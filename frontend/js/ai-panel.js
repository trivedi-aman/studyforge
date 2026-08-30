// ============================================================
// AI MAGIC PANEL — inline side panel, not overlay.
// Opens by expanding the panel width and collapsing the sidebar.
// The actions bar (Ask AI / Summarize / Explain / Generate) is ALWAYS
// visible, not just on first open — users can switch actions mid-thread.
// ============================================================

import { Documents, AI } from './api.js';
import { state, set } from './state.js';
import { Icon } from './icons.js';
import { escapeHtml, formatDate } from './ui-helpers.js';
import { toast } from './toast.js';
import { pollJob } from './jobs.js';
import { openModal } from './ui-helpers.js';

let panelEl;
const embeddedDocs = new Set();

export function initAiPanel(container) {
  panelEl = container;
}

export async function openAiPanel(documentId, opts = {}) {
  const doc = await Documents.get(documentId);
  set({ aiPanelOpen: true, aiPanelDocId: documentId });
  if (!state.chatSessions[documentId]) {
    state.chatSessions[documentId] = { sessionId: null, messages: [] };
  }

  const shell = document.querySelector('.shell');
  if (shell) shell.classList.add('ai-panel-open');

  panelEl.innerHTML = `
    <div class="ai-panel__header">
      <div>
        <div class="ai-panel__title">${Icon.sparkles} AI Magic</div>
        <div class="ai-panel__doc">${escapeHtml(doc.filename)}</div>
      </div>
      <button class="icon-btn" id="ai-panel-close">${Icon.close}</button>
    </div>
    <div id="ai-actions-bar"></div>
    <div class="ai-panel__body" id="ai-panel-body"></div>
    <div class="ai-panel__composer">
      <textarea id="ai-composer-input" placeholder="Ask anything about this document…" rows="1"></textarea>
      <button class="btn btn--accent btn--icon" id="ai-composer-send">${Icon.send}</button>
    </div>
  `;

  panelEl.querySelector('#ai-panel-close').addEventListener('click', closeAiPanel);

  requestAnimationFrame(() => {
    panelEl.classList.add('open');
  });

  renderActionsBar(doc);
  renderThread(doc);
  wireComposer(doc);

  if (opts.explainText) {
    runExplain(doc, opts.explainText);
  }
}

export function closeAiPanel() {
  panelEl.classList.remove('open');
  set({ aiPanelOpen: false });

  const shell = document.querySelector('.shell');
  if (shell) shell.classList.remove('ai-panel-open');
}

function renderActionsBar(doc) {

  const bar =
    panelEl.querySelector(
      '#ai-actions-bar'
    );

  if (!bar) return;

  bar.innerHTML = `

    <div
      class="ai-actions"
      style="padding: 12px 16px 0 16px;"
    >

      <button
        class="ai-action"
        data-action="chat"
      >
        ${Icon.chatBubble}

        <span class="ai-action__label">
          Ask AI
        </span>
      </button>


      <button
        class="ai-action"
        data-action="summarize"
      >
        ${Icon.summarize}

        <span class="ai-action__label">
          Summarize
        </span>
      </button>


      <button
        class="ai-action"
        data-action="explain"
      >
        ${Icon.explain}

        <span class="ai-action__label">
          Explain selection
        </span>
      </button>


      <button
        class="ai-action"
        data-action="generate-notes"
      >
        ${Icon.generate}

        <span class="ai-action__label">
          Generate notes
        </span>
      </button>


      <button
        class="ai-action"
        data-action="study-path"
      >
        ${Icon.sparkles}

        <span class="ai-action__label">
          Study path
        </span>
      </button>

    </div>
  `;


  bar
    .querySelectorAll('.ai-action')
    .forEach((btn) => {

      btn.addEventListener(
        'click',
        () =>
          handleAction(
            doc,
            btn.dataset.action
          )
      );

    });
}

function renderThread(doc) {
  const body = panelEl.querySelector('#ai-panel-body');
  if (!body) return;
  const session = state.chatSessions[doc.id];
  const hasMessages = session.messages.length > 0;

  body.innerHTML = `
    <div class="chat-thread" id="chat-thread">
      ${hasMessages ? session.messages.map(msgHTML).join('') : emptyStateHTML()}
    </div>
  `;

  // Wire "open generated notes" buttons in job cards
  body.querySelectorAll('[data-open-doc]').forEach((el) => {
    el.addEventListener('click', async () => {
      const { openDocument } = await import('./viewer.js');
      closeAiPanel();
      openDocument(el.dataset.openDoc);
    });
  });

  body.scrollTop = body.scrollHeight;
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
      <div class="chat-msg__bubble${m.typing ? ' typing' : ''}">${m.typing ? typingHTML() : formatChatText(m.content)}</div>
    </div>`;
}

function typingHTML() { return `<span></span><span></span><span></span>`; }

function jobCardHTML(m) {
  return `
    <div class="job-card">
      <div class="job-card__head">
        <div class="job-card__title">${Icon.generate} Generate Notes</div>
        <span class="badge badge--${m.status === 'done' ? 'success' : m.status === 'failed' ? 'danger' : 'warning'}">
          <span class="badge__dot ${m.status === 'processing' ? 'pulse' : ''}"></span>${m.status}
        </span>
      </div>
      <div class="job-card__desc">${m.status === 'processing' ? 'Restructuring this document into study notes…' : m.status === 'failed' ? escapeHtml(m.error || '') : 'Notes generated and saved to this folder.'}</div>
      ${m.status === 'done' ? `<div class="job-card__result" data-open-doc="${m.resultDocId}" style="cursor:pointer;">${Icon.notes} Open generated notes</div>` : ''}
    </div>`;
}

function formatChatText(text) {
  return `<p>${escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
}

function wireComposer(doc) {
  const input = panelEl.querySelector('#ai-composer-input');
  const send = panelEl.querySelector('#ai-composer-send');
  if (!input || !send) return;

  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    sendChatMessage(doc, text);
  };
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });
}

