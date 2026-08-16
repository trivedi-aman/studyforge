import io
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

CONVERTIBLE = {"docx", "pptx", "xlsx", "doc", "ppt", "xls"}


def is_convertible(file_type: str) -> bool:
    return file_type.lower() in CONVERTIBLE


def convert_to_pdf(file_bytes: bytes, original_filename: str) -> bytes | None:
    suffix = Path(original_filename).suffix.lower()
    try:
        if suffix in (".pptx", ".ppt"):
            return _pptx_to_pdf(file_bytes)
        elif suffix in (".docx", ".doc"):
            return _docx_to_pdf(file_bytes)
        elif suffix in (".xlsx", ".xls"):
            return _xlsx_to_pdf(file_bytes)
        else:
            logger.warning(f"No converter for {suffix}")
            return None
    except Exception as e:
        logger.error(f"Conversion failed for {original_filename}: {e}", exc_info=True)
        return None


def _pptx_to_pdf(file_bytes: bytes) -> bytes:
    from pptx import Presentation
    from pptx.util import Emu
    from reportlab.lib.pagesizes import landscape
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.utils import ImageReader

    prs = Presentation(io.BytesIO(file_bytes))

    slide_width = prs.slide_width or Emu(9144000)
    slide_height = prs.slide_height or Emu(6858000)
    aspect = slide_width / slide_height

    pdf_w = 792  # 11 inches
    pdf_h = pdf_w / aspect

    buf = io.BytesIO()
    c = pdf_canvas.Canvas(buf, pagesize=(pdf_w, pdf_h))

    for slide_num, slide in enumerate(prs.slides, 1):
        # Background
        bg = slide.background
        bg_color = None
        if bg and bg.fill and bg.fill.type is not None:
            try:
                fc = bg.fill.fore_color
                if fc and fc.rgb:
                    r = fc.rgb[0:2]
                    g = fc.rgb[2:4]
                    b = fc.rgb[4:6]
                    bg_color = (int(r, 16) / 255, int(g, 16) / 255, int(b, 16) / 255)
            except Exception:
                pass

        if bg_color:
            c.setFillColorRGB(*bg_color)
            c.rect(0, 0, pdf_w, pdf_h, fill=1, stroke=0)

        for shape in slide.shapes:
            _render_shape(c, shape, slide_width, slide_height, pdf_w, pdf_h)

        c.showPage()

    c.save()
    buf.seek(0)
    result = buf.read()
    logger.info(f"PPTX → PDF: {len(prs.slides)} slides, {len(result)} bytes")
    return result


def _render_shape(c, shape, slide_w, slide_h, pdf_w, pdf_h):
    from pptx.util import Emu, Pt
    from reportlab.lib.utils import ImageReader

    if not hasattr(shape, "left") or shape.left is None:
        return

    # Convert EMU coords to PDF coords
    x = (shape.left / slide_w) * pdf_w
    # PDF y is from bottom, PPTX y is from top
    y = pdf_h - ((shape.top / slide_h) * pdf_h)
    w = (shape.width / slide_w) * pdf_w
    h = (shape.height / slide_h) * pdf_h

    # Handle images
    if shape.shape_type == 13:  # MSO_SHAPE_TYPE.PICTURE
        try:
            img_bytes = shape.image.blob
            img = ImageReader(io.BytesIO(img_bytes))
            c.drawImage(img, x, y - h, w, h, preserveAspectRatio=True, mask='auto')
        except Exception:
            pass
        return

    # Handle tables
    if shape.has_table:
        try:
            _render_table(c, shape, x, y, w, h)
        except Exception:
            pass
        return

    # Handle text
    if shape.has_text_frame:
        tf = shape.text_frame
        text_y = y - 4  # start a bit below top

        for para in tf.paragraphs:
            full_text = para.text.strip()
            if not full_text:
                text_y -= 14
                continue

            # Get font properties from first run
            font_size = 12
            is_bold = False
            font_color = (0, 0, 0)

            if para.runs:
                run = para.runs[0]
                if run.font.size:
                    font_size = run.font.size.pt
                is_bold = run.font.bold or False
                if run.font.color and run.font.color.rgb:
                    rgb = run.font.color.rgb
                    font_color = (
                        int(str(rgb)[0:2], 16) / 255,
                        int(str(rgb)[2:4], 16) / 255,
                        int(str(rgb)[4:6], 16) / 255,
                    )

            # Cap font size for PDF readability
            pdf_font_size = min(font_size, 36)

            font_name = "Helvetica-Bold" if is_bold else "Helvetica"
            c.setFont(font_name, pdf_font_size)
            c.setFillColorRGB(*font_color)

            # Simple word wrap
            max_text_w = w - 10
            words = full_text.split()
            lines = []
            current_line = ""

            for word in words:
                test = f"{current_line} {word}".strip()
                if c.stringWidth(test, font_name, pdf_font_size) <= max_text_w:
                    current_line = test
                else:
                    if current_line:
                        lines.append(current_line)
                    current_line = word
            if current_line:
                lines.append(current_line)

            for line in lines:
                if text_y < (y - h):
                    break
                # Alignment
                if para.alignment and para.alignment == 1:  # CENTER
                    line_w = c.stringWidth(line, font_name, pdf_font_size)
                    c.drawString(x + (w - line_w) / 2, text_y, line)
                else:
                    c.drawString(x + 5, text_y, line)
                text_y -= pdf_font_size * 1.3

            # Reset color
            c.setFillColorRGB(0, 0, 0)


