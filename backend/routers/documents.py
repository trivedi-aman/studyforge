import io
import uuid
import mimetypes
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import JSONResponse
from core.auth import get_current_user
from core.database import get_service_db
from core.storage import upload_file, generate_presigned_url, delete_file
from core.config import get_settings
from models.document import DocumentOut, DocumentUpdate
from pydantic import BaseModel
from fastapi.responses import PlainTextResponse
from core.converter import convert_to_html, is_convertible



router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_TYPES = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "image/png": "image", "image/jpeg": "image", "image/gif": "image", "image/webp": "image",
    "text/plain": "txt",
    "text/markdown": "md",
}

EXT_FALLBACK = {
    ".pdf": "pdf", ".docx": "docx", ".pptx": "pptx", ".xlsx": "xlsx",
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image",
    ".txt": "txt", ".md": "md",
}


def detect_file_type(file: UploadFile) -> str:
    ct = file.content_type or ""
    if ct in ALLOWED_TYPES:
        return ALLOWED_TYPES[ct]
    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext in EXT_FALLBACK:
        return EXT_FALLBACK[ext]
    raise HTTPException(status_code=415, detail=f"Unsupported file type: {ct}")


def _enrich_documents(docs: list, user_id: str, db) -> list:
    """Add favorite flag and tags list to each document dict."""
    if not docs:
        return []
    doc_ids = [d["id"] for d in docs]

    # Favorites
    favs = db.table("favorites").select("document_id").eq("user_id", user_id).in_("document_id", doc_ids).execute()
    fav_set = {f["document_id"] for f in (favs.data or [])}

    # Tags
    tag_rows = db.table("document_tags").select("document_id, tag_id").in_("document_id", doc_ids).execute()
    tags_map: dict[str, list] = {}
    for row in (tag_rows.data or []):
        tags_map.setdefault(row["document_id"], []).append(row["tag_id"])

    for d in docs:
        d["favorite"] = d["id"] in fav_set
        d["tags"] = tags_map.get(d["id"], [])

    return docs


# ---- list / search ----

@router.get("")
async def list_documents(
    folder_id: str | None = Query(None),
    user=Depends(get_current_user),
):
    db = get_service_db()
    q = db.table("documents").select("*").eq("user_id", user["user_id"])
    if folder_id:
        q = q.eq("folder_id", folder_id)
    else:
        q = q.is_("folder_id", "null")
    res = q.order("created_at", desc=True).execute()
    return _enrich_documents(res.data or [], user["user_id"], db)


@router.get("/favorites")
async def list_favorites(user=Depends(get_current_user)):
    db = get_service_db()
    favs = db.table("favorites").select("document_id").eq("user_id", user["user_id"]).execute()
    doc_ids = [f["document_id"] for f in (favs.data or [])]
    if not doc_ids:
        return []
    res = db.table("documents").select("*").in_("id", doc_ids).execute()
    return _enrich_documents(res.data or [], user["user_id"], db)


@router.get("/search")
async def search_documents(q: str = Query(...), user=Depends(get_current_user)):
    db = get_service_db()
    res = (
        db.table("documents")
        .select("*")
        .eq("user_id", user["user_id"])
        .ilike("filename", f"%{q}%")
        .execute()
    )
    return _enrich_documents(res.data or [], user["user_id"], db)


# ---- get single ----

