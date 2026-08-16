# Agentic Multi-Modal Content Transformation Pipeline

A study/document management platform with folder-based organization, version control, and an AI microservice layer for content transformation (video → notes, text → PPT, PPT → notes, document RAG chat).

This is a **single-user application for the MVP** — no sharing, no permissions, no multi-user collaboration. Every user only ever sees their own folders/documents.

This README is the single source of truth for the whole project. It's split so that:
- **Shatakshi** can build the **AI microservice** independently using only the "AI Microservice Contract" section — no need to touch the main backend/frontend code or ask questions.
- **Main backend/frontend** work (folders, files, auth, versioning) is built separately against the schema defined here.

Both sides only need to agree on: the DB schema (shared Supabase instance) and the HTTP contract between the main backend and the AI microservice.

---

## 1. Project Overview

A full study-material management app (single-user, no sharing) where users can:
- Create nested folders, upload/organize/version files
- Preview any file type (PDF, DOCX, PPTX, XLSX, images, TXT) in-browser, normalized to PDF
- Read, navigate, search, and annotate documents in a proper study-focused viewer
- Tag and favorite documents
- Use AI features scoped to a specific document, triggered explicitly via an "AI Magic" entry point: RAG-based Q&A chat, summarize, explain selection, generate notes, plus standalone AI tools (YouTube → Notes, Text → PPT, PPT → Notes)

---

## 2. Feature List

### 2.1 Core App (Folder/File System)
- Auth: sign up, log in, log out, session persistence — fully handled by **Supabase Auth** (see Section 2.3, no custom auth logic)
- Folder CRUD: create, rename, delete, move, infinite nested subfolders
- File CRUD: upload, rename, delete, move between folders, download
- Automatic format normalization: PPTX/DOCX/XLSX uploads are converted to PDF server-side (via LibreOffice headless) for unified in-browser preview; original file is always retained for download
- File versioning: a new version is created **only on an explicit "Replace File" action** (not on every unrelated upload) — see Section 2.4
- Tags: create tags, attach/detach tags to/from documents, filter by tag
- Favorites: mark/unmark documents as favorite
- Activity log: every meaningful action (upload, delete, rename, restore version, create folder) is logged per user
- ~~Sharing~~ — **removed for the MVP.** This is a single-user app; no file/folder sharing, no permissions, no `shared_access` table. See Section 2.5.

### 2.2 Document Viewer

The viewer is a proper study/document viewer, not just a raw PDF display. It covers reading, navigation, search, annotation, AI, and file actions — but deliberately stops short of a full document editor (not Adobe Acrobat, not Notion, not Canva).

**Navigation:** page-by-page (prev/next, page number input, total pages), scroll-through, thumbnail sidebar, jump-to-page, fit-to-width, fit-to-page, zoom in/out, reasonable keyboard shortcuts.

**Reading:** clean distraction-free reading area, full-screen mode, in-document search with result navigation, text selection + copy, native image viewing for image files.

**Study / annotation:** highlight selected text (multiple colors if practical), sticky notes, comments, view/edit/delete annotations, navigate between annotations. Annotations are tied to the specific **document version** they were created on (see Section 2.6) — not the document as a whole.

**AI Magic (explicit trigger only):** a dedicated entry point in the viewer for AI actions — Ask AI about this document, Summarize, Explain selected text, Generate notes, etc. **AI/embedding operations never run automatically just because a document was opened** — only when the user explicitly picks an AI action. See Section 2.7.

**File actions:** download original, view file info, rename, delete, favorite, move, version history (view/restore).

**Markdown / AI-generated notes:** `.md` files (from YouTube → Notes / PPT → Notes) get a proper notebook-style Markdown renderer (headings, lists, bold/italic, code blocks, links, tables) instead of being forced through pdf.js. These notes are also **editable** — see Section 2.6.

### 2.3 Text → PPT: Templates and Styling

Text → PPT does **not** let the LLM invent arbitrary slide visuals. Instead, the app ships a small fixed set of professionally designed templates (4-6 for the MVP, e.g. Minimal/Academic, Modern/Clean, Dark/Premium, Colorful/Creative, Corporate, Notes/Study-focused). Before generating, the user picks: template/style, font, and optionally number of slides.

This is a strict separation of concerns:

