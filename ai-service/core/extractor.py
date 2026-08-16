import io
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def extract_text(file_bytes: bytes, filename: str) -> str:
    """
    Extract plain text from a document.
    Supports: PDF, DOCX, PPTX, TXT, MD.
    Returns a single string; caller is responsible for chunking.
    """
    suffix = Path(filename).suffix.lower()

    try:
        if suffix == ".pdf":
            return _extract_pdf(file_bytes)
        elif suffix in (".docx", ".doc"):
            return _extract_docx(file_bytes)
        elif suffix in (".pptx", ".ppt"):
            return _extract_pptx(file_bytes)
        elif suffix in (".txt", ".md"):
            return file_bytes.decode("utf-8", errors="replace")
        else:
            logger.warning(f"No extractor for {suffix}, treating as UTF-8 text")
            return file_bytes.decode("utf-8", errors="replace")
    except Exception as e:
        logger.error(f"Extraction failed for {filename}: {e}", exc_info=True)
        raise


def _extract_pdf(file_bytes: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    pages_text = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
            if text.strip():
                pages_text.append(f"[Page {i + 1}]\n{text}")
        except Exception as e:
            logger.warning(f"Failed to extract page {i + 1}: {e}")
    return "\n\n".join(pages_text)


def _extract_docx(file_bytes: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            parts.append(para.text)
    # Include table content too
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
            if row_text:
                parts.append(row_text)
    return "\n\n".join(parts)


def _extract_pptx(file_bytes: bytes) -> str:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(file_bytes))
    slides_text = []
    for i, slide in enumerate(prs.slides, 1):
        slide_parts = [f"[Slide {i}]"]
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    if para.text.strip():
                        slide_parts.append(para.text)
            if shape.has_table:
                for row in shape.table.rows:
                    row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                    if row_text:
                        slide_parts.append(row_text)
        if len(slide_parts) > 1:
            slides_text.append("\n".join(slide_parts))
    return "\n\n".join(slides_text)