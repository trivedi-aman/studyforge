// ============================================================
// FILE GRID — main canvas: breadcrumbs, toolbar, grid/list view
// ============================================================

import { Folders, Documents, Tags } from './api.js';
import { state, set } from './state.js';
import { Icon } from './icons.js';
import { openModal, openContextMenu, escapeHtml, formatBytes, timeAgo } from './ui-helpers.js';
import { busEmit, busOn } from './bus.js';
import { toast } from './toast.js';
import { selectFolder } from './sidebar.js';
import { openDocument } from './viewer.js';
import { openTextToPptModal, openYoutubeToNotesModal } from './modals.js';

let root;





export function initFileGrid(container) {
  root = container;
  root.innerHTML = `
    <div class="topbar">
      <div class="topbar__breadcrumbs" id="breadcrumbs"></div>
      <div class="topbar__actions" id="topbar-actions"></div>
    </div>
    <div class="main__body" id="main-body"></div>
  `;
  busOn('sf:nav-changed', () => refresh());
  busOn('sf:documents-changed', () => refresh());
  busOn('sf:search', ({ query }) => refresh(query));

  // Also listen for folders arriving from sidebar's initial load
  busOn('sf:folders-loaded', () => refresh());

  refresh();
}

function getBreadcrumbChain() {
  const chain = [];
  let cur = state.folders.find((f) => f.id === state.currentFolderId);
  while (cur) {
    chain.unshift(cur);
    cur = state.folders.find((f) => f.id === cur.parent_folder_id);
  }
  return chain;
}

async function refresh(searchQuery = null) {
  renderTopbarActions();
  const body = root.querySelector('#main-body');
  const crumbs = root.querySelector('#breadcrumbs');

  if (searchQuery) {
    crumbs.innerHTML = `<span class="topbar__crumb current">Search: "${escapeHtml(searchQuery)}"</span>`;
    const results = await Documents.search(searchQuery);
    renderCanvas(body, { title: `"${searchQuery}"`, meta: `${results.length} result${results.length === 1 ? '' : 's'}`, folders: [], documents: results, isSearch: true });
    return;
  }

  if (state.activeNav === 'favorites') {
    crumbs.innerHTML = `<span class="topbar__crumb current">Favorites</span>`;
    const docs = await Documents.listFavorites();
    renderCanvas(body, { title: 'Favorites', meta: `${docs.length} item${docs.length === 1 ? '' : 's'}`, folders: [], documents: docs });
    return;
  }

  // Files nav
  const chain = getBreadcrumbChain();
  const crumbItems = [
    `<span class="topbar__crumb ${!chain.length ? 'current' : ''}" data-crumb="root" style="cursor:pointer;">All Files</span>`,
    ...chain.map((f, i) =>
      `<span class="topbar__sep">${Icon.chevRight}</span>
       <span class="topbar__crumb ${i === chain.length - 1 ? 'current' : ''}" data-crumb="${f.id}" style="cursor:pointer;">${escapeHtml(f.name)}</span>`
    ),
  ];
  crumbs.innerHTML = crumbItems.join('');
  crumbs.querySelectorAll('[data-crumb]').forEach((el) => {
    el.addEventListener('click', () => selectFolder(el.dataset.crumb === 'root' ? null : el.dataset.crumb));
  });

  const subfolders = state.folders.filter((f) => f.parent_folder_id === state.currentFolderId);
  const documents = await Documents.listByFolder(state.currentFolderId);
  const title = chain.length ? chain[chain.length - 1].name : 'All Files';
  renderCanvas(body, {
    title,
    meta: `${subfolders.length + documents.length} item${subfolders.length + documents.length === 1 ? '' : 's'}`,
    folders: subfolders,
    documents,
  });
}

