// ============================================================
// NOTEBOOK VIEW — renders .md AI-generated notes as a proper
// notebook page (README 2.2/2.3), not forced through pdf.js.
// Editable with a real formatting toolbar; saves create a new
// document_versions row (README 2.6).
// ============================================================

import { Documents } from './api.js';
import { escapeHtml } from './ui-helpers.js';
import { toast } from './toast.js';
import { Icon } from './icons.js';
import { openAiPanel } from './ai-panel.js';

let saveTimer = null;
let dirty = false;

const HIGHLIGHT_COLORS = ['#FFF3A0', '#B8F1D0', '#BEE0FF', '#FBCFE8'];

export async function renderNotebook(body, doc) {
  const content = await Documents.getNotesContent(doc.id);
  const meta = doc.display_metadata || {};
  const coverColor = meta.cover_color || '#6C5CE7';
  const icon = meta.icon || '📄';

  body.innerHTML = `
    <div class="viewer">
      <div class="viewer-toolbar">
        <div class="viewer-toolbar__filename">${Icon.notes}<span>${escapeHtml(doc.filename)}</span><span class="badge badge--accent" style="margin-left:8px;">AI-generated</span></div>
        <div class="viewer-toolbar__group">
          <span class="badge badge--tag" id="version-badge">v${doc.current_version}</span>
        </div>
      </div>
      <div class="notebook" id="notebook-scroll">
        <div class="notebook-toolbar" id="notebook-toolbar">
          <button class="notebook-toolbar__btn" data-cmd="bold" title="Bold">B</button>
          <button class="notebook-toolbar__btn" data-cmd="italic" title="Italic" style="font-style:italic;">I</button>
          <div class="notebook-toolbar__sep"></div>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="H2" title="Heading">H1</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="H3" title="Subheading">H2</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="P" title="Paragraph">¶</button>
          <div class="notebook-toolbar__sep"></div>
          <button class="notebook-toolbar__btn" data-cmd="insertUnorderedList" title="Bullet list">${Icon.list}</button>
          <button class="notebook-toolbar__btn" data-cmd="formatBlock" data-value="BLOCKQUOTE" title="Quote">"</button>
          <div class="notebook-toolbar__sep"></div>
          <div class="notebook-toolbar__colors" id="highlight-colors" title="Highlight color">
            ${HIGHLIGHT_COLORS.map((c) => `<button class="notebook-toolbar__color" data-color="${c}" style="background:${c};"></button>`).join('')}
            <button class="notebook-toolbar__color" data-color="none" style="background:#fff; border:1px solid var(--line-strong);" title="Remove highlight"></button>
          </div>
          <div class="notebook-toolbar__sep"></div>
          <select class="notebook-toolbar__size" id="font-size-select" title="Text size">
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="1">Small</option>
          </select>
        </div>
        <div class="notebook__page">
          <div class="notebook__cover" style="background: linear-gradient(135deg, ${coverColor}, ${shade(coverColor)});">
            <div class="notebook__cover-icon">${icon}</div>
            <div class="notebook__cover-title">${escapeHtml(doc.filename.replace(/\.md$/, ''))}</div>
            <div class="notebook__cover-meta">Generated from ${doc.source_type === 'youtube_notes' ? 'a YouTube video' : doc.source_type === 'ppt_to_notes' ? 'a document' : 'your notes'} · v${doc.current_version}</div>
          </div>
          <div class="notebook__content" id="notebook-content" contenteditable="true">${renderMarkdown(content)}</div>
        </div>
      </div>
      <button class="ai-fab" id="ai-fab-btn"><span class="ai-fab__spark">${Icon.sparkles}</span> AI Magic</button>
      <div class="notebook__savebar saved" id="save-indicator">
        <span class="dot"></span><span id="save-text">Saved</span>
      </div>
    </div>
  `;

  body.querySelector('#ai-fab-btn').addEventListener('click', () => openAiPanel(doc.id));

  const editor = body.querySelector('#notebook-content');
  const indicator = body.querySelector('#save-indicator');
  const saveText = body.querySelector('#save-text');
  const versionBadge = body.querySelector('#version-badge');
  const toolbar = body.querySelector('#notebook-toolbar');

  // ---- Formatting toolbar (execCommand — adequate for this MVP's scope) ----
  toolbar.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editor.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
      markDirty();
    });
  });
  toolbar.querySelector('#highlight-colors').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    editor.focus();
    document.execCommand('hiliteColor', false, btn.dataset.color === 'none' ? 'transparent' : btn.dataset.color);
    markDirty();
  });
  toolbar.querySelector('#font-size-select').addEventListener('change', (e) => {
    editor.focus();
    document.execCommand('fontSize', false, e.target.value);
    markDirty();
  });

  function markDirty() {
    dirty = true;
    indicator.classList.remove('saved');
    indicator.classList.add('show');
    saveText.textContent = 'Unsaved changes';
    clearTimeout(saveTimer);
    // README-locked strategy: debounced client-side sync every ~60-90s, not on every keystroke
    saveTimer = setTimeout(() => saveNow(doc, editor, indicator, saveText, versionBadge), 75000);
  }

  editor.addEventListener('input', markDirty);

  // Final sync on tab close/blur per README sync strategy
  window.addEventListener('beforeunload', () => { if (dirty) saveNow(doc, editor, indicator, saveText, versionBadge); });
  editor.addEventListener('blur', () => { if (dirty) saveNow(doc, editor, indicator, saveText, versionBadge); });
}

