"""
Async job endpoints.
Pattern (README Section 7/9):
- Client POST → we create ai_jobs row (pending), spawn a background task,
  return job_id IMMEDIATELY.
- Background task runs, updates ai_jobs row (processing → done/failed).
- Client polls GET /jobs/{job_id} every few seconds for status.
"""
import json
import logging
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import re

from core.auth import verify_service_key
from core.database import get_db
from core.storage import upload_file
from core.llm import chat_completion, MODEL_STRUCTURED
from services.ppt_renderer import render_pptx, TEMPLATES

router = APIRouter(prefix="/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)


# ============================================================
# Helpers
# ============================================================
def _create_job(user_id: str, job_type: str, payload: dict) -> str:
    db = get_db()
    res = db.table("ai_jobs").insert({
        "user_id": user_id,
        "job_type": job_type,
        "status": "pending",
        "input_payload": payload,
    }).execute()
    return res.data[0]["id"]


def _update_job(job_id: str, **fields):
    db = get_db()
    db.table("ai_jobs").update(fields).eq("id", job_id).execute()


def _fail_job(job_id: str, message: str):
    logger.error(f"Job {job_id} failed: {message}")
    _update_job(job_id, status="failed", error_message=message)


# ============================================================
# /jobs/text-to-ppt
# ============================================================
class TextToPptRequest(BaseModel):
    user_id: str
    topic_or_text: str
    target_folder_id: Optional[str] = None
    template: str = "modern"
    font: str = "Inter"
    theme: str = "light"
    slide_count: Optional[int] = None


class JobStartResponse(BaseModel):
    job_id: str


@router.post("/text-to-ppt", response_model=JobStartResponse)
async def start_text_to_ppt(
    body: TextToPptRequest,
    background_tasks: BackgroundTasks,
    _: bool = Depends(verify_service_key),
):
    job_id = _create_job(body.user_id, "text_to_ppt", body.model_dump())
    background_tasks.add_task(_process_text_to_ppt, job_id, body)
    logger.info(f"Started text-to-ppt job {job_id}")
    return JobStartResponse(job_id=job_id)


def _process_text_to_ppt(job_id: str, body: TextToPptRequest):
    """Background task: generate outline via Groq, render .pptx, upload, create doc row."""
    try:
        _update_job(job_id, status="processing")

        # 1. Generate outline via LLM
        outline = _generate_slide_outline(body.topic_or_text, body.slide_count)
        if not outline or not outline.get("slides"):
            _fail_job(job_id, "AI returned no slides — try rephrasing your topic.")
            return

        # 2. Render .pptx
        try:
            pptx_bytes = render_pptx(outline, body.template, body.font)
        except Exception as e:
            _fail_job(job_id, f"PPTX rendering failed: {e}")
            return

        # 3. Upload PPTX to S3
        doc_id = str(uuid.uuid4())
        pptx_key = f"users/{body.user_id}/generated/{doc_id}/output.pptx"
        upload_file(
            pptx_key,
            pptx_bytes,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )

        # 3b. Generate HTML preview so it renders inside Studyforge
        preview_html_key = None
        try:
            from services.pptx_to_html import pptx_to_html
            html_str = pptx_to_html(pptx_bytes)
            preview_html_key = f"users/{body.user_id}/generated/{doc_id}/preview.html"
            upload_file(preview_html_key, html_str.encode("utf-8"), "text/html; charset=utf-8")
            logger.info(f"Generated HTML preview: {preview_html_key}")
        except Exception as e:
            logger.warning(f"HTML preview generation failed (non-fatal): {e}")

        # 4. Create documents row
        title = outline.get("title", body.topic_or_text)[:60]
        filename = f"{title}.pptx"

        db = get_db()
        doc_payload = {
            "id": doc_id,
            "user_id": body.user_id,
            "folder_id": body.target_folder_id,
            "filename": filename,
            "file_type": "pptx",
            "original_s3_key": pptx_key,
            "preview_pdf_s3_key": preview_html_key,  # HTML preview, not PDF — field name is legacy
            "is_ai_generated": True,
            "source_type": "text_to_ppt",
            "current_version": 1,
            "display_metadata": {
                "template": body.template,
                "font": body.font,
                "theme": body.theme,
                "slide_count": len(outline.get("slides", [])),
            },
            "file_size_bytes": len(pptx_bytes),
        }
        db.table("documents").insert(doc_payload).execute()

        # Every document needs at least one document_versions row
        db.table("document_versions").insert({
            "document_id": doc_id,
            "version_number": 1,
            "s3_key": pptx_key,
            "file_size_bytes": len(pptx_bytes),
            "uploaded_by": body.user_id,
        }).execute()

        # 5. Mark job done
        _update_job(
            job_id,
            status="done",
            result_document_id=doc_id,
            completed_at="now()",
        )
        logger.info(f"Text-to-PPT job {job_id} done → doc {doc_id}")

    except Exception as e:
        logger.exception(f"Text-to-PPT job {job_id} crashed")
        _fail_job(job_id, f"Unexpected error: {e}")
def _generate_slide_outline(topic_or_text: str, slide_count: Optional[int]) -> dict:
    """Ask Groq to produce structured JSON with slide headings + bullets."""
    slide_hint = f"exactly {slide_count} slides" if slide_count else "5-8 slides"

    system_prompt = """You are an expert at structuring content into clear presentation \
slides. You output ONLY valid JSON matching the exact schema requested. No markdown fences, \
no explanations, no extra text — just the JSON object."""

    user_prompt = f"""Create a presentation outline for the following topic/text.
Produce {slide_hint}. Each slide should have a short heading and 3-5 concise bullet points.
The first slide's heading acts as an intro; the last slide should wrap up.

Topic or text:
{topic_or_text}

Output ONLY this JSON structure (no surrounding text, no code fences):
{{
  "title": "Overall presentation title",
  "slides": [
    {{"heading": "Slide 1 heading", "bullets": ["point 1", "point 2", "point 3"]}},
    {{"heading": "Slide 2 heading", "bullets": ["point 1", "point 2", "point 3"]}}
  ]
}}"""

    raw = chat_completion(
        key_name="structured",
        model=MODEL_STRUCTURED,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=2000,
        temperature=0.4,
    )

    # Sometimes LLMs sneak in markdown fences despite instructions — strip them
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
        if raw.endswith("```"):
            raw = raw[:-3].strip()

    try:
        outline = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"LLM returned invalid JSON: {raw[:500]}")
        raise ValueError(f"AI returned invalid JSON: {e}")

    # Basic validation
    if not isinstance(outline, dict) or "slides" not in outline:
        raise ValueError("AI output missing 'slides' array")

    return outline