```
AI's job:        Topic/Text → understand content → structured JSON (title, slide headings, bullets)
Renderer's job:   structured JSON + template + font + theme → final .pptx
```

The AI never touches visual styling — it only ever outputs the structured JSON in Section 7.3. A rendering layer (python-pptx, driven by the chosen template) applies the actual look. This means adding a new template later is a renderer-side change only, never an AI-prompt change. Selected template/font/theme is stored in `documents.display_metadata` on the generated file (same JSONB field used for notes styling, Section 6.1).

**Canva export — nice-to-have, not a blocker.** Investigate whether a generated `.pptx` can be opened in Canva via a simple upload/URL flow. If it requires OAuth, a Canva app, paid APIs, or real backend work — skip it for the MVP. The floor requirement is just that generated `.pptx` files are normal, valid, editable PowerPoint files, so a user can always import them into Canva manually if they want. This must never block Text → PPT development itself.

### 2.4 AI Features (built by Shatakshi as a separate microservice)
- **Document RAG Chat** — chat with a specific document (Q&A grounded in its content). Triggered only from the viewer's "AI Magic" panel, never automatically.
- **YouTube → Notes** — paste a YouTube URL, get structured Markdown notes back (auto-saved as a new file in a folder of the user's choice)
- **Text/Topic → PPT** — enter a topic or raw text + template/font choice, get a generated `.pptx` back (rendered file, saved to a folder)
- **PPT → Notes** — pick an existing document, get structured Markdown notes generated from its content

All AI outputs, once generated, are saved back into the normal file system (as a `documents` row + S3 object) so they show up in the user's folders like any other file, and behave as fully independent documents from that point on (Section 2.6).

### 2.5 Sharing — explicitly removed

There is no sharing in this app. No file sharing, no folder sharing, no `view`/`edit` permissions, no `shared_access` table, no sharing UI or API endpoints. The only access-control requirement is that an authenticated user can only see/act on their own folders, documents, annotations, tags, favorites, and AI jobs. This may be revisited post-MVP, but nothing in the current build should assume it exists.

### 2.6 Versioning Rules

- A new `document_versions` row is created **only** when the user explicitly chooses "Replace File" on an existing document — never as a side effect of uploading an unrelated file, even if it happens to share a filename.
- **AI-generated Markdown notes are editable**, and a meaningful saved edit also creates a new version (v1 = AI-generated, v2 = first edit, v3 = further edit, etc.) rather than overwriting content in place — this gives a simple undo/history mechanism. The 60-90s client-side sync (Section 10) batches edits, but the actual persisted save is what creates/updates the version.
- **Annotations belong to a specific version**, not the document as a whole (`annotations.document_version_id`, Section 6.5) — so replacing a file (which can shift page layout) doesn't leave stale/misplaced highlights on the new version. Restoring an old version also restores that version's annotations as active.
- **AI-generated documents are independent** once created — e.g. if `Physics.pdf` is used to generate `Physics Notes.md` and the user later deletes `Physics.pdf`, `Physics Notes.md` is unaffected and remains a normal, fully independent document.

### 2.7 AI Is Always Explicitly Triggered

No AI or embedding call happens automatically on upload or on opening a document. Embedding a document for RAG happens lazily, the first time the user requests an AI feature on it that actually needs it (e.g. first chat message) — not eagerly on upload. This keeps API/LLM usage intentional and avoids burning Groq rate limits on documents nobody ever asks AI about.

### 2.8 Auth (Supabase Auth — no custom implementation)

```
Frontend → Supabase Auth (signup/login) → JWT access token + refresh token
Frontend → sends Authorization: Bearer <access_token> on every request
FastAPI (main backend) → validates the JWT → extracts user_id → proceeds
```

Supabase Auth owns sign up, login, logout, session persistence, and access-token refresh — the main backend does **not** implement its own auth/refresh-token system, it only validates incoming JWTs and reads the user id out of them. `SUPABASE_SERVICE_ROLE_KEY` stays server-side only (used for privileged writes like the AI service creating documents on a user's behalf) and is never exposed to the frontend.

### 2.9 MVP Scope Guardrails

This is a mini/portfolio project, not a production SaaS platform. Explicitly out of scope unless something above says otherwise: Redis/Celery-style job queues (the `ai_jobs` polling pattern in Section 7 is sufficient), real-time collaboration, an enterprise permission system, a full document editor, complicated Canva OAuth, and any AI call that isn't user-triggered. Priority is a reliable end-to-end demo: `Auth → Folders → Upload → Preview/Read → Search/Annotate → AI Magic → Generate output → Save back into folders → Edit/version/restore`.

---

## 3. Architecture

```
┌─────────────────┐   Supabase JWT   ┌──────────────────────┐  Internal API Key  ┌───────────────────────┐
│    Frontend       │ ───────────────▶ │     Main Backend         │ ──────────────────▶ │   AI Microservice        │
│  (HTML/CSS/JS)     │                  │      (FastAPI)            │                     │   (FastAPI, Shatakshi)    │
│  pdf.js + viewer   │                  │  Auth validation           │                     │   RAG / YouTube→Notes     │
│  → Netlify          │                  │  Folders/Files/Versions    │                     │   Text→PPT / PPT→Notes    │
│                    │                  │  Annotations               │                     │   → separate deployment   │
└─────────────────┘                  └──────────────────────┘                     └───────────┬───────────┘
                                                                                                 │        │
                                                                                          ┌──────▼──┐  ┌──▼───┐
                                                                                          │Supabase │  │  S3  │
                                                                                          │Postgres │  │Files │
                                                                                          │pgvector │  │      │
                                                                                          └─────────┘  └──────┘
```

**Key principles:**
- The frontend **never calls the AI microservice directly** — only through the main backend, which forwards requests with an internal service key (Section 5, `AI_SERVICE_API_KEY`).
- The AI microservice is otherwise fully independent — it talks to Supabase and S3 directly, and does **not** depend on the main backend being up to do its own processing. The main backend only needs to know its HTTP contract (Section 7), not its internals.
- Auth is JWT-based end-to-end (Section 2.8) — no custom session/refresh logic anywhere in this stack.

---

## 4. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | HTML / CSS / JS (vanilla), pdf.js for preview |
| Frontend hosting | Netlify |
| Main backend | FastAPI (Python) |
| Main backend hosting | Local (dev) → Render free tier (final, containerized) |
| AI microservice | FastAPI (Python), built by Shatakshi, run locally alongside main backend during dev |
| AI microservice hosting | Local (dev) → Render free tier (final, containerized) |
| LLM provider | Groq (primary) — see model allocation in Section 7.5 |
| Embeddings | `sentence-transformers` (`all-MiniLM-L6-v2`) — run locally, no API cost |
| Database | Supabase (Postgres) |
| Vector store | Supabase `pgvector` extension (same DB, no separate vector DB) |
| Auth | Supabase Auth |
| File storage | AWS S3 |
| Document format conversion | LibreOffice headless (`soffice --headless --convert-to pdf`) |

**Note on local dev:** Everything runs locally for now (main backend, AI microservice, frontend), but all file storage still goes to the real S3 bucket and all DB reads/writes go to the real Supabase project — so both of you are always working against the same live data layer, no local DB needed. See Section 4.1 for exactly how this works across two people/machines.

### 4.1 Dev Workflow (important — read this, Shatakshi)

- **Shatakshi builds the AI microservice as its own separate FastAPI project** (own folder, own repo, own `requirements.txt`, own `.env`, own `Dockerfile` eventually). It must be runnable completely standalone — `uvicorn main:app --reload --port 8001` — with no dependency on the main backend's code.
- **She does NOT need to run the main backend, frontend, or anything else to build/test her service.** She only needs: (a) the Supabase URL + service role key, (b) AWS S3 credentials, (c) her own Groq API keys. All three are shared with her once, by Aman, outside this repo (not committed anywhere).
- She tests her endpoints directly — Postman, curl, or FastAPI's own `/docs` (Swagger UI, auto-generated by FastAPI at `http://localhost:8001/docs`) — against real `document_id`s that exist in the shared Supabase `documents` table. Aman will insert a few test rows early on so she isn't blocked waiting for the file-upload flow to be finished.
- **Once her endpoints work standalone, she sends Aman the project folder (zipped or via GitHub repo)**. Aman will `pip install -r requirements.txt` and run it locally on his machine (Mac) on port `8001`, exactly as she ran it. The main backend calls it at `http://localhost:8001` via `AI_SERVICE_BASE_URL` in its own `.env` — this must not be hardcoded anywhere in her code.
- **Hard rule: do not hardcode ports, URLs, bucket names, or keys anywhere in code.** Everything comes from `.env` (`os.getenv(...)` / `python-dotenv`), so it runs identically on her machine and Aman's without code changes. This is the one thing that will cause "why doesn't it work on your laptop" issues if skipped.
- Final deployment (Render, containerized) happens later, together, once both services work locally end-to-end. Nobody needs to think about Docker/Render until then — build and test locally first.

---

## 5. Environment Variables

Each service needs its own `.env`. Never commit these.

### Main Backend `.env`
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_BUCKET_NAME=
AI_SERVICE_BASE_URL=          # e.g. http://localhost:8001 in dev
AI_SERVICE_API_KEY=            # sent as X-AI-Service-Key header on every call to the AI microservice
SUPABASE_JWT_SECRET=           # used to validate incoming JWTs from the frontend
```

### AI Microservice `.env` (Shatakshi)
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
S3_BUCKET_NAME=
AI_SERVICE_API_KEY=            # same value as main backend's — validate incoming X-AI-Service-Key header
GROQ_API_KEY_SUMMARIZATION=    # llama-3.3-70b-versatile
GROQ_API_KEY_STRUCTURED=       # llama-3.1-8b-instant
GROQ_API_KEY_RAG=              # llama-3.3-70b-versatile
GROQ_API_KEY_LIGHT=            # llama-3.1-8b-instant
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security — needed since the AI service writes on behalf of users without a user session. Keep it server-side only, never expose to frontend.

**Internal service auth:** the AI microservice isn't a public-facing service. Every request to it must include `X-AI-Service-Key: <AI_SERVICE_API_KEY>`; the AI service rejects requests missing/mismatching this header. This is intentionally simple (a shared secret, not OAuth/service accounts) — appropriate for this project's scope. The frontend never talks to the AI microservice directly; only the main backend does.

---

## 6. Database Schema (Supabase / Postgres)

All tables use `uuid` primary keys (`gen_random_uuid()`) and `timestamptz` for timestamps unless noted. `users` is managed automatically by Supabase Auth (`auth.users`) — referenced here as `user_id`.

### 6.1 Core File System

```sql
-- Folders (self-referencing for infinite nesting)
CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    name TEXT NOT NULL,
    parent_folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Documents (file metadata — points to CURRENT version)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL,              -- 'pdf', 'docx', 'pptx', 'image', 'txt'
    original_s3_key TEXT NOT NULL,        -- original uploaded file
    preview_pdf_s3_key TEXT,              -- normalized PDF (null if already PDF/image)
    is_ai_generated BOOLEAN DEFAULT FALSE,
    source_type TEXT,                     -- 'upload' | 'youtube_notes' | 'text_to_ppt' | 'ppt_to_notes'
    current_version INT DEFAULT 1,
    display_metadata JSONB DEFAULT '{}'::jsonb,  -- UI-only info: cover color, font, icon, etc.
                                                  -- e.g. {"cover_color": "#1a1a2e", "font": "Inter", "icon": "📘"}
                                                  -- used mainly for AI-generated notes (.md) so the
                                                  -- notebook UI can render a consistent "notebook" look
                                                  -- without a second file/table lookup
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Document versions (full version history)
CREATE TABLE document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    version_number INT NOT NULL,
    s3_key TEXT NOT NULL,
    file_size_bytes BIGINT,
    uploaded_by UUID REFERENCES auth.users(id) NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (document_id, version_number)
);
```

### 6.2 Tags (many-to-many)

```sql
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (user_id, name)
);

