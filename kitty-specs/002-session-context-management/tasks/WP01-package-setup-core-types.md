---
work_package_id: WP01
title: Package Setup & Core Types
lane: planned
dependencies: []
subtasks:
- T001
- T002
- T003
- T004
phase: Phase 1 - Foundation
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-02-17T03:14:10Z'
  lane: planned
  agent: system
  shell_pid: ''
  action: Prompt generated via /spec-kitty.tasks (MCP-first architecture)
---

# Work Package Prompt: WP01 -- Package Setup & Core Types

## IMPORTANT: Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.
- **Mark as acknowledged**: When you understand the feedback and begin addressing it, update `review_status: acknowledged` in the frontmatter.

---

## Review Feedback

> **Populated by `/spec-kitty.review`**

*[This section is empty initially.]*

---

## Markdown Formatting
Wrap HTML/XML tags in backticks: `` `<div>` ``, `` `<script>` ``
Use language identifiers in code blocks: ````python`, ````bash`

---

## Objectives & Success Criteria

- Create the `jawn-ai-state` package with TypeScript 5.3+ / Node.js 20+ toolchain
- Define all core types from the data model (Snapshot, EventType, GitState, FileState, etc.)
- Create Zod schemas that validate snapshot JSON files
- Implement configuration loading with global/project merging and sensible defaults
- **Done when**: Package compiles cleanly, types are importable, `SnapshotSchema.parse()` validates a sample snapshot, config loading returns merged defaults

## Context & Constraints

- **Data Model**: `kitty-specs/002-session-context-management/data-model.md` (authoritative for all entity definitions)
- **Plan**: `plan.md` — project structure under `jawn-ai-state/`
- **Contracts**: `contracts/state-api.md` — EventType enum values
- **Dependencies**: `@modelcontextprotocol/sdk` (MCP server, used later), `zod` (schema validation), `@paralleldrive/cuid2` (ID generation)
- **Testing**: Vitest (configured in this WP, tests written in WP09)
- **Storage paths**: `~/.jawn-ai/global-config.json` (global), `.jawn-ai/config.json` (project)

**Implementation command**: `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 -- Create package scaffolding

- **Purpose**: Set up the package directory, dependencies, TypeScript config, and build toolchain so all subsequent WPs can build on a working foundation.
- **Steps**:
  1. Create `jawn-ai-state/` directory at repo root
  2. Create `package.json`:
     ```json
     {
       "name": "jawn-ai-state",
       "version": "0.1.0",
       "type": "module",
       "main": "dist/index.js",
       "types": "dist/index.d.ts",
       "bin": {
         "jawn-ai-mcp": "./bin/jawn-ai-mcp",
         "jawn-ai-service": "./bin/jawn-ai-service"
       },
       "scripts": {
         "build": "tsc",
         "dev": "tsc --watch",
         "test": "vitest",
         "test:run": "vitest run"
       }
     }
     ```
  3. Install dependencies:
     - Production: `zod`, `@modelcontextprotocol/sdk`, `@paralleldrive/cuid2`
     - Dev: `typescript`, `vitest`, `@types/node`
  4. Create `tsconfig.json`:
     ```json
     {
       "compilerOptions": {
         "target": "ES2022",
         "module": "NodeNext",
         "moduleResolution": "NodeNext",
         "outDir": "dist",
         "rootDir": "src",
         "declaration": true,
         "strict": true,
         "esModuleInterop": true,
         "skipLibCheck": true
       },
       "include": ["src/**/*"]
     }
     ```
  5. Create `vitest.config.ts` with default configuration
  6. Create directory structure:
     ```
     src/
     ├── index.ts           # Package exports
     ├── core/              # Types, schemas, config
     ├── state/             # Store, canonical, share, divergence
     ├── collectors/        # Git, files, tests, decisions
     ├── mcp/               # MCP server + tools (WP06-07)
     │   └── tools/
     └── service/           # Companion service (WP08)
     ```
  7. Create stub `bin/jawn-ai-mcp` and `bin/jawn-ai-service` entry points:
     ```bash
     #!/usr/bin/env node
     // Stub — implemented in WP06/WP08
     ```
  8. Verify `npm run build` succeeds with empty `src/index.ts`

- **Files**:
  - `jawn-ai-state/package.json` (new)
  - `jawn-ai-state/tsconfig.json` (new)
  - `jawn-ai-state/vitest.config.ts` (new)
  - `jawn-ai-state/src/index.ts` (new, stub)
  - `jawn-ai-state/bin/jawn-ai-mcp` (new, stub)
  - `jawn-ai-state/bin/jawn-ai-service` (new, stub)

- **Parallel?**: No -- must complete before T002-T004.

---

### Subtask T002 -- Define core TypeScript types

- **Purpose**: Create all the TypeScript type definitions from the data model. These are the shared language all modules use.
- **Steps**:
  1. Create `src/core/types.ts` with all types from `data-model.md`:
     ```typescript
     export type EventType =
       | 'commit' | 'branch-switch' | 'test-run' | 'canonical-update'
       | 'session-start' | 'session-end' | 'manual' | 'periodic'
       | 'share' | 'file-change' | 'compaction';

     export interface Snapshot {
       id: string;
       version: string;
       timestamp: string;
       event: EventType;
       project: ProjectContext;
       git: GitState;
       files: FileState;
       task: TaskContext | null;
       tests: TestResults | null;
       decisions: Decision[];
       canonical: CanonicalStatus[];
       sharer: SharerNote | null;
     }

     export interface ProjectContext { ... }
     export interface GitState { ... }
     export interface FileState { ... }
     export interface TaskContext { ... }
     export interface TestResults { ... }
     export interface Decision { ... }
     export interface CanonicalStatus { ... }
     export interface SharerNote { ... }
     ```
  2. Every field must match `data-model.md` exactly — names, types, nullability
  3. Add JSDoc comments for non-obvious fields
  4. Export all types from `src/index.ts`

- **Files**:
  - `jawn-ai-state/src/core/types.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- independent of T004 once T001 is done.

