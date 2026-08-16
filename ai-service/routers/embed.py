import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import verify_service_key
from core.database import get_db
from core.storage import download_file
from core.embeddings import embed_batch
from core.extractor import extract_text
from services.chunker import chunk_text

router = APIRouter(tags=["embed"])
logger = logging.getLogger(__name__)


class EmbedRequest(BaseModel):
    document_id: str


class EmbedResponse(BaseModel):
    status: str
    chunk_count: int
    already_embedded: bool = False


@router.post("/embed-document", response_model=EmbedResponse)
async def embed_document(
    body: EmbedRequest,
    _: bool = Depends(verify_service_key),
):
    """
    Lazily embed a document for RAG.
    - Fetches the document row from Supabase
    - Downloads the original file from S3
    - Extracts text, chunks it, embeds each chunk
    - Writes chunks + embeddings to document_chunks
    - Idempotent: if the document already has chunks, returns immediately
    """
    db = get_db()
    document_id = body.document_id

    # 1. Verify the document exists
    doc_res = db.table("documents").select("*").eq("id", document_id).execute()
    if not doc_res.data:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found")
    doc = doc_res.data[0]

    # 2. Skip if already embedded (README 2.7: lazy, not repeated)
    existing = (
        db.table("document_chunks")
        .select("id", count="exact")
        .eq("document_id", document_id)
        .limit(1)
        .execute()
    )
    if existing.count and existing.count > 0:
        logger.info(f"Document {document_id} already embedded ({existing.count} chunks)")
        return EmbedResponse(status="done", chunk_count=existing.count, already_embedded=True)

    # 3. Download the original file from S3
    s3_key = doc["original_s3_key"]
    if not s3_key:
        raise HTTPException(status_code=500, detail="Document has no S3 key")

    logger.info(f"Downloading {s3_key} for embedding")
    try:
        file_bytes = download_file(s3_key)
    except Exception as e:
        logger.error(f"S3 download failed: {e}")
        raise HTTPException(status_code=500, detail=f"Could not download file: {e}")

    # 4. Extract text
    try:
        text = extract_text(file_bytes, doc["filename"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text extraction failed: {e}")

    if not text.strip():
        raise HTTPException(status_code=422, detail="Document has no extractable text")

    logger.info(f"Extracted {len(text)} chars from {doc['filename']}")

    # 5. Chunk
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(status_code=422, detail="No usable chunks after chunking")

    logger.info(f"Split into {len(chunks)} chunks")

    # 6. Embed all chunks in one batch (much faster than one-by-one)
    embeddings = embed_batch(chunks)

    # 7. Insert into document_chunks
    rows = [
        {
            "document_id": document_id,
            "chunk_index": i,
            "content": chunk,
            "embedding": emb,
        }
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings))
    ]

    # Insert in batches to avoid oversized payloads
    BATCH = 50
    inserted = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i : i + BATCH]
        res = db.table("document_chunks").insert(batch).execute()
        inserted += len(res.data or [])

    logger.info(f"Inserted {inserted} chunks for document {document_id}")

    return EmbedResponse(status="done", chunk_count=inserted, already_embedded=False)