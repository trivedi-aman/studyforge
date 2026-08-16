"""
RAG core: embed query → similarity search → build context prompt.
Used by /chat, /summarize, /explain, and later by job workers.
"""
import logging
from core.database import get_db
from core.embeddings import embed_text

logger = logging.getLogger(__name__)


def retrieve_chunks(
    document_id: str,
    query: str,
    top_k: int = 5,
) -> list[dict]:
    """
    Embed the query and pgvector-search against document_chunks
    scoped to this document. Returns the top_k most similar chunks.
    """
    db = get_db()

    query_embedding = embed_text(query)

    # Call the SQL function we created in the migration
    res = db.rpc(
        "match_document_chunks",
        {
            "query_embedding": query_embedding,
            "match_document_id": document_id,
            "match_count": top_k,
        },
    ).execute()

    return res.data or []


def get_all_chunks(document_id: str, max_chunks: int = 30) -> list[dict]:
    """
    Fetch ALL chunks for a document (in order).
    Used by /summarize where we don't have a query to search by.
    Capped at max_chunks so we don't blow the LLM context window.
    """
    db = get_db()
    res = (
        db.table("document_chunks")
        .select("chunk_index, content")
        .eq("document_id", document_id)
        .order("chunk_index")
        .limit(max_chunks)
        .execute()
    )
    return res.data or []


def build_context(chunks: list[dict]) -> str:
    """Assemble retrieved chunks into a single context string for the LLM."""
    if not chunks:
        return "(no relevant context found)"
    parts = []
    for i, c in enumerate(chunks, 1):
        parts.append(f"--- Excerpt {i} ---\n{c['content'].strip()}")
    return "\n\n".join(parts)