function renderTopbarActions() {
  const el = root.querySelector('#topbar-actions');
  if (state.activeNav === 'favorites') { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="btn btn--ghost btn--sm" id="ai-generate-btn">${Icon.sparkles} Generate</button>
    <button class="btn btn--subtle btn--sm" id="new-folder-btn">${Icon.folderPlus} New folder</button>
    <button class="btn btn--primary btn--sm" id="upload-btn">${Icon.upload} Upload</button>
    <input type="file" id="hidden-file-input" style="display:none" multiple />
  `;
  el.querySelector('#new-folder-btn').addEventListener('click', () => promptNewFolder());
  el.querySelector('#upload-btn').addEventListener('click', () => el.querySelector('#hidden-file-input').click());
  el.querySelector('#hidden-file-input').addEventListener('change', (e) => handleUpload(e.target.files));
  el.querySelector('#ai-generate-btn').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 6, [
      { label: 'YouTube → Notes', icon: Icon.youtube, action: 'yt', onClick: () => openYoutubeToNotesModal(state.currentFolderId, () => busEmit('sf:documents-changed', {})) },
      { label: 'Text/Topic → PPT', icon: Icon.ppt, action: 'ppt', onClick: () => openTextToPptModal(state.currentFolderId, () => busEmit('sf:documents-changed', {})) },
    ]);
  });
}

function renderCanvas(body, { title, meta, folders, documents, isSearch }) {
  const total = documents.length + folders.length;
  body.innerHTML = `
    <div class="canvas-toolbar">
      <div>
        <div class="canvas-toolbar__title">${escapeHtml(title)}</div>
        <div class="canvas-toolbar__meta">${meta}</div>
      </div>
      <div class="view-toggle">
        <button data-mode="grid" class="${state.gridMode === 'grid' ? 'active' : ''}">${Icon.grid}</button>
        <button data-mode="list" class="${state.gridMode === 'list' ? 'active' : ''}">${Icon.list}</button>
      </div>
    </div>
    <div id="grid-host" ondragover="event.preventDefault()"></div>
  `;
  body.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => { set({ gridMode: btn.dataset.mode }); refresh(); });
  });

  const host = body.querySelector('#grid-host');
  if (total === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">${isSearch ? Icon.search : Icon.folder}</div>
        <div class="empty-state__title">${isSearch ? 'No matches' : 'Nothing here yet'}</div>
        <div class="empty-state__desc">${isSearch ? 'Try a different search term.' : 'Upload a document or create a folder to get started.'}</div>
      </div>`;
    return;
  }

  if (state.gridMode === 'grid') {
    host.innerHTML = `<div class="file-grid">${folders.map(folderCardHTML).join('') + documents.map(docCardHTML).join('')}</div>`;
  } else {
    host.innerHTML = renderListView(folders, documents);
  }

  wireItemInteractions(host, folders, documents);
}

function folderCardHTML(f) {
  return `
    <div class="file-card" data-folder="${f.id}" style="cursor:pointer;">
      <div class="file-card__thumb folder">${Icon.folder}</div>
      <div class="file-card__name">${escapeHtml(f.name)}</div>
      <div class="file-card__meta">Folder</div>
    </div>`;
}

const TYPE_ICON = {
  pdf: Icon.filePdf, pptx: Icon.fileSlides, docx: Icon.file,
  xlsx: Icon.file, image: Icon.fileImage, txt: Icon.file, md: Icon.notes,
};

function docCardHTML(d) {
  const thumbClass = d.file_type === 'md' ? 'notes' : '';
  return `
    <div class="file-card" data-doc="${d.id}" draggable="true" style="cursor:pointer;">
      <div class="file-card__thumb ${thumbClass}">
        ${TYPE_ICON[d.file_type] || Icon.file}
        ${d.is_ai_generated ? `<div class="file-card__ai-badge">${Icon.sparkles}</div>` : ''}
      </div>
      <button class="file-card__fav ${d.favorite ? 'on' : ''}" data-fav="${d.id}">${Icon.star}</button>
      <div class="file-card__name">${escapeHtml(d.filename)}</div>
      <div class="file-card__meta">${formatBytes(d.file_size_bytes)} · ${timeAgo(d.updated_at)}</div>
    </div>`;
}

function renderListView(folders, documents) {
  const rows = [
    ...folders.map((f) => `
      <div class="file-list__row" data-folder="${f.id}" style="cursor:pointer;">
        <div class="file-list__name">${Icon.folder}<span>${escapeHtml(f.name)}</span></div>
        <div class="file-list__cell">Folder</div>
        <div class="file-list__cell">—</div>
        <div class="file-list__cell">—</div>
        <div></div>
      </div>`),
    ...documents.map((d) => `
      <div class="file-list__row" data-doc="${d.id}" draggable="true" style="cursor:pointer;">
        <div class="file-list__name">${TYPE_ICON[d.file_type] || Icon.file}<span>${escapeHtml(d.filename)}</span></div>
        <div class="file-list__cell">${d.file_type.toUpperCase()}</div>
        <div class="file-list__cell">${formatBytes(d.file_size_bytes)}</div>
        <div class="file-list__cell">${timeAgo(d.updated_at)}</div>
        <button class="icon-btn" data-fav="${d.id}" style="${d.favorite ? 'color:var(--warning)' : ''}">${Icon.star}</button>
      </div>`),
  ].join('');
  return `
    <div class="file-list__head"><div>Name</div><div>Type</div><div>Size</div><div>Modified</div><div></div></div>
    <div class="file-list">${rows}</div>`;
}