@router.get("/{doc_id}")
async def get_document(doc_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    res = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found")
    docs = _enrich_documents(res.data, user["user_id"], db)
    return docs[0]


# ---- upload ----

@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    folder_id: str | None = Form(None),
    user=Depends(get_current_user),
):
    file_type = detect_file_type(file)
    data = await file.read()
    file_size = len(data)
    doc_id = str(uuid.uuid4())
    user_id = user["user_id"]

    import os
    ext = os.path.splitext(file.filename or "")[1].lower() or f".{file_type}"
    original_key = f"users/{user_id}/uploads/{doc_id}/v1/original{ext}"

    upload_file(original_key, data, file.content_type or "application/octet-stream")

    # ---- LibreOffice conversion for DOCX/PPTX/XLSX ----
        # ---- HTML conversion for DOCX/PPTX/XLSX ----
    preview_pdf_key = None
    if is_convertible(file_type):
        html_str = convert_to_html(data, file.filename or f"file{ext}")
        if html_str:
            preview_pdf_key = f"users/{user_id}/uploads/{doc_id}/v1/preview.html"
            upload_file(preview_pdf_key, html_str.encode("utf-8"), "text/html; charset=utf-8")
        else:
            import logging
            logging.getLogger(__name__).warning(
                f"HTML preview generation failed for {file.filename}"
            )

    db = get_service_db()
    doc_payload = {
        "id": doc_id,
        "user_id": user_id,
        "folder_id": folder_id or None,
        "filename": file.filename,
        "file_type": file_type,
        "original_s3_key": original_key,
        "preview_pdf_s3_key": preview_pdf_key,   # None for PDF/image/txt/md, real key for converted
        "is_ai_generated": False,
        "source_type": "upload",
        "current_version": 1,
        "display_metadata": {},
        "file_size_bytes": file_size,
    }
    doc_res = db.table("documents").insert(doc_payload).execute()
    if not doc_res.data:
        raise HTTPException(status_code=500, detail="Failed to create document record")

    # Version 1
    db.table("document_versions").insert({
        "document_id": doc_id,
        "version_number": 1,
        "s3_key": original_key,
        "file_size_bytes": file_size,
        "uploaded_by": user_id,
    }).execute()

    # Seed notes_content for .md files
    if file_type == "md":
        try:
            text_content = data.decode("utf-8")
        except UnicodeDecodeError:
            text_content = data.decode("latin-1")
        db.table("notes_content").insert({
            "document_id": doc_id,
            "content": text_content,
        }).execute()

    # Activity log
    db.table("activity_log").insert({
        "user_id": user_id,
        "action_type": "upload",
        "document_id": doc_id,
        "metadata": {"filename": file.filename},
    }).execute()

    doc = doc_res.data[0]
    doc["favorite"] = False
    doc["tags"] = []
    return doc



@router.patch("/{doc_id}")
async def update_document(doc_id: str, body: DocumentUpdate, user=Depends(get_current_user)):
    db = get_service_db()
    existing = db.table("documents").select("id").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Document not found")

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = db.table("documents").update(patch).eq("id", doc_id).execute()
    return res.data[0]


# ---- delete ----

@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    doc = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")
    d = doc.data[0]

    # Delete S3 objects
    delete_file(d["original_s3_key"])
    if d.get("preview_pdf_s3_key"):
        delete_file(d["preview_pdf_s3_key"])

    db.table("documents").delete().eq("id", doc_id).execute()
    return None


# ---- favorite toggle ----

