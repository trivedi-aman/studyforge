// ============================================================
// VIEWER — routes to the right renderer per file_type, and
// implements the full PDF study-viewer experience (README 2.2).
// ============================================================

import { Documents, Annotations, MOCK_MODE, S3_PUBLIC_BASE_URL, AI } from './api.js';
import { state, set } from './state.js';
import { Icon } from './icons.js';
import { openModal, openContextMenu, escapeHtml, formatBytes, formatDate } from './ui-helpers.js';
import { toast } from './toast.js';
import { busEmit } from './bus.js';
import { renderNotebook } from './markdown-viewer.js';
import { openAiPanel } from './ai-panel.js';

const TYPE_ICON = { pdf: Icon.filePdf, pptx: Icon.fileSlides, docx: Icon.file, xlsx: Icon.file, image: Icon.fileImage, txt: Icon.file, md: Icon.notes };

// Module-level cleanup registry — ensures we never leak observers or state
// across document opens.
let _cleanup = null;

export async function openDocument(docId) {
  // Run any cleanup from the previously open document
  if (_cleanup) { _cleanup(); _cleanup = null; }

  const doc = await Documents.get(docId);
  if (!doc) { toast('Could not open that document', 'danger'); return; }
  set({ selectedDocument: doc });

  const crumbs = document.querySelector('#breadcrumbs');
  const topActions = document.querySelector('#topbar-actions');
  const body = document.querySelector('#main-body');

  crumbs.innerHTML = `
    <span class="topbar__crumb" id="viewer-back" style="cursor:pointer;display:flex;align-items:center;gap:6px;">${Icon.arrowLeft} Back</span>
    <span class="topbar__sep">${Icon.chevRight}</span>
    <span class="topbar__crumb current" style="display:flex;align-items:center;gap:6px;">${TYPE_ICON[doc.file_type] || Icon.file}${escapeHtml(doc.filename)}</span>
  `;
  crumbs.querySelector('#viewer-back').addEventListener('click', () => {
    if (_cleanup) { _cleanup(); _cleanup = null; }
    busEmit('sf:nav-changed', {});
  });

  topActions.innerHTML = `
    <button class="btn btn--accent btn--sm" id="ai-magic-topbtn">${Icon.sparkles} AI Magic</button>
    <button class="icon-btn" id="fav-toggle" title="Favorite" style="${doc.favorite ? 'color:var(--warning)' : ''}">${Icon.star}</button>
    <button class="icon-btn" id="doc-more" title="More">${Icon.more}</button>
  `;
  topActions.querySelector('#ai-magic-topbtn').addEventListener('click', () => openAiPanel(doc.id));
  topActions.querySelector('#fav-toggle').addEventListener('click', async () => {
    await Documents.toggleFavorite(doc.id);
    doc.favorite = !doc.favorite;
    topActions.querySelector('#fav-toggle').style.color = doc.favorite ? 'var(--warning)' : '';
    toast(doc.favorite ? 'Added to favorites' : 'Removed from favorites', 'success');
  });
  topActions.querySelector('#doc-more').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(rect.right, rect.bottom + 6, buildFileActionsMenu(doc));
  });

  if (doc.file_type === 'md') {
    await renderNotebook(body, doc);
  } else if (doc.file_type === 'image') {
    renderImageViewer(body, doc);
  } else if (doc.file_type === 'txt') {
    renderTextViewer(body, doc);
  } else {
    await renderPdfViewer(body, doc);
  }
}

function buildFileActionsMenu(doc) {
  return [
    { label: 'Document info', icon: Icon.info, action: 'info', onClick: () => showDocInfo(doc) },
    { label: 'Download original', icon: Icon.download, action: 'download', onClick: () => toast(`Downloading ${doc.filename}…`, 'info') },
    { label: 'Version history', icon: Icon.history, action: 'history', onClick: () => showVersionHistory(doc) },
    { type: 'sep' },
    { label: 'Replace file', icon: Icon.upload, action: 'replace', onClick: () => promptReplaceFile(doc) },
    { label: 'Rename', icon: Icon.edit, action: 'rename', onClick: () => toast('Use the file grid context menu to rename', 'info') },
    { type: 'sep' },
    { label: 'Delete', icon: Icon.trash, action: 'delete', danger: true, onClick: () => confirmDelete(doc) },
  ];
}

