// ============================================================
// API CLIENT
// ------------------------------------------------------------
// MOCK_MODE = true  → everything is served from in-memory mock
//                     data (js/mock-data.js), latency-simulated.
// MOCK_MODE = false → real calls go to MAIN_BACKEND_URL, which
//                     internally proxies AI actions to the AI
//                     microservice (per README Section 3/7).
//
// Every function signature/response shape below matches the
// contract in the README exactly, so flipping MOCK_MODE is the
// only change needed once the real FastAPI backend is running.
//
// IMPORTANT: every mock function returns a CLONE of its data,
// never a live reference into the internal arrays below. A real
// HTTP API never hands you a live reference either — skipping
// this caused a real bug (UI code pushing an "optimistic" copy
// of an item into what turned out to be the same underlying
// array the mock had already pushed into, duplicating it).
// ============================================================

import { mockUser, mockFolders, mockDocuments, mockTags, mockNotesContent, makeJob } from './mock-data.js';

export const MOCK_MODE = false;
export const MAIN_BACKEND_URL = 'http://localhost:8000'; // matches README's local dev port for main backend
export const S3_PUBLIC_BASE_URL = 'https://your-bucket.s3.amazonaws.com'; // replace with real bucket URL when live

// ---- in-memory mutable "database" (mock mode only) ----
let _folders = JSON.parse(JSON.stringify(mockFolders));
let _documents = JSON.parse(JSON.stringify(mockDocuments));
let _tags = JSON.parse(JSON.stringify(mockTags));
let _annotations = [];
let _jobs = [];
let _notesContent = { ...mockNotesContent };

const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const wait = (ms = 110) => new Promise((res) => setTimeout(res, ms + Math.random() * 90));

