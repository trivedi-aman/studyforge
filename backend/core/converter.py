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
    from docx import Document

    # Mammoth handles structure well (headings, tables, images, lists)
    style_map = """
    p[style-name='Title'] => h1.doc-title:fresh
    p[style-name='Subtitle'] => p.doc-subtitle:fresh
    p[style-name='Heading 1'] => h1:fresh
    p[style-name='Heading 2'] => h2:fresh
    p[style-name='Heading 3'] => h3:fresh
    p[style-name='Heading 4'] => h4:fresh
    p[style-name='Heading 5'] => h5:fresh
    p[style-name='Quote'] => blockquote:fresh
    p[style-name='Intense Quote'] => blockquote.intense:fresh
    p[style-name='List Paragraph'] => p.list-para:fresh
    r[style-name='Strong'] => strong
    r[style-name='Emphasis'] => em
    r[style-name='Intense Emphasis'] => em.intense
    r[style-name='Book Title'] => cite
    """

    def convert_image(image):
        with image.open() as image_bytes:
            encoded = base64.b64encode(image_bytes.read()).decode("ascii")
            return {"src": f"data:{image.content_type};base64,{encoded}"}

    result = mammoth.convert_to_html(
        io.BytesIO(file_bytes),
        style_map=style_map,
        convert_image=mammoth.images.img_element(convert_image),
    )
    body_html = result.value

    # Second pass: extract inline formatting mammoth misses (colors, sizes, alignment)
    body_html = _enrich_docx_html(file_bytes, body_html)

    logger.info(f"DOCX → HTML: {len(body_html)} chars")
    return _wrap_html(body_html, css=_docx_css())


def _enrich_docx_html(file_bytes: bytes, base_html: str) -> str:
    """
    Read the DOCX again with python-docx to capture styling mammoth loses:
    - Paragraph alignment
    - Run-level font size, color, font family
    - Better spacing
    Rebuilds the HTML ourselves for maximum fidelity.
    """
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    try:
        doc = Document(io.BytesIO(file_bytes))
    except Exception:
        return base_html  # fall back to mammoth's output

    align_map = {
        WD_ALIGN_PARAGRAPH.LEFT: "left",
        WD_ALIGN_PARAGRAPH.CENTER: "center",
        WD_ALIGN_PARAGRAPH.RIGHT: "right",
        WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
    }

    html_parts = []

    for element in doc.element.body:
        tag = element.tag.split("}")[-1] if "}" in element.tag else element.tag

        if tag == "p":
            para = _find_para(doc, element)
            if not para:
                continue
            html_parts.append(_render_docx_para(para, align_map))

        elif tag == "tbl":
            table = _find_table(doc, element)
            if not table:
                continue
            html_parts.append(_render_docx_table(table, align_map))

    enriched = "".join(html_parts)
    # If we got nothing meaningful, fall back to mammoth
    return enriched if len(enriched) > 100 else base_html


def _find_para(doc, element):
    for p in doc.paragraphs:
        if p._element is element:
            return p
    return None


def _find_table(doc, element):
    for t in doc.tables:
        if t._element is element:
            return t
    return None