function showDocInfo(doc) {
  openModal({
    title: 'Document info',
    bodyHTML: `
      <div style="display:flex; flex-direction:column; gap:10px; font-size: var(--text-sm);">
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-500)">Filename</span><span>${escapeHtml(doc.filename)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-500)">Type</span><span>${doc.file_type.toUpperCase()}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-500)">Size</span><span>${formatBytes(doc.file_size_bytes)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-500)">Current version</span><span>v${doc.current_version}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-500)">Created</span><span>${formatDate(doc.created_at)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text-500)">Source</span><span>${doc.is_ai_generated ? `AI-generated (${doc.source_type})` : 'Uploaded'}</span></div>
      </div>`,
    footerHTML: `<button class="btn btn--primary" data-close-modal>Done</button>`,
  });
}

async function showVersionHistory(doc) {
  const versions = await Documents.versions(doc.id);
  const rows = versions.slice().reverse().map((v) => `
    <div style="display:flex; align-items:center; justify-content:space-between; padding: 10px 0; border-bottom: 1px solid var(--line);">
      <div>
        <div style="font-weight:600; font-size: var(--text-sm);">Version ${v.version_number} ${v.version_number === doc.current_version ? '<span class="badge badge--accent" style="margin-left:6px;">Current</span>' : ''}</div>
        <div style="font-size: var(--text-xs); color: var(--text-500); font-family: var(--font-mono);">${formatDate(v.uploaded_at)} · ${formatBytes(v.file_size_bytes)}</div>
      </div>
      ${v.version_number !== doc.current_version ? `<button class="btn btn--ghost btn--sm" data-restore="${v.version_number}">Restore</button>` : ''}
    </div>`).join('');
  const { el } = openModal({
    title: 'Version history',
    subtitle: doc.filename,
    bodyHTML: `<div>${rows}</div>`,
    footerHTML: `<button class="btn btn--primary" data-close-modal>Done</button>`,
  });
  el.querySelectorAll('[data-restore]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await Documents.restoreVersion(doc.id, Number(btn.dataset.restore));
      toast(`Restored version ${btn.dataset.restore}`, 'success');
      el.querySelector('[data-close-modal]')?.click();
      openDocument(doc.id);
    });
  });
}

function promptReplaceFile(doc) {
  const { el, close } = openModal({
    title: 'Replace file',
    subtitle: 'This creates a new version — the current version stays in history.',
    bodyHTML: `<div class="dropzone" id="replace-dropzone">${Icon.upload}<div>Click to choose a new file</div></div><input type="file" id="replace-input" style="display:none" />`,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button>`,
  });
  el.querySelector('#replace-dropzone').addEventListener('click', () => el.querySelector('#replace-input').click());
  el.querySelector('#replace-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await Documents.replaceFile(doc.id, file);
    toast('New version uploaded', 'success');
    close();
    openDocument(doc.id);
  });
}

function confirmDelete(doc) {
  const { close } = openModal({
    title: `Delete "${doc.filename}"?`,
    subtitle: "This can't be undone.",
    bodyHTML: '',
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn" id="vdel-confirm" style="background:var(--danger); color:#fff;">Delete</button>`,
  });
  document.getElementById('vdel-confirm').addEventListener('click', async () => {
    await Documents.remove(doc.id);
    close();
    toast('Deleted', 'success');
    busEmit('sf:nav-changed', {});
  });
}

// ============================================================
// Simple viewers (image / txt)
// ============================================================
function renderImageViewer(body, doc) {
  body.innerHTML = `
    <div class="viewer">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__filename">${Icon.fileImage}<span>${escapeHtml(doc.filename)}</span></div>
        <div></div>
      </div>
      <div class="simple-viewer">${placeholderImageSvg(doc.filename)}</div>
    </div>`;
}

