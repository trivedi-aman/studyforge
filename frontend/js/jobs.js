// ============================================================
// JOBS — polls ai_jobs status until done/failed. This is the
// ONLY waiting mechanism for async AI work (README Section 7/9) —
// no long-held requests, no keep-alive endpoints.
// ============================================================

import { AI } from './api.js';

export function pollJob(jobId, onUpdate, intervalMs = 2000) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const job = await AI.jobStatus(jobId);
      onUpdate(job);
      if (job.status === 'done' || job.status === 'failed') { stopped = true; return; }
    } catch (e) {
      onUpdate({ status: 'failed', error_message: 'Lost connection to the job — try again.' });
      stopped = true;
      return;
    }
    setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}