function authHeaders() {
  const token = localStorage.getItem('sf_access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function realFetch(path, opts = {}) {
  const res = await fetch(`${MAIN_BACKEND_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ============================================================
// AUTH — Supabase Auth owns sessions; backend only validates JWT
// ============================================================
export const Auth = {
  async signUp(email, password) {
    if (MOCK_MODE) {
      await wait(150);
      localStorage.setItem('sf_access_token', 'mock-jwt-token');
      localStorage.setItem('sf_user', JSON.stringify(mockUser));
      localStorage.setItem('sf_display_name', email.split('@')[0]);
      return { user: clone(mockUser), access_token: 'mock-jwt-token' };
    }
    const data = await realFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.access_token) {
      localStorage.setItem('sf_access_token', data.access_token);
      localStorage.setItem('sf_user', JSON.stringify(data.user));
      localStorage.setItem('sf_display_name', data.user?.name || email.split('@')[0]);
    }
    return data;
  },
  async signIn(email, password) {
    if (MOCK_MODE) {
      await wait(150);
      localStorage.setItem('sf_access_token', 'mock-jwt-token');
      localStorage.setItem('sf_user', JSON.stringify(mockUser));
      return { user: clone(mockUser), access_token: 'mock-jwt-token' };
    }
    const data = await realFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.access_token) {
      localStorage.setItem('sf_access_token', data.access_token);
      localStorage.setItem('sf_user', JSON.stringify(data.user));
      localStorage.setItem('sf_display_name', data.user?.name || data.user?.email?.split('@')[0] || '');
    }
    return data;
  },
  async signOut() {
    localStorage.removeItem('sf_access_token');
    localStorage.removeItem('sf_user');
    localStorage.removeItem('sf_display_name');
    if (!MOCK_MODE) return realFetch('/auth/logout', { method: 'POST' });
  },
  currentSession() {
    const token = localStorage.getItem('sf_access_token');
    if (!token) return null;
    const userStr = localStorage.getItem('sf_user');
    let user;
    try {
      user = userStr ? JSON.parse(userStr) : clone(mockUser);
    } catch {
      user = clone(mockUser);
    }
    return { user, access_token: token };
  },
  updateProfile(patch) {
    if (patch.name) localStorage.setItem('sf_display_name', patch.name);
    return Promise.resolve({ ...clone(mockUser), ...patch });
  },
  getDisplayName() {
    return localStorage.getItem('sf_display_name') || mockUser.name || mockUser.email.split('@')[0];
  },
};

// ============================================================
// FOLDERS
// ============================================================
export const Folders = {
  async list() {
    if (MOCK_MODE) { await wait(90); return clone(_folders); }
    return realFetch('/folders');
  },
  async create(name, parentFolderId = null) {
    if (MOCK_MODE) {
      await wait(140);
      const f = { id: 'f-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), user_id: mockUser.id, name, parent_folder_id: parentFolderId, created_at: new Date().toISOString() };
      _folders.push(f);
      return clone(f);
    }
    return realFetch('/folders', { method: 'POST', body: JSON.stringify({ name, parent_folder_id: parentFolderId }) });
  },
  async rename(id, name) {
    if (MOCK_MODE) { await wait(100); const f = _folders.find((x) => x.id === id); if (f) f.name = name; return clone(f); }
    return realFetch(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  },
  async move(id, newParentId) {
    if (MOCK_MODE) { await wait(100); const f = _folders.find((x) => x.id === id); if (f) f.parent_folder_id = newParentId; return clone(f); }
    return realFetch(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ parent_folder_id: newParentId }) });
  },
  async remove(id) {
    if (MOCK_MODE) {
      await wait(140);
      const toDelete = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        _folders.forEach((f) => { if (toDelete.has(f.parent_folder_id) && !toDelete.has(f.id)) { toDelete.add(f.id); changed = true; } });
      }
      _folders = _folders.filter((f) => !toDelete.has(f.id));
      _documents = _documents.filter((d) => !toDelete.has(d.folder_id));
      return { deleted: true };
    }
    return realFetch(`/folders/${id}`, { method: 'DELETE' });
  },
};

// ============================================================
// DOCUMENTS
// ============================================================
export const Documents = {
  async listByFolder(folderId) {
    if (MOCK_MODE) { await wait(110); return clone(_documents.filter((d) => d.folder_id === folderId)); }
    return realFetch(`/documents?folder_id=${folderId ?? ''}`);
  },
  async listFavorites() {
    if (MOCK_MODE) { await wait(100); return clone(_documents.filter((d) => d.favorite)); }
    return realFetch('/documents/favorites');
  },
  async search(query) {
    if (MOCK_MODE) {
      await wait(130);
      const q = query.toLowerCase();
      return clone(_documents.filter((d) => d.filename.toLowerCase().includes(q)));
    }
    return realFetch(`/documents/search?q=${encodeURIComponent(query)}`);
  },
  async get(id) {
    if (MOCK_MODE) { await wait(80); return clone(_documents.find((d) => d.id === id)); }
    return realFetch(`/documents/${id}`);
  },
  async upload(file, folderId) {
    if (MOCK_MODE) {
      await wait(450);
      const ext = file.name.split('.').pop().toLowerCase();
      const typeMap = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', png: 'image', jpg: 'image', jpeg: 'image', txt: 'txt', md: 'md' };
      const doc = {
        id: 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), user_id: mockUser.id, folder_id: folderId, filename: file.name,
        file_type: typeMap[ext] || 'pdf', original_s3_key: `users/u-1/uploads/mock/${file.name}`,
        preview_pdf_s3_key: ['docx', 'pptx', 'xlsx'].includes(ext) ? 'mock-preview.pdf' : null,
        is_ai_generated: false, source_type: 'upload', current_version: 1, display_metadata: {},
        file_size_bytes: file.size, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        favorite: false, tags: [],
      };
      _documents.push(doc);
      return clone(doc);
    }
    const form = new FormData();
    form.append('file', file);
    form.append('folder_id', folderId ?? '');
    const res = await fetch(`${MAIN_BACKEND_URL}/documents/upload`, { method: 'POST', headers: authHeaders(), body: form });
    return res.json();
  },
  async replaceFile(documentId, file) {
    // Explicit "Replace File" — the ONLY action that creates a new document_versions row (README 2.6)
    if (MOCK_MODE) {
      await wait(380);
      const doc = _documents.find((d) => d.id === documentId);
      if (doc) { doc.current_version += 1; doc.updated_at = new Date().toISOString(); doc.file_size_bytes = file.size; }
      return clone(doc);
    }
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${MAIN_BACKEND_URL}/documents/${documentId}/versions`, { method: 'POST', headers: authHeaders(), body: form });
    return res.json();
  },
  async rename(id, filename) {
    if (MOCK_MODE) { await wait(100); const d = _documents.find((x) => x.id === id); if (d) d.filename = filename; return clone(d); }
    return realFetch(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ filename }) });
  },
  async move(id, folderId) {
    if (MOCK_MODE) { await wait(100); const d = _documents.find((x) => x.id === id); if (d) d.folder_id = folderId; return clone(d); }
    return realFetch(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ folder_id: folderId }) });
  },
  async remove(id) {
    if (MOCK_MODE) { await wait(120); _documents = _documents.filter((d) => d.id !== id); return { deleted: true }; }
    return realFetch(`/documents/${id}`, { method: 'DELETE' });
  },
  async toggleFavorite(id) {
    if (MOCK_MODE) { await wait(70); const d = _documents.find((x) => x.id === id); if (d) d.favorite = !d.favorite; return clone(d); }
    return realFetch(`/documents/${id}/favorite`, { method: 'POST' });
  },
  async versions(id) {
    if (MOCK_MODE) {
      await wait(100);
      const d = _documents.find((x) => x.id === id);
      if (!d) return [];
      return clone(Array.from({ length: d.current_version }, (_, i) => ({
        id: `v-${id}-${i + 1}`, document_id: id, version_number: i + 1,
        uploaded_at: new Date(Date.now() - (d.current_version - i) * 86400000).toISOString(),
        uploaded_by: mockUser.id, file_size_bytes: d.file_size_bytes,
      })));
    }
    return realFetch(`/documents/${id}/versions`);
  },
  async restoreVersion(id, versionNumber) {
    if (MOCK_MODE) { await wait(220); return { restored: versionNumber }; }
    return realFetch(`/documents/${id}/versions/${versionNumber}/restore`, { method: 'POST' });
  },
  // Notes content (md) — read/save. Saving creates a new version (README 2.6).