def _render_docx_para(para, align_map) -> str:
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    style_name = (para.style.name or "").lower()

    # Determine wrapping tag
    if "title" in style_name and "subtitle" not in style_name:
        tag = "h1"
        cls = "doc-title"
    elif "subtitle" in style_name:
        tag = "p"
        cls = "doc-subtitle"
    elif "heading 1" in style_name:
        tag = "h1"; cls = ""
    elif "heading 2" in style_name:
        tag = "h2"; cls = ""
    elif "heading 3" in style_name:
        tag = "h3"; cls = ""
    elif "heading 4" in style_name:
        tag = "h4"; cls = ""
    elif "heading 5" in style_name:
        tag = "h5"; cls = ""
    elif "quote" in style_name:
        tag = "blockquote"; cls = ""
    elif "list" in style_name:
        tag = "li"; cls = ""
    else:
        tag = "p"; cls = ""

    # Paragraph-level styles
    p_styles = []
    align = align_map.get(para.alignment)
    if align:
        p_styles.append(f"text-align: {align}")

    # Runs — capture inline styling
    runs_html = []
    for run in para.runs:
        text = html_module.escape(run.text or "").replace("\n", "<br>").replace("\t", "&nbsp;&nbsp;&nbsp;&nbsp;")
        if not text:
            continue

        run_styles = []
        if run.font.size:
            run_styles.append(f"font-size: {run.font.size.pt:.1f}pt")
        if run.font.name:
            run_styles.append(f"font-family: '{run.font.name}', sans-serif")
        if run.font.color and run.font.color.type is not None:
            try:
                if run.font.color.rgb:
                    run_styles.append(f"color: #{run.font.color.rgb}")
            except Exception:
                pass
        if run.font.highlight_color:
            run_styles.append(f"background-color: yellow")

        inner = text
        if run.bold:
            inner = f"<strong>{inner}</strong>"
        if run.italic:
            inner = f"<em>{inner}</em>"
        if run.underline:
            inner = f'<span style="text-decoration:underline;">{inner}</span>'

        if run_styles:
            inner = f'<span style="{"; ".join(run_styles)};">{inner}</span>'

        runs_html.append(inner)

    if not runs_html:
        # Empty paragraph — keep a break so spacing is preserved
        return "<p>&nbsp;</p>"

    inner_html = "".join(runs_html)
    style_attr = f' style="{"; ".join(p_styles)};"' if p_styles else ""
    class_attr = f' class="{cls}"' if cls else ""

    return f"<{tag}{class_attr}{style_attr}>{inner_html}</{tag}>"


def _render_docx_table(table, align_map) -> str:
    rows_html = []
    for ri, row in enumerate(table.rows):
        cells_html = []
        for cell in row.cells:
            cell_html_parts = []
            for para in cell.paragraphs:
                cell_html_parts.append(_render_docx_para(para, align_map))
            tag = "th" if ri == 0 else "td"
            cells_html.append(f"<{tag}>{''.join(cell_html_parts)}</{tag}>")
        rows_html.append(f"<tr>{''.join(cells_html)}</tr>")
    return f"<table>{''.join(rows_html)}</table>"


def _docx_css() -> str:
    return """
    body {
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      max-width: 8.5in;
      margin: 40px auto;
      padding: 60px 80px;
      background: white;
      color: #1a1a1a;
      line-height: 1.5;
      font-size: 11pt;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      border-radius: 4px;
    }
    * { box-sizing: border-box; }
    h1, h2, h3, h4, h5 {
      color: #1a1a1a;
      margin: 1.2em 0 0.4em;
      line-height: 1.25;
      font-weight: 700;
    }
    h1.doc-title {
      text-align: center;
      font-size: 26pt;
      border-bottom: 2px solid #ddd;
      padding-bottom: 10px;
      margin-top: 0;
    }
    p.doc-subtitle {
      text-align: center;
      font-size: 14pt;
      color: #666;
      font-weight: 400;
      margin-top: 0;
    }
    h1 { font-size: 20pt; }
    h2 { font-size: 16pt; color: #2c3e50; }
    h3 { font-size: 13.5pt; color: #34495e; }
    h4 { font-size: 12pt; }
    h5 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
    p { margin: 0.5em 0; }
    ul, ol { margin: 0.6em 0; padding-left: 2em; }
    li { margin: 0.25em 0; }
    p.list-para { margin-left: 1.5em; position: relative; }
    p.list-para::before { content: "•"; position: absolute; left: -1em; color: #666; }
    table {
      border-collapse: collapse;
      margin: 1em 0;
      width: 100%;
      font-size: 10.5pt;
    }
    td, th {
      border: 1px solid #ccc;
      padding: 8px 12px;
      vertical-align: top;
    }
    th {
      background: #f5f5f5;
      font-weight: 700;
      text-align: left;
    }
    tr:nth-child(even) td { background: #fafafa; }
    blockquote {
      border-left: 3px solid #6c5ce7;
      padding: 4px 0 4px 16px;
      color: #444;
      margin: 1em 0;
      font-style: italic;
    }
    blockquote.intense {
      background: #f7f6f3;
      padding: 12px 16px;
      border-left-width: 4px;
      font-style: normal;
    }
    img { max-width: 100%; height: auto; margin: 0.5em 0; border-radius: 2px; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    em.intense { font-weight: 600; color: #333; }
    a { color: #6c5ce7; text-decoration: none; border-bottom: 1px solid rgba(108,92,231,0.3); }
    a:hover { border-bottom-color: #6c5ce7; }
    cite { font-style: italic; color: #666; }
    hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
    """

