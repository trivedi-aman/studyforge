# ai-service/services/pptx_to_html.py
"""
PPTX → HTML preview.
Strategy: render slides at their NATIVE pixel size (positions/sizes/fonts all
in pixels), then use CSS transform: scale() on a wrapper to fit the viewport.
This is how professional slide viewers (Google Slides, Office Online) work —
container queries and percentage layout are fragile, absolute pixel sizing is not.
"""
import base64
import io
import html as html_module
import logging

logger = logging.getLogger(__name__)


def pptx_to_html(file_bytes: bytes) -> str:
    from pptx import Presentation
    from pptx.util import Emu

    prs = Presentation(io.BytesIO(file_bytes))

    slide_w_emu = prs.slide_width or Emu(9144000)
    slide_h_emu = prs.slide_height or Emu(6858000)

    slide_w_px = slide_w_emu * 96 / 914400
    slide_h_px = slide_h_emu * 96 / 914400

    slides_html = []
    for idx, slide in enumerate(prs.slides, 1):
        bg_style = _get_slide_bg_style(slide)

        parts = []
        for shape in slide.shapes:
            p = _render_shape(shape, slide_w_emu, slide_h_emu, slide_w_px, slide_h_px)
            if p:
                parts.append(p)

        slides_html.append(f"""
        <div class="slide-wrap">
          <div class="slide-num">Slide {idx}</div>
          <div class="slide-scaler">
            <div class="slide" style="{bg_style} width:{slide_w_px:.1f}px; height:{slide_h_px:.1f}px;">
              {"".join(parts)}
            </div>
          </div>
        </div>
        """)

    body = f'<div class="slides-container">{"".join(slides_html)}</div>'
    return _wrap_html(body, slide_w_px, slide_h_px)


def _get_slide_bg_style(slide) -> str:
    """
    Robustly extract the slide background color set by ppt_renderer._set_bg().
    Falls back to white if anything goes wrong.
    """
    try:
        bg = slide.background
        fill = bg.fill
        if fill.type is None:
            return "background:#ffffff;"
        rgb = fill.fore_color.rgb
        return f"background:#{rgb};"
    except Exception as e:
        logger.debug(f"Slide bg extraction failed: {e}")
        return "background:#ffffff;"


def _get_shape_fill_style(shape) -> str:
    """Robustly extract shape fill color as a CSS style string."""
    try:
        if not hasattr(shape, "fill") or shape.fill is None:
            return ""
        if shape.fill.type is None:
            return ""
        rgb = shape.fill.fore_color.rgb
        return f"background-color:#{rgb};"
    except Exception:
        return ""


def _render_shape(shape, sw_emu, sh_emu, sw_px, sh_px):
    if not hasattr(shape, "left") or shape.left is None:
        return ""

    left_px = shape.left * 96 / 914400
    top_px = shape.top * 96 / 914400
    w_px = shape.width * 96 / 914400
    h_px = shape.height * 96 / 914400

    pos = f"left:{left_px:.1f}px;top:{top_px:.1f}px;width:{w_px:.1f}px;height:{h_px:.1f}px;"

    fill_style = _get_shape_fill_style(shape)

    # Picture
    if shape.shape_type == 13:
        try:
            b = shape.image.blob
            ct = shape.image.content_type or "image/png"
            b64 = base64.b64encode(b).decode("ascii")
            return f'<div class="shape shape-image" style="{pos}"><img src="data:{ct};base64,{b64}"/></div>'
        except Exception:
            return ""

    # Text frame
    if shape.has_text_frame:
        text_html = _text_frame_html(shape.text_frame)
        return f'<div class="shape shape-text" style="{pos}{fill_style}">{text_html}</div>'

    # Plain filled shape (accent bars, sidebars, etc.)
    if fill_style:
        return f'<div class="shape shape-fill" style="{pos}{fill_style}"></div>'
    return ""


def _text_frame_html(tf):
    paras = []
    for para in tf.paragraphs:
        if not para.runs:
            paras.append('<p style="margin:0">&nbsp;</p>')
            continue
        runs = []
        for run in para.runs:
            text = html_module.escape(run.text or "").replace("\n", "<br>")
            if not text:
                continue
            styles = []

            pt_size = run.font.size.pt if run.font.size else 18
            px_size = pt_size * 1.333
            styles.append(f"font-size:{px_size:.1f}px")

            if run.font.bold:
                styles.append("font-weight:700")
            if run.font.italic:
                styles.append("font-style:italic")
            try:
                if run.font.color and run.font.color.type is not None and run.font.color.rgb:
                    styles.append(f"color:#{run.font.color.rgb}")
            except Exception:
                pass
            if run.font.name:
                styles.append(f"font-family:'{run.font.name}',sans-serif")
            sattr = f' style="{";".join(styles)}"' if styles else ""
            runs.append(f'<span{sattr}>{text}</span>')

        pstyles = ["margin:0", "line-height:1.25"]
        if para.alignment is not None:
            m = {1: "center", 2: "right", 3: "justify"}
            if para.alignment in m:
                pstyles.append(f"text-align:{m[para.alignment]}")
        paras.append(f'<p style="{";".join(pstyles)}">{"".join(runs) or "&nbsp;"}</p>')

    return "".join(paras)


def _wrap_html(body, slide_w_px, slide_h_px):
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