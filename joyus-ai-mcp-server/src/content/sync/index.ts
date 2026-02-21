/**
 * Content Infrastructure — Sync Module Barrel
 *
 * Re-exports the public surface of the sync sub-package.
 */

// Engine
export { SyncEngine, triggerSync } from './engine.js';

// Scheduler
export { initializeSyncScheduler, stopSyncScheduler } from './scheduler.js';

// State helpers
export {
  createSyncRun,
  updateSyncRun,
  completeSyncRun,
  failSyncRun,
  getLatestSyncRun,
  getSyncRunById,
  detectStaleContent,
  detectStaleSources,
} from './state.js';
export type { SyncRunStats } from './state.js';
