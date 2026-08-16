// ============================================================
// BUS — window CustomEvent wrapper. Keeps sidebar/grid/viewer/
// ai-panel modules decoupled from each other.
// ============================================================

export function busEmit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function busOn(name, handler) {
  const fn = (e) => handler(e.detail);
  window.addEventListener(name, fn);
  return () => window.removeEventListener(name, fn);
}
