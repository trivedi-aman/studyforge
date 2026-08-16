// ============================================================
// STATE — tiny observable store. No framework, just pub-sub.
// ============================================================

const listeners = new Map();

export const state = {
  user: null,                 // { id, email }
  folders: [],                // flat list, tree built on demand
  documents: [],               // flat list of documents in the CURRENT folder view
  currentFolderId: null,       // null = root
  breadcrumb: [],              // [{id, name}]
  expandedFolders: new Set(),
  selectedDocument: null,      // full document object when viewing
  view: 'auth',                // 'auth' | 'workspace'
  activeNav: 'files',           // 'files' | 'favorites' | 'search'
  gridMode: 'grid',             // 'grid' | 'list'
  aiPanelOpen: false,
  aiPanelDocId: null,
  aiPanelScreen: 'menu',        // 'menu' | 'chat' | 'youtube' | 'text-to-ppt' | 'ppt-to-notes'
  chatSessions: {},             // documentId -> [{role, content}]
  jobs: [],                     // active ai_jobs being polled
  sidebarCollapsed: false,
};

export function emit(key) {
  (listeners.get(key) || []).forEach((fn) => fn(state));
}

export function on(key, fn) {
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(fn);
  return () => {
    listeners.set(key, listeners.get(key).filter((f) => f !== fn));
  };
}

export function set(patch, emitKeys = []) {
  Object.assign(state, patch);
  emitKeys.forEach(emit);
}