CREATE TABLE document_tags (
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, tag_id)
);
```

### 6.3 ~~Sharing~~ — removed

`shared_access` and all sharing-related tables/columns/endpoints have been removed for the MVP (Section 2.5). If sharing is added post-MVP, this section is where it would come back.

### 6.4 Favorites

```sql
CREATE TABLE favorites (
    user_id UUID REFERENCES auth.users(id),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, document_id)
);
```

### 6.5 Annotations

Annotations are tied to a specific **version** (`document_version_id`), not just the document — see Section 2.6 for why. `document_id` is kept as a denormalized convenience column so you don't always need a join through `document_versions` just to list "all annotations on this document across versions."

```sql
CREATE TABLE annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    document_version_id UUID REFERENCES document_versions(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    annotation_type TEXT NOT NULL DEFAULT 'highlight' CHECK (annotation_type IN ('highlight', 'sticky_note', 'comment')),
    page_number INT NOT NULL,
    x_coord FLOAT,
    y_coord FLOAT,
    width FLOAT,
    height FLOAT,
    content TEXT,                 -- comment/note text (null if pure highlight)
    color TEXT DEFAULT '#FFFF00',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 6.6 Activity Log

```sql
CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    action_type TEXT NOT NULL,     -- 'upload','delete','rename','restore_version','create_folder','edit_notes', etc.
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    metadata JSONB,                -- e.g. {"old_name": "x", "new_name": "y"}
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 6.7 AI / RAG Tables (used by Shatakshi's service)

```sql
-- Chunked + embedded document text for RAG
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(384),         -- 384 dims for all-MiniLM-L6-v2
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);