@router.post("/{doc_id}/favorite")
async def toggle_favorite(doc_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    user_id = user["user_id"]
    existing = db.table("favorites").select("*").eq("user_id", user_id).eq("document_id", doc_id).execute()
    if existing.data:
        db.table("favorites").delete().eq("user_id", user_id).eq("document_id", doc_id).execute()
        return {"favorite": False}
    else:
        db.table("favorites").insert({"user_id": user_id, "document_id": doc_id}).execute()
        return {"favorite": True}


# ---- versions ----

@router.get("/{doc_id}/versions")
async def list_versions(doc_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    # Verify ownership
    doc = db.table("documents").select("id").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")

    res = db.table("document_versions").select("*").eq("document_id", doc_id).order("version_number").execute()
    return res.data


@router.post("/{doc_id}/versions", status_code=201)
async def replace_file(
    doc_id: str,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    """Explicit Replace File — the ONLY action that creates a new document_versions row."""
    db = get_service_db()
    doc_res = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = doc_res.data[0]

    data = await file.read()
    file_size = len(data)
    new_version = doc["current_version"] + 1
    user_id = user["user_id"]

    import os
    ext = os.path.splitext(file.filename or "")[1].lower() or ".bin"
    new_key = f"users/{user_id}/uploads/{doc_id}/v{new_version}/original{ext}"
    upload_file(new_key, data, file.content_type or "application/octet-stream")

    # Detect new file type and convert if needed
    new_file_type = detect_file_type(file)
    new_preview_key = None

    if is_convertible(new_file_type):
        html_str = convert_to_html(data, file.filename or f"file{ext}")
        if html_str:
            new_preview_key = f"users/{user_id}/uploads/{doc_id}/v{new_version}/preview.html"
            upload_file(new_preview_key, html_str.encode("utf-8"), "text/html; charset=utf-8")

    # Insert new version row
    db.table("document_versions").insert({
        "document_id": doc_id,
        "version_number": new_version,
        "s3_key": new_key,
        "file_size_bytes": file_size,
        "uploaded_by": user_id,
    }).execute()

    # Update document
    update_payload = {
        "current_version": new_version,
        "original_s3_key": new_key,
        "file_size_bytes": file_size,
        "file_type": new_file_type,
    }
    # Only update preview key if we have one, or if the new file
    # doesn't need one (PDF/image/txt) — clear any stale key
    if new_file_type in {"pdf", "image", "txt", "md"}:
        update_payload["preview_pdf_s3_key"] = None
    elif new_preview_key:
        update_payload["preview_pdf_s3_key"] = new_preview_key
    # If conversion failed, leave the existing preview key alone
    # (better than clearing it and showing nothing)

    updated = db.table("documents").update(update_payload).eq("id", doc_id).execute()

    db.table("activity_log").insert({
        "user_id": user_id,
        "action_type": "restore_version",
        "document_id": doc_id,
        "metadata": {"new_version": new_version},
    }).execute()

    return updated.data[0]


@router.post("/{doc_id}/versions/{version_number}/restore")
async def restore_version(doc_id: str, version_number: int, user=Depends(get_current_user)):
    db = get_service_db()
    doc_res = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")

    ver = db.table("document_versions").select("*").eq("document_id", doc_id).eq("version_number", version_number).execute()
    if not ver.data:
        raise HTTPException(status_code=404, detail="Version not found")
    v = ver.data[0]

    db.table("documents").update({
        "current_version": version_number,
        "original_s3_key": v["s3_key"],
        "file_size_bytes": v["file_size_bytes"],
    }).eq("id", doc_id).execute()

    return {"restored": version_number}


# ---- notes content ----


@router.get("/{doc_id}/content", response_class=PlainTextResponse)
async def get_notes_content(doc_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    doc = db.table("documents").select("id,file_type").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")

    res = db.table("notes_content").select("content").eq("document_id", doc_id).execute()
    if res.data:
        return res.data[0]["content"]
    return "# Untitled Notes\n\nStart writing…"


class NotesContentBody(BaseModel):
    content: str


@router.put("/{doc_id}/content")
async def save_notes_content(doc_id: str, body: NotesContentBody, user=Depends(get_current_user)):
    db = get_service_db()
    doc_res = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")
    doc = doc_res.data[0]

    # Upsert notes_content
    db.table("notes_content").upsert({
        "document_id": doc_id,
        "content": body.content,
        "updated_at": "now()",
    }).execute()

    # Create a new version row for the edit (README 2.6)
    new_version = doc["current_version"] + 1
    user_id = user["user_id"]
    new_key = f"users/{user_id}/uploads/{doc_id}/v{new_version}/output.md"

    # Upload updated markdown to S3
    upload_file(new_key, body.content.encode("utf-8"), "text/markdown")

    db.table("document_versions").insert({
        "document_id": doc_id,
        "version_number": new_version,
        "s3_key": new_key,
        "file_size_bytes": len(body.content.encode("utf-8")),
        "uploaded_by": user_id,
    }).execute()

    db.table("documents").update({
        "current_version": new_version,
        "original_s3_key": new_key,
    }).eq("id", doc_id).execute()

    return {"saved": True, "new_version": new_version}


# ---- download URL ----

@router.get("/{doc_id}/download")
async def get_download_url(doc_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    doc = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")
    d = doc.data[0]
    url = generate_presigned_url(d["original_s3_key"])
    return {"url": url}


# ---- view URL (for PDF viewer) ----
@router.get("/{doc_id}/view-url")
async def get_view_url(doc_id: str, user=Depends(get_current_user)):
    """
    Returns a short-lived presigned S3 URL for the viewer.
    Prefers preview_pdf_s3_key (LibreOffice-converted) over original
    for DOCX/PPTX/XLSX. Falls back to original for PDFs and images.
    """
    db = get_service_db()
    doc_res = db.table("documents").select("*").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail="Document not found")
    d = doc_res.data[0]

    # Pick the right key
    key = d.get("preview_pdf_s3_key") or d.get("original_s3_key")
    if not key:
        raise HTTPException(status_code=404, detail="No file found for this document")

    try:
        url = generate_presigned_url(key, expires_in=3600)
        return {"url": url, "file_type": d["file_type"], "filename": d["filename"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not generate URL: {str(e)}")