# ============================================================
# PPTX → HTML (rendered as one card per slide)
# ============================================================

def _render_pptx_shape(shape, slide_w_emu, slide_h_emu, slide_w_px) -> str:
    if not hasattr(shape, "left") or shape.left is None:
        return ""

    left_pct = (shape.left / slide_w_emu) * 100
    top_pct = (shape.top / slide_h_emu) * 100
    width_pct = (shape.width / slide_w_emu) * 100
    height_pct = (shape.height / slide_h_emu) * 100

    position_style = (
        f"left: {left_pct:.3f}%; "
        f"top: {top_pct:.3f}%; "
        f"width: {width_pct:.3f}%; "
        f"height: {height_pct:.3f}%;"
    )

    # Shape fill (background color of the shape itself)
    fill_style = ""
    try:
        if hasattr(shape, "fill") and shape.fill and shape.fill.type is not None:
            fc = shape.fill.fore_color
            if fc and fc.rgb:
                fill_style = f"background-color: #{fc.rgb};"
    except Exception:
        pass

    # Picture
    if shape.shape_type == 13:
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
                    cells.append(f"<td>{cell_text or '&nbsp;'}</td>")
                rows_html.append(f"<tr>{''.join(cells)}</tr>")
            return (
                f'<div class="shape shape-table" style="{position_style}">'
                f'<table>{"".join(rows_html)}</table>'
                f'</div>'
            )
        except Exception:
            return ""

    # Text frame
    if shape.has_text_frame:
        paragraphs_html = _render_pptx_text_frame(shape.text_frame, shape.width, slide_w_emu, slide_w_px)
        return (
            f'<div class="shape shape-text" style="{position_style} {fill_style}">'
            f'{paragraphs_html}'
            f'</div>'
        )

    # Empty/generic shape with just a fill
    if fill_style:
        return f'<div class="shape shape-fill" style="{position_style} {fill_style}"></div>'

    return ""


def _render_pptx_text_frame(text_frame, shape_width_emu, slide_w_emu, slide_w_px) -> str:
    """
    Render text with proper font-size scaling.
    PowerPoint font sizes are in points at slide's native size.
    Since we're rendering the slide at percentage-of-container,
    we use vw-based sizing so text scales with the slide.
    """
    paragraphs = []

    for para in text_frame.paragraphs:
        if not para.runs:
            paragraphs.append('<p style="margin:0;">&nbsp;</p>')
            continue

        runs_html = []
        for run in para.runs:
            text = html_module.escape(run.text or "").replace("\n", "<br>")
            if not text:
                continue

            styles = []

            # Font size — use a container-query-like approach:
            # 1pt at PPT native ≈ (1 / slide_w_pt) of slide width
            # slide_w_pt = slide_w_emu / 12700 (EMU to points)
            if run.font.size:
                pt_size = run.font.size.pt
                # As a % of slide width — so it scales with the slide
                slide_w_pt = slide_w_emu / 12700
                pct = (pt_size / slide_w_pt) * 100
                # Use cqw (container query width) with fallback to em
                styles.append(f"font-size: {pct:.3f}cqw")

            if run.font.bold:
                styles.append("font-weight: 700")
            if run.font.italic:
                styles.append("font-style: italic")
            if run.font.underline:
                styles.append("text-decoration: underline")

            # Color
            try:
                if run.font.color and run.font.color.type is not None:
                    if run.font.color.rgb:
                        styles.append(f"color: #{run.font.color.rgb}")
            except Exception:
                pass

            if run.font.name:
                styles.append(f"font-family: '{run.font.name}', 'Calibri', sans-serif")

            style_attr = f' style="{"; ".join(styles)}"' if styles else ""
            runs_html.append(f'<span{style_attr}>{text}</span>')

        # Paragraph alignment
        para_styles = ["margin: 0"]
        if para.alignment is not None:
            align_map = {1: "center", 2: "right", 3: "justify"}
            if para.alignment in align_map:
                para_styles.append(f"text-align: {align_map[para.alignment]}")

        # Level → indentation (for bullet levels)
        if para.level and para.level > 0:
            para_styles.append(f"padding-left: {para.level * 1.5}em")

        paragraphs.append(
            f'<p style="{"; ".join(para_styles)};">'
            f'{"".join(runs_html) or "&nbsp;"}'
            f'</p>'
        )

    return "".join(paragraphs)


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









