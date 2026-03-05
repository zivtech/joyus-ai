/**
 * Zod schemas for session context management — T003
 *
 * Single source of truth: schemas define structure, TypeScript types
 * are inferred via z.infer. Mirrors data-model.md exactly.
 */

import { z } from 'zod';

// --- Enums ---

export const EventTypeSchema = z.enum([
  'commit',
  'branch-switch',
  'test-run',
  'canonical-update',
  'session-start',
  'session-end',
  'manual',
  'file-change',
  'compaction',
  'share',
]);

// --- Sub-entity schemas ---

export const ProjectContextSchema = z.object({
  rootPath: z.string(),
  hash: z.string(),
  name: z.string(),
});

export const AheadBehindSchema = z.object({
  ahead: z.number().int().min(0),
  behind: z.number().int().min(0),
});

export const GitStateSchema = z.object({
  branch: z.string(),
  commitHash: z.string(),
  commitMessage: z.string(),
  isDetached: z.boolean(),
  hasUncommittedChanges: z.boolean(),
  remoteBranch: z.string().nullable(),
  aheadBehind: AheadBehindSchema,
});

export const FileStateSchema = z.object({
  staged: z.array(z.string()),
  unstaged: z.array(z.string()),
  untracked: z.array(z.string()),
});

export const TaskContextSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  url: z.string().nullable(),
});

export const TestResultsSchema = z.object({
  runner: z.string(),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failingTests: z.array(z.string()).max(20),
  duration: z.number().min(0),
  command: z.string(),
});

export const DecisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string(),
  options: z.array(z.string()),
  answer: z.string().nullable(),
  resolved: z.boolean(),
  timestamp: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});

export const CanonicalStatusSchema = z.object({
  name: z.string(),
  canonicalPath: z.string(),
  exists: z.boolean(),
  lastModified: z.string().datetime().nullable(),
  branchOverride: z.string().nullable(),
});

export const SharerNoteSchema = z.object({
  from: z.string(),
  note: z.string(),
  sharedAt: z.string().datetime(),
});

// --- Snapshot schema ---

export const SnapshotSchema = z.object({
  id: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
  event: EventTypeSchema,
  project: ProjectContextSchema,
  git: GitStateSchema,
  files: FileStateSchema,
  task: TaskContextSchema.nullable(),
  tests: TestResultsSchema.nullable(),
  decisions: z.array(DecisionSchema),
  canonical: z.array(CanonicalStatusSchema),
  sharer: SharerNoteSchema.nullable(),
});

// --- Configuration schemas ---

export const EventTriggerConfigSchema = z.object({
  commit: z.boolean().default(true),
  branchSwitch: z.boolean().default(true),
  testRun: z.boolean().default(true),
  canonicalUpdate: z.boolean().default(true),
  sessionEnd: z.boolean().default(true),
});

export const CustomTriggerSchema = z.object({
  pattern: z.string().min(1),
  event: z.string().min(1),
});

export const GlobalConfigSchema = z.object({
  retentionDays: z.number().int().positive().default(7),
  retentionMaxBytes: z.number().int().positive().default(52_428_800),
  autoRestore: z.boolean().default(true),
  verbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
});

export const ProjectConfigSchema = z.object({
  eventTriggers: EventTriggerConfigSchema.default({}),
  customTriggers: z.array(CustomTriggerSchema).default([]),
  periodicIntervalMinutes: z.number().int().positive().default(15),
});

// --- Canonical declaration schema ---

export const CanonicalDocumentSchema = z.object({
  default: z.string(),
  branches: z.record(z.string()).optional(),
});

export const CanonicalDeclarationSchema = z.object({
  documents: z.record(CanonicalDocumentSchema).default({}),
});
