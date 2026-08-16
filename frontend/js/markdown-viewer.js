// ============================================================
// NOTEBOOK VIEW
// Scroll: .notebook-outer is the ONE scroll container, position:absolute
//         inset so it fills exactly the space below the toolbar.
//         contenteditable divs have no overflow of their own.
// Pages:  one .notebook-page per logical "page". Page 1 has a cover.
//         Additional pages added by "Add page" button or auto-split.
// Export: window.print() with a @media print stylesheet that hides
//         everything except the notebook content. Browser renders
//         exact CSS — correct fonts, colours, everything.
// ============================================================

import { Documents } from './api.js';
import { escapeHtml } from './ui-helpers.js';
import { toast } from './toast.js';
import { Icon } from './icons.js';
import { openAiPanel } from './ai-panel.js';

const HIGHLIGHT_COLORS = ['#FFF3A0', '#B8F1D0', '#BEE0FF', '#FBCFE8'];

let nbState = null;

// ---- public entry point ----

export async function renderNotebook(body, doc) {
  teardownNotebook();

  const rawContent = await Documents.getNotesContent(doc.id);
  const meta        = doc.display_metadata || {};
  const coverColor  = meta.cover_color || '#6C5CE7';
  const icon        = meta.icon        || '📄';

  // Split markdown into logical pages on --- or ===PAGE=== markers.
  // If there are none, the whole thing is one page.
  const pageContents = splitIntoPages(rawContent);

  // Build shell
  body.innerHTML = `
    <div class="viewer" id="nb-viewer">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__filename">
          ${Icon.notes}
          <span>${escapeHtml(doc.filename)}</span>
          ${doc.is_ai_generated
            ? '<span class="badge badge--accent" style="margin-left:8px;">AI-generated</span>'
            : ''}
        </div>
        <div class="viewer-toolbar__group">
          <button class="btn btn--ghost btn--sm" id="nb-add-page">${Icon.folderPlus} Add page</button>
          <button class="btn btn--ghost btn--sm" id="nb-export-pdf">${Icon.download} Export PDF</button>
          <div class="viewer-toolbar__sep"></div>
          <span class="badge badge--tag" id="nb-version-badge">v${doc.current_version}</span>
        </div>
      </div>

      <!-- THE scroll container — position:absolute so it sits exactly
           below the 52px toolbar with no interference from flex parents -->
      <div class="notebook-outer" id="nb-outer">
        <div class="notebook-toolbar" id="nb-toolbar">
          <button class="notebook-toolbar__btn" data-cmd="bold"          title="Bold"><b>B</b></button>
          <button class="notebook-toolbar__btn" data-cmd="italic"        title="Italic"><i>I</i></button>
          <button class="notebook-toolbar__btn" data-cmd="underline"     title="Underline"><u>U</u></button>
          <div class="notebook-toolbar__sep"></div>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-val="h1" title="Heading 1">H1</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-val="h2" title="Heading 2">H2</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-val="h3" title="Heading 3">H3</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-val="p"  title="Paragraph">¶</button>
          <div class="notebook-toolbar__sep"></div>
          <button class="notebook-toolbar__btn" data-cmd="insertUnorderedList" title="Bullet list">${Icon.list}</button>
          <button class="notebook-toolbar__btn" data-cmd="insertOrderedList"   title="Numbered list">1.</button>
          <div class="notebook-toolbar__sep"></div>
          <div class="notebook-toolbar__colors">
            ${HIGHLIGHT_COLORS.map(c =>
              `<button class="notebook-toolbar__color" data-color="${c}"
                style="background:${c};" title="Highlight"></button>`).join('')}
            <button class="notebook-toolbar__color" data-color="none"
              style="background:#fff;border:1px solid var(--line-strong);"
              title="Remove highlight"></button>
          </div>
          <div class="notebook-toolbar__sep"></div>
          <select class="notebook-toolbar__size" id="nb-font-size">
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="1">Small</option>
          </select>
        </div>

        <div class="notebook-pages" id="nb-pages"></div>
      </div>

      <div class="notebook__savebar" id="nb-savebar">
        <span class="dot"></span><span id="nb-save-text">Saved</span>
      </div>
    </div>
  `;

  const viewerEl    = body.querySelector('#nb-viewer');
  const outerEl     = body.querySelector('#nb-outer');
  const pagesEl     = body.querySelector('#nb-pages');
  const toolbarEl   = body.querySelector('#nb-toolbar');
  const savebarEl   = body.querySelector('#nb-savebar');
  const saveTextEl  = body.querySelector('#nb-save-text');
  const versionBadge = body.querySelector('#nb-version-badge');

  // Render initial pages
  pageContents.forEach((md, idx) => {
    appendPage(pagesEl, doc, md, idx, coverColor, icon, pageContents.length);
  });

  // State
  nbState = {
    dirty: false,
    saveTimer: null,
    doc, pagesEl, savebarEl, saveTextEl, versionBadge,
    coverColor, icon,
  };

  // Wire toolbar
  wireToolbar(toolbarEl);

  // Wire buttons
  body.querySelector('#nb-add-page').addEventListener('click', () => {
    const count = pagesEl.querySelectorAll('.notebook-page').length;
    appendPage(pagesEl, doc, '', count, coverColor, icon, count + 1, true);
    updatePageFooters(pagesEl);
    // Scroll to new page
    pagesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  body.querySelector('#nb-export-pdf').addEventListener('click', () => exportPdf(doc));

  viewerEl.querySelector('#ai-fab-btn')?.addEventListener('click', () => openAiPanel(doc.id));

  // We need the FAB — add it
  const fab = document.createElement('button');
  fab.className = 'ai-fab';
  fab.id = 'ai-fab-btn';
  fab.innerHTML = `<span class="ai-fab__spark">${Icon.sparkles}</span> AI Magic`;
  fab.addEventListener('click', () => openAiPanel(doc.id));
  viewerEl.appendChild(fab);

  // beforeunload sync
  const unloadHandler = () => { if (nbState?.dirty) saveNow(); };
  window.addEventListener('beforeunload', unloadHandler);
  nbState.unloadHandler = unloadHandler;
}

// ---- page builder ----

function appendPage(pagesEl, doc, markdownContent, pageIdx, coverColor, icon, totalPages, focusAfter = false) {
  const isFirst = pageIdx === 0;
  const html    = renderMarkdown(markdownContent);

  const page = document.createElement('div');
  page.className = 'notebook-page';
  page.dataset.pageIdx = pageIdx;

  let inner = '';

  if (isFirst) {
    const sourceLabel =
      doc.source_type === 'youtube_notes' ? 'a YouTube video'
      : doc.source_type === 'ppt_to_notes' ? 'a document'
      : 'your notes';
    inner += `
      <div class="notebook-page__cover"
           style="background:linear-gradient(135deg,${coverColor},${shade(coverColor)});">
        <div class="notebook-page__cover-icon">${icon}</div>
        <div class="notebook-page__cover-title">${escapeHtml(doc.filename.replace(/\.md$/, ''))}</div>
        <div class="notebook-page__cover-meta">Generated from ${sourceLabel} · v${doc.current_version}</div>
      </div>`;
  }

  inner += `
    <div class="notebook-page__body" contenteditable="true" spellcheck="true">${html || '<p><br></p>'}</div>
    <div class="notebook-page__footer">Page ${pageIdx + 1} of ${totalPages}</div>
  `;

  page.innerHTML = inner;
  pagesEl.appendChild(page);

  // Wire the editor inside this page
  const editor = page.querySelector('.notebook-page__body');
  wireEditor(editor);

  if (focusAfter) {
    requestAnimationFrame(() => {
      editor.focus();
      // place cursor at start
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
  }
}

function wireEditor(editor) {
  // Track changes
  editor.addEventListener('input', markDirty);

  // Save on blur
  editor.addEventListener('blur', () => {
    if (nbState?.dirty) saveNow();
  });

  // CRITICAL: stop the editor from trapping wheel/scroll events.
  // When the user scrolls and the editor itself has no overflow (scrollHeight ≤ clientHeight),
  // the wheel event must NOT be stopped — it naturally bubbles to .notebook-outer.
  // contenteditable does NOT trap wheel events by default, so this is mainly
  // a safeguard; the real fix is that .notebook-outer is the scroll container
  // and the editor has no overflow:auto/scroll of its own.
  editor.style.overflow = 'visible';
}

function updatePageFooters(pagesEl) {
  const pages = pagesEl.querySelectorAll('.notebook-page');
  const total = pages.length;
  pages.forEach((p, i) => {
    const footer = p.querySelector('.notebook-page__footer');
    if (footer) footer.textContent = `Page ${i + 1} of ${total}`;
    p.dataset.pageIdx = i;
  });
}

// ---- toolbar ----

function wireToolbar(toolbar) {
  toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      // mousedown fires BEFORE blur on the editor, keeping focus
      e.preventDefault();
      const val = btn.dataset.val || btn.dataset.value || null;
      document.execCommand(btn.dataset.cmd, false, val);
      markDirty();
    });
  });

  toolbar.querySelector('#nb-toolbar .notebook-toolbar__colors')
    ?.addEventListener('mousedown', e => {
      const btn = e.target.closest('[data-color]');
      if (!btn) return;
      e.preventDefault();
      const color = btn.dataset.color === 'none' ? 'transparent' : btn.dataset.color;
      document.execCommand('hiliteColor', false, color);
      markDirty();
    });

  toolbar.querySelector('#nb-font-size')?.addEventListener('change', e => {
    document.execCommand('fontSize', false, e.target.value);
    markDirty();
  });
}