function placeholderImageSvg(name) {
  return `<svg width="420" height="300" viewBox="0 0 420 300" style="border-radius:12px; box-shadow: var(--shadow-md);">
    <rect width="420" height="300" fill="#EEEBFC"/>
    <circle cx="90" cy="90" r="34" fill="#6C5CE7" opacity="0.4"/>
    <path d="M0 230 L120 150 L200 210 L280 120 L420 230 L420 300 L0 300 Z" fill="#C7C7D1" opacity="0.5"/>
    <text x="210" y="280" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" fill="#6E6E78">${escapeHtml(name)}</text>
  </svg>`;
}

function renderTextViewer(body, doc) {
  body.innerHTML = `
    <div class="viewer">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__filename">${Icon.file}<span>${escapeHtml(doc.filename)}</span></div>
        <div></div>
      </div>
      <div class="simple-viewer"><pre>Plain-text preview of ${escapeHtml(doc.filename)}.

This is a stand-in for the real file content, rendered exactly as uploaded — no formatting, no conversion needed for .txt files.</pre></div>
    </div>`;
}

// ============================================================
// PDF viewer
// ============================================================

// Single PDF state object — always reset before a new document loads.
// Keeping it module-level (rather than closure-local) lets toolbar
// callbacks and annotation handlers reach it without prop-drilling.
let pdfState = null;

async function renderPdfViewer(body, doc) {
  // Reset state fully before rendering a new document
  pdfState = null;

  body.innerHTML = `
    <div class="viewer" id="pdf-viewer-root">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__group">
          <button class="icon-btn" id="tb-search" title="Search">${Icon.search}</button>
          <div class="viewer-toolbar__sep"></div>
          <button class="icon-btn" id="tb-prev" title="Previous page">${Icon.chevLeft}</button>
          <input class="viewer-toolbar__pageinput" id="tb-pagenum" value="1" />
          <span class="viewer-toolbar__pagetotal">/ <span id="tb-total">—</span></span>
          <button class="icon-btn" id="tb-next" title="Next page">${Icon.chevRight}</button>
        </div>
        <div class="viewer-toolbar__filename">
          ${TYPE_ICON[doc.file_type] || Icon.filePdf}
          <span>${escapeHtml(doc.filename)}</span>
          ${doc.file_type !== 'pdf' ? '<span class="badge badge--tag" style="margin-left:6px;">Converted preview</span>' : ''}
        </div>
        <div class="viewer-toolbar__group">
          <button class="icon-btn" id="tb-zoomout" title="Zoom out">${Icon.zoomOut}</button>
          <span class="viewer-toolbar__zoom" id="tb-zoomlevel">100%</span>
          <button class="icon-btn" id="tb-zoomin" title="Zoom in">${Icon.zoomIn}</button>
          <div class="viewer-toolbar__sep"></div>
          <button class="icon-btn" id="tb-fullscreen" title="Full screen">${Icon.fullscreen}</button>
        </div>
      </div>

      <div class="viewer-search" id="viewer-search">
        <input type="text" id="search-input" placeholder="Search in document…" />
        <span class="viewer-toolbar__sep"></span>
        <button class="icon-btn" id="search-prev" title="Previous match">${Icon.chevLeft}</button>
        <span class="viewer-search__count" id="search-count">0 / 0</span>
        <button class="icon-btn" id="search-next" title="Next match">${Icon.chevRight}</button>
        <button class="icon-btn" id="search-close" title="Close search">${Icon.close}</button>
      </div>

      <div class="viewer-body">
        <div class="viewer-thumbs" id="viewer-thumbs"></div>
        <div class="viewer-scroll" id="viewer-scroll">
          <div class="empty-state" style="height:100%;">
            <div class="empty-state__icon">${Icon.filePdf}</div>
            <div class="empty-state__title">Loading document…</div>
          </div>
        </div>
      </div>
      <button class="ai-fab" id="ai-fab-btn"><span class="ai-fab__spark">${Icon.sparkles}</span> AI Magic</button>
    </div>
  `;

  const viewerRoot = body.querySelector('#pdf-viewer-root');
  viewerRoot.querySelector('#ai-fab-btn').addEventListener('click', () => openAiPanel(doc.id));

  // Load the PDF
  const url = await loadPdfUrl(doc);
  const pdfjsLib = window.pdfjsLib;

  let pdf;
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    pdf = await loadingTask.promise;
  } catch (err) {
    console.error('PDF load error:', err);
    viewerRoot.querySelector('#viewer-scroll').innerHTML = `
      <div class="empty-state" style="height:100%;">
        <div class="empty-state__icon">${Icon.filePdf}</div>
        <div class="empty-state__title">Couldn't load preview</div>
        <div class="empty-state__desc">${escapeHtml(err.message || 'The document failed to load.')}</div>
      </div>`;
    return;
  }

  // Initialise state AFTER successful load
  pdfState = {
    pdf,
    doc,
    scale: 1.2,
    matches: [],       // page numbers that contain the search term
    matchIndex: -1,
    textCache: {},     // pageNum -> plain text string
    observer: null,    // IntersectionObserver — stored so we can disconnect on cleanup
    rendering: false,  // guard against concurrent rescale calls
  };

  viewerRoot.querySelector('#tb-total').textContent = pdf.numPages;

  // Hide thumb rail for single-page docs
  if (pdf.numPages === 1) {
    viewerRoot.querySelector('#viewer-thumbs').style.display = 'none';
  }

  await renderAllPages(viewerRoot);
  renderThumbnails(viewerRoot);   // fire-and-forget — thumbs render async in background
  wireToolbar(viewerRoot, doc);
  wirePageObserver(viewerRoot);
  await loadAndRenderAnnotations(viewerRoot, doc);

  // Register cleanup so the next openDocument() call tears everything down
  _cleanup = () => {
    if (pdfState?.observer) { pdfState.observer.disconnect(); }
    pdfState = null;
  };
}

