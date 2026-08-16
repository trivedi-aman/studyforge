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

export async function openDocument(docId) {
  const doc = await Documents.get(docId);
  if (!doc) { toast('Could not open that document', 'danger'); return; }
  set({ selectedDocument: doc });

  const crumbs = document.querySelector('#breadcrumbs');
  const topActions = document.querySelector('#topbar-actions');
  const body = document.querySelector('#main-body');

  crumbs.innerHTML = `
    <span class="topbar__crumb" id="viewer-back" style="display:flex;align-items:center;gap:6px;">${Icon.arrowLeft} Back</span>
    <span class="topbar__sep">${Icon.chevRight}</span>
    <span class="topbar__crumb current" style="display:flex;align-items:center;gap:6px;">${TYPE_ICON[doc.file_type] || Icon.file}${escapeHtml(doc.filename)}</span>
  `;
  crumbs.querySelector('#viewer-back').addEventListener('click', () => busEmit('sf:nav-changed', {}));

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
    { label: 'Document info', icon: Icon.info, onClick: () => showDocInfo(doc) },
    { label: 'Download original', icon: Icon.download, onClick: () => toast(`Downloading ${doc.filename}…`, 'info') },
    { label: 'Version history', icon: Icon.history, onClick: () => showVersionHistory(doc) },
    { type: 'sep' },
    { label: 'Replace file', icon: Icon.upload, onClick: () => promptReplaceFile(doc) },
    { label: 'Rename', icon: Icon.edit, onClick: () => toast('Use the file grid context menu to rename for now', 'info') },
    { type: 'sep' },
    { label: 'Delete', icon: Icon.trash, danger: true, onClick: () => confirmDelete(doc) },
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
        <div style="font-weight:600; font-size: var(--text-sm);">Version ${v.version_number} ${v.version_number === doc.current_version ? '<span class="badge badge--accent" style=\"margin-left:6px;\">Current</span>' : ''}</div>
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
    subtitle: 'This creates a new version — the current version stays in history and can be restored later.',
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
    subtitle: 'This can\'t be undone.',
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
      <div class="viewer-toolbar"><div class="viewer-toolbar__filename">${Icon.fileImage}<span>${escapeHtml(doc.filename)}</span></div><div></div></div>
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
      <div class="viewer-toolbar"><div class="viewer-toolbar__filename">${Icon.file}<span>${escapeHtml(doc.filename)}</span></div><div></div></div>
      <div class="simple-viewer"><pre>Plain-text preview of ${escapeHtml(doc.filename)}.

This is a stand-in for the real file content, rendered exactly as uploaded — no formatting, no conversion needed for .txt files.</pre></div>
    </div>`;
}

// ============================================================
// PDF viewer (also used for docx/pptx/xlsx via normalized preview PDF)
// ============================================================
let pdfState = null; // { pdf, doc, scale, matches, matchIndex, textCache }

async function renderPdfViewer(body, doc) {
  body.innerHTML = `
    <div class="viewer" id="pdf-viewer-root">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__group">
          <button class="icon-btn" id="tb-search" title="Search">${Icon.search}</button>
          <div class="viewer-toolbar__sep"></div>
          <button class="icon-btn" id="tb-prev" title="Previous page">${Icon.chevLeft}</button>
          <input class="viewer-toolbar__pageinput" id="tb-pagenum" value="1" />
          <span class="viewer-toolbar__pagetotal">/ <span id="tb-total">1</span></span>
          <button class="icon-btn" id="tb-next" title="Next page">${Icon.chevRight}</button>
        </div>
        <div class="viewer-toolbar__filename">${TYPE_ICON[doc.file_type] || Icon.filePdf}<span>${escapeHtml(doc.filename)}</span>${doc.file_type !== 'pdf' ? '<span class="badge badge--tag" style="margin-left:6px;">Converted preview</span>' : ''}</div>
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
        <span class="viewer-search__count" id="search-count">0/0</span>
        <button class="icon-btn" id="search-next" title="Next match">${Icon.chevRight}</button>
        <button class="icon-btn" id="search-close" title="Close">${Icon.close}</button>
      </div>
      <div class="viewer-body">
        <div class="viewer-thumbs" id="viewer-thumbs"></div>
        <div class="viewer-scroll" id="viewer-scroll"></div>
      </div>
      <button class="ai-fab" id="ai-fab-btn"><span class="ai-fab__spark">${Icon.sparkles}</span> AI Magic</button>
    </div>
  `;

  const root = body.querySelector('#pdf-viewer-root');
  root.querySelector('#ai-fab-btn').addEventListener('click', () => openAiPanel(doc.id));

  const url = await loadPdfUrl(doc);
  const pdfjsLib = window.pdfjsLib;
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument(url).promise;
  } catch (err) {
    root.querySelector('#viewer-scroll').innerHTML = `<div class="empty-state"><div class="empty-state__icon">${Icon.filePdf}</div><div class="empty-state__title">Couldn't load preview</div><div class="empty-state__desc">The document preview failed to load. Try again in a moment.</div></div>`;
    return;
  }

  pdfState = { pdf, doc, scale: 1.1, matches: [], matchIndex: -1, textCache: {} };
  root.querySelector('#tb-total').textContent = pdf.numPages;

  await renderAllPages(root);
  await renderThumbnails(root);
  wireToolbar(root, doc);
  await loadAndRenderAnnotations(root, doc);
  observeCurrentPage(root);
}

