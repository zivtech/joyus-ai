/**
 * Core TypeScript types for session context management — T002
 *
 * Inferred from Zod schemas (single source of truth) to prevent drift.
 * Re-exports inferred types for use throughout the codebase.
 */

import type { z } from 'zod';
import type {
  EventTypeSchema,
  ProjectContextSchema,
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
  AheadBehindSchema,
} from './schema.js';

// --- Core entity types (inferred from Zod schemas) ---

export type EventType = z.infer<typeof EventTypeSchema>;

export type ProjectContext = z.infer<typeof ProjectContextSchema>;

export type AheadBehind = z.infer<typeof AheadBehindSchema>;

export type GitState = z.infer<typeof GitStateSchema>;

export type FileState = z.infer<typeof FileStateSchema>;

export type TaskContext = z.infer<typeof TaskContextSchema>;

export type TestResults = z.infer<typeof TestResultsSchema>;

export type Decision = z.infer<typeof DecisionSchema>;

export type CanonicalStatus = z.infer<typeof CanonicalStatusSchema>;

export type SharerNote = z.infer<typeof SharerNoteSchema>;

export type Snapshot = z.infer<typeof SnapshotSchema>;

// --- Configuration types (inferred from Zod schemas) ---

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export type EventTriggerConfig = z.infer<typeof EventTriggerConfigSchema>;

export type CanonicalDeclaration = z.infer<typeof CanonicalDeclarationSchema>;

export type CanonicalDocument = z.infer<typeof CanonicalDocumentSchema>;