async function loadPdfUrl(doc) {
  if (MOCK_MODE) return generateMockPdfUrl(doc);
  // Real mode: prefer the normalized preview PDF; fall back to the original
  const key = doc.preview_pdf_s3_key || doc.original_s3_key;
  return `${S3_PUBLIC_BASE_URL}/${key}`;
}

function generateMockPdfUrl(doc) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

  const pages = [
    {
      h: doc.filename.replace(/\.[^.]+$/, ''),
      body: [
        'This is a demo preview — in the real app this renders the actual uploaded or converted PDF from S3.',
        'The viewer is fully functional: navigation, zoom, thumbnails, in-document search, text selection, and highlight/sticky-note annotations all work against this generated PDF exactly as they will against real files.',
      ],
    },
    {
      h: 'Section 1 — Navigation & Zoom',
      body: [
        'Use the arrow buttons in the toolbar to move between pages, or click any thumbnail in the left rail.',
        'Zoom in and out with the magnifier buttons. The page number input also accepts direct entry — type a number and press Enter.',
      ],
    },
    {
      h: 'Section 2 — Search & Annotations',
      body: [
        'Click the search icon to open the in-document search bar. Try searching for "annotations" or "zoom" — matching pages are highlighted in the counter.',
        'Select any text on this page — a small toolbar appears letting you highlight it in one of four colours, add a sticky note, or explain it with AI.',
      ],
    },
    {
      h: 'Section 3 — AI Magic',
      body: [
        'The purple "AI Magic" button in the bottom-right corner opens the AI panel scoped to this document. Nothing runs automatically — every AI call is explicit.',
        'From the panel you can ask questions about this document, get a summary, explain selected text, or generate structured Markdown study notes.',
      ],
    },
  ];

  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text(p.h, 56, 72);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    let y = 110;
    p.body.forEach((para) => {
      const lines = pdf.splitTextToSize(para, 484);
      pdf.text(lines, 56, y);
      y += lines.length * 17 + 20;
    });
    pdf.setFontSize(9);
    pdf.setTextColor(150);
    pdf.text(`Page ${i + 1} of ${pages.length}`, 284, 810, { align: 'center' });
    pdf.setTextColor(0);
  });

  return URL.createObjectURL(pdf.output('blob'));
}