---

### Subtask T003 -- Create Zod validation schemas

- **Purpose**: Create Zod schemas that validate snapshot JSON files. Used for both write-time validation and read-time safety (corrupted files are caught early).
- **Steps**:
  1. Create `src/core/schema.ts` with Zod schemas mirroring every type:
     ```typescript
     import { z } from 'zod';

     export const EventTypeSchema = z.enum([
       'commit', 'branch-switch', 'test-run', 'canonical-update',
       'session-start', 'session-end', 'manual', 'periodic',
       'share', 'file-change', 'compaction'
     ]);

     export const ProjectContextSchema = z.object({
       rootPath: z.string(),
       hash: z.string(),
       name: z.string(),
     });

     export const GitStateSchema = z.object({ ... });
     export const FileStateSchema = z.object({ ... });
     // ... all sub-schemas

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
     ```
  2. Add size validation: `TestResults.failingTests` capped at 20 entries
  3. Add `SnapshotSchema.parse()` and `SnapshotSchema.safeParse()` for safe validation
  4. Export schemas from `src/index.ts`
  5. Consider: derive TypeScript types from Zod schemas (`z.infer<typeof SnapshotSchema>`) to be single source of truth — if so, update T002 types to use inference

- **Files**:
  - `jawn-ai-state/src/core/schema.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- depends on T002 types being defined (or replaces them via z.infer).
- **Notes**: Prefer Zod-first approach (define schemas, infer types) to prevent drift. If this approach is taken, `types.ts` becomes re-exports of inferred types rather than manual definitions.

---

### Subtask T004 -- Implement configuration loading

- **Purpose**: Load and merge configuration from global defaults, global config file, and project config file. All subsequent modules use this for settings.
- **Steps**:
  1. Create `src/core/config.ts`:
     ```typescript
     export interface GlobalConfig {
       retentionDays: number;        // default: 7
       retentionMaxBytes: number;    // default: 52428800 (50MB)
       autoRestore: boolean;         // default: true
       verbosity: 'minimal' | 'normal' | 'verbose'; // default: 'normal'
     }

     export interface ProjectConfig {
       eventTriggers: EventTriggerConfig;
       customTriggers: string[];     // default: []
       periodicIntervalMinutes: number; // default: 15
     }

     export interface EventTriggerConfig {
       commit: boolean;        // default: true
       branchSwitch: boolean;  // default: true
       testRun: boolean;       // default: true
       canonicalUpdate: boolean; // default: true
       sessionEnd: boolean;    // default: true
     }

     export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = { ... };
     export const DEFAULT_PROJECT_CONFIG: ProjectConfig = { ... };

     export async function loadGlobalConfig(): Promise<GlobalConfig>;
     export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig>;
     export async function loadConfig(projectRoot: string): Promise<{
       global: GlobalConfig;
       project: ProjectConfig;
     }>;
     ```
  2. `loadGlobalConfig()`: Read `~/.jawn-ai/global-config.json`. Return defaults if missing. Deep-merge found values over defaults.
  3. `loadProjectConfig()`: Read `.jawn-ai/config.json` in project root. Return defaults if missing. Deep-merge.
  4. `loadConfig()`: Load both, return merged result.
  5. Handle errors gracefully: if config file is corrupted JSON, log warning and return defaults.
  6. Export from `src/index.ts`

- **Files**:
  - `jawn-ai-state/src/core/config.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- independent of T002/T003 once T001 is done.
- **Notes**: Config merging should be shallow for top-level keys but deep for `eventTriggers` (individual trigger settings override, not replace the whole object).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Zod schema drift from data model | Use Zod-first approach: define schemas, infer types |
| MCP SDK version mismatch | Pin exact version. Verify import works at build time. |
| Config file corruption | Always fall back to defaults. Log warning. Never crash. |
| Package name conflicts | Check npm registry for `jawn-ai-state`. Use scoped name if needed. |

## Review Guidance

- Verify all types match `data-model.md` field-for-field
- Verify Zod schemas validate a hand-crafted sample snapshot
- Verify Zod schemas reject invalid data (wrong types, missing required fields)
- Verify config loading returns sensible defaults when no config files exist
- Verify config loading survives corrupted JSON gracefully
- Verify `npm run build` produces clean output with no TypeScript errors
- Verify all public types and functions are exported from `src/index.ts`

## Activity Log

- 2026-02-17T03:14:10Z -- system -- lane=planned -- Prompt created.