# ============================================================
# /jobs/ppt-to-notes  (stub — implement next)
# ============================================================
class PptToNotesRequest(BaseModel):
    user_id: str
    source_document_id: str
    target_folder_id: Optional[str] = None


@router.post("/ppt-to-notes", response_model=JobStartResponse)
async def start_ppt_to_notes(
    body: PptToNotesRequest,
    background_tasks: BackgroundTasks,
    _: bool = Depends(verify_service_key),
):
    job_id = _create_job(body.user_id, "ppt_to_notes", body.model_dump())
    background_tasks.add_task(_process_ppt_to_notes, job_id, body)
    return JobStartResponse(job_id=job_id)


def _process_ppt_to_notes(job_id: str, body: PptToNotesRequest):
    """Turn any document into structured Markdown notes."""
    from services.rag import get_all_chunks, build_context
    from core.llm import chat_completion, MODEL_SUMMARIZATION

    try:
        _update_job(job_id, status="processing")
        db = get_db()

        # Get source doc
        src_res = db.table("documents").select("*").eq("id", body.source_document_id).execute()
        if not src_res.data:
            _fail_job(job_id, "Source document not found")
            return
        src = src_res.data[0]

        # Read all chunks (should already be embedded from prior AI use;
        # if not, caller should have embedded first — but let's be safe)
        chunks = get_all_chunks(body.source_document_id, max_chunks=40)
        if not chunks:
            _fail_job(job_id, "Source document has no extracted content. Try opening it and using AI first to embed it.")
            return

        context = build_context(chunks)

        system = """You are an expert study-notes generator. Given a document's content, \
produce clean, well-structured Markdown notes that a student could actually study from. \
Use headings, bullets, and short paragraphs. Preserve important facts and definitions."""

        user_prompt = f"""Turn the following document content into clean study notes in Markdown.

Source document: "{src['filename']}"

Content:
{context}

Output ONLY Markdown — no code fences around the whole thing, no preamble."""

        md = chat_completion(
            key_name="summarization",
            model=MODEL_SUMMARIZATION,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=3000,
            temperature=0.3,
        )

        # Save
        doc_id = str(uuid.uuid4())
        md_key = f"users/{body.user_id}/generated/{doc_id}/output.md"
        upload_file(md_key, md.encode("utf-8"), "text/markdown; charset=utf-8")

        base_name = src["filename"].rsplit(".", 1)[0]
        filename = f"{base_name} — Notes.md"

        db.table("documents").insert({
            "id": doc_id,
            "user_id": body.user_id,
            "folder_id": body.target_folder_id,
            "filename": filename,
            "file_type": "md",
            "original_s3_key": md_key,
            "preview_pdf_s3_key": None,
            "is_ai_generated": True,
            "source_type": "ppt_to_notes",
            "current_version": 1,
            "display_metadata": {
                "cover_color": "#6C5CE7",
                "font": "Source Serif 4",
                "icon": "📝",
            },
            "file_size_bytes": len(md.encode("utf-8")),
        }).execute()

        db.table("document_versions").insert({
            "document_id": doc_id,
            "version_number": 1,
            "s3_key": md_key,
            "file_size_bytes": len(md.encode("utf-8")),
            "uploaded_by": body.user_id,
        }).execute()

        # Also seed notes_content so the notebook UI can load it instantly
        db.table("notes_content").insert({
            "document_id": doc_id,
            "content": md,
        }).execute()

        _update_job(job_id, status="done", result_document_id=doc_id, completed_at="now()")
        logger.info(f"PPT-to-Notes job {job_id} done → doc {doc_id}")

    except Exception as e:
        logger.exception(f"PPT-to-Notes job {job_id} crashed")
        _fail_job(job_id, f"Unexpected error: {e}")