# ============================================================
# PPTX → HTML — native pixel sizing + transform scale
# Same strategy as ai-service/services/pptx_to_html.py
# ============================================================
def _pptx_to_html(file_bytes: bytes) -> str:
    from pptx import Presentation
    from pptx.util import Emu

    prs = Presentation(io.BytesIO(file_bytes))

    slide_w_emu = prs.slide_width or Emu(9144000)
    slide_h_emu = prs.slide_height or Emu(6858000)

    # EMU → pixels at 96 DPI (1 inch = 914400 EMU = 96 px)
    slide_w_px = slide_w_emu * 96 / 914400
    slide_h_px = slide_h_emu * 96 / 914400

    slides_html = []

    for idx, slide in enumerate(prs.slides, 1):
        bg_style = "background:#ffffff;"
        try:
            bg = slide.background
            if bg and bg.fill and bg.fill.type is not None:
                fc = bg.fill.fore_color
                if fc and fc.rgb:
                    bg_style = f"background:#{fc.rgb};"
        except Exception:
            pass

        shape_html_parts = []
        for shape in slide.shapes:
            part = _render_pptx_shape_px(shape)
            if part:
                shape_html_parts.append(part)

        slides_html.append(f"""
        <div class="slide-wrap">
          <div class="slide-num">Slide {idx}</div>
          <div class="slide-scaler">
            <div class="slide" style="{bg_style} width:{slide_w_px:.1f}px; height:{slide_h_px:.1f}px;">
              {''.join(shape_html_parts)}
            </div>
          </div>
        </div>
        """)

    body = f'<div class="slides-container">{"".join(slides_html)}</div>'
    logger.info(f"PPTX → HTML: {len(prs.slides)} slides ({slide_w_px:.0f}×{slide_h_px:.0f})")
    return _wrap_pptx_html(body, slide_w_px, slide_h_px)


