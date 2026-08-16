// ============================================================
// NOTEBOOK VIEW — renders .md AI-generated notes as a proper
// multi-page notebook (README 2.2/2.3). Scrollable with mouse,
// paginated like a real document, exportable to PDF via jsPDF.
// Editable with formatting toolbar; saves create a new
// document_versions row (README 2.6).
// ============================================================

import { Documents } from './api.js';
import { escapeHtml } from './ui-helpers.js';
import { toast } from './toast.js';
import { Icon } from './icons.js';
import { openAiPanel } from './ai-panel.js';

const HIGHLIGHT_COLORS = ['#FFF3A0', '#B8F1D0', '#BEE0FF', '#FBCFE8'];

// Approximate height of one A4-like page content area in px.
// 934px total page height - 130px cover (page 1 only) - 40px footer - 80px padding ≈ 684px
const PAGE_CONTENT_HEIGHT = 684;
// Continuation pages have no cover: 934 - 40 footer - 48 padding
const CONTINUATION_CONTENT_HEIGHT = 846;

let nbState = null;

export async function renderNotebook(body, doc) {
  teardownNotebook();

  const content = await Documents.getNotesContent(doc.id);
  const meta = doc.display_metadata || {};
  const coverColor = meta.cover_color || '#6C5CE7';
  const icon = meta.icon || '📄';
  const renderedHTML = renderMarkdown(content);

  body.innerHTML = `
    <div class="viewer" id="notebook-viewer-root">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__filename">
          ${Icon.notes}
          <span>${escapeHtml(doc.filename)}</span>
          ${doc.is_ai_generated ? '<span class="badge badge--accent" style="margin-left:8px;">AI-generated</span>' : ''}
        </div>
        <div class="viewer-toolbar__group">
          <button class="btn btn--ghost btn--sm" id="nb-export-pdf" title="Export as PDF">${Icon.download} Export PDF</button>
          <div class="viewer-toolbar__sep"></div>
          <span class="badge badge--tag" id="version-badge">v${doc.current_version}</span>
        </div>
      </div>

      <div class="notebook" id="notebook-scroll">
        <div class="notebook-toolbar" id="notebook-toolbar">
          <button class="notebook-toolbar__btn" data-cmd="bold" title="Bold"><b>B</b></button>
          <button class="notebook-toolbar__btn" data-cmd="italic" title="Italic"><i>I</i></button>
          <div class="notebook-toolbar__sep"></div>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="H2" title="Heading">H1</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="H3" title="Subheading">H2</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="P" title="Paragraph">¶</button>
          <div class="notebook-toolbar__sep"></div>
          <button class="notebook-toolbar__btn" data-cmd="insertUnorderedList" title="Bullet list">${Icon.list}</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="BLOCKQUOTE" title="Quote">"</button>
          <div class="notebook-toolbar__sep"></div>
          <div class="notebook-toolbar__colors" id="highlight-colors" title="Highlight color">
            ${HIGHLIGHT_COLORS.map((c) => `<button class="notebook-toolbar__color" data-color="${c}" style="background:${c};"></button>`).join('')}
            <button class="notebook-toolbar__color" data-color="none" style="background:#fff;border:1px solid var(--line-strong);" title="Remove highlight"></button>
          </div>
          <div class="notebook-toolbar__sep"></div>
          <select class="notebook-toolbar__size" id="font-size-select" title="Text size">
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="1">Small</option>
          </select>
        </div>

        <div id="notebook-pages"></div>
      </div>

      <button class="ai-fab" id="ai-fab-btn"><span class="ai-fab__spark">${Icon.sparkles}</span> AI Magic</button>
      <div class="notebook__savebar saved" id="save-indicator">
        <span class="dot"></span><span id="save-text">Saved</span>
      </div>
    </div>
  `;

  const viewerRoot = body.querySelector('#notebook-viewer-root');
  viewerRoot.querySelector('#ai-fab-btn').addEventListener('click', () => openAiPanel(doc.id));
  viewerRoot.querySelector('#nb-export-pdf').addEventListener('click', () => exportNotebookAsPdf(doc));

  const pagesHost = viewerRoot.querySelector('#notebook-pages');
  const toolbar = viewerRoot.querySelector('#notebook-toolbar');
  const indicator = viewerRoot.querySelector('#save-indicator');
  const saveText = viewerRoot.querySelector('#save-text');
  const versionBadge = viewerRoot.querySelector('#version-badge');

  // Build multi-page layout
  buildPages(pagesHost, renderedHTML, doc, coverColor, icon);

  // Initialise state
  nbState = {
    dirty: false,
    saveTimer: null,
    doc,
    pagesHost,
    indicator,
    saveText,
    versionBadge,
    coverColor,
    icon,
  };

  // Wire toolbar
  wireToolbar(toolbar);

  // Wire edit tracking on all content areas
  wireEditors(pagesHost);

  // Sync on tab close
  const unloadHandler = () => { if (nbState?.dirty) saveNow(); };
  window.addEventListener('beforeunload', unloadHandler);
  nbState.unloadHandler = unloadHandler;
}

