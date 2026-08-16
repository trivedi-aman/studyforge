"""
Simple, deterministic text chunker.
Splits by paragraph first, then packs paragraphs into chunks of ~500 tokens
(approximated by characters, since we don't need token-perfect chunks for
retrieval — approximation is fine).
"""

CHUNK_CHAR_SIZE = 2000     # ~500 tokens (rough: 1 token ≈ 4 chars)
CHUNK_OVERLAP_CHARS = 200  # ~50 tokens of overlap between chunks


def chunk_text(text: str) -> list[str]:
    """
    Break text into overlapping chunks suitable for embedding.
    Tries to respect paragraph boundaries first, then falls back to
    hard character splits if a single paragraph is too long.
    """
    if not text or not text.strip():
        return []

    # Split on double-newlines (paragraphs)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        # If this paragraph alone is bigger than our target, hard-split it
        if len(para) > CHUNK_CHAR_SIZE:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_split(para))
            continue

        # If adding this paragraph would overflow, flush current
        if current and len(current) + len(para) + 2 > CHUNK_CHAR_SIZE:
            chunks.append(current)
            # Start next chunk with overlap from end of previous one
            current = current[-CHUNK_OVERLAP_CHARS:] + "\n\n" + para
        else:
            current = f"{current}\n\n{para}" if current else para

    if current:
        chunks.append(current)

    return chunks


def _hard_split(text: str) -> list[str]:
    """Fallback for pathologically long paragraphs — split by character count."""
    chunks = []
    step = CHUNK_CHAR_SIZE - CHUNK_OVERLAP_CHARS
    for i in range(0, len(text), step):
        chunk = text[i : i + CHUNK_CHAR_SIZE]
        if chunk.strip():
            chunks.append(chunk)
    return chunks