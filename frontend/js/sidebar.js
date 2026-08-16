// ============================================================
// SIDEBAR — icon rail + nested folder tree
// ============================================================

import { Folders, Auth } from './api.js';
import { state, set } from './state.js';
import { Icon } from './icons.js';
import { openModal, openContextMenu, escapeHtml, formatDate } from './ui-helpers.js';
import { busEmit, busOn } from './bus.js';
import { toast } from './toast.js';

let railEl, sidebarEl, treeEl, searchInput;

export async function renderShellChrome(root) {
  root.innerHTML = `
    <div class="rail" id="rail"></div>
    <div class="sidebar" id="sidebar"></div>
    <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">${Icon.chevLeft}</button>
  `;
  railEl = root.querySelector('#rail');
  sidebarEl = root.querySelector('#sidebar');

  renderRail();
  renderSidebarShell();
  try {
    const folders = await Folders.list();
    set({ folders });
    renderTree();
    busEmit('sf:folders-loaded', { folders });
  } catch (err) {
    console.error('Failed to load folders:', err);
    toast('Could not load folders — check your connection.', 'danger');
    throw err;  // let mountWorkspace catch auth errors
  }

  root.querySelector('#sidebar-toggle').addEventListener('click', () => {
    set({ sidebarCollapsed: !state.sidebarCollapsed });
    document.querySelector('.shell').classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  });

  busOn('sf:documents-changed', () => {});
}

function renderRail() {
  const displayName = Auth.getDisplayName();
  railEl.innerHTML = `
    <div class="rail__brand">S</div>
    <div class="rail__nav">
      <button class="rail__btn ${state.activeNav === 'files' ? 'active' : ''}" data-nav="files" title="Files">${Icon.folder}</button>
      <button class="rail__btn ${state.activeNav === 'favorites' ? 'active' : ''}" data-nav="favorites" title="Favorites">${Icon.star}</button>
    </div>
    <div class="rail__spacer"></div>
    <button class="rail__btn" id="rail-avatar-btn" title="Profile">
      <div class="rail__avatar">${displayName[0].toUpperCase()}</div>
    </button>
  `;
  railEl.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      set({ activeNav: btn.dataset.nav });
      renderRail();
      busEmit('sf:nav-changed', { nav: btn.dataset.nav });
    });
  });
  railEl.querySelector('#rail-avatar-btn').addEventListener('click', () => openProfileModal());
}

function openProfileModal() {
  const displayName = Auth.getDisplayName();
  const memberSince = formatDate(new Date(Date.now() - 46 * 86400000).toISOString());
  const { el, close } = openModal({
    title: 'Profile',
    bodyHTML: `
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:4px;">
        <div class="rail__avatar" style="width:52px;height:52px;font-size:20px;background:var(--accent-soft);color:var(--accent-600);border:none;">
          ${displayName[0].toUpperCase()}
        </div>
        <div>
          <div style="font-weight:700;font-size:var(--text-md);font-family:var(--font-display);">${escapeHtml(displayName)}</div>
          <div style="font-size:var(--text-xs);color:var(--text-500);">${escapeHtml(state.user?.email || '')}</div>
        </div>
      </div>
      <div class="field">
        <label class="field__label">Display name</label>
        <input class="input" id="profile-name" value="${escapeHtml(displayName)}" />
      </div>
      <div class="field">
        <label class="field__label">Email</label>
        <input class="input" value="${escapeHtml(state.user?.email || '')}" disabled style="opacity:0.6;" />
        <div class="field__hint">Managed by Supabase Auth — not editable here.</div>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:6px;border-top:1px solid var(--line);font-size:var(--text-sm);">
        <span style="color:var(--text-500);">Member since</span><span>${memberSince}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:var(--text-sm);">
        <span style="color:var(--text-500);">Storage used</span><span>142 MB</span>
      </div>
    `,
    footerHTML: `
      <button class="btn btn--danger-ghost" id="profile-logout">${Icon.logout} Log out</button>
      <button class="btn btn--primary" id="profile-save">Save changes</button>
    `,
  });
  el.querySelector('#profile-save').addEventListener('click', async () => {
    const name = el.querySelector('#profile-name').value.trim();
    if (!name) return;
    await Auth.updateProfile({ name });
    renderRail();
    toast('Profile updated', 'success');
    close();
  });
  el.querySelector('#profile-logout').addEventListener('click', async () => {
    await Auth.signOut();
    window.location.reload();
  });
}

