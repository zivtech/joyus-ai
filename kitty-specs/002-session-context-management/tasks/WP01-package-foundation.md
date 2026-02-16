---
work_package_id: "WP01"
subtasks:
  - "T001"
  - "T002"
  - "T003"
  - "T004"
title: "Package Foundation & Core Types"
phase: "Phase 0 - Foundation"
lane: "planned"
assignee: ""
agent: ""
shell_pid: ""
review_status: ""
reviewed_by: ""
dependencies: []
history:
  - timestamp: "2026-02-16T19:42:12Z"
    lane: "planned"
    agent: "system"
    shell_pid: ""
    action: "Prompt generated via /spec-kitty.tasks"
---

# Work Package Prompt: WP01 -- Package Foundation & Core Types

## IMPORTANT: Review Feedback Status

**Read this first if you are implementing this task!**

- **Has review feedback?**: Check the `review_status` field above. If it says `has_feedback`, scroll to the **Review Feedback** section immediately.
- **You must address all feedback** before your work is complete.
- **Mark as acknowledged**: When you understand the feedback and begin addressing it, update `review_status: acknowledged` in the frontmatter.
- **Report progress**: As you address each feedback item, update the Activity Log.

---

## Review Feedback

> **Populated by `/spec-kitty.review`** -- Reviewers add detailed feedback here when work needs changes.

*[This section is empty initially.]*

---

## Markdown Formatting
Wrap HTML/XML tags in backticks: `` `<div>` ``, `` `<script>` ``
Use language identifiers in code blocks: ````python`, ````bash`

---

## Objectives & Success Criteria

- Initialize the `jawn-ai-state` TypeScript package at the repository root alongside the existing `jawn-ai-mcp-server/`
- Define all core TypeScript types from the data model (Snapshot, GitState, FileState, Decision, etc.)
- Create Zod schemas that validate snapshot JSON against the defined types
- Implement two-tier configuration loading (global defaults + project overrides)
- **Done when**: Package compiles cleanly, Zod schemas validate sample snapshots, config loads and merges defaults correctly

## Context & Constraints

- **Spec**: `kitty-specs/002-session-context-management/spec.md`
- **Plan**: `kitty-specs/002-session-context-management/plan.md` (see Project Structure for full directory tree)
- **Data Model**: `kitty-specs/002-session-context-management/data-model.md` (authoritative source for all types)
- **Research**: `kitty-specs/002-session-context-management/research.md` (R1: JSON format, R3: SHA256 project hash)
- **Toolchain**: TypeScript 5.3+, Node.js 20+, Vitest for testing, ESLint, Prettier
- **Existing reference**: Match the toolchain patterns used in `jawn-ai-mcp-server/` (check its `package.json` and `tsconfig.json` for conventions)
- **Schema version**: Include `version: "1.0.0"` in the snapshot schema from day 1 for forward compatibility (Research R1)
- **No dependencies on other WPs**: This is the foundation package

**Implementation command**: `spec-kitty implement WP01`

## Subtasks & Detailed Guidance

### Subtask T001 -- Initialize jawn-ai-state package

- **Purpose**: Create the package scaffold so all other WPs have a home.
- **Steps**:
  1. Create `jawn-ai-state/` directory at the repository root (alongside `jawn-ai-mcp-server/`)
  2. Initialize `package.json` with:
     - `name`: `jawn-ai-state`
     - `version`: `0.1.0`
     - `type`: `module`
     - `main`: `dist/index.js`
     - `types`: `dist/index.d.ts`
     - `bin`: `{ "jawn-ai": "./bin/jawn-ai" }`
     - Scripts: `build`, `dev`, `test`, `lint`
     - Dependencies: `zod`, `commander`, `@modelcontextprotocol/sdk`
     - Dev dependencies: `typescript`, `vitest`, `eslint`, `prettier`, `tsx`
  3. Create `tsconfig.json` matching the conventions of `jawn-ai-mcp-server/`:
     - `target`: `ES2022`
     - `module`: `NodeNext`
     - `moduleResolution`: `NodeNext`
     - `outDir`: `dist`
     - `rootDir`: `src`
     - `strict`: `true`
     - `declaration`: `true`
  4. Create the directory structure from the plan:
     ```
     jawn-ai-state/
     ├── src/
     │   ├── index.ts
     │   ├── core/
     │   ├── state/
     │   ├── collectors/
     │   ├── cli/
     │   │   └── commands/
     │   ├── mcp/
     │   │   └── tools/
     │   ├── adapters/
     │   └── hooks/
     │       └── templates/
     ├── tests/
     │   ├── unit/
     │   ├── integration/
     │   └── contract/
     └── bin/
     ```
  5. Create `src/index.ts` with placeholder exports
  6. Create `bin/jawn-ai` as a Node.js executable stub: `#!/usr/bin/env node` importing the CLI entry point
  7. Run `npm install` to generate `package-lock.json`
  8. Verify `npm run build` compiles cleanly (even if output is minimal)