// ---- dirty / save ----

function markDirty() {
  if (!nbState) return;
  nbState.dirty = true;
  nbState.savebarEl.classList.add('show');
  nbState.savebarEl.classList.remove('saved');
  nbState.saveTextEl.textContent = 'Unsaved changes';
  clearTimeout(nbState.saveTimer);
  nbState.saveTimer = setTimeout(saveNow, 75_000);
}

async function saveNow() {
  if (!nbState || !nbState.dirty) return;
  const { doc, pagesEl, savebarEl, saveTextEl, versionBadge } = nbState;
  saveTextEl.textContent = 'Saving…';

  try {
    const editors = pagesEl.querySelectorAll('.notebook-page__body[contenteditable]');
    let combined = '';
    editors.forEach((ed, i) => {
      if (i > 0) combined += '\n\n---\n\n'; // page break marker
      combined += htmlToMarkdownApprox(ed.innerHTML);
    });

    const res = await Documents.saveNotesContent(doc.id, combined);

    if (nbState) {
      nbState.dirty = false;
      savebarEl.classList.add('saved');
      saveTextEl.textContent = 'Saved';
      if (res?.new_version) {
        doc.current_version = res.new_version;
        versionBadge.textContent = `v${res.new_version}`;
      }
      setTimeout(() => savebarEl.classList.remove('show'), 2000);
      toast('Saved', 'success', 1800);
    }
  } catch (err) {
    if (nbState) saveTextEl.textContent = 'Save failed';
    console.error(err);
  }
}

