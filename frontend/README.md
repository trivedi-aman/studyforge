# Studyforge — Frontend

Vanilla HTML/CSS/JS (ES modules, no framework, no build step) — matches the main project README's tech stack decision.

## Running it locally

ES modules are blocked by CORS if you just double-click `index.html` (the `file://` protocol won't let `import` statements resolve). You need a tiny local server — pick one:

```bash
# Python (already on most machines)
cd frontend
python3 -m http.server 5500

# or Node, if you have it
npx serve .
```

Then open `http://localhost:5500`. Any signup/login "works" immediately — it's mock auth, no real backend needed yet (see below).

## What's real vs. mock right now

The whole app is fully wired against the API contract in the main project README — every function in `js/api.js` matches the real endpoint shapes exactly. But since the backend/AI microservice don't exist yet, `MOCK_MODE = true` at the top of `js/api.js` routes everything to in-memory mock data (`js/mock-data.js`) instead of real HTTP calls, with simulated network latency so loading states are visible.

**To connect the real backend once it's running:** open `js/api.js` and:
1. Set `MOCK_MODE = false`
2. Set `MAIN_BACKEND_URL` to wherever FastAPI is running (defaults to `http://localhost:8000`, matches the main README's local dev setup)
3. Set `S3_PUBLIC_BASE_URL` to the real bucket URL

Nothing else in the app needs to change — every UI module calls into `api.js`, never `fetch` directly.

One exception: PDF preview currently renders a **generated placeholder PDF** (via jsPDF) instead of a real file, since there's no backend yet to serve one. Once `MOCK_MODE = false`, `loadPdfUrl()` in `js/viewer.js` automatically switches to fetching the real file from S3 — no other viewer code needs to change, since PDF.js just takes a URL either way.

## Project structure

```
frontend/
├── index.html              — entry point, loads fonts + CDN libs + js/main.js
├── css/
│   ├── tokens.css           — design tokens (colors, type, spacing, radius, shadow)
│   ├── base.css              — reset + global typography
│   ├── layout.css            — app shell (rail, sidebar, topbar, main, AI panel)
│   ├── components.css        — buttons, inputs, file grid/list, modals, toasts, tree
│   ├── auth.css               — login/signup screen
│   ├── viewer.css             — PDF viewer, annotations, notebook/markdown view
│   └── ai-panel.css           — AI Magic slide-in panel
└── js/
    ├── main.js                — bootstrap: session check → auth screen or workspace
    ├── state.js                — tiny observable store (no framework)
    ├── bus.js                   — window CustomEvent wrapper, decouples modules
    ├── api.js                   — API client; mirrors the backend contract exactly
    ├── mock-data.js              — in-memory mock dataset (mirrors the Supabase schema)
    ├── icons.js                   — shared inline SVG icon set
    ├── ui-helpers.js               — modal/context-menu/formatting helpers
    ├── toast.js                     — notification stack
    ├── auth.js                       — login/signup screen logic
    ├── sidebar.js                     — icon rail + nested folder tree
    ├── filegrid.js                     — main canvas: breadcrumbs, file/folder grid+list
    ├── viewer.js                        — PDF viewer (pages, zoom, search, annotations)
    ├── markdown-viewer.js                 — notebook view for AI-generated .md notes
    ├── ai-panel.js                          — AI Magic panel: chat/summarize/explain/generate
    ├── jobs.js                                — polls ai_jobs status (README's locked pattern)
    └── modals.js                               — YouTube→Notes / Text→PPT standalone flows
```

## Design system notes

- **Ink chrome (dark) + paper canvas (warm, light)** — the sidebar/rail/topbar-adjacent chrome stays dark and quiet; the actual reading/notebook surface is a warm paper tone, closer to GoodNotes than a typical dark-mode app.
- **One accent (violet), reserved for AI** — every AI-related affordance (the "AI Magic" button, chat bubbles, AI badges on generated files) uses the accent; nothing else does, so it stays meaningful.
- **Three type roles** — Sora for UI chrome/headings, Inter for dense lists/forms, Source Serif 4 for the notebook/reading canvas specifically, JetBrains Mono for metadata (sizes, timestamps, job status).
- **AI is never automatic** — matches the README's locked decision (Section 2.7). The AI panel only ever opens on an explicit click; embedding only happens lazily on first real AI use per document (tracked in `ai-panel.js`'s `embeddedDocs` set, standing in for the real backend's lazy-embed check).

## Known simplifications (intentional, for a weekend-scope MVP)

- Annotation highlight rectangles use a single bounding box per selection (not multi-line-aware rects) — fine for the demo, a real implementation could split by line using `range.getClientRects()`.
- In-document search matches at the page level (does it contain the term), not exact in-page highlight — good enough to demo "search works," a fuller version would highlight exact matches.
- `htmlToMarkdownApprox()` in `markdown-viewer.js` is a best-effort HTML→Markdown converter for saving edited notes, not a full round-trip parser — fine for headings/bold/italic/lists/links, which is what the AI actually generates.