// ---- Page rendering ----

async function renderAllPages(viewerRoot) {
  const scroll = viewerRoot.querySelector('#viewer-scroll');
  scroll.innerHTML = '';

  const { pdf, scale } = pdfState;
  const devicePixelRatio = window.devicePixelRatio || 1;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    // Outer wrapper — sized in CSS pixels
    const pageEl = document.createElement('div');
    pageEl.className = 'viewer-page';
    pageEl.dataset.page = pageNum;
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;

    // Canvas — rendered at device pixel ratio for sharp text on HiDPI screens
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * devicePixelRatio);
    canvas.height = Math.floor(viewport.height * devicePixelRatio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);

    await page.render({ canvasContext: ctx, viewport }).promise;
    pageEl.appendChild(canvas);

    // Text layer — transparent overlay for selection & search
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.cssText = `width:${viewport.width}px; height:${viewport.height}px;`;
    pageEl.appendChild(textLayerDiv);

    // Extract plain text for search cache
    try {
      const textContent = await page.getTextContent();
      pdfState.textCache[pageNum] = textContent.items.map((it) => it.str).join(' ');

      // pdf.js 3.x text layer API
      const textLayerObj = new pdfjsLib.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayerObj.promise;
    } catch (textErr) {
      // Text layer is optional — canvas render already succeeded
      console.warn(`Text layer page ${pageNum}:`, textErr);
    }

    // Annotation layer — pointer-events on; sits above text layer
    const annotLayer = document.createElement('div');
    annotLayer.className = 'annot-layer';
    annotLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    pageEl.appendChild(annotLayer);

    // Wire text selection → annotation popover
    pageEl.addEventListener('mouseup', () => handleTextSelection(viewerRoot, pageEl, pageNum));

    scroll.appendChild(pageEl);
  }
}

// Thumbnails rendered at a low scale asynchronously — don't await in the main flow
async function renderThumbnails(viewerRoot) {
  const thumbsEl = viewerRoot.querySelector('#viewer-thumbs');
  thumbsEl.innerHTML = '';
  const { pdf } = pdfState;
  const THUMB_SCALE = 0.18;

  for (let i = 1; i <= pdf.numPages; i++) {
    // Guard: viewer might have been torn down while thumbs were rendering
    if (!pdfState || pdfState.pdf !== pdf) return;

    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: THUMB_SCALE });

    const thumb = document.createElement('div');
    thumb.className = `viewer-thumb ${i === 1 ? 'active' : ''}`;
    thumb.dataset.page = i;

    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    thumb.appendChild(canvas);

    const numLabel = document.createElement('span');
    numLabel.className = 'viewer-thumb__num';
    numLabel.textContent = i;
    thumb.appendChild(numLabel);

    thumb.addEventListener('click', () => jumpToPage(viewerRoot, i));
    thumbsEl.appendChild(thumb);
  }
}

