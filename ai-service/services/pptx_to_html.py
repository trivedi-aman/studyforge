"""
PPTX → HTML for previewing generated presentations inside Studyforge.
Mirrors backend/core/converter.py logic — same visual output.
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
    slide_w_px = int(slide_w_emu / 9525)
    slide_h_px = int(slide_h_emu / 9525)

    slides_html = []
    for idx, slide in enumerate(prs.slides, 1):
        bg_style = "background: white;"
        try:
            bg = slide.background
            if bg and bg.fill and bg.fill.type is not None:
                fc = bg.fill.fore_color
                if fc and fc.rgb:
                    bg_style = f"background: #{fc.rgb};"
        except Exception:
            pass

        parts = []
        for shape in slide.shapes:
            p = _render_shape(shape, slide_w_emu, slide_h_emu)
            if p:
                parts.append(p)

        slides_html.append(f"""
        <div class="slide-wrap">
          <div class="slide-num">Slide {idx}</div>
          <div class="slide" style="{bg_style}">{"".join(parts)}</div>
        </div>
        """)

    body = f'<div class="slides-container" style="--slide-w:{slide_w_px}px; --slide-h:{slide_h_px}px;">{"".join(slides_html)}</div>'
    return _wrap_html(body)


def _render_shape(shape, sw, sh):
    if not hasattr(shape, "left") or shape.left is None:
        return ""
    left = (shape.left / sw) * 100
    top = (shape.top / sh) * 100
    w = (shape.width / sw) * 100
    h = (shape.height / sh) * 100
    pos = f"left:{left:.3f}%;top:{top:.3f}%;width:{w:.3f}%;height:{h:.3f}%;"

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
            b = shape.image.blob
            ct = shape.image.content_type or "image/png"
            b64 = base64.b64encode(b).decode("ascii")
            return f'<div class="shape shape-image" style="{pos}"><img src="data:{ct};base64,{b64}"/></div>'
        except Exception:
            return ""

    # Text frame
    if shape.has_text_frame:
        return f'<div class="shape shape-text" style="{pos}{fill_style}">{_text_frame_html(shape.text_frame, sw)}</div>'

    # Plain filled shape (accent bars, etc.)
    if fill_style:
        return f'<div class="shape" style="{pos}{fill_style}"></div>'
    return ""


def _text_frame_html(tf, slide_w_emu):
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

            # Font size — as a % of slide width (via cqw)
            # If no size on run, use a sensible default of 18pt equivalent
            if run.font.size:
                pt = run.font.size.pt
            else:
                pt = 18  # fallback default
            slide_w_pt = slide_w_emu / 12700
            pct = (pt / slide_w_pt) * 100
            styles.append(f"font-size:{pct:.3f}cqw")

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

        pstyles = ["margin:0"]
        if para.alignment is not None:
            m = {1: "center", 2: "right", 3: "justify"}
            if para.alignment in m:
                pstyles.append(f"text-align:{m[para.alignment]}")
        paras.append(f'<p style="{";".join(pstyles)}">{"".join(runs) or "&nbsp;"}</p>')

    return "".join(paras)


def _wrap_html(body):
    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{{box-sizing:border-box}}html,body{{margin:0;padding:0}}
body{{background:#f3f2ef;padding:24px;font-family:'Calibri','Segoe UI',Arial,sans-serif}}
.slides-container{{max-width:1200px;margin:0 auto;display:flex;flex-direction:column;gap:28px}}
.slide-wrap{{display:flex;flex-direction:column;gap:8px}}
.slide-num{{font-family:'JetBrains Mono',monospace;font-size:11px;color:#6e6e78;padding:0 4px;text-transform:uppercase;letter-spacing:0.05em}}
.slide{{position:relative;width:100%;aspect-ratio:var(--slide-w)/var(--slide-h);background:white;box-shadow:0 4px 24px rgba(0,0,0,0.12);border-radius:6px;overflow:hidden;container-type:inline-size}}
.shape{{position:absolute;overflow:hidden}}
.shape-text{{padding:0.4cqw;display:flex;flex-direction:column;justify-content:flex-start}}
.shape-text p{{line-height:1.25;margin:0 0 0.25em 0;font-size:2.2cqw}}
.shape-text span{{display:inline}}
.shape-image img{{width:100%;height:100%;object-fit:contain;display:block}}
</style></head><body>{body}</body></html>"""