async function ensureEmbedded(doc) {
  if (embeddedDocs.has(doc.id)) return;
  try {
    await AI.embedDocument(doc.id);
    embeddedDocs.add(doc.id);
  } catch (e) {
    console.warn('Embed failed:', e.message);
  }
}

async function handleAction(doc, action) {

  if (action === 'chat') {

    const session =
      state.chatSessions[doc.id];

    session.messages.push({
      role: 'assistant',

      content:
        "I'm ready — ask me anything about this document below.",
    });

    renderThread(doc);

  }

  else if (action === 'summarize') {

    await runWithTyping(
      doc,
      async () => {

        await ensureEmbedded(doc);

        const { summary } =
          await AI.summarize(doc.id);

        return summary;
      }
    );

  }

  else if (action === 'explain') {

    const currentSelection =
      window
        .getSelection()
        ?.toString()
        .trim();

    if (
      currentSelection &&
      currentSelection.length > 3
    ) {

      runExplain(
        doc,
        currentSelection
      );

    } else {

      toast(
        'Select some text in the document first, then click Explain',
        'info',
        4000
      );
    }

  }

  else if (action === 'generate-notes') {

    startGenerateNotesJob(doc);

  }

  else if (action === 'study-path') {

    openStudyPathModal(doc);
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
    const msg = e.message?.includes('503')
      ? 'The AI service is not running yet.'
      : e.message?.includes('502')
      ? 'The AI model call failed — try again in a moment.'
      : "Something went wrong reaching the AI service — try again in a moment.";
    session.messages.push({ role: 'assistant', content: msg });
  }
  renderThread(doc);
}

async function startGenerateNotesJob(doc) {
  const session = state.chatSessions[doc.id];
  const jobMsg = { type: 'job', status: 'processing', resultDocId: null, error: null };
  session.messages.push(jobMsg);
  renderThread(doc);

  try {
    const { job_id } = await AI.startPptToNotes(doc.id, doc.folder_id);
    pollJob(job_id, (job) => {
      jobMsg.status = job.status;
      if (job.status === 'done') { jobMsg.resultDocId = job.result_document_id; toast('Notes generated', 'success'); }
      if (job.status === 'failed') { jobMsg.error = job.error_message; toast('Generation failed', 'danger'); }
      renderThread(doc);
    });
  } catch (e) {
    jobMsg.status = 'failed';
    jobMsg.error = e.message || 'Failed to start job.';
    renderThread(doc);
  }
}



// ============================================================
// STUDY PATH — A*
// ============================================================

function openStudyPathModal(doc) {

  const existing =
    document.getElementById(
      'study-path-modal'
    );

  if (existing) {
    existing.remove();
  }


  const modal =
    document.createElement('div');

  modal.id =
    'study-path-modal';

  modal.className =
    'study-path-modal';


  modal.innerHTML = `

    <div class="study-path-modal__backdrop"></div>


    <div class="study-path-modal__card">

      <div class="study-path-modal__header">

        <div>

          <div class="study-path-modal__eyebrow">
            AI STUDY PLANNER
          </div>

          <h2>
            Find a study path
          </h2>

          <p>
            A* will find the lowest-cost path
            between two topics.
          </p>

        </div>


        <button
          class="icon-btn"
          id="study-path-close"
        >
          ${Icon.close}
        </button>

      </div>


      <div class="study-path-form">

        <div class="field">

          <label
            class="field__label"
            for="study-path-start"
          >
            Start topic
          </label>

          <input
            class="input"
            id="study-path-start"
            type="text"
            value="Probability"
            placeholder="e.g. Probability"
          />

        </div>


        <div class="study-path-arrow">
          ↓
        </div>


        <div class="field">

          <label
            class="field__label"
            for="study-path-goal"
          >
            Target topic
          </label>

          <input
            class="input"
            id="study-path-goal"
            type="text"
            value="Regression"
            placeholder="e.g. Regression"
          />

        </div>


        <button
          class="btn btn--accent btn--block"
          id="study-path-run"
          style="margin-top: 8px;"
        >
          ${Icon.sparkles}
          Find optimal path
        </button>

      </div>


      <div
        id="study-path-result"
        class="study-path-result"
      ></div>

    </div>
  `;


  document.body.appendChild(modal);


  const close = () => {
    modal.remove();
  };


  modal
    .querySelector(
      '#study-path-close'
    )
    .addEventListener(
      'click',
      close
    );


  modal
    .querySelector(
      '.study-path-modal__backdrop'
    )
    .addEventListener(
      'click',
      close
    );


  modal
    .querySelector(
      '#study-path-run'
    )
    .addEventListener(
      'click',
      async () => {

        const start =
          modal
            .querySelector(
              '#study-path-start'
            )
            .value
            .trim();

        const goal =
          modal
            .querySelector(
              '#study-path-goal'
            )
            .value
            .trim();


        if (!start || !goal) {

          toast(
            'Enter both a starting and target topic.',
            'info',
            3000
          );

          return;
        }


        await runStudyPath(
          modal,
          start,
          goal
        );
      }
    );
}