def _render_table(c, shape, x, y, w, h):
    table = shape.table
    rows = len(table.rows)
    cols = len(table.columns)
    if rows == 0 or cols == 0:
        return

    cell_w = w / cols
    cell_h = h / rows

    c.setStrokeColorRGB(0.7, 0.7, 0.7)
    c.setLineWidth(0.5)

    for ri, row in enumerate(table.rows):
        for ci, cell in enumerate(row.cells):
            cx = x + ci * cell_w
            cy = y - ri * cell_h

            # Cell border
            c.rect(cx, cy - cell_h, cell_w, cell_h, fill=0, stroke=1)

            # Cell text
            text = cell.text.strip()
            if text:
                font_size = 8
                if ri == 0:
                    c.setFont("Helvetica-Bold", font_size)
                else:
                    c.setFont("Helvetica", font_size)
                c.setFillColorRGB(0, 0, 0)

                # Truncate if too long
                max_chars = int(cell_w / (font_size * 0.5))
                display_text = text[:max_chars] + ("…" if len(text) > max_chars else "")
                c.drawString(cx + 3, cy - cell_h + 5, display_text)


def _docx_to_pdf(file_bytes: bytes) -> bytes:
    from docx import Document
    from docx.shared import Pt
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader

    doc = Document(io.BytesIO(file_bytes))

    buf = io.BytesIO()
    width, height = A4
    c = pdf_canvas.Canvas(buf, pagesize=A4)

    margin_x = 56
    margin_top = height - 56
    margin_bottom = 56
    usable_w = width - 2 * margin_x
    y = margin_top

    def new_page():
        nonlocal y
        c.showPage()
        y = margin_top

    for element in doc.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            # Find the matching Paragraph object
            para = None
            for p in doc.paragraphs:
                if p._element is element:
                    para = p
                    break

            if para is None:
                continue

            text = para.text.strip()
            style_name = (para.style.name or "").lower()

            # Determine font properties
            if "heading 1" in style_name:
                font_name, font_size = "Helvetica-Bold", 20
                space_before, space_after = 24, 10
            elif "heading 2" in style_name:
                font_name, font_size = "Helvetica-Bold", 16
                space_before, space_after = 20, 8
            elif "heading 3" in style_name:
                font_name, font_size = "Helvetica-Bold", 13
                space_before, space_after = 16, 6
            elif "title" in style_name:
                font_name, font_size = "Helvetica-Bold", 24
                space_before, space_after = 10, 14
            else:
                font_name, font_size = "Helvetica", 11
                space_before, space_after = 2, 4

            # Check for run-level bold/italic
            if para.runs:
                run = para.runs[0]
                if run.bold:
                    font_name = "Helvetica-Bold"
                elif run.italic:
                    font_name = "Helvetica-Oblique"
                if run.font.size:
                    font_size = run.font.size.pt

            if not text:
                y -= 10
                continue

            y -= space_before

            c.setFont(font_name, min(font_size, 28))
            c.setFillColorRGB(0, 0, 0)

            # Word wrap
            words = text.split()
            lines = []
            current_line = ""
            for word in words:
                test = f"{current_line} {word}".strip()
                if c.stringWidth(test, font_name, font_size) <= usable_w:
                    current_line = test
                else:
                    if current_line:
                        lines.append(current_line)
                    current_line = word
            if current_line:
                lines.append(current_line)

            for line in lines:
                if y < margin_bottom:
                    new_page()
                c.drawString(margin_x, y, line)
                y -= font_size * 1.4

            y -= space_after

        elif tag == "tbl":
            # Find matching Table object
            for tbl in doc.tables:
                if tbl._element is element:
                    rows = tbl.rows
                    if not rows:
                        break
                    cols = len(rows[0].cells)
                    cell_w = usable_w / max(cols, 1)
                    cell_h = 18

                    for ri, row in enumerate(rows):
                        if y - cell_h < margin_bottom:
                            new_page()
                        for ci, cell in enumerate(row.cells):
                            cx = margin_x + ci * cell_w
                            c.setStrokeColorRGB(0.7, 0.7, 0.7)
                            c.setLineWidth(0.5)
                            c.rect(cx, y - cell_h, cell_w, cell_h, fill=0, stroke=1)

                            text = cell.text.strip()
                            if text:
                                fn = "Helvetica-Bold" if ri == 0 else "Helvetica"
                                c.setFont(fn, 8)
                                c.setFillColorRGB(0, 0, 0)
                                max_chars = int(cell_w / 4.5)
                                c.drawString(
                                    cx + 3,
                                    y - cell_h + 5,
                                    text[:max_chars] + ("…" if len(text) > max_chars else ""),
                                )
                        y -= cell_h
                    y -= 10
                    break

    c.save()
    buf.seek(0)
    result = buf.read()
    logger.info(f"DOCX → PDF: {len(result)} bytes")
    return result