function renderSidebarShell() {
  sidebarEl.innerHTML = `
    <div class="sidebar__header">
      <div class="sidebar__title">Workspace</div>
      <button class="sidebar__new-btn" id="new-folder-root" title="New folder">${Icon.folderPlus}</button>
    </div>
    <div class="sidebar__search">
      ${Icon.search}
      <input type="text" placeholder="Search files…" id="sidebar-search-input" />
    </div>
    <div class="sidebar__tree" id="folder-tree"></div>
    <div class="sidebar__footer">
      <span class="sidebar__storage">142 MB used</span>
      <span class="badge badge--accent">MVP</span>
    </div>
  `;
  treeEl = sidebarEl.querySelector('#folder-tree');
  searchInput = sidebarEl.querySelector('#sidebar-search-input');

  sidebarEl.querySelector('#new-folder-root').addEventListener('click', () => promptCreateFolder(null));

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    debounce = setTimeout(() => {
      if (q) busEmit('sf:search', { query: q });
      else busEmit('sf:nav-changed', { nav: state.activeNav });
    }, 220);
  });
}

function buildChildMap() {
  const map = new Map();
  state.folders.forEach((f) => {
    const key = f.parent_folder_id || 'root';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  });
  return map;
}

function renderTree() {
  if (!treeEl) return;
  const map = buildChildMap();
  const rootFolders = map.get('root') || [];
  treeEl.innerHTML = '';
  if (rootFolders.length === 0) {
    treeEl.innerHTML = `<div style="padding:var(--sp-4) var(--sp-3);font-size:var(--text-xs);color:var(--ink-400);">No folders yet — create one to get organised.</div>`;
    return;
  }
  rootFolders
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f) => treeEl.appendChild(renderTreeNode(f, map, 0)));
}

function renderTreeNode(folder, map, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-item';

  const children = (map.get(folder.id) || []).sort((a, b) => a.name.localeCompare(b.name));
  const hasChildren = children.length > 0;
  const isExpanded = state.expandedFolders.has(folder.id);
  const isActive = state.currentFolderId === folder.id && state.activeNav === 'files';

  const row = document.createElement('div');
  row.className = `tree-row${isActive ? ' active' : ''}`;
  row.dataset.folderId = folder.id;
  row.innerHTML = `
    <span class="tree-row__chev ${hasChildren ? (isExpanded ? 'open' : '') : 'spacer'}">${hasChildren ? Icon.chevRight : ''}</span>
    <span class="tree-row__icon">${Icon.folder}</span>
    <span class="tree-row__label">${escapeHtml(folder.name)}</span>
    <button class="tree-row__more" data-more>${Icon.more}</button>
  `;

  row.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) return;
    if (e.target.closest('.tree-row__chev') && hasChildren) {
      toggleExpand(folder.id);
      return;
    }
    selectFolder(folder.id);
  });

  row.querySelector('[data-more]').addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(rect.right, rect.bottom, [
      { label: 'New subfolder', icon: Icon.folderPlus, action: 'new-sub', onClick: () => promptCreateFolder(folder.id) },
      { label: 'Rename', icon: Icon.edit, action: 'rename', onClick: () => promptRenameFolder(folder) },
      { type: 'sep' },
      { label: 'Delete', icon: Icon.trash, action: 'delete', danger: true, onClick: () => confirmDeleteFolder(folder) },
    ]);
  });

  // Drag-to-move
  row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('dragover'); });
  row.addEventListener('dragleave', () => row.classList.remove('dragover'));
  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('dragover');
    const docId = e.dataTransfer.getData('text/document-id');
    if (docId) {
      const { Documents } = await import('./api.js');
      await Documents.move(docId, folder.id);
      toast('Moved to ' + folder.name, 'success');
      busEmit('sf:documents-changed', {});
    }
  });

  wrapper.appendChild(row);

  if (hasChildren && isExpanded) {
    const childWrap = document.createElement('div');
    childWrap.className = 'tree-children';
    children.forEach((c) => childWrap.appendChild(renderTreeNode(c, map, depth + 1)));
    wrapper.appendChild(childWrap);
  }

  return wrapper;
}