async function saveNow(doc, editor, indicator, saveText, versionBadge) {
  if (!dirty) return;
  saveText.textContent = 'Saving…';
  const markdown = htmlToMarkdownApprox(editor.innerHTML);
  const res = await Documents.saveNotesContent(doc.id, markdown);
  dirty = false;
  indicator.classList.add('saved');
  saveText.textContent = 'Saved';
  if (res?.new_version) { doc.current_version = res.new_version; versionBadge.textContent = `v${res.new_version}`; }
  setTimeout(() => indicator.classList.remove('show'), 1800);
  toast('Notes saved as a new version', 'success', 2000);
}

function shade(hex) {
  // slightly darken a hex color for the cover gradient's second stop
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - 30), g = Math.max(0, ((n >> 8) & 0xff) - 30), b = Math.max(0, (n & 0xff) - 30);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ---- Markdown → HTML (uses marked.js from CDN when available, else a naive fallback) ----
function renderMarkdown(md) {
  if (window.marked) {
    try { return window.marked.parse(md); } catch (e) { /* fall through to naive renderer */ }
  }
  return naiveMarkdown(md);
}

function naiveMarkdown(md) {
  let html = escapeHtml(md);
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  return `<p>${html}</p>`;
}

// ---- Approximate HTML → Markdown on save (best-effort, not a full round-trip parser) ----
function htmlToMarkdownApprox(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  let out = '';
  div.childNodes.forEach((node) => { out += nodeToMd(node); });
  return out.trim() + '\n';
}

function nodeToMd(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  const tag = node.tagName?.toLowerCase();
  const inner = Array.from(node.childNodes).map(nodeToMd).join('');
  switch (tag) {
    case 'h1': return `# ${inner}\n\n`;
    case 'h2': return `## ${inner}\n\n`;
    case 'h3': return `### ${inner}\n\n`;
    case 'p': return `${inner}\n\n`;
    case 'strong': case 'b': return `**${inner}**`;
    case 'em': case 'i': return `*${inner}*`;
    case 'code': return `\`${inner}\``;
    case 'li': return `- ${inner}\n`;
    case 'ul': case 'ol': return `${inner}\n`;
    case 'blockquote': return `> ${inner}\n\n`;
    case 'br': return '\n';
    default: return inner;
  }
}
