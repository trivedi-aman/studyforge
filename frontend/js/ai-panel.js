// ============================================================
// AI MAGIC PANEL — everything routes through one chat-like feed.
// Embedding happens lazily on first real AI use per document
// (README 2.7) — never automatically on open/upload.
// ============================================================

import { Documents, AI } from './api.js';
import { state, set } from './state.js';
import { Icon } from './icons.js';
import { escapeHtml, formatDate } from './ui-helpers.js';
import { toast } from './toast.js';
import { pollJob } from './jobs.js';

let panelEl, scrimEl;
const embeddedDocs = new Set();

export function initAiPanel(root) {
  scrimEl = document.createElement('div');
  scrimEl.className = 'ai-panel-scrim';
  panelEl = document.createElement('div');
  panelEl.className = 'ai-panel';
  root.appendChild(scrimEl);
  root.appendChild(panelEl);
  scrimEl.addEventListener('click', closeAiPanel);
}

export async function openAiPanel(documentId, opts = {}) {
  const doc = await Documents.get(documentId);
  set({ aiPanelOpen: true, aiPanelDocId: documentId });
  if (!state.chatSessions[documentId]) state.chatSessions[documentId] = { sessionId: null, messages: [] };

  panelEl.innerHTML = `
    <div class="ai-panel__header">
      <div>
        <div class="ai-panel__title">${Icon.sparkles} AI Magic</div>
        <div class="ai-panel__doc">${escapeHtml(doc.filename)}</div>
      </div>
      <button class="icon-btn" id="ai-panel-close">${Icon.close}</button>
    </div>
    <div class="ai-panel__body" id="ai-panel-body"></div>
    <div class="ai-panel__composer">
      <textarea id="ai-composer-input" placeholder="Ask anything about this document…" rows="1"></textarea>
      <button class="btn btn--accent btn--icon" id="ai-composer-send">${Icon.send}</button>
    </div>
  `;
  panelEl.querySelector('#ai-panel-close').addEventListener('click', closeAiPanel);

  requestAnimationFrame(() => { panelEl.classList.add('open'); scrimEl.classList.add('open'); });

  renderThread(doc);
  wireComposer(doc);

  if (opts.explainText) {
    runExplain(doc, opts.explainText);
  }
}

export function closeAiPanel() {
  panelEl.classList.remove('open');
  scrimEl.classList.remove('open');
  set({ aiPanelOpen: false });
}

function renderThread(doc) {
  const body = panelEl.querySelector('#ai-panel-body');
  const session = state.chatSessions[doc.id];
  const hasMessages = session.messages.length > 0;

  body.innerHTML = `
    ${!hasMessages ? actionsGridHTML() : ''}
    <div class="chat-thread" id="chat-thread">
      ${hasMessages ? session.messages.map(msgHTML).join('') : emptyStateHTML()}
    </div>
  `;

  if (!hasMessages) {
    body.querySelectorAll('.ai-action').forEach((btn) => {
      btn.addEventListener('click', () => handleAction(doc, btn.dataset.action));
    });
  }
  body.scrollTop = body.scrollHeight;
}

function actionsGridHTML() {
  return `
    <div class="ai-actions">
      <button class="ai-action" data-action="chat">${Icon.chatBubble}<span class="ai-action__label">Ask AI</span></button>
      <button class="ai-action" data-action="summarize">${Icon.summarize}<span class="ai-action__label">Summarize</span></button>
      <button class="ai-action" data-action="explain">${Icon.explain}<span class="ai-action__label">Explain selection</span></button>
      <button class="ai-action" data-action="generate-notes">${Icon.generate}<span class="ai-action__label">Generate notes</span></button>
    </div>
    <div class="ai-panel__divider">or ask directly below</div>
  `;
}

function emptyStateHTML() {
  return `
    <div class="chat-empty">
      ${Icon.sparkles}
      <div class="chat-empty__title">Nothing generated yet</div>
      <div class="chat-empty__desc">Pick an action above, or type a question about this document below. Nothing runs until you ask.</div>
    </div>`;
}

function msgHTML(m) {
  if (m.type === 'job') return jobCardHTML(m);
  return `
    <div class="chat-msg chat-msg--${m.role}">
      <div class="chat-msg__avatar">${m.role === 'user' ? (state.user?.email || 'U')[0].toUpperCase() : '✦'}</div>
      <div class="chat-msg__bubble">${m.typing ? typingHTML() : formatChatText(m.content)}</div>
    </div>`;
}

function typingHTML() { return `<span></span><span></span><span></span>`; }