function teardownNotebook() {
  if (!nbState) return;
  if (nbState.unloadHandler) window.removeEventListener('beforeunload', nbState.unloadHandler);
  if (nbState.saveTimer) clearTimeout(nbState.saveTimer);
  nbState = null;
}

// ---- export ----

function exportPdf(doc) {
  // Clone the notebook pages into a hidden print-only container attached to <body>.
  // window.print() will render that via @media print CSS — correct fonts, colours,
  // border-radius on cover, everything — then we remove the clone.

  const existing = document.getElementById('nb-print-root');
  if (existing) existing.remove();

  const printRoot = document.createElement('div');
  printRoot.id = 'nb-print-root';
  printRoot.className = 'notebook-print-root';

  // Copy just the pages
  const sourcePagesEl = document.getElementById('nb-pages');
  if (!sourcePagesEl) { toast('Nothing to export', 'danger'); return; }

  const pagesClone = sourcePagesEl.cloneNode(true);

  // Make cloned editors non-editable (cleaner print)
  pagesClone.querySelectorAll('[contenteditable]').forEach(el => {
    el.removeAttribute('contenteditable');
  });

  printRoot.appendChild(pagesClone);
  document.body.appendChild(printRoot);

  // Small delay so DOM paints, then print
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
      // Clean up after dialog closes
      setTimeout(() => printRoot.remove(), 1000);
    });
  });
}

// ---- markdown / page splitting ----

function splitIntoPages(markdown) {
  // Split on --- or ===PAGE=== as page break markers
  const parts = markdown.split(/\n(?:---|===PAGE===)\n/);
  return parts.map(p => p.trim()).filter(Boolean);
}

// ---- markdown → HTML ----

function renderMarkdown(md) {
  if (!md || !md.trim()) return '<p><br></p>';
  if (window.marked) {
    try {
      return window.marked.parse(md);
    } catch (e) { /* fall through */ }
  }
  return naiveMarkdown(md);
}

function naiveMarkdown(md) {
  let html = escapeHtml(md)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.*)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>')
    .replace(/^&gt; (.*)$/gm,  '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm,     '<li>$1</li>')
    .replace(/\n{2,}/g,        '</p><p>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  return `<p>${html}</p>`;
}

// ---- HTML → markdown (approximate, for save) ----

function htmlToMarkdownApprox(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return Array.from(div.childNodes).map(nodeToMd).join('').trim() + '\n';
}

function nodeToMd(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  const tag   = node.tagName?.toLowerCase() || '';
  const inner = Array.from(node.childNodes).map(nodeToMd).join('');
  switch (tag) {
    case 'h1':         return `# ${inner}\n\n`;
    case 'h2':         return `## ${inner}\n\n`;
    case 'h3':         return `### ${inner}\n\n`;
    case 'p':          return `${inner}\n\n`;
    case 'strong': case 'b': return `**${inner}**`;
    case 'em':    case 'i':  return `*${inner}*`;
    case 'u':          return `${inner}`;
    case 'code':       return `\`${inner}\``;
    case 'li':         return `- ${inner}\n`;
    case 'ul': case 'ol': return `${inner}\n`;
    case 'blockquote': return `> ${inner}\n\n`;
    case 'br':         return '\n';
    case 'div':        return `${inner}\n`;
    default:           return inner;
  }
}

// ---- helpers ----

function shade(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (n >> 16)        - 30);
  const g = Math.max(0, ((n >> 8) & 0xff) - 30);
  const b = Math.max(0, (n & 0xff)        - 30);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}