-- Chat sessions per document
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Async job tracking for AI tasks (YouTube->Notes, Text->PPT, PPT->Notes)
CREATE TABLE ai_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    job_type TEXT NOT NULL,        -- 'youtube_to_notes' | 'text_to_ppt' | 'ppt_to_notes'
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'done' | 'failed'
    input_payload JSONB,
    result_document_id UUID REFERENCES documents(id),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
```

### 6.8 Example JOIN Queries (for Shatakshi's DBMS submission)

```sql
-- All documents in a folder with latest version info and tags
SELECT d.filename, dv.version_number, dv.uploaded_at,
       STRING_AGG(t.name, ', ') AS tags
FROM documents d
JOIN document_versions dv ON dv.document_id = d.id AND dv.version_number = d.current_version
LEFT JOIN document_tags dt ON dt.document_id = d.id
LEFT JOIN tags t ON t.id = dt.tag_id
WHERE d.folder_id = '<folder_id>'
GROUP BY d.id, dv.version_number, dv.uploaded_at;

-- Most active users (activity count)
SELECT u.email, COUNT(*) AS actions
FROM activity_log al
JOIN auth.users u ON u.id = al.user_id
GROUP BY u.email
ORDER BY actions DESC;

-- Documents with the most versions (heavily-edited content)
SELECT d.filename, COUNT(dv.id) AS version_count
FROM documents d
JOIN document_versions dv ON dv.document_id = d.id
GROUP BY d.filename
ORDER BY version_count DESC;

