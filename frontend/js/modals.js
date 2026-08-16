// ============================================================
// MODALS — standalone AI generation flows launched from the
// file grid's "Generate" button (not scoped to an open document)
// ============================================================

import { AI } from './api.js';
import { openModal, escapeHtml } from './ui-helpers.js';
import { Icon } from './icons.js';
import { toast } from './toast.js';
import { templates } from './mock-data.js';
import { pollJob } from './jobs.js';
import { busEmit } from './bus.js';

export function openYoutubeToNotesModal(folderId, onDone) {
  let stopPolling = null;
  const { el, close } = openModal({
    title: 'YouTube → Notes',
    subtitle: 'Paste a video URL — structured Markdown notes are generated and saved to this folder.',
    bodyHTML: `
      <div class="field">
        <label class="field__label">YouTube URL</label>
        <input class="input" id="yt-url" placeholder="https://youtube.com/watch?v=…" autofocus />
      </div>
      <div id="yt-status"></div>
    `,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--accent" id="yt-generate">${Icon.sparkles} Generate notes</button>`,
    width: 'modal--wide',
  });
  el.querySelector('[data-close-modal]').addEventListener('click', () => stopPolling?.());

  el.querySelector('#yt-generate').addEventListener('click', async () => {
    const url = el.querySelector('#yt-url').value.trim();
    if (!url) { toast('Paste a YouTube URL first', 'danger'); return; }
    el.querySelector('#yt-generate').disabled = true;
    el.querySelector('#yt-generate').textContent = 'Starting…';

    const { job_id } = await AI.startYoutubeToNotes(url, folderId);
    el.querySelector('#yt-status').innerHTML = jobStatusHTML('processing', 'Fetching transcript and generating notes…');

    stopPolling = pollJob(job_id, (job) => {
      if (job.status === 'processing' || job.status === 'pending') {
        el.querySelector('#yt-status').innerHTML = jobStatusHTML('processing', 'Fetching transcript and generating notes…');
      } else if (job.status === 'done') {
        el.querySelector('#yt-status').innerHTML = jobStatusHTML('done', 'Notes generated and saved.');
        toast('YouTube notes generated', 'success');
        onDone?.();
        setTimeout(close, 900);
      } else if (job.status === 'failed') {
        el.querySelector('#yt-status').innerHTML = jobStatusHTML('failed', job.error_message || 'Something went wrong.');
        el.querySelector('#yt-generate').disabled = false;
        el.querySelector('#yt-generate').textContent = 'Try again';
      }
    });
  });
}

export function openTextToPptModal(folderId, onDone) {
  let selectedTemplate = templates[1].id; // 'modern' default
  let stopPolling = null;
  const fonts = ['Inter', 'Sora', 'Source Serif 4', 'Poppins', 'JetBrains Mono'];
  let selectedFont = fonts[0];
  let selectedTheme = 'light';

  const { el, close } = openModal({
    title: 'Text / Topic → PPT',
    subtitle: 'The AI generates the content — you control the look. Pick a template below.',
    bodyHTML: `
      <div class="field">
        <label class="field__label">Topic or raw text</label>
        <textarea class="textarea" id="ppt-topic" placeholder="e.g. Introduction to Machine Learning — cover definitions, key algorithms, and real-world applications" autofocus></textarea>
      </div>
      <div class="field">
        <label class="field__label">Template</label>
        <div class="template-grid" id="template-grid">
          ${templates.map((t) => `
            <div class="template-card ${t.id === selectedTemplate ? 'selected' : ''}" data-template="${t.id}">
              <div class="template-card__preview" style="background:${t.colors[2]}">
                <div class="bar" style="width:60%; background:${t.colors[0]}"></div>
                <div class="bar" style="width:40%; background:${t.colors[1]}"></div>
                <div class="bar" style="width:50%; background:${t.colors[0]}; opacity:0.6;"></div>
              </div>
              <div class="template-card__label">${t.label}</div>
            </div>`).join('')}
        </div>
      </div>
      <div style="display:flex; gap: var(--sp-4);">
        <div class="field" style="flex:1;">
          <label class="field__label">Font</label>
          <select class="select" id="ppt-font">${fonts.map((f) => `<option value="${f}">${f}</option>`).join('')}</select>
        </div>
        <div class="field" style="flex:1;">
          <label class="field__label">Slides (optional)</label>
          <input class="input" id="ppt-slidecount" type="number" min="3" max="20" placeholder="Auto" />
        </div>
      </div>
      <div id="ppt-status"></div>
    `,
    footerHTML: `<button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--accent" id="ppt-generate">${Icon.sparkles} Generate presentation</button>`,
    width: 'modal--xwide',
  });

  el.querySelector('#template-grid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-template]');
    if (!card) return;
    selectedTemplate = card.dataset.template;
    el.querySelectorAll('.template-card').forEach((c) => c.classList.toggle('selected', c.dataset.template === selectedTemplate));
  });

  el.querySelector('[data-close-modal]').addEventListener('click', () => stopPolling?.());

  el.querySelector('#ppt-generate').addEventListener('click', async () => {
    const topic = el.querySelector('#ppt-topic').value.trim();
    if (!topic) { toast('Enter a topic or some text first', 'danger'); return; }
    selectedFont = el.querySelector('#ppt-font').value;
    const slideCount = Number(el.querySelector('#ppt-slidecount').value) || null;
    el.querySelector('#ppt-generate').disabled = true;
    el.querySelector('#ppt-generate').textContent = 'Starting…';

    const { job_id } = await AI.startTextToPpt(topic, folderId, selectedTemplate, selectedFont, selectedTheme, slideCount);
    el.querySelector('#ppt-status').innerHTML = jobStatusHTML('processing', 'Generating slide structure and rendering your deck…');

    stopPolling = pollJob(job_id, (job) => {
      if (job.status === 'processing' || job.status === 'pending') {
        el.querySelector('#ppt-status').innerHTML = jobStatusHTML('processing', 'Generating slide structure and rendering your deck…');
      } else if (job.status === 'done') {
        el.querySelector('#ppt-status').innerHTML = jobStatusHTML('done', 'Presentation generated and saved.');
        toast('Presentation generated', 'success');
        onDone?.();
        setTimeout(close, 900);
      } else if (job.status === 'failed') {
        el.querySelector('#ppt-status').innerHTML = jobStatusHTML('failed', job.error_message || 'Something went wrong.');
        el.querySelector('#ppt-generate').disabled = false;
        el.querySelector('#ppt-generate').textContent = 'Try again';
      }
    });
  });
}

function jobStatusHTML(status, message) {
  const badge = { processing: 'warning', done: 'success', failed: 'danger' }[status];
  return `
    <div class="job-card" style="margin-top:4px;">
      <div class="job-card__head">
        <div class="job-card__title">${Icon.generate} Job status</div>
        <span class="badge badge--${badge}"><span class="badge__dot ${status === 'processing' ? 'pulse' : ''}"></span>${status}</span>
      </div>
      <div class="job-card__desc">${escapeHtml(message)}</div>
    </div>`;
}