async function loadPdfUrl(doc) {
  if (MOCK_MODE) return generateMockPdfUrl(doc);
  return `${S3_PUBLIC_BASE_URL}/${doc.preview_pdf_s3_key || doc.original_s3_key}`;
}

function generateMockPdfUrl(doc) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pages = [
    { h: doc.filename.replace(/\.[^.]+$/, ''), body: [
      'This is a demo preview standing in for the real document content — in the working app this pane renders the actual uploaded or converted PDF.',
      'The viewer itself is fully functional: page navigation, zoom, thumbnails, in-document search, text selection, and highlight/sticky-note annotations all work against this generated PDF exactly as they would against a real one.',
    ]},
    { h: 'Section 1 — Overview', body: [
      'Once the real backend is wired up, this content is replaced by the actual normalized PDF served from S3 (original PDFs served directly; DOCX/PPTX/XLSX converted server-side via LibreOffice headless).',
      'Try selecting a line of this text — a small toolbar appears letting you highlight it in one of four colors, or leave a sticky note.',
    ]},
    { h: 'Section 2 — Try the tools', body: [
      'Use the search icon in the toolbar to search this document — try searching for "annotations" or "zoom".',
      'The thumbnail rail on the left lets you jump straight to any page. The AI Magic button in the corner opens the AI panel scoped to this exact document.',
    ]},
  ];
  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage();
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20);
    pdf.text(p.h, 56, 80);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11.5);
    let y = 120;
    p.body.forEach((para) => {
      const lines = pdf.splitTextToSize(para, 480);
      pdf.text(lines, 56, y);
      y += lines.length * 16 + 18;
    });
    pdf.setFontSize(9); pdf.setTextColor(150);
    pdf.text(`Page ${i + 1}`, 290, 800);
    pdf.setTextColor(0);
  });
  const blob = pdf.output('blob');
  return URL.createObjectURL(blob);
}

async function renderAllPages(root) {
  const scroll = root.querySelector('#viewer-scroll');
  scroll.innerHTML = '';
  const { pdf, scale } = pdfState;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const pageEl = document.createElement('div');
    pageEl.className = 'viewer-page';
    pageEl.dataset.page = i;
    pageEl.style.width = `${viewport.width}px`;
    pageEl.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageEl.appendChild(canvas);

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    pageEl.appendChild(textLayerDiv);

    try {
      const textContent = await page.getTextContent();
      pdfState.textCache[i] = textContent.items.map((it) => it.str).join(' ');
      if (window.pdfjsLib.renderTextLayer) {
        await window.pdfjsLib.renderTextLayer({ textContentSource: textContent, container: textLayerDiv, viewport }).promise;
      }
    } catch (e) { /* text layer optional — canvas still renders */ }

    const annotLayer = document.createElement('div');
    annotLayer.className = 'annot-layer';
    annotLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none;';
    pageEl.appendChild(annotLayer);

    pageEl.addEventListener('mouseup', () => handleTextSelection(pageEl, i));

    scroll.appendChild(pageEl);
  }
}

async function renderThumbnails(root) {
  const thumbsEl = root.querySelector('#viewer-thumbs');
  thumbsEl.innerHTML = '';
  const { pdf } = pdfState;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 0.22 });
    const thumb = document.createElement('div');
    thumb.className = `viewer-thumb ${i === 1 ? 'active' : ''}`;
    thumb.dataset.page = i;
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    thumb.appendChild(canvas);
    thumb.innerHTML += `<span class="viewer-thumb__num">${i}</span>`;
    thumb.addEventListener('click', () => jumpToPage(root, i));
    thumbsEl.appendChild(thumb);
  }
}