-- Documents with the most annotations, per version
SELECT d.filename, dv.version_number, COUNT(a.id) AS annotation_count
FROM annotations a
JOIN document_versions dv ON dv.id = a.document_version_id
JOIN documents d ON d.id = a.document_id
GROUP BY d.filename, dv.version_number
ORDER BY annotation_count DESC;
```

A view + trigger to add for extra DBMS points:

```sql
CREATE VIEW document_summary AS
SELECT d.id, d.filename, d.file_type, d.current_version,
       dv.uploaded_at AS last_updated, u.email AS owner
FROM documents d
JOIN document_versions dv ON dv.document_id = d.id AND dv.version_number = d.current_version
JOIN auth.users u ON u.id = d.user_id;

CREATE OR REPLACE FUNCTION log_document_update() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activity_log (user_id, action_type, document_id, metadata)
    VALUES (NEW.user_id, 'update', NEW.id, jsonb_build_object('updated_at', NEW.updated_at));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_document_update
AFTER UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION log_document_update();
```

---

## 7. AI Microservice Contract (Shatakshi's scope)

This is the **only section Shatakshi needs** to build independently. She only needs read/write access to the tables in 6.7 (plus read access to `documents` and S3), and doesn't need to touch folders/versioning logic at all.

**Every endpoint below must validate an `X-AI-Service-Key` header** (Section 5) matching `AI_SERVICE_API_KEY` — reject with 401 if missing/wrong. This service is only ever called by the main backend, never directly by the frontend.

### 7.1 Responsibilities
- Chunk + embed documents into `document_chunks` **lazily**, i.e. only the first time a document actually needs it for an AI feature (Section 2.7) — never automatically on upload
- Serve RAG chat over a specific document
- Process YouTube → Notes, Text → PPT, and PPT → Notes jobs (via `ai_jobs` table)
- Render `.pptx` output using the fixed template system (Section 2.3) — Shatakshi's LLM calls only ever produce the structured JSON in Section 7.3; template/font/theme rendering is a separate, non-LLM step
- Write generated output files to S3 and create the corresponding `documents` row so they appear in the user's file system

### 7.2 Endpoints to build

```
POST /embed-document
  body: { document_id: uuid }
  → chunks the document's text, embeds each chunk, writes to document_chunks
  → returns { status: "done", chunk_count: N }

