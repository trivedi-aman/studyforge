"""
All three synchronous RAG endpoints: /chat, /summarize, /explain.
They share the same retrieval pattern, differ only in prompts.
"""
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import verify_service_key
from core.database import get_db
from core.llm import chat_completion, MODEL_RAG, MODEL_SUMMARIZATION
from services.rag import retrieve_chunks, get_all_chunks, build_context

router = APIRouter(tags=["ai"])
logger = logging.getLogger(__name__)


# ============================================================
# /chat
# ============================================================
class ChatRequest(BaseModel):
    document_id: str
    session_id: Optional[str] = None
    message: str


class ChatResponse(BaseModel):
    session_id: str
    answer: str


CHAT_SYSTEM_PROMPT = """You are a helpful study assistant. You answer questions strictly \
based on the provided document excerpts. If the excerpts don't contain the answer, say so \
honestly — don't invent facts. Cite specific ideas from the excerpts when useful. Keep \
answers concise but complete, and use plain language."""


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, _: bool = Depends(verify_service_key)):
    db = get_db()

    # 1. Verify document exists + get user_id for session creation
    doc_res = db.table("documents").select("id, user_id, filename").eq("id", body.document_id).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = doc_res.data[0]

    # 2. Ensure a chat session
    session_id = body.session_id
    if not session_id:
        s_res = db.table("chat_sessions").insert({
            "document_id": body.document_id,
            "user_id": doc["user_id"],
        }).execute()
        if not s_res.data:
            raise HTTPException(status_code=500, detail="Could not create chat session")
        session_id = s_res.data[0]["id"]
        logger.info(f"Created chat session {session_id} for doc {body.document_id}")

    # 3. Retrieve relevant chunks via RAG
    chunks = retrieve_chunks(body.document_id, body.message, top_k=5)
    context = build_context(chunks)

    # 4. Build the prompt
    user_prompt = f"""Document excerpts:

{context}

---

Question: {body.message}

Answer based on the excerpts above."""

    # 5. Save user message
    db.table("chat_messages").insert({
        "session_id": session_id,
        "role": "user",
        "content": body.message,
    }).execute()

    # 6. Call Groq
    try:
        answer = chat_completion(
            key_name="rag",
            model=MODEL_RAG,
            messages=[
                {"role": "system", "content": CHAT_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=1024,
            temperature=0.3,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    # 7. Save assistant message
    db.table("chat_messages").insert({
        "session_id": session_id,
        "role": "assistant",
        "content": answer,
    }).execute()

    return ChatResponse(session_id=session_id, answer=answer)


# ============================================================
# /summarize
# ============================================================
class SummarizeRequest(BaseModel):
    document_id: str


class SummarizeResponse(BaseModel):
    summary: str


SUMMARIZE_SYSTEM_PROMPT = """You are an expert at making crisp document summaries. \
Produce a SHORT, focused summary — no filler, no meta-commentary, no "this document \
discusses..." lead-ins. Structure:

1. One-sentence overview
2. 3-5 key points as bullets (one line each)
3. One takeaway sentence if useful

Total length: under 150 words. Terse and useful, not academic."""


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize(body: SummarizeRequest, _: bool = Depends(verify_service_key)):
    db = get_db()

    doc_res = db.table("documents").select("id, filename").eq("id", body.document_id).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = doc_res.data[0]

    # For summarize, we grab the beginning of the document (first N chunks in order),
    # not top-similarity chunks — we want to summarize the whole thing.
    chunks = get_all_chunks(body.document_id, max_chunks=30)
    if not chunks:
        raise HTTPException(
            status_code=422,
            detail="Document has not been embedded yet. Try again in a moment.",
        )

    context = build_context(chunks)

    user_prompt = f"""Summarize the following document. Cover the main ideas, key concepts, \
and any important structure.

Document: "{doc['filename']}"

Content:
{context}"""

    try:
        summary = chat_completion(
            key_name="summarization",
            model=MODEL_SUMMARIZATION,
            messages=[
                {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=400,      # was 1200
            temperature=0.2,     # was 0.3 — more deterministic
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    return SummarizeResponse(summary=summary)


# ============================================================
# /explain
# ============================================================
class ExplainRequest(BaseModel):
    document_id: str
    text: str


class ExplainResponse(BaseModel):
    explanation: str


EXPLAIN_SYSTEM_PROMPT = """You are a patient tutor. The user has selected a piece of text \
from their document and wants it explained in plain language. Use the surrounding document \
context to give a clear, accurate explanation — define jargon, unpack dense sentences, and \
give a simple example if helpful. Keep it short (2-4 short paragraphs max)."""


@router.post("/explain", response_model=ExplainResponse)
async def explain(body: ExplainRequest, _: bool = Depends(verify_service_key)):
    db = get_db()

    doc_res = db.table("documents").select("id, filename").eq("id", body.document_id).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")

    if not body.text.strip():
        raise HTTPException(status_code=400, detail="No text provided to explain")

    # Retrieve chunks similar to the selected text (gives context around it)
    chunks = retrieve_chunks(body.document_id, body.text, top_k=4)
    context = build_context(chunks)

    user_prompt = f"""The user selected this text from their document and wants it explained:

"{body.text}"

Here are related excerpts from the same document for context:

{context}

Explain the selected text clearly, using the context to inform your explanation."""

    try:
        explanation = chat_completion(
            key_name="rag",
            model=MODEL_RAG,
            messages=[
                {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=800,
            temperature=0.4,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {e}")

    return ExplainResponse(explanation=explanation)