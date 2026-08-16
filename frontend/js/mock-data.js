// ============================================================
// MOCK DATA — mirrors the Supabase schema (documents, folders,
// document_versions, tags, ai_jobs) so the frontend is fully
// demoable before the real backend/AI service exist.
// Swap MOCK_MODE to false in api.js once the backend is live —
// nothing else in the app needs to change.
// ============================================================

const now = () => new Date().toISOString();
const uid = () => 'id-' + Math.random().toString(36).slice(2, 10);

export const mockUser = { id: 'u-1', email: 'aman@studyforge.dev', name: 'Aman' };

export const mockFolders = [
  { id: 'f-root-1', user_id: 'u-1', name: 'Semester 7', parent_folder_id: null, created_at: now() },
  { id: 'f-root-2', user_id: 'u-1', name: 'BITS — Data Science & AI', parent_folder_id: null, created_at: now() },
  { id: 'f-root-3', user_id: 'u-1', name: 'Research Papers', parent_folder_id: null, created_at: now() },
  { id: 'f-child-1', user_id: 'u-1', name: 'Machine Learning', parent_folder_id: 'f-root-1', created_at: now() },
  { id: 'f-child-2', user_id: 'u-1', name: 'Distributed Systems', parent_folder_id: 'f-root-1', created_at: now() },
  { id: 'f-child-3', user_id: 'u-1', name: 'Assignments', parent_folder_id: 'f-child-1', created_at: now() },
];

export const mockTags = [
  { id: 't-1', user_id: 'u-1', name: 'exam-prep' },
  { id: 't-2', user_id: 'u-1', name: 'urgent' },
  { id: 't-3', user_id: 'u-1', name: 'reference' },
];

export const mockDocuments = [
  {
    id: 'd-1', user_id: 'u-1', folder_id: 'f-child-1', filename: 'Gradient Descent — Lecture Notes.pdf',
    file_type: 'pdf', original_s3_key: 'users/u-1/uploads/d-1/v1/original.pdf', preview_pdf_s3_key: null,
    is_ai_generated: false, source_type: 'upload', current_version: 1, display_metadata: {},
    file_size_bytes: 2_400_000, created_at: now(), updated_at: now(), favorite: true, tags: ['t-1'],
  },
  {
    id: 'd-2', user_id: 'u-1', folder_id: 'f-child-1', filename: 'Neural Networks Overview.pptx',
    file_type: 'pptx', original_s3_key: 'users/u-1/uploads/d-2/v1/original.pptx', preview_pdf_s3_key: 'users/u-1/uploads/d-2/v1/preview.pdf',
    is_ai_generated: false, source_type: 'upload', current_version: 1, display_metadata: {},
    file_size_bytes: 5_100_000, created_at: now(), updated_at: now(), favorite: false, tags: [],
  },
  {
    id: 'd-3', user_id: 'u-1', folder_id: 'f-child-1', filename: 'Backpropagation Notes.md',
    file_type: 'md', original_s3_key: 'users/u-1/generated/d-3/output.md', preview_pdf_s3_key: null,
    is_ai_generated: true, source_type: 'ppt_to_notes', current_version: 2, favorite: false, tags: ['t-3'],
    display_metadata: { cover_color: '#6C5CE7', font: 'Source Serif 4', icon: '🧠' },
    file_size_bytes: 18_000, created_at: now(), updated_at: now(),
  },
  {
    id: 'd-4', user_id: 'u-1', folder_id: 'f-root-3', filename: 'Attention Is All You Need.pdf',
    file_type: 'pdf', original_s3_key: 'users/u-1/uploads/d-4/v1/original.pdf', preview_pdf_s3_key: null,
    is_ai_generated: false, source_type: 'upload', current_version: 1, display_metadata: {},
    file_size_bytes: 3_900_000, created_at: now(), updated_at: now(), favorite: true, tags: ['t-1', 't-2'],
  },
  {
    id: 'd-5', user_id: 'u-1', folder_id: 'f-root-3', filename: 'Transformer Architecture — Video Notes.md',
    file_type: 'md', original_s3_key: 'users/u-1/generated/d-5/output.md', preview_pdf_s3_key: null,
    is_ai_generated: true, source_type: 'youtube_notes', current_version: 1, favorite: false, tags: [],
    display_metadata: { cover_color: '#2678C9', font: 'Source Serif 4', icon: '🎬' },
    file_size_bytes: 9_400, created_at: now(), updated_at: now(),
  },
  {
    id: 'd-6', user_id: 'u-1', folder_id: 'f-child-2', filename: 'CAP Theorem — Reading.pdf',
    file_type: 'pdf', original_s3_key: 'users/u-1/uploads/d-6/v1/original.pdf', preview_pdf_s3_key: null,
    is_ai_generated: false, source_type: 'upload', current_version: 1, display_metadata: {},
    file_size_bytes: 1_100_000, created_at: now(), updated_at: now(), favorite: false, tags: [],
  },
];