POST /chat
  body: { document_id: uuid, session_id: uuid | null, message: string }
  → embeds the message, does similarity search against document_chunks
    (WHERE document_id = :document_id), builds context, calls Groq
  → creates session if session_id is null
  → writes both user + assistant messages to chat_messages
  → returns { session_id, answer: string } (stream via SSE if time allows)

POST /jobs/youtube-to-notes
  body: { user_id: uuid, youtube_url: string, target_folder_id: uuid }
  → creates ai_jobs row (status=pending), processes async (background task)
  → on completion: generates Markdown notes, uploads to S3, creates documents row
    (source_type='youtube_notes', is_ai_generated=true), updates ai_jobs (status=done, result_document_id)
  → returns { job_id: uuid } immediately

POST /jobs/text-to-ppt
  body: { user_id: uuid, topic_or_text: string, target_folder_id: uuid,
          template: string, font: string, theme: string, slide_count: int | null }
  → generates a slide outline via Groq (structured JSON, Section 7.3 — content only, no styling),
    renders with python-pptx using the chosen template/font/theme, uploads .pptx +
    converted preview PDF to S3, creates documents row (display_metadata records the
    template/font/theme actually used)
  → returns { job_id: uuid }

POST /jobs/ppt-to-notes
  body: { user_id: uuid, source_document_id: uuid, target_folder_id: uuid }
  → reads source document's extracted text (from document_chunks or re-extracts),
    generates structured notes via Groq, uploads to S3, creates documents row
  → returns { job_id: uuid }

GET /jobs/{job_id}
  → returns { status, result_document_id | null, error_message | null }
  → this is a plain polling endpoint — the frontend calls it every few seconds until status
    is 'done' or 'failed'. Do not build a separate "keep-alive" endpoint or long-held request
    for this; polling is the correct MVP pattern (Section 9 in Locked Decisions has more on why).
```

**Error handling (all job types, especially YouTube → Notes):** if a transcript is unavailable/unretrievable, the video is invalid/too long, or any LLM/API call fails, mark the `ai_jobs` row `status = 'failed'` with a clear `error_message` (e.g. `"Transcript not available for this video."`) and stop — no retries-with-fallback logic needed for the MVP, a clean failure state is enough.

### 7.3 Expected JSON shape for the Text→PPT outline (internal, before rendering)

```json
{
  "title": "Presentation Title",
  "slides": [
    { "heading": "Slide 1 Title", "bullets": ["point 1", "point 2", "point 3"] },
    { "heading": "Slide 2 Title", "bullets": ["point 1", "point 2"] }
  ]
}
```

### 7.4 S3 write paths (Section 8 has full bucket structure)
- Generated PPTX → `s3://<bucket>/users/{user_id}/generated/{document_id}/output.pptx`
- Generated PPTX preview PDF → `.../output_preview.pdf`
- Generated notes → `.../output.md` (decision locked: notes are always `.md`, not PDF — see 7.4.1)

#### 7.4.1 Notes format — locked decision
YouTube→Notes and PPT→Notes both output **plain Markdown (`.md`)**, not PDF. Reasons this matters for Shatakshi's code:
- `document_type` for these should be set to `'md'` (not `'pdf'`) when creating the `documents` row.
- Do **not** run these through the LibreOffice PDF conversion step — that's only for uploaded DOCX/PPTX files, not AI-generated Markdown. The frontend renders `.md` natively with a Markdown renderer, not pdf.js.
- All visual "notebook" styling (cover color, font, icon) is **not** part of the `.md` file itself — it's stored separately in `documents.display_metadata` (see schema, Section 6.1). So her job is just: write clean Markdown content + pick reasonable default `display_metadata` values (e.g. a color based on subject/topic if she wants to be fancy, or just a sensible static default) and pass both when creating the `documents` row. The frontend/notebook UI handles rendering that metadata into an actual look — she does not need to build any UI for this.

