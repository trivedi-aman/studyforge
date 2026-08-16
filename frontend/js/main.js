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

function mountWorkspace() {
  set({ view: 'workspace' });
  app.innerHTML = `<div class="shell" id="shell"></div>`;
  const shell = document.getElementById('shell');

  // The main column now has a content area + AI panel side by side
  shell.innerHTML = `
    <div id="chrome-mount" style="display:contents;"></div>
    <div class="main" id="main-mount">
      <div class="main__content-area" id="main-content-area"></div>
      <div class="ai-panel" id="ai-panel"></div>
    </div>
  `;

  renderShellChrome(document.getElementById('chrome-mount'));
  initFileGrid(document.getElementById('main-content-area'));
  initAiPanel(document.getElementById('ai-panel'));

  busOn('sf:nav-changed', () => {});
}

boot();