function jobCardHTML(m) {
  const icons = { processing: Icon.generate, done: Icon.chatBubble, failed: Icon.close };
  return `
    <div class="job-card">
      <div class="job-card__head">
        <div class="job-card__title">${Icon.generate} Generate Notes</div>
        <span class="badge badge--${m.status === 'done' ? 'success' : m.status === 'failed' ? 'danger' : 'warning'}">
          <span class="badge__dot ${m.status === 'processing' ? 'pulse' : ''}"></span>${m.status}
        </span>
      </div>
      <div class="job-card__desc">${m.status === 'processing' ? 'Restructuring this document into study notes…' : m.status === 'failed' ? m.error : 'Notes generated and saved to this folder.'}</div>
      ${m.status === 'done' ? `<div class="job-card__result" data-open-doc="${m.resultDocId}">${Icon.notes} Open generated notes</div>` : ''}
    </div>`;
}

function formatChatText(text) {
  return `<p>${escapeHtml(text).replace(/\n\n/g, '</p><p>')}</p>`;
}

function wireComposer(doc) {
  const input = panelEl.querySelector('#ai-composer-input');
  const send = panelEl.querySelector('#ai-composer-send');
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendChatMessage(doc, text);
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 100) + 'px'; });
}

async function ensureEmbedded(doc) {
  if (embeddedDocs.has(doc.id)) return;
  await AI.embedDocument(doc.id); // lazy — only ever called on first real AI use (README 2.7)
  embeddedDocs.add(doc.id);
}

async function handleAction(doc, action) {
  if (action === 'chat') {
    const session = state.chatSessions[doc.id];
    session.messages.push({ role: 'assistant', content: "I'm ready — ask me anything about this document below." });
    renderThread(doc);
  } else if (action === 'summarize') {
    await runWithTyping(doc, async () => {
      await ensureEmbedded(doc);
      const { summary } = await AI.summarize(doc.id);
      return summary;
    });
  } else if (action === 'explain') {
    toast('Select some text in the document first, then choose "Explain with AI"', 'info', 4000);
  } else if (action === 'generate-notes') {
    startGenerateNotesJob(doc);
  }
}

async function runExplain(doc, text) {
  const session = state.chatSessions[doc.id];
  session.messages.push({ role: 'user', content: `Explain: "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"` });
  renderThread(doc);
  await runWithTyping(doc, async () => {
    await ensureEmbedded(doc);
    const { explanation } = await AI.explainSelection(doc.id, text);
    return explanation;
  }, true);
}

async function sendChatMessage(doc, text) {
  const session = state.chatSessions[doc.id];
  session.messages.push({ role: 'user', content: text });
  renderThread(doc);
  await runWithTyping(doc, async () => {
    await ensureEmbedded(doc);
    const { session_id, answer } = await AI.chat(doc.id, session.sessionId, text);
    session.sessionId = session_id;
    return answer;
  }, true);
}

async function runWithTyping(doc, fn, skipUserPush = false) {
  const session = state.chatSessions[doc.id];
  const typingMsg = { role: 'assistant', typing: true, content: '' };
  session.messages.push(typingMsg);
  renderThread(doc);
  try {
    const result = await fn();
    session.messages = session.messages.filter((m) => m !== typingMsg);
    session.messages.push({ role: 'assistant', content: result });
  } catch (e) {
    session.messages = session.messages.filter((m) => m !== typingMsg);
    session.messages.push({ role: 'assistant', content: "Something went wrong reaching the AI service — try again in a moment." });
  }
  renderThread(doc);
}

async function startGenerateNotesJob(doc) {
  const session = state.chatSessions[doc.id];
  const jobMsg = { type: 'job', status: 'processing', resultDocId: null, error: null };
  session.messages.push(jobMsg);
  renderThread(doc);

  const { job_id } = await AI.startPptToNotes(doc.id, doc.folder_id);
  pollJob(job_id, (job) => {
    jobMsg.status = job.status;
    if (job.status === 'done') { jobMsg.resultDocId = job.result_document_id; toast('Notes generated', 'success'); }
    if (job.status === 'failed') { jobMsg.error = job.error_message; toast('Generation failed', 'danger'); }
    renderThread(doc);
    if (job.status === 'done' || job.status === 'failed') {
      const body = panelEl.querySelector('#ai-panel-body');
      body.querySelectorAll('[data-open-doc]').forEach((el) => {
        el.addEventListener('click', async () => {
          const { openDocument } = await import('./viewer.js');
          closeAiPanel();
          openDocument(el.dataset.openDoc);
        });
      });
    }
  });
}