### 7.5 Groq model allocation (use separate API keys per task to spread rate limits)

| Task | Model | Key |
|---|---|---|
| YouTube → Notes (summarization) | `llama-3.3-70b-versatile` | `GROQ_API_KEY_SUMMARIZATION` |
| Text → PPT outline (structured JSON) | `llama-3.1-8b-instant` | `GROQ_API_KEY_STRUCTURED` |
| RAG chat | `llama-3.3-70b-versatile` | `GROQ_API_KEY_RAG` |
| PPT → Notes | `llama-3.1-8b-instant` | `GROQ_API_KEY_LIGHT` |

Add retry-with-backoff around every Groq call (rate limits on free tier are tight). If Groq fails after retries, consider a fallback provider (Gemini free tier / OpenRouter) — optional, nice-to-have.

### 7.6 Embeddings
Groq does not serve embedding models. Use `sentence-transformers` (`all-MiniLM-L6-v2`, 384-dim, free, runs locally in the service) for both document chunk embeddings and query embeddings — must use the *same* model for both sides of the similarity search.

### 7.7 Exact fields when creating a `documents` row (for all 3 job types)

This is the one place a lot of confusion usually happens — copy this exactly:

```json
{
  "user_id": "<from request>",
  "folder_id": "<target_folder_id from request>",
  "filename": "<generated, e.g. 'My Video Notes.md' or 'Topic Outline.pptx'>",
  "file_type": "md",              // or "pptx" for Text→PPT
  "original_s3_key": "users/{user_id}/generated/{document_id}/output.md",  // or output.pptx
  "preview_pdf_s3_key": null,      // null for .md; set for .pptx (points to output_preview.pdf)
  "is_ai_generated": true,
  "source_type": "youtube_notes",  // or "text_to_ppt" / "ppt_to_notes"
  "current_version": 1,
  "display_metadata": {"cover_color": "#1a1a2e", "font": "Inter", "icon": "📘"}
}
```

Also insert a matching row in `document_versions` (version_number=1, s3_key = same as original_s3_key, uploaded_by = user_id) — every document needs at least one version row, no exceptions, or the main app's "current version" queries will break.

---

## 8. S3 Bucket Structure

```
<bucket-name>/
├── users/
│   └── {user_id}/
│       ├── uploads/
│       │   └── {document_id}/
│       │       ├── v1/
│       │       │   ├── original.<ext>
│       │       │   └── preview.pdf          # only if original wasn't already PDF/image
│       │       ├── v2/
│       │       │   └── ...
│       │       └── ...
│       └── generated/
│           └── {document_id}/
│               ├── output.<ext>              # e.g. output.pptx
│               └── output_preview.pdf
```

Notes:
- Keying by `{document_id}/v{n}/` lines up directly with `document_versions.s3_key` — no separate naming scheme to keep in sync.
- Bucket can stay public for this project (scoped to reduce IAM/policy overhead during the weekend build) — if made public, restrict public read access to the `users/*` prefix only via bucket policy, not full-bucket public access.
- `file_type`/extension is stored in the `documents` table, so S3 keys don't need to encode type beyond the actual file extension.

---

## 9. What Shatakshi Needs To Do (Summary)