function buildPages(host, htmlContent, doc, coverColor, icon) {
  host.innerHTML = '';

  // Render into a hidden measurer to figure out page breaks
  const measurer = document.createElement('div');
  measurer.style.cssText = `
    position:absolute; visibility:hidden; pointer-events:none;
    width:720px; padding:32px;
    font-family:'Source Serif 4', Georgia, serif;
    font-size:1.05rem; line-height:1.85;
  `;
  measurer.innerHTML = htmlContent;
  document.body.appendChild(measurer);

  // Collect all top-level block nodes and their heights
  const blocks = Array.from(measurer.children);
  const blockData = blocks.map((b) => ({
    html: b.outerHTML,
    height: b.getBoundingClientRect().height + 16, // 16px gap between blocks
  }));
  document.body.removeChild(measurer);

  // Paginate
  const pages = [];
  let currentPage = { blocks: [], usedHeight: 0 };
  const isFirstPage = () => pages.length === 0;
  const maxHeight = () => isFirstPage() ? PAGE_CONTENT_HEIGHT : CONTINUATION_CONTENT_HEIGHT;

  for (const block of blockData) {
    if (currentPage.usedHeight + block.height > maxHeight() && currentPage.blocks.length > 0) {
      pages.push(currentPage);
      currentPage = { blocks: [], usedHeight: 0 };
    }
    currentPage.blocks.push(block);
    currentPage.usedHeight += block.height;
  }
  if (currentPage.blocks.length > 0) pages.push(currentPage);

  // If nothing was parsed, make one page with the raw content
  if (pages.length === 0) {
    pages.push({ blocks: [{ html: htmlContent, height: 100 }], usedHeight: 100 });
  }

  // Render pages
  pages.forEach((page, idx) => {
    const pageEl = document.createElement('div');
    pageEl.className = `notebook__page ${idx > 0 ? 'notebook__page--continuation' : ''}`;

    let inner = '';
    if (idx === 0) {
      inner += `
        <div class="notebook__cover" style="background:linear-gradient(135deg, ${coverColor}, ${shade(coverColor)});">
          <div class="notebook__cover-icon">${icon}</div>
          <div class="notebook__cover-title">${escapeHtml(doc.filename.replace(/\.md$/, ''))}</div>
          <div class="notebook__cover-meta">
            Generated from ${
              doc.source_type === 'youtube_notes' ? 'a YouTube video'
              : doc.source_type === 'ppt_to_notes' ? 'a document'
              : 'your notes'
            } · v${doc.current_version}
          </div>
        </div>
      `;
    }
    inner += `
      <div class="notebook__content-wrap">
        <div class="notebook__content" contenteditable="true" data-page-idx="${idx}">
          ${page.blocks.map((b) => b.html).join('')}
        </div>
      </div>
      <div class="notebook__page-footer">Page ${idx + 1} of ${pages.length}</div>
    `;

    pageEl.innerHTML = inner;
    host.appendChild(pageEl);
  });
}

function wireToolbar(toolbar) {
  toolbar.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Apply to whatever content area is focused
      const active = document.activeElement;
      if (active && active.classList.contains('notebook__content')) {
        document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
        markDirty();
      } else {
        // Focus the first editable area if none is active
        const first = document.querySelector('.notebook__content[contenteditable]');
        if (first) { first.focus(); document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined); markDirty(); }
      }
    });
  });

  toolbar.querySelector('#highlight-colors').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    document.execCommand('hiliteColor', false, btn.dataset.color === 'none' ? 'transparent' : btn.dataset.color);
    markDirty();
  });

  toolbar.querySelector('#font-size-select').addEventListener('change', (e) => {
    document.execCommand('fontSize', false, e.target.value);
    markDirty();
  });
}

