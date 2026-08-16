import io
import base64
import logging
import html as html_module
from pathlib import Path

logger = logging.getLogger(__name__)

CONVERTIBLE = {"docx", "pptx", "xlsx", "doc", "ppt", "xls"}


def is_convertible(file_type: str) -> bool:
    return file_type.lower() in CONVERTIBLE


def convert_to_html(file_bytes: bytes, original_filename: str) -> str | None:
    """
    Convert DOCX/PPTX/XLSX to HTML.
    Returns a full HTML document as a string, or None on failure.
    """
    suffix = Path(original_filename).suffix.lower()
    try:
        if suffix in (".docx", ".doc"):
            return _docx_to_html(file_bytes)
        elif suffix in (".pptx", ".ppt"):
            return _pptx_to_html(file_bytes)
        elif suffix in (".xlsx", ".xls"):
            return _xlsx_to_html(file_bytes)
        else:
            logger.warning(f"No converter for {suffix}")
            return None
    except Exception as e:
        logger.error(f"HTML conversion failed for {original_filename}: {e}", exc_info=True)
        return None


# ============================================================
# DOCX → HTML (mammoth handles this brilliantly)
# ============================================================
def _docx_to_html(file_bytes: bytes) -> str:
    import mammoth

    style_map = """
    p[style-name='Title'] => h1.doc-title:fresh
    p[style-name='Subtitle'] => h2.doc-subtitle:fresh
    p[style-name='Heading 1'] => h1:fresh
    p[style-name='Heading 2'] => h2:fresh
    p[style-name='Heading 3'] => h3:fresh
    p[style-name='Heading 4'] => h4:fresh
    p[style-name='Quote'] => blockquote:fresh
    p[style-name='Intense Quote'] => blockquote.intense:fresh
    r[style-name='Strong'] => strong
    r[style-name='Emphasis'] => em
    """

    result = mammoth.convert_to_html(
        io.BytesIO(file_bytes),
        style_map=style_map,
    )
    body_html = result.value
    logger.info(f"DOCX → HTML: {len(body_html)} chars, {len(result.messages)} messages")

    return _wrap_html(body_html, css=_docx_css())


def _docx_css() -> str:
    return """
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      max-width: 8.5in;
      margin: 40px auto;
      padding: 60px 80px;
      background: white;
      color: #1a1a1a;
      line-height: 1.6;
      font-size: 11pt;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      border-radius: 4px;
    }
    h1, h2, h3, h4 { color: #1a1a1a; margin-top: 1.5em; margin-bottom: 0.5em; }
    h1.doc-title { text-align: center; font-size: 24pt; border-bottom: 2px solid #ccc; padding-bottom: 8px; }
    h2.doc-subtitle { text-align: center; font-size: 14pt; color: #666; font-weight: normal; }
    h1 { font-size: 20pt; }
    h2 { font-size: 16pt; }
    h3 { font-size: 13pt; }
    p { margin: 0.6em 0; }
    ul, ol { margin: 0.6em 0; padding-left: 2em; }
    li { margin: 0.2em 0; }
    table { border-collapse: collapse; margin: 1em 0; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 6px 10px; vertical-align: top; }
    th { background: #f5f5f5; font-weight: bold; }
    blockquote { border-left: 3px solid #6c5ce7; padding-left: 16px; color: #444; margin: 1em 0; font-style: italic; }
    blockquote.intense { background: #f7f6f3; padding: 12px 16px; border-left-width: 4px; }
    img { max-width: 100%; height: auto; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    a { color: #6c5ce7; }
    """


# ============================================================
# PPTX → HTML (rendered as one card per slide)
# ============================================================
def _pptx_to_html(file_bytes: bytes) -> str:
    from pptx import Presentation
    from pptx.util import Emu

    prs = Presentation(io.BytesIO(file_bytes))

    slide_w_emu = prs.slide_width or Emu(9144000)
    slide_h_emu = prs.slide_height or Emu(6858000)

    # Render each slide as an absolutely-positioned container
    slides_html = []

    for idx, slide in enumerate(prs.slides, 1):
        # Background color if any
        bg_style = ""
        try:
            bg = slide.background
            if bg and bg.fill and bg.fill.type is not None:
                fc = bg.fill.fore_color
                if fc and fc.rgb:
                    bg_style = f"background-color: #{fc.rgb};"
        except Exception:
            pass

        shape_html_parts = []
        for shape in slide.shapes:
            part = _render_pptx_shape(shape, slide_w_emu, slide_h_emu)
            if part:
                shape_html_parts.append(part)

        slide_html = f"""
        <div class="slide-wrap">
          <div class="slide-num">Slide {idx}</div>
          <div class="slide" style="{bg_style}">
            {''.join(shape_html_parts)}
          </div>
        </div>
        """
        slides_html.append(slide_html)

    body = f'<div class="slides-container">{"".join(slides_html)}</div>'
    logger.info(f"PPTX → HTML: {len(prs.slides)} slides")
    return _wrap_html(body, css=_pptx_css())