def _xlsx_to_pdf(file_bytes: bytes) -> bytes:
    from openpyxl import load_workbook
    from reportlab.pdfgen import canvas as pdf_canvas
    from reportlab.lib.pagesizes import A4, landscape

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)

    buf = io.BytesIO()
    page_w, page_h = landscape(A4)
    c = pdf_canvas.Canvas(buf, pagesize=landscape(A4))

    margin = 40

    for sheet in wb.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        # Title
        c.setFont("Helvetica-Bold", 14)
        c.drawString(margin, page_h - margin, sheet.title)

        max_cols = max(len(r) for r in rows)
        usable_w = page_w - 2 * margin
        col_w = usable_w / max(max_cols, 1)
        row_h = 16
        y = page_h - margin - 30

        for ri, row in enumerate(rows):
            if y - row_h < margin:
                c.showPage()
                c.setFont("Helvetica-Bold", 10)
                c.drawString(margin, page_h - margin, f"{sheet.title} (cont.)")
                y = page_h - margin - 30

            for ci, val in enumerate(row):
                cx = margin + ci * col_w
                c.setStrokeColorRGB(0.8, 0.8, 0.8)
                c.setLineWidth(0.3)
                c.rect(cx, y - row_h, col_w, row_h, fill=0, stroke=1)

                if val is not None:
                    fn = "Helvetica-Bold" if ri == 0 else "Helvetica"
                    c.setFont(fn, 8)
                    c.setFillColorRGB(0, 0, 0)
                    text = str(val)
                    max_chars = int(col_w / 4.5)
                    c.drawString(
                        cx + 3,
                        y - row_h + 4,
                        text[:max_chars] + ("…" if len(text) > max_chars else ""),
                    )
            y -= row_h

        c.showPage()

    c.save()
    buf.seek(0)
    result = buf.read()
    logger.info(f"XLSX → PDF: {len(result)} bytes")
    return result