def _render_pptx_shape_px(shape) -> str:
    """Render one shape at its native pixel position/size."""
    if not hasattr(shape, "left") or shape.left is None:
        return ""

    left_px = shape.left * 96 / 914400
    top_px = shape.top * 96 / 914400
    w_px = shape.width * 96 / 914400
    h_px = shape.height * 96 / 914400

    pos = f"left:{left_px:.1f}px;top:{top_px:.1f}px;width:{w_px:.1f}px;height:{h_px:.1f}px;"

    fill_style = ""
    try:
        if hasattr(shape, "fill") and shape.fill and shape.fill.type is not None:
            fc = shape.fill.fore_color
            if fc and fc.rgb:
                fill_style = f"background-color:#{fc.rgb};"
    except Exception:
        pass

    # Picture
    if shape.shape_type == 13:
        try:
            img_bytes = shape.image.blob
            ct = shape.image.content_type or "image/png"
            b64 = base64.b64encode(img_bytes).decode("ascii")
            return (
                f'<div class="shape shape-image" style="{pos}">'
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
                    cells.append(f"<td>{cell_text or '&nbsp;'}</td>")
                rows_html.append(f"<tr>{''.join(cells)}</tr>")
            return (
                f'<div class="shape shape-table" style="{pos}">'
                f'<table>{"".join(rows_html)}</table>'
                f'</div>'
            )
        except Exception:
            return ""

    # Text frame
    if shape.has_text_frame:
        paragraphs_html = _render_pptx_text_frame_px(shape.text_frame)
        return (
            f'<div class="shape shape-text" style="{pos}{fill_style}">'
            f'{paragraphs_html}'
            f'</div>'
        )

    # Plain filled shape (accent bars, sidebars, etc.)
    if fill_style:
        return f'<div class="shape shape-fill" style="{pos}{fill_style}"></div>'

    return ""


def _render_pptx_text_frame_px(text_frame) -> str:
    """Render text frame with pixel-based font sizes."""
    paragraphs = []

    for para in text_frame.paragraphs:
        if not para.runs:
            paragraphs.append('<p style="margin:0;">&nbsp;</p>')
            continue

        runs_html = []
        for run in para.runs:
            text = html_module.escape(run.text or "").replace("\n", "<br>")
            if not text:
                continue

            styles = []

            # Font size in pixels (1 pt = 1.333 px at 96 DPI)
            pt_size = run.font.size.pt if run.font.size else 18
            px_size = pt_size * 1.333
            styles.append(f"font-size:{px_size:.1f}px")

            if run.font.bold:
                styles.append("font-weight:700")
            if run.font.italic:
                styles.append("font-style:italic")
            if run.font.underline:
                styles.append("text-decoration:underline")

            try:
                if run.font.color and run.font.color.type is not None:
                    if run.font.color.rgb:
                        styles.append(f"color:#{run.font.color.rgb}")
            except Exception:
                pass

            if run.font.name:
                styles.append(f"font-family:'{run.font.name}','Calibri',sans-serif")

            style_attr = f' style="{"; ".join(styles)}"' if styles else ""
            runs_html.append(f'<span{style_attr}>{text}</span>')

        # Paragraph alignment
        para_styles = ["margin:0", "line-height:1.25"]
        if para.alignment is not None:
            align_map = {1: "center", 2: "right", 3: "justify"}
            if para.alignment in align_map:
                para_styles.append(f"text-align:{align_map[para.alignment]}")

        # Level → indentation (for bullet levels)
        if para.level and para.level > 0:
            para_styles.append(f"padding-left:{para.level * 18}px")

        paragraphs.append(
            f'<p style="{"; ".join(para_styles)};">'
            f'{"".join(runs_html) or "&nbsp;"}'
            f'</p>'
        )

    return "".join(paragraphs)


def _wrap_pptx_html(body: str, slide_w_px: float, slide_h_px: float) -> str:
    """Wrap PPTX preview HTML with CSS and transform-scale JS."""
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
body {{
  background: #f3f2ef;
  padding: 24px;
  font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
}}
.slides-container {{
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 28px;
}}
.slide-wrap {{
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}}
.slide-num {{
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #6e6e78;
  padding: 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}}
.slide-scaler {{
  width: 100%;
  aspect-ratio: {slide_w_px:.0f} / {slide_h_px:.0f};
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
  background: white;
}}
.slide {{
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
}}
.shape {{
  position: absolute;
  overflow: hidden;
}}
.shape-text {{
  padding: 4px;
}}
.shape-text p {{
  margin: 0;
  line-height: 1.25;
}}
.shape-text span {{ display: inline; }}
.shape-image img {{
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}}
.shape-table {{
  background: white;
}}
.shape-table table {{
  width: 100%;
  height: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}}
.shape-table td {{
  border: 1px solid #ccc;
  padding: 4px 8px;
  vertical-align: top;
  overflow: hidden;
  font-size: 14px;
}}
.shape-table tr:first-child td {{
  background: #f0f0f0;
  font-weight: 600;
}}
</style>
</head>
<body>
{body}
<script>
function scaleSlides() {{
  const NATIVE_W = {slide_w_px:.0f};
  document.querySelectorAll('.slide-scaler').forEach(scaler => {{
    const slide = scaler.querySelector('.slide');
    if (!slide) return;
    const scale = scaler.clientWidth / NATIVE_W;
    slide.style.transform = 'scale(' + scale + ')';
  }});
}}
scaleSlides();
window.addEventListener('resize', scaleSlides);
if (document.fonts) {{
  document.fonts.ready.then(scaleSlides);
}}
</script>
</body>
</html>"""