function jumpToPage(viewerRoot, n) {
  const el = viewerRoot.querySelector(`.viewer-page[data-page="${n}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Toolbar wiring ----

function wireToolbar(viewerRoot, doc) {
  const pageInput = viewerRoot.querySelector('#tb-pagenum');

  viewerRoot.querySelector('#tb-prev').addEventListener('click', () => {
    const cur = parseInt(pageInput.value, 10) || 1;
    if (cur > 1) jumpToPage(viewerRoot, cur - 1);
  });

  viewerRoot.querySelector('#tb-next').addEventListener('click', () => {
    const cur = parseInt(pageInput.value, 10) || 1;
    if (pdfState && cur < pdfState.pdf.numPages) jumpToPage(viewerRoot, cur + 1);
  });

  pageInput.addEventListener('change', () => {
    if (!pdfState) return;
    const n = Math.min(Math.max(1, parseInt(pageInput.value, 10) || 1), pdfState.pdf.numPages);
    pageInput.value = n;
    jumpToPage(viewerRoot, n);
  });

  // Zoom
  viewerRoot.querySelector('#tb-zoomin').addEventListener('click', () => {
    if (!pdfState || pdfState.rendering) return;
    rescale(viewerRoot, Math.min(pdfState.scale + 0.2, 3.0));
  });
  viewerRoot.querySelector('#tb-zoomout').addEventListener('click', () => {
    if (!pdfState || pdfState.rendering) return;
    rescale(viewerRoot, Math.max(pdfState.scale - 0.2, 0.4));
  });

  // Fullscreen
  viewerRoot.querySelector('#tb-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) viewerRoot.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Search
  const searchBar = viewerRoot.querySelector('#viewer-search');
  const searchInput = viewerRoot.querySelector('#search-input');

  viewerRoot.querySelector('#tb-search').addEventListener('click', () => {
    const isOpen = searchBar.classList.toggle('open');
    if (isOpen) searchInput.focus();
    else clearSearch(viewerRoot);
  });
  viewerRoot.querySelector('#search-close').addEventListener('click', () => {
    searchBar.classList.remove('open');
    clearSearch(viewerRoot);
  });
  searchInput.addEventListener('input', (e) => runSearch(viewerRoot, e.target.value));
  viewerRoot.querySelector('#search-next').addEventListener('click', () => stepMatch(viewerRoot, 1));
  viewerRoot.querySelector('#search-prev').addEventListener('click', () => stepMatch(viewerRoot, -1));

  // Keyboard shortcut — Ctrl/Cmd+F opens search
  const kbHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      searchBar.classList.add('open');
      searchInput.focus();
    }
  };
  document.addEventListener('keydown', kbHandler);
  // Store for cleanup
  const existingCleanup = _cleanup;
  _cleanup = () => {
    document.removeEventListener('keydown', kbHandler);
    if (existingCleanup) existingCleanup();
  };
}

async function rescale(viewerRoot, newScale) {
  if (!pdfState || pdfState.rendering) return;
  pdfState.rendering = true;
  pdfState.scale = newScale;

  const zoomLabel = viewerRoot.querySelector('#tb-zoomlevel');
  if (zoomLabel) zoomLabel.textContent = `${Math.round((newScale / 1.2) * 100)}%`;

  // Disconnect old observer before re-rendering pages
  if (pdfState.observer) {
    pdfState.observer.disconnect();
    pdfState.observer = null;
  }

  // Remember which page we were on so we can scroll back to it
  const pageInput = viewerRoot.querySelector('#tb-pagenum');
  const currentPage = parseInt(pageInput?.value, 10) || 1;

  await renderAllPages(viewerRoot);
  await loadAndRenderAnnotations(viewerRoot, pdfState.doc);
  wirePageObserver(viewerRoot);

  // Scroll back to where we were
  jumpToPage(viewerRoot, currentPage);

  pdfState.rendering = false;
}

// ---- Page visibility observer ----

function wirePageObserver(viewerRoot) {
  if (!pdfState) return;

  // Disconnect any previous observer
  if (pdfState.observer) pdfState.observer.disconnect();

  const scroll = viewerRoot.querySelector('#viewer-scroll');
  const pageInput = viewerRoot.querySelector('#tb-pagenum');

  const observer = new IntersectionObserver(
    (entries) => {
      // Pick the page with the highest intersection ratio that is actually visible
      let best = null;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry;
        }
      }
      if (best) {
        const n = Number(best.target.dataset.page);
        if (pageInput) pageInput.value = n;
        viewerRoot.querySelectorAll('.viewer-thumb').forEach((t) => {
          t.classList.toggle('active', Number(t.dataset.page) === n);
        });
      }
    },
    { root: scroll, threshold: [0, 0.25, 0.5, 0.75, 1.0] },
  );

  viewerRoot.querySelectorAll('.viewer-page').forEach((p) => observer.observe(p));
  pdfState.observer = observer;
}

// ---- Search ----

function runSearch(viewerRoot, query) {
  const countEl = viewerRoot.querySelector('#search-count');
  if (!pdfState || !query.trim()) {
    if (pdfState) pdfState.matches = [];
    if (countEl) countEl.textContent = '0 / 0';
    return;
  }
  const q = query.toLowerCase();
  pdfState.matches = Object.entries(pdfState.textCache)
    .filter(([, text]) => text.toLowerCase().includes(q))
    .map(([page]) => Number(page))
    .sort((a, b) => a - b);
  pdfState.matchIndex = pdfState.matches.length ? 0 : -1;
  if (countEl) countEl.textContent = `${pdfState.matches.length ? 1 : 0} / ${pdfState.matches.length}`;
  if (pdfState.matches.length) jumpToPage(viewerRoot, pdfState.matches[0]);
}

function stepMatch(viewerRoot, dir) {
  if (!pdfState || !pdfState.matches.length) return;
  pdfState.matchIndex = (pdfState.matchIndex + dir + pdfState.matches.length) % pdfState.matches.length;
  const countEl = viewerRoot.querySelector('#search-count');
  if (countEl) countEl.textContent = `${pdfState.matchIndex + 1} / ${pdfState.matches.length}`;
  jumpToPage(viewerRoot, pdfState.matches[pdfState.matchIndex]);
}

function clearSearch(viewerRoot) {
  if (pdfState) { pdfState.matches = []; pdfState.matchIndex = -1; }
  const countEl = viewerRoot.querySelector('#search-count');
  if (countEl) countEl.textContent = '0 / 0';
  const input = viewerRoot.querySelector('#search-input');
  if (input) input.value = '';
}

// ---- Annotations ----

const COLORS = ['yellow', 'green', 'blue', 'pink'];

async function loadAndRenderAnnotations(viewerRoot, doc) {
  try {
    const annots = await Annotations.list(doc.id, doc.current_version);
    annots.forEach((a) => renderAnnotation(viewerRoot, a));
  } catch (e) {
    console.warn('Annotation load failed:', e);
  }
}

function renderAnnotation(viewerRoot, a) {
  const pageEl = viewerRoot.querySelector(`.viewer-page[data-page="${a.page_number}"]`);
  if (!pageEl) return;
  const layer = pageEl.querySelector('.annot-layer');
  if (!layer) return;

  if (a.annotation_type === 'sticky_note') {
    const pin = document.createElement('div');
    pin.className = 'annot-note-pin';
    pin.style.cssText = `left:${a.x_coord * 100}%; top:${a.y_coord * 100}%; pointer-events:auto; position:absolute;`;
    pin.innerHTML = Icon.stickyNote;
    pin.title = a.content || '';
    pin.addEventListener('click', (e) => showAnnotInfo(e, a, viewerRoot));
    layer.style.pointerEvents = 'none';
    layer.appendChild(pin);
  } else {
    const hl = document.createElement('div');
    hl.className = `annot-highlight color-${a.color || 'yellow'}`;
    hl.style.cssText = `
      position:absolute;
      left:${a.x_coord * 100}%;
      top:${a.y_coord * 100}%;
      width:${a.width * 100}%;
      height:${a.height * 100}%;
      pointer-events:auto;
    `;
    hl.addEventListener('click', (e) => showAnnotInfo(e, a, viewerRoot));
    layer.appendChild(hl);
  }
}

function showAnnotInfo(e, a, viewerRoot) {
  e.stopPropagation();
  document.querySelectorAll('.annot-popover').forEach((p) => p.remove());

  const pop = document.createElement('div');
  pop.className = 'annot-popover';

  // Clamp to viewport
  const x = Math.min(e.clientX, window.innerWidth - 240);
  const y = Math.min(e.clientY + 8, window.innerHeight - 120);
  pop.style.cssText = `left:${x}px; top:${y}px; flex-direction:column; align-items:flex-start; max-width:220px;`;

  pop.innerHTML = `
    ${a.content ? `<div style="padding:6px 8px; font-size:12px; line-height:1.5; max-width:200px; border-bottom:1px solid rgba(255,255,255,0.1);">${escapeHtml(a.content)}</div>` : ''}
    <button style="width:auto; padding:6px 10px; gap:6px; display:flex; align-items:center;" data-del>
      ${Icon.trash}<span style="font-size:11px;">Remove</span>
    </button>
  `;
  document.body.appendChild(pop);

  pop.querySelector('[data-del]').addEventListener('click', async () => {
    await Annotations.remove(a.id);
    pop.remove();
    if (state.selectedDocument) {
      await loadAndRenderAnnotations(viewerRoot, state.selectedDocument);
    }
  });

  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(ev) {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); }
    });
  }, 0);
}

function handleTextSelection(viewerRoot, pageEl, pageNumber) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

  const range = sel.getRangeAt(0);
  const rawRects = Array.from(range.getClientRects()).filter((r) => r.width > 2 && r.height > 2);
  if (!rawRects.length) return;

  const pageRect = pageEl.getBoundingClientRect();
  const selectedText = sel.toString();

  // One rect per visual line the selection covers
  const lineRects = rawRects.map((r) => ({
    relX: (r.left - pageRect.left) / pageRect.width,
    relY: (r.top - pageRect.top) / pageRect.height,
    relW: r.width / pageRect.width,
    relH: r.height / pageRect.height,
  }));

  const anchorRect = rawRects[0];

  document.querySelectorAll('.annot-popover').forEach((p) => p.remove());

  const pop = document.createElement('div');
  pop.className = 'annot-popover';

  // Clamp popover to viewport
  const popLeft = Math.max(8, Math.min(anchorRect.left + anchorRect.width / 2 - 90, window.innerWidth - 196));
  const popTop = Math.max(8, anchorRect.top - 50);
  pop.style.cssText = `left:${popLeft}px; top:${popTop}px;`;

  pop.innerHTML = `
    ${COLORS.map((c) => `<button data-color="${c}" title="Highlight ${c}"><span class="annot-color-dot ${c}"></span></button>`).join('')}
    <button data-note title="Sticky note">${Icon.stickyNote}</button>
    <button data-explain title="Explain with AI">${Icon.sparkles}</button>
  `;
  document.body.appendChild(pop);

  // Highlight buttons
  pop.querySelectorAll('[data-color]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      pop.remove();
      for (const lr of lineRects) {
        const a = await Annotations.create({
          document_id: state.selectedDocument.id,
          version_number: state.selectedDocument.current_version,
          annotation_type: 'highlight',
          page_number: pageNumber,
          x_coord: lr.relX,
          y_coord: lr.relY,
          width: lr.relW,
          height: lr.relH,
          color: btn.dataset.color,
          content: null,
        });
        renderAnnotation(viewerRoot, a);
      }
      sel.removeAllRanges();
    });
  });

  // Sticky note button
  pop.querySelector('[data-note]').addEventListener('click', () => {
    pop.remove();
    const { close } = openModal({
      title: 'Add sticky note',
      bodyHTML: `<div class="field"><textarea class="textarea" id="note-text" placeholder="Write a note…" autofocus></textarea></div>`,
      footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="note-save">Add note</button>`,
    });
    document.getElementById('note-save').addEventListener('click', async () => {
      const content = document.getElementById('note-text').value.trim();
      if (!content) return;
      const first = lineRects[0];
      const a = await Annotations.create({
        document_id: state.selectedDocument.id,
        version_number: state.selectedDocument.current_version,
        annotation_type: 'sticky_note',
        page_number: pageNumber,
        x_coord: first.relX,
        y_coord: first.relY,
        width: first.relW,
        height: first.relH,
        color: 'yellow',
        content,
      });
      renderAnnotation(viewerRoot, a);
      close();
      sel.removeAllRanges();
    });
  });

  // Explain with AI
  pop.querySelector('[data-explain]').addEventListener('click', () => {
    pop.remove();
    sel.removeAllRanges();
    openAiPanel(state.selectedDocument.id, { explainText: selectedText });
  });

  // Dismiss on outside click
  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(ev) {
      if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); }
    });
  }, 0);
}