async getNotesContent(id) {
  if (MOCK_MODE) { await wait(110); return _notesContent[id] || '# Untitled Notes\n\nStart writing…'; }
  // Content endpoint returns plain text, not JSON
  const res = await fetch(`${MAIN_BACKEND_URL}/documents/${id}/content`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`Failed to load notes: ${res.status}`);
  return res.text(); // plain text, not .json()
},

async saveNotesContent(id, content) {
    if (MOCK_MODE) {
      await wait(160);
      _notesContent[id] = content;
      const d = _documents.find((x) => x.id === id);
      if (d) d.current_version += 1;
      return { saved: true, new_version: d?.current_version };
    }
    return realFetch(`/documents/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  },
};

// ============================================================
// TAGS
// ============================================================
export const Tags = {
  async list() { if (MOCK_MODE) { await wait(70); return clone(_tags); } return realFetch('/tags'); },
  async create(name) {
    if (MOCK_MODE) { await wait(100); const t = { id: 't-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), user_id: mockUser.id, name }; _tags.push(t); return clone(t); }
    return realFetch('/tags', { method: 'POST', body: JSON.stringify({ name }) });
  },
  async attach(documentId, tagId) {
    if (MOCK_MODE) { await wait(70); const d = _documents.find((x) => x.id === documentId); if (d && !d.tags.includes(tagId)) d.tags.push(tagId); return clone(d); }
    return realFetch(`/documents/${documentId}/tags/${tagId}`, { method: 'POST' });
  },
  async detach(documentId, tagId) {
    if (MOCK_MODE) { await wait(70); const d = _documents.find((x) => x.id === documentId); if (d) d.tags = d.tags.filter((t) => t !== tagId); return clone(d); }
    return realFetch(`/documents/${documentId}/tags/${tagId}`, { method: 'DELETE' });
  },
};

// ============================================================
// ANNOTATIONS — tied to document_version_id (README 2.6 / 6.5)
// ============================================================
export const Annotations = {
  async list(documentId, versionNumber) {
    if (MOCK_MODE) { await wait(90); return clone(_annotations.filter((a) => a.document_id === documentId && a.version_number === versionNumber)); }
    return realFetch(`/documents/${documentId}/annotations?version=${versionNumber}`);
  },
  async create(annotation) {
    if (MOCK_MODE) { await wait(90); const a = { id: 'an-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), created_at: new Date().toISOString(), ...annotation }; _annotations.push(a); return clone(a); }
    return realFetch(`/documents/${annotation.document_id}/annotations`, { method: 'POST', body: JSON.stringify(annotation) });
  },
  async remove(id) {
    if (MOCK_MODE) { await wait(70); _annotations = _annotations.filter((a) => a.id !== id); return { deleted: true }; }
    return realFetch(`/annotations/${id}`, { method: 'DELETE' });
  },
};

// ============================================================
// AI — main backend forwards these to the AI microservice with
// the internal X-AI-Service-Key header (README Section 5/7).
// Frontend only ever talks to the main backend.
// ============================================================
export const AI = {
  async embedDocument(documentId) {
    if (MOCK_MODE) { await wait(400); return { status: 'done', chunk_count: 24 }; }
    return realFetch('/ai/embed-document', { method: 'POST', body: JSON.stringify({ document_id: documentId }) });
  },
  async chat(documentId, sessionId, message) {
    if (MOCK_MODE) {
      await wait(650);
      const answers = [
        "Based on this document, the core idea is that the process is applied layer by layer, propagating information backward through the computation graph using the chain rule.",
        "Good question — the document frames this as a trade-off between computational cost and accuracy. The relevant section covers this in more depth around the middle of the text.",
        "That term refers to a specific technique described earlier in the document. In short: it improves stability during training by preventing gradients from growing or shrinking uncontrollably.",
      ];
      return { session_id: sessionId || 'sess-' + Date.now(), answer: answers[Math.floor(Math.random() * answers.length)] };
    }
    return realFetch('/ai/chat', { method: 'POST', body: JSON.stringify({ document_id: documentId, session_id: sessionId, message }) });
  },
  async summarize(documentId) {
    if (MOCK_MODE) { await wait(750); return { summary: "This document covers the core mechanics of the topic, walks through a worked example, and closes with common pitfalls to watch for when applying it in practice." }; }
    return realFetch('/ai/summarize', { method: 'POST', body: JSON.stringify({ document_id: documentId }) });
  },
  async explainSelection(documentId, selectedText) {
    if (MOCK_MODE) { await wait(650); return { explanation: `In plain terms: "${selectedText.slice(0, 40)}${selectedText.length > 40 ? '…' : ''}" is describing a mechanism the rest of the document builds on — it's worth re-reading the paragraph right before this if it's still unclear.` }; }
    return realFetch('/ai/explain', { method: 'POST', body: JSON.stringify({ document_id: documentId, text: selectedText }) });
  },
  // ---- Async jobs (polling pattern per README Section 7 / 9) ----
  async startYoutubeToNotes(youtubeUrl, targetFolderId) {
    if (MOCK_MODE) {
      await wait(200);
      const job = makeJob('youtube_to_notes', { youtube_url: youtubeUrl, target_folder_id: targetFolderId });
      _jobs.push(job);
      _simulateJob(job, () => {
        const doc = {
          id: 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), user_id: mockUser.id, folder_id: targetFolderId, filename: 'YouTube Notes — Generated.md',
          file_type: 'md', original_s3_key: `users/u-1/generated/mock/output.md`, preview_pdf_s3_key: null,
          is_ai_generated: true, source_type: 'youtube_notes', current_version: 1,
          display_metadata: { cover_color: '#2678C9', font: 'Source Serif 4', icon: '🎬' },
          file_size_bytes: 7200, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), favorite: false, tags: [],
        };
        _documents.push(doc);
        _notesContent[doc.id] = '# Generated Notes\n\nThis is a mock-generated notes file standing in for the real YouTube → Notes AI job output.\n\n## Key points\n\n- Point one from the video\n- Point two from the video\n- Point three from the video\n';
        return doc.id;
      });
      return { job_id: job.id };
    }
    return realFetch('/ai/jobs/youtube-to-notes', { method: 'POST', body: JSON.stringify({ youtube_url: youtubeUrl, target_folder_id: targetFolderId }) });
  },
  async startTextToPpt(topicOrText, targetFolderId, template, font, theme, slideCount) {
    if (MOCK_MODE) {
      await wait(200);
      const job = makeJob('text_to_ppt', { topic_or_text: topicOrText, target_folder_id: targetFolderId, template, font, theme, slide_count: slideCount });
      _jobs.push(job);
      _simulateJob(job, () => {
        const doc = {
          id: 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), user_id: mockUser.id, folder_id: targetFolderId, filename: `${topicOrText.slice(0, 30)} — Generated.pptx`,
          file_type: 'pptx', original_s3_key: `users/u-1/generated/mock/output.pptx`, preview_pdf_s3_key: 'mock-preview.pdf',
          is_ai_generated: true, source_type: 'text_to_ppt', current_version: 1,
          display_metadata: { template, font, theme },
          file_size_bytes: 340000, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), favorite: false, tags: [],
        };
        _documents.push(doc);
        return doc.id;
      }, 2200);
      return { job_id: job.id };
    }
    return realFetch('/ai/jobs/text-to-ppt', { method: 'POST', body: JSON.stringify({ topic_or_text: topicOrText, target_folder_id: targetFolderId, template, font, theme, slide_count: slideCount }) });
  },
  async startPptToNotes(sourceDocumentId, targetFolderId) {
    if (MOCK_MODE) {
      await wait(200);
      const job = makeJob('ppt_to_notes', { source_document_id: sourceDocumentId, target_folder_id: targetFolderId });
      _jobs.push(job);
      const src = _documents.find((d) => d.id === sourceDocumentId);
      _simulateJob(job, () => {
        const doc = {
          id: 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), user_id: mockUser.id, folder_id: targetFolderId, filename: `${(src?.filename || 'Document').replace(/\.[^.]+$/, '')} — Notes.md`,
          file_type: 'md', original_s3_key: `users/u-1/generated/mock/output.md`, preview_pdf_s3_key: null,
          is_ai_generated: true, source_type: 'ppt_to_notes', current_version: 1,
          display_metadata: { cover_color: '#1BA672', font: 'Source Serif 4', icon: '📝' },
          file_size_bytes: 8400, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), favorite: false, tags: [],
        };
        _documents.push(doc);
        _notesContent[doc.id] = `# ${src?.filename || 'Document'} — Notes\n\nMock-generated structured notes standing in for the real PPT → Notes AI job output.\n\n## Summary\n\n- Restructured key content\n- Organized into headings and bullets\n`;
        return doc.id;
      });
      return { job_id: job.id };
    }
    return realFetch('/ai/jobs/ppt-to-notes', { method: 'POST', body: JSON.stringify({ source_document_id: sourceDocumentId, target_folder_id: targetFolderId }) });
  },
  async jobStatus(jobId) {
    if (MOCK_MODE) { await wait(60); const j = _jobs.find((x) => x.id === jobId); return j ? clone(j) : { status: 'failed', error_message: 'Job not found' }; }
    return realFetch(`/ai/jobs/${jobId}`);
  },
};

function _simulateJob(job, onDone, delay = 1600) {
  job.status = 'processing';
  setTimeout(() => {
    const failed = Math.random() < 0.06; // small mock failure chance to exercise error UI
    if (failed) {
      job.status = 'failed';
      job.error_message = 'Transcript not available for this video.';
    } else {
      const resultId = onDone();
      job.status = 'done';
      job.result_document_id = resultId;
      job.completed_at = new Date().toISOString();
    }
  }, delay);
}