export const mockNotesContent = {
  'd-3': `# Backpropagation\n\n## What it does\n\nBackpropagation computes the gradient of the loss function with respect to every weight in a network, by applying the chain rule layer by layer, backwards from the output.\n\n## Why it matters\n\n- Makes training deep networks computationally feasible\n- Reuses intermediate gradients instead of recomputing from scratch per weight\n- Underpins virtually every modern deep learning framework\n\n## The core idea\n\n1. **Forward pass** — compute activations layer by layer, cache them\n2. **Compute loss** — compare prediction to target\n3. **Backward pass** — propagate the error gradient from output to input, layer by layer\n4. **Update weights** — apply gradient descent (or a variant) using the computed gradients\n\n> The chain rule is doing all the real work here — backprop is just a systematic, cache-friendly way of applying it across a computation graph.\n\n## Common pitfalls\n\n- Vanishing gradients in deep nets with saturating activations (sigmoid/tanh)\n- Exploding gradients without proper initialization or clipping\n- Forgetting to zero gradients between batches (common PyTorch bug)\n`,
  'd-5': `# Transformer Architecture\n\n*Auto-generated from a YouTube lecture*\n\n## Key ideas\n\n- Self-attention lets every token attend to every other token directly, no recurrence needed\n- Positional encodings inject sequence order since attention itself is order-agnostic\n- Multi-head attention lets the model attend to different representation subspaces at once\n\n## Architecture at a glance\n\n1. Input embeddings + positional encoding\n2. Stack of encoder blocks (self-attention + feed-forward)\n3. Stack of decoder blocks (masked self-attention + cross-attention + feed-forward)\n4. Final linear + softmax for output probabilities\n\n## Why it replaced RNNs\n\nRNNs process sequentially, which is slow and struggles with long-range dependencies. Transformers process the whole sequence in parallel and attention gives direct paths between any two positions, regardless of distance.\n`,
};

export const templates = [
  { id: 'minimal', label: 'Minimal / Academic', colors: ['#2B2B33', '#8A8A96', '#E4E2DC'] },
  { id: 'modern', label: 'Modern / Clean', colors: ['#6C5CE7', '#EDEBFF', '#1A1A1F'] },
  { id: 'dark', label: 'Dark / Premium', colors: ['#14141A', '#6C5CE7', '#C7C7D1'] },
  { id: 'colorful', label: 'Colorful / Creative', colors: ['#F0824C', '#2678C9', '#1BA672'] },
  { id: 'corporate', label: 'Corporate', colors: ['#1F3A5F', '#C9A227', '#F3F2EF'] },
  { id: 'study', label: 'Notes / Study-focused', colors: ['#FBF9F4', '#C9820A', '#3F3F47'] },
];

export function makeJob(type, payload) {
  return { id: uid(), user_id: 'u-1', job_type: type, status: 'pending', input_payload: payload, result_document_id: null, error_message: null, created_at: now(), completed_at: null };
}

export { uid, now };
