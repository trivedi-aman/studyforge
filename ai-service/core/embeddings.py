import logging
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

_model: SentenceTransformer | None = None
MODEL_NAME = "all-MiniLM-L6-v2"  # 384-dim, matches document_chunks.embedding VECTOR(384)


def get_embedder() -> SentenceTransformer:
    """
    Lazy-load the embedding model once per process.
    First call takes ~5-10s to download+load; subsequent calls are instant.
    """
    global _model
    if _model is None:
        logger.info(f"Loading embedding model: {MODEL_NAME}")
        _model = SentenceTransformer(MODEL_NAME)
        logger.info("Embedding model loaded.")
    return _model


def embed_text(text: str) -> list[float]:
    """Embed a single string. Returns a 384-dim float list."""
    return get_embedder().encode(text, normalize_embeddings=True).tolist()


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed many strings at once (much faster than one-by-one)."""
    vecs = get_embedder().encode(texts, normalize_embeddings=True, batch_size=32)
    return [v.tolist() for v in vecs]