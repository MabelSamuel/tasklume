import { config as env } from '../lib/config';

// Feature config derived from the validated env in lib/config
export const config = {
  capture: {
    // Parses at or above this confidence skip review when the user opted in
    autoConfirmMinConfidence: env.CAPTURE_AUTO_CONFIRM_MIN_CONFIDENCE,
    // Up to this many tasks may come out of one capture ("call Ana and email Bo")
    maxTasksPerCapture: 5,
    draftTtlDays: 7,
  },
  categorize: {
    minConfidence: env.CATEGORIZE_MIN_CONFIDENCE,
  },
  prioritize: {
    // Only the top-N by heuristic score go to the LLM, to bound tokens
    maxTasks: 40,
  },
  digests: {
    enabled: env.DIGESTS_ENABLED,
    // "At risk" = not done and due within this window
    atRiskHours: 48,
  },
};
