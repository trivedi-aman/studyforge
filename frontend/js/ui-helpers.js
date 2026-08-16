// ============================================================
// UI HELPERS — modal shell + context menu, reused everywhere
// ============================================================

export function openModal({ title, subtitle = '', bodyHTML, footerHTML, width = '' }) {
  // Only one modal at a time — prevents duplicate-submission bugs if a click
  // is fired twice (e.g. while the UI feels slow) before the first modal closes.
  document.querySelectorAll('.modal-scrim').forEach((m) => m.remove());

  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal ${width}">
      <div class="modal__header">
        <div>
          <div class="modal__title">${title}</div>
          ${subtitle ? `<div class="modal__subtitle">${subtitle}</div>` : ''}
        </div>
        <button class="icon-btn" data-close-modal aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal__body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal__footer">${footerHTML}</div>` : ''}
    </div>
  `;
  document.body.appendChild(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));

  const close = () => {
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 200);
  };

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close-modal]')) close();
  });
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  });

  return { el: scrim, close };
}

export function openContextMenu(x, y, items) {
  document.querySelectorAll('.context-menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = items.map((item) => {
    if (item.type === 'sep') return '<div class="context-menu__sep"></div>';
    return `<div class="context-menu__item ${item.danger ? 'danger' : ''}" data-action="${item.action}">${item.icon || ''}<span>${item.label}</span></div>`;
  }).join('');
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 12);
  const top = Math.min(y, window.innerHeight - rect.height - 12);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.addEventListener('click', (e) => {
    const row = e.target.closest('[data-action]');
    if (row) {
      const item = items.find((i) => i.action === row.dataset.action);
      item?.onClick?.();
    }
    menu.remove();
  });

  const dismiss = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);

  return menu;
}

export function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
