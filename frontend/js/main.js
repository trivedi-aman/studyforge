// ============================================================
// MAIN — app bootstrap
// ============================================================

import { Auth } from './api.js';
import { state, set } from './state.js';
import { renderAuthScreen } from './auth.js';
import { renderShellChrome } from './sidebar.js';
import { initFileGrid } from './filegrid.js';
import { initAiPanel } from './ai-panel.js';
import { busOn } from './bus.js';

const app = document.getElementById('app');

function configurePdfWorker() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

async function boot() {
  configurePdfWorker();
  const session = Auth.currentSession();
  if (session) {
    set({ user: session.user });
    mountWorkspace();
  } else {
    mountAuth();
  }
}

function mountAuth() {
  app.innerHTML = '';
  set({ view: 'auth' });
  renderAuthScreen(app, () => mountWorkspace());
}

async function mountWorkspace() {
  set({ view: 'workspace' });
  app.innerHTML = `<div class="shell" id="shell"></div>`;
  const shell = document.getElementById('shell');

  shell.innerHTML = `
    <div id="chrome-mount" style="display:contents;"></div>
    <div class="main" id="main-mount">
      <div class="main__content-area" id="main-content-area"></div>
      <div class="ai-panel" id="ai-panel"></div>
    </div>
  `;

  // Await chrome (which loads folders) BEFORE mounting the grid,
  // so refresh() sees the real folder list on first render.
  try {
    await renderShellChrome(document.getElementById('chrome-mount'));
  } catch (err) {
    console.error('Failed to load workspace chrome:', err);
    // If auth is bad, kick back to login
    if (String(err.message).includes('401') || String(err.message).includes('403')) {
      localStorage.removeItem('sf_access_token');
      localStorage.removeItem('sf_user');
      mountAuth();
      return;
    }
  }

  initFileGrid(document.getElementById('main-content-area'));
  initAiPanel(document.getElementById('ai-panel'));

  busOn('sf:nav-changed', () => {});
}

boot();