// ============================================================
// TOAST — lightweight notification stack
// ============================================================

let container = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-stack';
    document.body.appendChild(container);
  }
  return container;
}

const ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

export function toast(message, type = 'info', duration = 3200) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `${ICONS[type] || ICONS.info}<span>${message}</span>`;
  ensureContainer().appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, duration);
}