function wireItemInteractions(host, folders, documents) {
  // Folders
  host.querySelectorAll('[data-folder]').forEach((el) => {
    const folder = folders.find((f) => f.id === el.dataset.folder);
    if (!folder) return;
    el.addEventListener('click', () => selectFolder(folder.id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY, [
        { label: 'Open', icon: Icon.folder, action: 'open', onClick: () => selectFolder(folder.id) },
        { label: 'Rename', icon: Icon.edit, action: 'rename', onClick: () => promptRenameFolderInline(folder) },
        { type: 'sep' },
        { label: 'Delete', icon: Icon.trash, action: 'delete', danger: true, onClick: () => confirmDeleteFolderInline(folder) },
      ]);
    });
  });

  // Documents
  host.querySelectorAll('[data-doc]').forEach((el) => {
    const doc = documents.find((d) => d.id === el.dataset.doc);
    if (!doc) return;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-fav]')) return;
      openDocument(doc.id);
    });
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/document-id', doc.id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openDocContextMenu(e.clientX, e.clientY, doc);
    });
  });

  // Favorite buttons
  host.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await Documents.toggleFavorite(btn.dataset.fav);
      refresh();
    });
  });
}

function openDocContextMenu(x, y, doc) {
  openContextMenu(x, y, [
    { label: 'Open', icon: Icon.file, action: 'open', onClick: () => openDocument(doc.id) },
    { label: doc.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Icon.star, action: 'fav', onClick: async () => { await Documents.toggleFavorite(doc.id); refresh(); } },
    { label: 'Rename', icon: Icon.edit, action: 'rename', onClick: () => promptRenameDoc(doc) },
    { label: 'Move to…', icon: Icon.move, action: 'move', onClick: () => promptMoveDoc(doc) },
    { label: 'Manage tags', icon: Icon.tag, action: 'tags', onClick: () => promptManageTags(doc) },
    { type: 'sep' },
    { label: 'Download', icon: Icon.download, action: 'download', onClick: () => toast(`Downloading ${doc.filename}…`, 'info') },
    { type: 'sep' },
    { label: 'Delete', icon: Icon.trash, action: 'delete', danger: true, onClick: () => confirmDeleteDoc(doc) },
  ]);
}

async function handleUpload(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    toast(`Uploading ${file.name}…`, 'info', 1600);
    await Documents.upload(file, state.currentFolderId);
  }
  toast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success');
  busEmit('sf:documents-changed', {});
}

function promptNewFolder() {
  const options = state.folders
    .map((f) => `<option value="${f.id}" ${f.id === state.currentFolderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
    .join('');

  const { el, close } = openModal({
    title: 'New folder',
    bodyHTML: `
      <div class="field">
        <label class="field__label">Folder name</label>
        <input class="input" id="pnf-name" autofocus placeholder="e.g. Machine Learning" />
      </div>
      <div class="field">
        <label class="field__label">Parent folder</label>
        <select class="select" id="pnf-parent">
          <option value="" ${!state.currentFolderId ? 'selected' : ''}>Root (All Files)</option>
          ${options}
        </select>
      </div>
    `,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="pnf-confirm">Create folder</button>`,
  });

  setTimeout(() => el.querySelector('#pnf-name')?.focus(), 60);

  el.querySelector('#pnf-confirm').addEventListener('click', async () => {
    const name = el.querySelector('#pnf-name').value.trim();
    if (!name) return;
    const targetParent = el.querySelector('#pnf-parent').value || null;
    const f = await Folders.create(name, targetParent);

    // Update state properly
    set({ folders: [...state.folders, f] });
    if (targetParent) state.expandedFolders.add(targetParent);

    toast(`Created "${name}"`, 'success');
    close();

    // Navigate into the new folder immediately
    selectFolder(f.id);
  });
}