async function runStudyPath(
  modal,
  start,
  goal
) {

  const button =
    modal.querySelector(
      '#study-path-run'
    );

  const result =
    modal.querySelector(
      '#study-path-result'
    );


  button.disabled = true;

  button.innerHTML = `
    <span class="study-path-spinner"></span>
    Searching with A*…
  `;


  result.innerHTML = '';


  /*
   * TEMPORARY GRAPH
   *
   * This is intentionally hardcoded.
   *
   * Later we will replace this with:
   *
   * Document / syllabus
   *       ↓
   * Topic extraction
   *       ↓
   * Prerequisite graph
   *       ↓
   * A*
   */

  const graph = {

    "Probability": [
      [
        "Random Variables",
        1
      ]
    ],

    "Random Variables": [
      [
        "Probability Distributions",
        1
      ]
    ],

    "Probability Distributions": [

      [
        "Hypothesis Testing",
        2
      ],

      [
        "Regression",
        5
      ]

    ],

    "Hypothesis Testing": [
      [
        "Regression",
        1
      ]
    ],

    "Regression": [],

  };


  const positions = {

    "Probability":
      [0, 0],

    "Random Variables":
      [1, 0],

    "Probability Distributions":
      [2, 0],

    "Hypothesis Testing":
      [3, 1],

    "Regression":
      [4, 1],

  };


  try {

    const response =
      await AI.studyPath(
        start,
        goal,
        graph,
        positions
      );


    renderStudyPathResult(
      result,
      response
    );


  } catch (error) {

    console.error(
      'Study path failed:',
      error
    );


    result.innerHTML = `

      <div class="study-path-error">

        <div class="study-path-error__icon">
          !
        </div>

        <div>

          <strong>
            Couldn't generate a study path
          </strong>

          <p>
            ${
              escapeHtml(
                error.message ||
                'Something went wrong.'
              )
            }
          </p>

        </div>

      </div>

    `;

  } finally {

    button.disabled = false;

    button.innerHTML = `
      ${Icon.sparkles}
      Find optimal path
    `;
  }
}


function renderStudyPathResult(
  container,
  result
) {

  if (
    !result.path ||
    result.path.length === 0
  ) {

    container.innerHTML = `

      <div class="study-path-empty">

        <div class="study-path-empty__icon">
          ∅
        </div>

        <strong>
          No path found
        </strong>

        <p>
          There is no connected learning path
          between these topics.
        </p>

      </div>
    `;

    return;
  }


  const steps =
    result.path
      .map(
        (topic, index) => `

          <div class="study-path-step">

            <div class="study-path-step__number">
              ${index + 1}
            </div>

            <div class="study-path-step__topic">
              ${escapeHtml(topic)}
            </div>

            ${
              index <
              result.path.length - 1
                ? `
                  <div class="study-path-step__line"></div>
                `
                : ''
            }

          </div>

        `
      )
      .join('');


  container.innerHTML = `

    <div class="study-path-success">

      <div class="study-path-result__header">

        <div>

          <div class="study-path-result__eyebrow">
            OPTIMAL LEARNING PATH
          </div>

          <h3>
            ${escapeHtml(result.path[0])}
            <span>→</span>
            ${escapeHtml(
              result.path[
                result.path.length - 1
              ]
            )}
          </h3>

        </div>


        <div class="study-path-badge">
          A*
        </div>

      </div>


      <div class="study-path-steps">

        ${steps}

      </div>


      <div class="study-path-stats">

        <div>
          <span>PATH COST</span>
          <strong>
            ${result.cost ?? '—'}
          </strong>
        </div>


        <div>
          <span>NODES EXPLORED</span>
          <strong>
            ${result.nodes_explored ?? '—'}
          </strong>
        </div>


        <div>
          <span>ALGORITHM</span>
          <strong>
            ${escapeHtml(
              result.algorithm ||
              'A*'
            )}
          </strong>
        </div>

      </div>

    </div>

  `;
}