1. **Get 3 things from Aman first** (shared once, outside this repo, not committed): Supabase URL + service role key, AWS S3 credentials, and confirmation that the tables in Section 6.7 exist (she can run the `CREATE EXTENSION vector` + table SQL herself if Aman hasn't yet — same shared DB either way).
2. **Build her own standalone FastAPI project** — separate folder/repo, own `requirements.txt`, own `.env` (see Section 5), runnable with just `uvicorn main:app --reload --port 8001`. It must NOT import or depend on any of Aman's backend code.
3. **Build the 5 endpoints in Section 7.2**, following the request/response shapes exactly (Section 7.7 has the exact field list for creating `documents` rows — follow it precisely, this is the main integration point). Every endpoint checks the `X-AI-Service-Key` header (Section 5/7).
4. Use 4 separate Groq API keys per Section 7.5 for task-appropriate models and rate-limit spreading. Keep LLM output limited to content only (Section 7.3's JSON shape) — template/font/theme rendering for PPTX is a separate non-LLM step (Section 2.3).
5. **Test entirely standalone** — Postman, curl, or FastAPI's auto Swagger docs at `http://localhost:8001/docs` — against real `document_id`s in the shared Supabase. Aman will seed a few test rows early so she isn't blocked on the file-upload flow being done. She never needs to run the main backend, frontend, or talk to Aman mid-build.
6. **Once it works locally on her machine, send Aman the project** (zip or GitHub repo link). He'll `pip install -r requirements.txt` and run it locally on his Mac on port 8001 — same command, same `.env` keys, should just work if no ports/URLs/keys were hardcoded (see Section 4.1, this is the one rule that matters most).
7. No need to touch: folders, tags, favorites, activity log, annotations, versioning logic, auth — all of that lives in the main backend, not her scope at all. Sharing doesn't exist in this app (Section 2.5) — nothing to build there either.

---

## 10. Locked Decisions

- **Sharing:** Removed entirely for the MVP. Single-user app, no `shared_access` table, no permissions. See Section 2.5.
- **Auth:** Supabase Auth handles everything (signup/login/session/refresh); FastAPI only validates JWTs. No custom auth/refresh system. See Section 2.8.
- **AI trigger:** Never automatic. Embedding/LLM calls only happen when the user explicitly clicks an AI action; RAG embedding happens lazily on first use, not on upload. See Section 2.7.
- **File conversion for AI:** DOCX/PPTX/XLSX are normalized to PDF for the viewer (original kept for download); AI text extraction can use that same normalized PDF, so no separate per-format extraction pipeline is needed for the MVP unless a real limitation shows up.
- **AI jobs / waiting for results:** Plain async job pattern (`ai_jobs` table) + frontend polling `GET /jobs/{job_id}` every few seconds. No Celery/Redis/Kafka, and no endpoint whose purpose is just "keep the server alive" — polling is the correct MVP pattern and doubles as the fix for Render's cold-start behavior (the polling request itself wakes the service if it's asleep).
- **Versioning:** Only explicit "Replace File" creates a new version — not incidental same-name uploads. Editable AI notes create a new version per meaningful save. Annotations are tied to a specific version. AI-generated documents are fully independent of their source once created. See Section 2.6.
- **PPT templates:** Fixed set of 4-6 templates; AI only ever outputs structured content JSON (Section 7.3), never styling — a separate renderer applies template/font/theme. See Section 2.3.
- **Canva:** Nice-to-have only, never a blocker — investigate simple import options only; skip entirely if it needs OAuth/paid APIs/real backend work. See Section 2.3.
- **AI service auth:** Shared internal secret (`X-AI-Service-Key` header) between main backend and AI microservice — no OAuth/service-account complexity. Frontend never calls the AI service directly. See Section 5 and 7.
- **Hosting:** Dev/testing happens entirely locally for both backend and AI microservice (Aman runs both on his Mac — see Section 4.1). Final deployment is **containerized (Docker) → Render free tier** for both main backend and AI microservice, and **Netlify** for frontend. EC2 is *not* used for final hosting — disposable/dev-only if used at all, since keeping it running for a year isn't practical. Render's free tier cold-starts after ~15 min idle (30-50s wake time); acceptable for a portfolio project, and Supabase free tier stays alive as long as it gets occasional traffic (any visit to the live link resets its idle timer).
- **Notes format:** Always `.md` (Markdown), never PDF. Visual styling (cover color, font, icon) lives in `documents.display_metadata` (JSONB), not in the file itself — see Section 7.4.1 and 7.7.
- **Sync strategy:** Notes/annotation edits are kept in-memory client-side and synced to the backend every ~60-90 seconds (only if there are unsaved changes) plus once on tab close/blur. File uploads remain immediate/one-shot (not batched).
- **MVP scope guardrails:** No Redis/Celery, no real-time collaboration, no enterprise permissions, no full document editor, no complicated Canva integration, no unnecessary AI calls. See Section 2.9.

## 11. Remaining Open Decisions / TBD
- [ ] Streaming vs non-streaming for `/chat` endpoint (nice-to-have, not blocking)
- [ ] Whether annotations sync in real-time (Supabase Realtime) or on save only (default to the same 60-90s batched sync as notes unless time allows for Realtime)