def _render_pptx_shape(shape, slide_w_emu, slide_h_emu) -> str:
    if not hasattr(shape, "left") or shape.left is None:
        return ""

    # Percentage positioning — makes the slide responsive
    left_pct = (shape.left / slide_w_emu) * 100
    top_pct = (shape.top / slide_h_emu) * 100
    width_pct = (shape.width / slide_w_emu) * 100
    height_pct = (shape.height / slide_h_emu) * 100

    position_style = (
        f"left: {left_pct:.2f}%; "
        f"top: {top_pct:.2f}%; "
        f"width: {width_pct:.2f}%; "
        f"height: {height_pct:.2f}%;"
    )

    # Picture
    if shape.shape_type == 13:  # MSO_SHAPE_TYPE.PICTURE
        try:
            img_bytes = shape.image.blob
            ct = shape.image.content_type or "image/png"
            b64 = base64.b64encode(img_bytes).decode("ascii")
            return (
                f'<div class="shape shape-image" style="{position_style}">'
                f'<img src="data:{ct};base64,{b64}" />'
                f'</div>'
            )
        except Exception:
            return ""

    # Table
    if shape.has_table:
        try:
            rows_html = []
            for row in shape.table.rows:
                cells = []
                for cell in row.cells:
                    cell_text = html_module.escape(cell.text or "")
                    cells.append(f"<td>{cell_text}</td>")
                rows_html.append(f"<tr>{''.join(cells)}</tr>")
            return (
                f'<div class="shape shape-table" style="{position_style}">'
                f'<table>{"".join(rows_html)}</table>'
                f'</div>'
            )
        except Exception:
            return ""

    # Text
    if shape.has_text_frame:
        paragraphs = []
        for para in shape.text_frame.paragraphs:
            if not para.runs:
                paragraphs.append("<p>&nbsp;</p>")
                continue

            runs_html = []
            for run in para.runs:
                text = html_module.escape(run.text or "")
                if not text:
                    continue

                styles = []
                if run.font.size:
                    # Scale font size relative to slide (10pt on a 720pt slide = 1.39%)
                    pt_size = run.font.size.pt
                    styles.append(f"font-size: {pt_size:.1f}pt;")
                if run.font.bold:
                    styles.append("font-weight: 700;")
                if run.font.italic:
                    styles.append("font-style: italic;")
                if run.font.underline:
                    styles.append("text-decoration: underline;")
                if run.font.color and run.font.color.type is not None:
                    try:
                        if run.font.color.rgb:
                            styles.append(f"color: #{run.font.color.rgb};")
                    except Exception:
                        pass
                if run.font.name:
                    styles.append(f"font-family: '{run.font.name}', sans-serif;")

                style_attr = f' style="{" ".join(styles)}"' if styles else ""
                runs_html.append(f'<span{style_attr}>{text}</span>')

            # Paragraph alignment
            align_style = ""
            if para.alignment is not None:
                # 1=CENTER, 2=RIGHT, 3=JUSTIFY
                align_map = {1: "center", 2: "right", 3: "justify"}
                if para.alignment in align_map:
                    align_style = f' style="text-align: {align_map[para.alignment]};"'

            paragraphs.append(f'<p{align_style}>{"".join(runs_html) or "&nbsp;"}</p>')

        return (
            f'<div class="shape shape-text" style="{position_style}">'
            f'{"".join(paragraphs)}'
            f'</div>'
        )

    return ""


def _pptx_css() -> str:
    return """
    body {
      background: #f3f2ef;
      margin: 0;
      padding: 20px;
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    }
    .slides-container {
      max-width: 1000px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .slide-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .slide-num {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #6e6e78;
      padding: 0 4px;
    }
    .slide {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: white;
      box-shadow: 0 2px 16px rgba(0,0,0,0.10);
      border-radius: 4px;
      overflow: hidden;
    }
    .shape { position: absolute; overflow: hidden; }
    .shape-text { padding: 4px; box-sizing: border-box; }
    .shape-text p { margin: 0 0 0.15em 0; line-height: 1.2; }
    .shape-image img { width: 100%; height: 100%; object-fit: contain; }
    .shape-table table { width: 100%; height: 100%; border-collapse: collapse; font-size: 10pt; }
    .shape-table td { border: 1px solid #ccc; padding: 3px 6px; vertical-align: top; }
    """


# ============================================================
# XLSX → HTML
# ============================================================
def _xlsx_to_html(file_bytes: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)

    sheets_html = []
    for sheet in wb.worksheets:
        rows = list(sheet.iter_rows(values_only=True))
        if not rows:
            continue

        rows_html = []
        for ri, row in enumerate(rows):
            cells = []
            for val in row:
                cell_text = html_module.escape(str(val)) if val is not None else ""
                tag = "th" if ri == 0 else "td"
                cells.append(f"<{tag}>{cell_text}</{tag}>")
            rows_html.append(f"<tr>{''.join(cells)}</tr>")

        sheet_title = html_module.escape(sheet.title)
        sheets_html.append(
            f'<div class="sheet"><h2>{sheet_title}</h2>'
            f'<table>{"".join(rows_html)}</table></div>'
        )

    body = f'<div class="workbook">{"".join(sheets_html)}</div>'
    logger.info(f"XLSX → HTML: {len(wb.worksheets)} sheets")
    return _wrap_html(body, css=_xlsx_css())


def _xlsx_css() -> str:
    return """
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      background: #f3f2ef;
      margin: 0;
      padding: 20px;
    }
    .workbook { max-width: 100%; }
    .sheet { background: white; border-radius: 4px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow-x: auto; }
    .sheet h2 { margin: 0 0 12px 0; font-size: 15pt; color: #1a1a1a; }
    table { border-collapse: collapse; font-size: 10pt; min-width: 100%; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; white-space: nowrap; }
    th { background: #217346; color: white; font-weight: 600; position: sticky; top: 0; }
    tr:nth-child(even) td { background: #f9f9f9; }
    """


# ============================================================
# Common HTML wrapper
# ============================================================
def _wrap_html(body_html: str, css: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Preview</title>
<style>
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
{css}
</style>
</head>
<body>
{body_html}
</body>
</html>"""