/**
 * joyus-ai-state — Package exports
 *
 * Re-exports core types, schemas, and config for consumers.
 */

// --- Core types (session context) ---
export type {
  EventType,
  ProjectContext,
  AheadBehind,
  GitState,
  FileState,
  TaskContext,
  TestResults,
  Decision,
  CanonicalStatus,
  SharerNote,
  Snapshot,
  GlobalConfig,
  ProjectConfig,
  EventTriggerConfig,
  CanonicalDeclaration,
  CanonicalDocument,
} from './core/types.js';

// --- Zod schemas (session context) ---
export {
  EventTypeSchema,
  ProjectContextSchema,
  AheadBehindSchema,
  GitStateSchema,
  FileStateSchema,
  TaskContextSchema,
  TestResultsSchema,
  DecisionSchema,
  CanonicalStatusSchema,
  SharerNoteSchema,
  SnapshotSchema,
  GlobalConfigSchema,
  ProjectConfigSchema,
  EventTriggerConfigSchema,
  CanonicalDeclarationSchema,
  CanonicalDocumentSchema,
} from './core/schema.js';

// --- Configuration ---
export {
  DEFAULT_GLOBAL_CONFIG,
  DEFAULT_PROJECT_CONFIG,
  loadGlobalConfig,
  loadProjectConfig,
  loadConfig,
} from './core/config.js';

// --- State store ---
export {
  StateStore,
  getProjectHash,
  getStateDir,
  getSnapshotsDir,
  initStateDirectory,
} from './state/store.js';
export type { SnapshotFilter, SnapshotSummary } from './state/store.js';

// --- Divergence detection ---
export { detectDivergence } from './state/divergence.js';
export type { DivergenceReport, DivergenceChange } from './state/divergence.js';

// --- Collectors ---
export { collectGitState } from './collectors/git.js';
export { collectFileState } from './collectors/files.js';
export { parseTestResults } from './collectors/tests.js';
export { carryForwardDecisions } from './collectors/decisions.js';