function promptRenameFolderInline(folder) {
  const { el, close } = openModal({
    title: 'Rename folder',
    bodyHTML: `<div class="field"><label class="field__label">Name</label><input class="input" id="rf-name" value="${escapeHtml(folder.name)}" /></div>`,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="rf-confirm">Save</button>`,
  });
  setTimeout(() => el.querySelector('#rf-name')?.focus(), 60);
  el.querySelector('#rf-confirm').addEventListener('click', async () => {
    const name = el.querySelector('#rf-name').value.trim();
    if (!name) return;
    await Folders.rename(folder.id, name);
    folder.name = name;
    close();
    busEmit('sf:nav-changed', {});
  });
}

function confirmDeleteFolderInline(folder) {
  const { el, close } = openModal({
    title: `Delete "${folder.name}"?`,
    subtitle: "This deletes everything inside it too. This can't be undone.",
    bodyHTML: '',
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn" id="df-confirm" style="background:var(--danger);color:#fff;">Delete</button>`,
  });
  el.querySelector('#df-confirm').addEventListener('click', async () => {
    await Folders.remove(folder.id);
    const folders = await Folders.list();
    set({ folders });
    close();
    toast('Folder deleted', 'success');
    busEmit('sf:nav-changed', {});
  });
}

function promptRenameDoc(doc) {
  const { el, close } = openModal({
    title: 'Rename file',
    bodyHTML: `<div class="field"><label class="field__label">Filename</label><input class="input" id="rd-name" value="${escapeHtml(doc.filename)}" /></div>`,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="rd-confirm">Save</button>`,
  });
  setTimeout(() => el.querySelector('#rd-name')?.focus(), 60);
  el.querySelector('#rd-confirm').addEventListener('click', async () => {
    const name = el.querySelector('#rd-name').value.trim();
    if (!name) return;
    await Documents.rename(doc.id, name);
    close();
    toast('Renamed', 'success');
    busEmit('sf:documents-changed', {});
  });
}

function promptMoveDoc(doc) {
  const options = state.folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
  const { el, close } = openModal({
    title: `Move "${doc.filename}"`,
    bodyHTML: `<div class="field"><label class="field__label">Destination folder</label><select class="select" id="md-target"><option value="">Root (All Files)</option>${options}</select></div>`,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="md-confirm">Move</button>`,
  });
  el.querySelector('#md-confirm').addEventListener('click', async () => {
    const target = el.querySelector('#md-target').value || null;
    await Documents.move(doc.id, target);
    close();
    toast('Moved', 'success');
    busEmit('sf:documents-changed', {});
  });
}

async function promptManageTags(doc) {
  const allTags = await Tags.list();
  const render = () => allTags.map((t) => `
    <button class="select-pill ${doc.tags.includes(t.id) ? 'selected' : ''}" data-tag="${t.id}">${escapeHtml(t.name)}</button>
  `).join('');
  const { el } = openModal({
    title: 'Manage tags',
    subtitle: doc.filename,
    bodyHTML: `
      <div class="select-pill-group" id="tag-pills">${render()}</div>
      <div class="field" style="margin-top:12px;">
        <input class="input" id="new-tag-input" placeholder="Create new tag and press Enter…" />
      </div>
    `,
    footerHTML: `<button class="btn btn--primary" data-close-modal>Done</button>`,
  });
  el.querySelector('#tag-pills').addEventListener('click', async (e) => {
    const pill = e.target.closest('[data-tag]');
    if (!pill) return;
    const tagId = pill.dataset.tag;
    if (doc.tags.includes(tagId)) {
      await Tags.detach(doc.id, tagId);
      doc.tags = doc.tags.filter((t) => t !== tagId);
      pill.classList.remove('selected');
    } else {
      await Tags.attach(doc.id, tagId);
      doc.tags.push(tagId);
      pill.classList.add('selected');
    }
  });
  el.querySelector('#new-tag-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      const t = await Tags.create(e.target.value.trim());
      allTags.push(t);
      el.querySelector('#tag-pills').innerHTML = render();
      e.target.value = '';
    }
  });
}

function confirmDeleteDoc(doc) {
  const { el, close } = openModal({
    title: `Delete "${doc.filename}"?`,
    subtitle: "This can't be undone.",
    bodyHTML: '',
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn" id="dd-confirm" style="background:var(--danger);color:#fff;">Delete</button>`,
  });
  el.querySelector('#dd-confirm').addEventListener('click', async () => {
    await Documents.remove(doc.id);
    close();
    toast('Deleted', 'success');
    busEmit('sf:documents-changed', {});
  });
}

export { refresh as refreshFileGrid };