- **Files**:
  - `jawn-ai-state/package.json` (new)
  - `jawn-ai-state/tsconfig.json` (new)
  - `jawn-ai-state/src/index.ts` (new)
  - `jawn-ai-state/bin/jawn-ai` (new)
  - All directories listed above (new)

- **Parallel?**: No -- must complete before T002-T004 can start.
- **Notes**: Check `jawn-ai-mcp-server/package.json` and `tsconfig.json` for exact version numbers and conventions to match. Add `jawn-ai-state/node_modules/` and `jawn-ai-state/dist/` to `.gitignore` if not already covered by root patterns.

---

### Subtask T002 -- Define core TypeScript types

- **Purpose**: Establish the type system that all other WPs build on. These types are the source of truth for the entire package.
- **Steps**:
  1. Create `src/core/types.ts` with all types from `data-model.md`:
     - `EventType` union type: `"commit" | "branch-switch" | "test-run" | "canonical-update" | "session-start" | "session-end" | "manual" | "periodic" | "share"`
     - `ProjectContext` interface: `rootPath`, `hash`, `name`
     - `GitState` interface: `branch`, `commitHash`, `commitMessage`, `isDetached`, `hasUncommittedChanges`, `remoteBranch`, `aheadBehind`
     - `FileState` interface: `staged`, `unstaged`, `untracked` (all `string[]`)
     - `TaskContext` interface: `id`, `title`, `source`, `url`
     - `TestResults` interface: `runner`, `passed`, `failed`, `skipped`, `failingTests`, `duration`, `command`
     - `Decision` interface: `id`, `question`, `context`, `options`, `answer`, `resolved`, `timestamp`, `resolvedAt`
     - `CanonicalStatus` interface: `name`, `canonicalPath`, `exists`, `lastModified`, `branchOverride`
     - `SharerNote` interface: `from`, `note`, `sharedAt`
     - `Snapshot` interface: `id`, `version`, `timestamp`, `event`, `project`, `git`, `files`, `task`, `tests`, `decisions`, `canonical`, `sharer`
  2. Export all types from `src/core/types.ts`
  3. Re-export from `src/index.ts`

- **Files**:
  - `jawn-ai-state/src/core/types.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- can develop alongside T004 after T001 completes.
- **Notes**: Use `string | null` for nullable fields (not `undefined`). Use readonly arrays where appropriate. The `Snapshot.version` field must be present and set to `"1.0.0"`.

---

### Subtask T003 -- Create Zod schemas for snapshot validation

- **Purpose**: Provide runtime validation for snapshots read from disk. Corrupted or invalid snapshots should be caught and handled gracefully.
- **Steps**:
  1. Create `src/core/schema.ts` with Zod schemas mirroring every type from T002:
     - `EventTypeSchema` (z.enum)
     - `ProjectContextSchema` (z.object)
     - `GitStateSchema` (z.object)
     - `FileStateSchema` (z.object)
     - `TaskContextSchema` (z.object)
     - `TestResultsSchema` (z.object) -- with `failingTests` capped at 20 entries
     - `DecisionSchema` (z.object) -- with refinement: `answer` must be non-null when `resolved` is true
     - `CanonicalStatusSchema` (z.object)
     - `SharerNoteSchema` (z.object)
     - `SnapshotSchema` (z.object) -- with refinement: `version` must be a valid semver string
  2. Export a `validateSnapshot(data: unknown): { success: boolean; data?: Snapshot; error?: string }` function
  3. Export individual schemas for use by other modules
  4. Add `z.infer<typeof SnapshotSchema>` type check to ensure Zod schema matches TypeScript types

- **Files**:
  - `jawn-ai-state/src/core/schema.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: No -- depends on T002 types being defined. Can start once T002 is complete.