function wireEditors(pagesHost) {
  pagesHost.querySelectorAll('.notebook__content[contenteditable]').forEach((editor) => {
    editor.addEventListener('input', markDirty);

    // Blur → save
    editor.addEventListener('blur', () => {
      if (nbState?.dirty) saveNow();
    });

    // Make scroll work seamlessly — prevent contenteditable from capturing
    // scroll events that should go to the parent .notebook container
    editor.addEventListener('wheel', (e) => {
      const notebook = pagesHost.closest('.notebook');
      if (!notebook) return;

      const editorRect = editor.getBoundingClientRect();
      const atTop = editor.scrollTop <= 0;
      const atBottom = editor.scrollTop + editorRect.height >= editor.scrollHeight - 1;

      // If content doesn't overflow, or we're at the edge, let parent scroll
      if (editor.scrollHeight <= editorRect.height || (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        // Don't prevent default — let the event bubble to .notebook
        return;
      }
    }, { passive: true });
  });
}

function teardownNotebook() {
  if (!nbState) return;
  if (nbState.unloadHandler) window.removeEventListener('beforeunload', nbState.unloadHandler);
  if (nbState.saveTimer) clearTimeout(nbState.saveTimer);
  nbState = null;
}

function markDirty() {
  if (!nbState) return;
  nbState.dirty = true;
  nbState.indicator.classList.remove('saved');
  nbState.indicator.classList.add('show');
  nbState.saveText.textContent = 'Unsaved changes';
  clearTimeout(nbState.saveTimer);
  nbState.saveTimer = setTimeout(() => saveNow(), 75000);
}

async function saveNow() {
  if (!nbState || !nbState.dirty) return;
  const { doc, pagesHost, indicator, saveText, versionBadge } = nbState;
  saveText.textContent = 'Saving…';

  try {
    // Collect content from all pages in order
    const editors = pagesHost.querySelectorAll('.notebook__content[contenteditable]');
    let fullHTML = '';
    editors.forEach((ed) => { fullHTML += ed.innerHTML; });

    const markdown = htmlToMarkdownApprox(fullHTML);
    const res = await Documents.saveNotesContent(doc.id, markdown);

    if (nbState) {
      nbState.dirty = false;
      indicator.classList.add('saved');
      saveText.textContent = 'Saved';
      if (res?.new_version) {
        doc.current_version = res.new_version;
        versionBadge.textContent = `v${res.new_version}`;
      }
      setTimeout(() => indicator.classList.remove('show'), 1800);
      toast('Notes saved as a new version', 'success', 2000);
    }
  } catch (e) {
    if (nbState) saveText.textContent = 'Save failed — will retry';
    console.error('Notes save failed:', e);
  }
}

// ============================================================
// EXPORT TO PDF via jsPDF
// ============================================================

function exportNotebookAsPdf(doc) {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) {
    toast('PDF export library not loaded', 'danger');
    return;
  }

  toast('Generating PDF…', 'info', 2000);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 56;
  const contentWidth = pageWidth - margin * 2;
  const maxY = pageHeight - margin;

  // Collect all text content from editors
  const editors = document.querySelectorAll('.notebook__content[contenteditable]');
  const allBlocks = [];

  editors.forEach((editor) => {
    Array.from(editor.children).forEach((node) => {
      const tag = node.tagName?.toLowerCase() || 'p';
      const text = (node.textContent || '').trim();
      if (!text) return;
      allBlocks.push({ tag, text });
    });
  });

  let y = margin;
  let pageNum = 1;
  const totalPagesPlaceholder = '{total}';

  // Title page header
  const meta = doc.display_metadata || {};
  pdf.setFillColor(108, 92, 231);
  pdf.rect(0, 0, pageWidth, 100, 'F');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(255, 255, 255);
  pdf.text(doc.filename.replace(/\.md$/, ''), margin, 65);
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  const sourceLabel = doc.source_type === 'youtube_notes' ? 'Generated from a YouTube video'
    : doc.source_type === 'ppt_to_notes' ? 'Generated from a document'
    : 'Study notes';
  pdf.text(`${sourceLabel}  ·  v${doc.current_version}  ·  Exported ${new Date().toLocaleDateString()}`, margin, 85);
  pdf.setTextColor(0, 0, 0);
  y = 130;

  function addPageNumber() {
    pdf.setFontSize(9);
    pdf.setTextColor(150);
    pdf.text(`Page ${pageNum}`, pageWidth / 2, pageHeight - 30, { align: 'center' });
    pdf.setTextColor(0);
  }

  function newPage() {
    addPageNumber();
    pageNum++;
    pdf.addPage();
    y = margin;
  }

  for (const block of allBlocks) {
    let fontSize = 11;
    let fontStyle = 'normal';
    let lineSpacing = 16;
    let blockGap = 12;

    switch (block.tag) {
      case 'h1':
        fontSize = 18; fontStyle = 'bold'; lineSpacing = 22; blockGap = 18;
        break;
      case 'h2':
        fontSize = 15; fontStyle = 'bold'; lineSpacing = 20; blockGap = 16;
        break;
      case 'h3':
        fontSize = 13; fontStyle = 'bold'; lineSpacing = 18; blockGap = 14;
        break;
      case 'li':
        fontSize = 11; blockGap = 8;
        break;
      case 'blockquote':
        fontSize = 11; fontStyle = 'italic'; blockGap = 14;
        break;
      case 'pre': case 'code':
        fontSize = 9.5; lineSpacing = 14;
        break;
      default:
        break;
    }

    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(fontSize);

    const prefix = block.tag === 'li' ? '  •  ' : block.tag === 'blockquote' ? '  │  ' : '';
    const textToRender = prefix + block.text;
    const lines = pdf.splitTextToSize(textToRender, contentWidth);
    const blockHeight = lines.length * lineSpacing + blockGap;

    if (y + blockHeight > maxY) {
      newPage();
    }

    // Draw blockquote bar
    if (block.tag === 'blockquote') {
      pdf.setDrawColor(108, 92, 231);
      pdf.setLineWidth(2);
      pdf.line(margin, y - 2, margin, y + lines.length * lineSpacing + 2);
    }

    lines.forEach((line) => {
      if (y > maxY) newPage();
      pdf.text(line, margin + (block.tag === 'blockquote' ? 8 : 0), y);
      y += lineSpacing;
    });
    y += blockGap;
  }

  addPageNumber();

  // Save
  const safeName = doc.filename.replace(/\.md$/, '').replace(/[^a-zA-Z0-9\s_-]/g, '').trim();
  pdf.save(`${safeName || 'notes'}.pdf`);
  toast('PDF exported', 'success');
}