# ============================================================
# /jobs/{job_id}  (polling endpoint)
# ============================================================
@router.get("/{job_id}")
async def get_job_status(job_id: str, _: bool = Depends(verify_service_key)):
    db = get_db()
    res = db.table("ai_jobs").select("*").eq("id", job_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Job not found")
    return res.data[0]





# ============================================================
# /jobs/youtube-to-notes
# ============================================================
class YoutubeToNotesRequest(BaseModel):
    user_id: str
    youtube_url: str
    target_folder_id: Optional[str] = None


@router.post("/youtube-to-notes", response_model=JobStartResponse)
async def start_youtube_to_notes(
    body: YoutubeToNotesRequest,
    background_tasks: BackgroundTasks,
    _: bool = Depends(verify_service_key),
):
    job_id = _create_job(body.user_id, "youtube_to_notes", body.model_dump())
    background_tasks.add_task(_process_youtube_to_notes, job_id, body)
    return JobStartResponse(job_id=job_id)



def _extract_video_id(url: str) -> Optional[str]:
    """Handle youtu.be/xxx, youtube.com/watch?v=xxx, youtube.com/embed/xxx, shorts/xxx."""
    import re
    patterns = [
        r"(?:v=|/videos/|embed/|youtu\.be/|/v/|watch\?v=|/shorts/)([\w-]{11})",
        r"^([\w-]{11})$",  # raw ID
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


def _process_youtube_to_notes(job_id: str, body: YoutubeToNotesRequest):
    try:
        _update_job(job_id, status="processing")

        # 1. Extract video ID
        video_id = _extract_video_id(body.youtube_url)
        if not video_id:
            _fail_job(job_id, "Could not parse YouTube URL. Please paste a valid video link.")
            return

        # 2. Fetch transcript — handle both old and new youtube-transcript-api APIs
        full_transcript = _fetch_transcript(video_id)
        if full_transcript is None:
            # _fail_job already called inside _fetch_transcript
            _fail_job(job_id, "Could not retrieve transcript for this video.")
            return

        if len(full_transcript.strip()) < 100:
            _fail_job(job_id, "Transcript was too short to generate notes from.")
            return

        # 3. Generate notes
        from core.llm import chat_completion, MODEL_SUMMARIZATION

        system = """You are an expert at turning video transcripts into clean, \
well-structured study notes in Markdown. Extract the key ideas, organize them under \
headings, and use bullets for details. Skip filler ("as you can see", "um", etc.). \
Focus on facts, definitions, and actionable takeaways."""

        user_prompt = f"""Turn this YouTube video transcript into study notes.

Video URL: {body.youtube_url}

Transcript:
{full_transcript}

Output ONLY clean Markdown notes — no code fences, no preamble. Start with a # heading \
that captures the video's topic."""

        md = chat_completion(
            key_name="summarization",
            model=MODEL_SUMMARIZATION,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=3000,
            temperature=0.3,
        )

        # 4. Save to S3 + create documents row
        doc_id = str(uuid.uuid4())
        md_key = f"users/{body.user_id}/generated/{doc_id}/output.md"
        upload_file(md_key, md.encode("utf-8"), "text/markdown; charset=utf-8")

        # Try to extract a title from the first heading
        first_line = md.strip().split("\n", 1)[0].strip()
        title = first_line.lstrip("#").strip() if first_line.startswith("#") else "YouTube Notes"
        filename = f"{title[:60]}.md"

        db = get_db()
        db.table("documents").insert({
            "id": doc_id,
            "user_id": body.user_id,
            "folder_id": body.target_folder_id,
            "filename": filename,
            "file_type": "md",
            "original_s3_key": md_key,
            "preview_pdf_s3_key": None,
            "is_ai_generated": True,
            "source_type": "youtube_notes",
            "current_version": 1,
            "display_metadata": {
                "cover_color": "#2678C9",
                "font": "Source Serif 4",
                "icon": "🎬",
                "source_url": body.youtube_url,
            },
            "file_size_bytes": len(md.encode("utf-8")),
        }).execute()

        db.table("document_versions").insert({
            "document_id": doc_id,
            "version_number": 1,
            "s3_key": md_key,
            "file_size_bytes": len(md.encode("utf-8")),
            "uploaded_by": body.user_id,
        }).execute()

        db.table("notes_content").insert({
            "document_id": doc_id,
            "content": md,
        }).execute()

        _update_job(job_id, status="done", result_document_id=doc_id, completed_at="now()")
        logger.info(f"YouTube-to-Notes job {job_id} done → doc {doc_id}")

    except Exception as e:
        logger.exception(f"YouTube-to-Notes job {job_id} crashed")
        _fail_job(job_id, f"Unexpected error: {e}")


def _fetch_transcript(video_id: str) -> Optional[str]:
    """
    Fetch transcript text for a YouTube video.
    Handles both youtube-transcript-api 0.6.x (legacy class-method API)
    and the newer instance-based API introduced in 0.7+.
    Returns concatenated transcript text, or None on failure.
    """
    # --- Strategy 1: new API (0.7+) ---
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        ytt = YouTubeTranscriptApi()
        fetched = ytt.fetch(video_id, languages=["en", "en-US"])
        # FetchedTranscript is iterable of snippet objects with .text
        segments = list(fetched)
        text = " ".join(
            seg.text if hasattr(seg, "text") else seg["text"]
            for seg in segments
        )
        if len(text) > 30000:
            text = text[:30000] + "\n\n[transcript truncated]"
        logger.info(f"Fetched transcript for {video_id} via new API ({len(text)} chars)")
        return text
    except TypeError:
        # YouTubeTranscriptApi() can't be instantiated — old API, fall through
        pass
    except Exception as e:
        err = str(e).lower()
        if any(kw in err for kw in ("disabled", "unavailable", "no transcript", "private")):
            logger.warning(f"Transcript unavailable for {video_id}: {e}")
            return None
        logger.warning(f"New API fetch failed for {video_id}, trying legacy: {e}")

    # --- Strategy 2: legacy class-method API (0.6.x) ---
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript_list = YouTubeTranscriptApi.get_transcript(
            video_id, languages=["en", "en-US"]
        )
        text = " ".join(seg["text"] for seg in transcript_list)
        if len(text) > 30000:
            text = text[:30000] + "\n\n[transcript truncated]"
        logger.info(f"Fetched transcript for {video_id} via legacy API ({len(text)} chars)")
        return text
    except Exception as e:
        err = str(e).lower()
        if any(kw in err for kw in ("disabled", "unavailable", "no transcript", "private")):
            logger.warning(f"Transcript unavailable for {video_id}: {e}")
            return None
        logger.error(f"Legacy API also failed for {video_id}: {e}")
        return None