- **Notes**: The `validateSnapshot` function must never throw. Return a result object so callers can handle invalid data gracefully (FR-011). Timestamps must be valid ISO 8601 strings (use `z.string().datetime()` or a custom refinement).

---

### Subtask T004 -- Implement configuration loading

- **Purpose**: Provide the two-tier config system (global defaults + project overrides) that all CLI commands and the MCP server use.
- **Steps**:
  1. Create `src/core/config.ts` with:
     - `GlobalConfig` type: `retentionDays` (default 7), `retentionMaxBytes` (default 52428800 = 50MB), `autoRestore` (default true), `verbosity` (default "normal")
     - `ProjectConfig` type: `eventTriggers` (all true by default), `customTriggers` (empty array), `periodicIntervalMinutes` (default 15)
     - `EventTriggerConfig` type: `commit`, `branchSwitch`, `testRun`, `canonicalUpdate`, `sessionEnd` (all boolean, default true)
     - `loadGlobalConfig()`: Read from `~/.jawn-ai/global-config.json`, create with defaults if missing
     - `loadProjectConfig(projectRoot: string)`: Read from `<projectRoot>/.jawn-ai/config.json`, create with defaults if missing
     - `mergeConfig(global, project)`: Merge with project overrides taking precedence
     - `saveGlobalConfig(config)`: Write global config
     - `saveProjectConfig(projectRoot, config)`: Write project config
     - `getProjectHash(projectRoot: string): string`: SHA256 of absolute path, first 16 chars
     - `getStateDir(projectRoot: string): string`: Returns `~/.jawn-ai/projects/<hash>/`
     - `ensureStateDir(projectRoot: string): Promise<void>`: Creates the state directory if it doesn't exist (with 700 permissions)
  2. Create Zod schemas for config validation (GlobalConfigSchema, ProjectConfigSchema)
  3. Handle missing config files gracefully (return defaults, don't error)
  4. Ensure directory creation uses proper permissions (700 for `~/.jawn-ai/`)

- **Files**:
  - `jawn-ai-state/src/core/config.ts` (new)
  - `jawn-ai-state/src/index.ts` (update exports)

- **Parallel?**: Yes -- can develop alongside T002 after T001 completes. Only depends on having Node.js fs access.
- **Notes**: Use `os.homedir()` for `~` expansion. Config reads should never throw -- return defaults on any error. The `getProjectHash` function is critical -- other WPs depend on it for storage paths. Use `crypto.createHash('sha256')` from Node.js built-in `crypto` module.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Schema evolution breaks existing snapshots | Include `version` field from day 1. Validate against version-specific schemas. |
| Config file corruption | Always return defaults when config is unreadable. Atomic writes for saves. |
| Toolchain mismatch with jawn-ai-mcp-server | Check existing package versions before choosing. Match conventions. |
| Package name conflicts | Verify `jawn-ai-state` doesn't conflict with anything on npm (it's a local package, but good practice). |

## Review Guidance

- Verify all types match `data-model.md` exactly (field names, types, nullability)
- Verify Zod schemas match TypeScript types (use `z.infer` checks)
- Verify config defaults match values in data-model.md
- Verify `getProjectHash` produces stable, deterministic output
- Verify `validateSnapshot` never throws, always returns a result object
- Verify package.json scripts work: `build`, `test`, `lint`
- Verify directory structure matches the plan

## Activity Log

- 2026-02-16T19:42:12Z -- system -- lane=planned -- Prompt created.