function jumpToPage(root, n) {
  const el = root.querySelector(`.viewer-page[data-page="${n}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wireToolbar(root, doc) {
  const pageInput = root.querySelector('#tb-pagenum');
  root.querySelector('#tb-prev').addEventListener('click', () => {
    const cur = Number(pageInput.value) || 1;
    if (cur > 1) jumpToPage(root, cur - 1);
  });
  root.querySelector('#tb-next').addEventListener('click', () => {
    const cur = Number(pageInput.value) || 1;
    if (cur < pdfState.pdf.numPages) jumpToPage(root, cur + 1);
  });
  pageInput.addEventListener('change', () => {
    const n = Math.min(Math.max(1, Number(pageInput.value) || 1), pdfState.pdf.numPages);
    jumpToPage(root, n);
  });

  const zoomInBtn = root.querySelector('#tb-zoomin');
  const zoomOutBtn = root.querySelector('#tb-zoomout');
  zoomInBtn.addEventListener('click', () => rescale(root, Math.min(pdfState.scale + 0.15, 2.4), zoomInBtn, zoomOutBtn));
  zoomOutBtn.addEventListener('click', () => rescale(root, Math.max(pdfState.scale - 0.15, 0.5), zoomInBtn, zoomOutBtn));
  root.querySelector('#tb-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) root.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  const searchBar = root.querySelector('#viewer-search');
  root.querySelector('#tb-search').addEventListener('click', () => {
    searchBar.classList.toggle('open');
    if (searchBar.classList.contains('open')) root.querySelector('#search-input').focus();
  });
  root.querySelector('#search-close').addEventListener('click', () => searchBar.classList.remove('open'));
  root.querySelector('#search-input').addEventListener('input', (e) => runSearch(root, e.target.value));
  root.querySelector('#search-next').addEventListener('click', () => stepMatch(root, 1));
  root.querySelector('#search-prev').addEventListener('click', () => stepMatch(root, -1));

  root.querySelector('#viewer-thumbs').style.display = pdfState.pdf.numPages > 1 ? 'flex' : 'none';
}

async function rescale(root, newScale, zoomInBtn, zoomOutBtn) {
  if (pdfState.rescaling) return;
  pdfState.rescaling = true;
  if (zoomInBtn) zoomInBtn.disabled = true;
  if (zoomOutBtn) zoomOutBtn.disabled = true;
  pdfState.scale = newScale;
  root.querySelector('#tb-zoomlevel').textContent = `${Math.round((newScale / 1.1) * 100)}%`;
  await renderAllPages(root);
  await loadAndRenderAnnotations(root, pdfState.doc);
  observeCurrentPage(root);
  pdfState.rescaling = false;
  if (zoomInBtn) zoomInBtn.disabled = false;
  if (zoomOutBtn) zoomOutBtn.disabled = false;
}

function runSearch(root, query) {
  const countEl = root.querySelector('#search-count');
  if (!query.trim()) { pdfState.matches = []; countEl.textContent = '0/0'; return; }
  const q = query.toLowerCase();
  pdfState.matches = Object.entries(pdfState.textCache)
    .filter(([, text]) => text.toLowerCase().includes(q))
    .map(([page]) => Number(page));
  pdfState.matchIndex = pdfState.matches.length ? 0 : -1;
  countEl.textContent = `${pdfState.matches.length ? 1 : 0}/${pdfState.matches.length}`;
  if (pdfState.matches.length) jumpToPage(root, pdfState.matches[0]);
}

function stepMatch(root, dir) {
  if (!pdfState.matches.length) return;
  pdfState.matchIndex = (pdfState.matchIndex + dir + pdfState.matches.length) % pdfState.matches.length;
  root.querySelector('#search-count').textContent = `${pdfState.matchIndex + 1}/${pdfState.matches.length}`;
  jumpToPage(root, pdfState.matches[pdfState.matchIndex]);
}

function observeCurrentPage(root) {
  const scroll = root.querySelector('#viewer-scroll');
  const pageInput = root.querySelector('#tb-pagenum');
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) {
      const n = Number(visible.target.dataset.page);
      pageInput.value = n;
      root.querySelectorAll('.viewer-thumb').forEach((t) => t.classList.toggle('active', Number(t.dataset.page) === n));
    }
  }, { root: scroll, threshold: [0.5] });
  root.querySelectorAll('.viewer-page').forEach((p) => observer.observe(p));
}

// ---------------- Annotations ----------------
const COLORS = ['yellow', 'green', 'blue', 'pink'];

async function loadAndRenderAnnotations(root, doc) {
  const annots = await Annotations.list(doc.id, doc.current_version);
  annots.forEach((a) => renderAnnotation(root, a));
}

function renderAnnotation(root, a) {
  const pageEl = root.querySelector(`.viewer-page[data-page="${a.page_number}"]`);
  if (!pageEl) return;
  const layer = pageEl.querySelector('.annot-layer');
  const rect = pageEl.getBoundingClientRect();
  if (a.annotation_type === 'sticky_note') {
    const pin = document.createElement('div');
    pin.className = 'annot-note-pin';
    pin.style.cssText = `left:${a.x_coord * 100}%; top:${a.y_coord * 100}%; pointer-events:auto;`;
    pin.innerHTML = Icon.stickyNote;
    pin.title = a.content;
    pin.addEventListener('click', (e) => showAnnotPopoverInfo(e, a));
    layer.appendChild(pin);
  } else {
    const hl = document.createElement('div');
    hl.className = `annot-highlight color-${a.color}`;
    hl.style.cssText = `left:${a.x_coord * 100}%; top:${a.y_coord * 100}%; width:${a.width * 100}%; height:${a.height * 100}%; pointer-events:auto;`;
    hl.addEventListener('click', (e) => showAnnotPopoverInfo(e, a));
    layer.appendChild(hl);
  }
}

function showAnnotPopoverInfo(e, a) {
  e.stopPropagation();
  document.querySelectorAll('.annot-popover').forEach((p) => p.remove());
  const pop = document.createElement('div');
  pop.className = 'annot-popover';
  pop.style.cssText = `left:${e.clientX}px; top:${e.clientY + 8}px; flex-direction:column; align-items:flex-start; max-width:220px;`;
  pop.innerHTML = `
    ${a.content ? `<div style="padding:4px 6px; font-size:12px; max-width:200px;">${escapeHtml(a.content)}</div>` : ''}
    <button style="width:auto; padding:4px 8px; gap:6px; display:flex; align-items:center;" data-del>${Icon.trash}<span style="font-size:11px;">Remove</span></button>
  `;
  document.body.appendChild(pop);
  pop.querySelector('[data-del]').addEventListener('click', async () => {
    await Annotations.remove(a.id);
    pop.remove();
    if (state.selectedDocument) openDocument(state.selectedDocument.id);
  });
  setTimeout(() => document.addEventListener('mousedown', function dismiss(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); } }), 0);
}

function handleTextSelection(pageEl, pageNumber) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
  const range = sel.getRangeAt(0);
  const rawRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  if (!rawRects.length) return;
  const pageRect = pageEl.getBoundingClientRect();
  const selectedText = sel.toString();

  // one rect per visual line the selection actually covers — NOT one bounding
  // box for the whole selection, which is what made highlights look like they
  // covered a full row even for a short selection within it.
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
  pop.style.cssText = `left:${anchorRect.left + anchorRect.width / 2 - 90}px; top:${anchorRect.top - 46}px;`;
  pop.innerHTML = `
    ${COLORS.map((c) => `<button data-color="${c}"><span class="annot-color-dot ${c}"></span></button>`).join('')}
    <button data-note title="Sticky note">${Icon.stickyNote}</button>
    <button data-explain title="Explain with AI">${Icon.sparkles}</button>
  `;
  document.body.appendChild(pop);

  pop.querySelectorAll('[data-color]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const layer = document.querySelector('#pdf-viewer-root') || document.body;
      for (const lr of lineRects) {
        const a = await Annotations.create({
          document_id: state.selectedDocument.id, version_number: state.selectedDocument.current_version,
          annotation_type: 'highlight', page_number: pageNumber, x_coord: lr.relX, y_coord: lr.relY, width: lr.relW, height: lr.relH,
          color: btn.dataset.color, content: null,
        });
        renderAnnotation(layer, a);
      }
      pop.remove();
      sel.removeAllRanges();
    });
  });

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
        document_id: state.selectedDocument.id, version_number: state.selectedDocument.current_version,
        annotation_type: 'sticky_note', page_number: pageNumber, x_coord: first.relX, y_coord: first.relY, width: first.relW, height: first.relH,
        color: 'yellow', content,
      });
      renderAnnotation(document.querySelector('#pdf-viewer-root'), a);
      close();
      sel.removeAllRanges();
    });
  });

  pop.querySelector('[data-explain]').addEventListener('click', async () => {
    pop.remove();
    sel.removeAllRanges();
    openAiPanel(state.selectedDocument.id, { explainText: selectedText });
  });

  setTimeout(() => document.addEventListener('mousedown', function dismiss(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', dismiss); } }), 0);
}