function toggleExpand(folderId) {
  if (state.expandedFolders.has(folderId)) state.expandedFolders.delete(folderId);
  else state.expandedFolders.add(folderId);
  renderTree();
}

export function selectFolder(folderId) {
  set({ currentFolderId: folderId, activeNav: 'files' });
  // Expand ancestors so the tree reveals the active folder
  let cur = state.folders.find((f) => f.id === folderId);
  while (cur && cur.parent_folder_id) {
    state.expandedFolders.add(cur.parent_folder_id);
    cur = state.folders.find((f) => f.id === cur.parent_folder_id);
  }
  renderRail();
  renderTree();
  busEmit('sf:nav-changed', { nav: 'files', folderId });
}

function promptCreateFolder(parentId) {
  const options = state.folders
    .map((f) => `<option value="${f.id}" ${f.id === parentId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`)
    .join('');

  const { el, close } = openModal({
    title: 'New folder',
    bodyHTML: `
      <div class="field">
        <label class="field__label">Folder name</label>
        <input class="input" id="new-folder-name" placeholder="e.g. Machine Learning" autofocus />
      </div>
      <div class="field">
        <label class="field__label">Parent folder</label>
        <select class="select" id="new-folder-parent">
          <option value="" ${!parentId ? 'selected' : ''}>Root (All Files)</option>
          ${options}
        </select>
      </div>
    `,
    footerHTML: `
      <button class="btn btn--ghost" data-close-modal>Cancel</button>
      <button class="btn btn--primary" id="confirm-create-folder">Create folder</button>
    `,
  });

  // Auto-focus
  setTimeout(() => el.querySelector('#new-folder-name')?.focus(), 60);

  el.querySelector('#confirm-create-folder').addEventListener('click', async () => {
    const name = el.querySelector('#new-folder-name').value.trim();
    if (!name) return;
    const targetParent = el.querySelector('#new-folder-parent').value || null;

    const folder = await Folders.create(name, targetParent);

    // Update state properly via set() instead of direct push
    set({ folders: [...state.folders, folder] });

    // Expand the parent so the new folder is visible in the tree
    if (targetParent) state.expandedFolders.add(targetParent);

    close();
    toast(`Created "${name}"`, 'success');

    // Navigate into the new folder
    selectFolder(folder.id);
  });
}

function promptRenameFolder(folder) {
  const { el, close } = openModal({
    title: 'Rename folder',
    bodyHTML: `
      <div class="field">
        <label class="field__label">Folder name</label>
        <input class="input" id="rename-folder-input" value="${escapeHtml(folder.name)}" />
      </div>
    `,
    footerHTML: `
      <button class="btn btn--ghost" data-close-modal>Cancel</button>
      <button class="btn btn--primary" id="confirm-rename-folder">Save</button>
    `,
  });
  setTimeout(() => el.querySelector('#rename-folder-input')?.focus(), 60);
  el.querySelector('#confirm-rename-folder').addEventListener('click', async () => {
    const name = el.querySelector('#rename-folder-input').value.trim();
    if (!name) return;
    await Folders.rename(folder.id, name);
    // Mutate the folder object in the state array directly (it's the same reference)
    folder.name = name;
    renderTree();
    toast('Folder renamed', 'success');
    close();
    busEmit('sf:folders-loaded', {});
    busEmit('sf:nav-changed', {});
  });
}

function confirmDeleteFolder(folder) {
  const { el, close } = openModal({
    title: `Delete "${folder.name}"?`,
    subtitle: "This also deletes everything inside it — subfolders and files. This can't be undone.",
    bodyHTML: '',
    footerHTML: `
      <button class="btn btn--ghost" data-close-modal>Cancel</button>
      <button class="btn btn--danger-ghost" id="confirm-delete-folder" style="background:var(--danger);color:#fff;border-color:var(--danger);">Delete folder</button>
    `,
  });
  el.querySelector('#confirm-delete-folder').addEventListener('click', async () => {
    await Folders.remove(folder.id);
    const folders = await Folders.list();
    set({ folders });
    if (state.currentFolderId === folder.id) set({ currentFolderId: null });
    renderTree();
    busEmit('sf:nav-changed', { nav: 'files', folderId: state.currentFolderId });
    toast('Folder deleted', 'success');
    close();
  });
}

export function refreshTreeData() {
  return Folders.list().then((folders) => { set({ folders }); renderTree(); });
}