// ============================================================
// Helpers
// ============================================================

function shade(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (n >> 16) - 30);
  const g = Math.max(0, ((n >> 8) & 0xff) - 30);
  const b = Math.max(0, (n & 0xff) - 30);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function renderMarkdown(md) {
  if (window.marked) {
    try { return window.marked.parse(md); } catch (e) { /* fall through */ }
  }
  return naiveMarkdown(md);
}

function naiveMarkdown(md) {
  let html = escapeHtml(md);
  html = html
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  return `<p>${html}</p>`;
}

function htmlToMarkdownApprox(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  let out = '';
  div.childNodes.forEach((node) => { out += nodeToMd(node); });
  return out.trim() + '\n';
}

function nodeToMd(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  const tag = node.tagName?.toLowerCase();
  const inner = Array.from(node.childNodes).map(nodeToMd).join('');
  switch (tag) {
    case 'h1': return `# ${inner}\n\n`;
    case 'h2': return `## ${inner}\n\n`;
    case 'h3': return `### ${inner}\n\n`;
    case 'p': return `${inner}\n\n`;
    case 'strong': case 'b': return `**${inner}**`;
    case 'em': case 'i': return `*${inner}*`;
    case 'code': return `\`${inner}\``;
    case 'li': return `- ${inner}\n`;
    case 'ul': case 'ol': return `${inner}\n`;
    case 'blockquote': return `> ${inner}\n\n`;
    case 'br': return '\n';
    case 'div': return `${inner}\n`;
    default: return inner;
  }
}