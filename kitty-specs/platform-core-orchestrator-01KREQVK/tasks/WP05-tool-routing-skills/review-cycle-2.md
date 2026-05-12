---
affected_files: []
cycle_number: 2
mission_slug: platform-core-orchestrator-01KREQVK
reproduction_command:
reviewed_at: '2026-05-12T22:00:06Z'
reviewer_agent: unknown
verdict: rejected
wp_id: WP05
---

# WP05 Review Cycle 1 — REJECTED

**Reviewer:** spec-kitty agent (claude-sonnet-4-6)
**Date:** 2026-05-12
**Test run:** 44/44 pass

---

## Summary

All 44 tests pass and the core functionality for T034–T040 is correctly implemented. One invariant is violated: the platform Constitution can be silently lost when skill loading fails with a non-ENOENT error. The spec and reviewer checklist both explicitly require that Constitution injection cannot be bypassed even if skill loading fails. This is not a polish item — it is a stated safety invariant.

Everything else is approved as-is:
- T034 tool discovery, caching, and invalidation — correct
- T035 dispatch, string/object normalization, event emission — correct
- T036 getAuthorizedTools filtering circuit-broken tools — correct
- T037 retry classification, exponential backoff, circuit breaker lifecycle — correct
- T038 filesystem skill loading, frontmatter parsing, per-file error swallowing — correct
- T039 token budget math, priority sort, skip-whole-skill — correct
- T040 constitution loading, graceful ENOENT degrade, constitution-first ordering — correct

---

## Blocking Issue: Constitution Bypass on Non-ENOENT Skill Load Failure

**File:** `src/orchestrator/skill-loader.service.ts`
**Location:** `SkillLoaderService.assemblePromptPrefix`, lines 300–311

```typescript
async assemblePromptPrefix(
  tenantId: string,
  historyTokens: number,
  userId?: string,
  taskContext?: string,
): Promise<SkillInjectionResult> {
  const [constitution, skills] = await Promise.all([
    this.loadConstitution(),
    this.loadSkills(tenantId, userId, taskContext),
  ]);
  return this.injectSkills(skills, constitution, historyTokens);
}
```

**Failure path:**

`loadSkills` calls `resolver.resolve` which calls `FilesystemSkillResolver.resolve`. Inside that method, ENOENT from `readdir` is caught and swallowed (returns `[]`). Any other error — `EACCES`, `EIO`, `EMFILE`, or any error thrown by a future DB-backed resolver (the interface is explicitly designed to be swappable per Spec 013) — propagates out of `loadSkills`.

When `loadSkills` rejects, `Promise.all` immediately rejects with that error. The `loadConstitution()` promise may already be resolved at that point, but its value is discarded. The caller in `agent-loop.service.ts` has no try/catch around this call, so the entire agent turn fails without the Constitution ever reaching Claude.

**Why this matters beyond the current filesystem implementation:**

The `SkillResolver` interface (`resolve(tenantId, userId?, taskContext?): Promise<Skill[]>`) is documented as the swap point for a Spec 013 DB-backed resolver. A DB-backed resolver can fail for reasons entirely unrelated to file permissions. The bypass path is not a filesystem edge case — it is the normal failure mode for any network-dependent resolver.

**Required fix (choose one):**

Option A — Isolate skill loading errors in `assemblePromptPrefix`:
```typescript
async assemblePromptPrefix(tenantId, historyTokens, userId?, taskContext?) {
  const constitution = await this.loadConstitution();
  let skills: Skill[] = [];
  try {
    skills = await this.loadSkills(tenantId, userId, taskContext);
  } catch (err) {
    console.warn('[SkillLoaderService] Skill loading failed; continuing with constitution only.', err);
  }
  return this.injectSkills(skills, constitution, historyTokens);
}
```

Option B — Use `Promise.allSettled` treating constitution as required and skills as best-effort:
```typescript
async assemblePromptPrefix(tenantId, historyTokens, userId?, taskContext?) {
  const [constitutionResult, skillsResult] = await Promise.allSettled([
    this.loadConstitution(),
    this.loadSkills(tenantId, userId, taskContext),
  ]);
  const constitution = constitutionResult.status === 'fulfilled' ? constitutionResult.value : '';
  if (constitutionResult.status === 'rejected') throw constitutionResult.reason; // re-throw — constitution failure is fatal
  const skills = skillsResult.status === 'fulfilled' ? skillsResult.value : [];
  if (skillsResult.status === 'rejected') {
    console.warn('[SkillLoaderService] Skill loading failed; continuing with constitution only.', skillsResult.reason);
  }
  return this.injectSkills(skills, constitution, historyTokens);
}
```

Option C — Catch at the agent-loop call site in `agent-loop.service.ts`:
```typescript
let injectionResult: SkillInjectionResult | null = null;
try {
  injectionResult = await this.skillLoader.assemblePromptPrefix(tenantId, historyTokenEstimate);
} catch (err) {
  console.warn('[AgentLoopService] assemblePromptPrefix failed; falling back to constitution-only.', err);
  injectionResult = { block: '', includedSkills: [], excludedSkills: [], estimatedTokens: 0 };
}
```

Option A or B is preferred — the invariant belongs at the boundary closest to the failure, not propagated up to the caller.

---

## Required Test to Add

Add to `tests/orchestrator/skill-loader.service.test.ts`:

```typescript
it('returns constitution even when skill resolver throws EACCES', async () => {
  // Constitution loads fine
  mockReadFile.mockResolvedValueOnce('Platform Constitution v1.0');
  // Skills directory throws permission denied (non-ENOENT)
  const eacces = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
  eacces.code = 'EACCES';
  mockReaddir.mockRejectedValue(eacces);

  const resolver = new FilesystemSkillResolver(SKILLS_DIR);
  const service = new SkillLoaderService({ resolver, constitutionFile: '/constitution.md' });

  const result = await service.assemblePromptPrefix(TENANT_ID, 0);

  expect(result.block).toContain('Platform Constitution v1.0');
  expect(result.includedSkills).toHaveLength(0);
});
```

---

## Non-blocking Observation (document, do not change)

`loadConstitution` currently throws on non-ENOENT errors (e.g., EACCES on the constitution file itself). This is the correct fail-closed behavior — better to surface a hard failure than silently serve an empty constitution and let users rely on an unconstrained agent. Add a comment to `loadConstitution` making this intent explicit so the next reader does not "fix" it:

```typescript
// Non-ENOENT errors (EACCES, EIO, etc.) are intentionally re-thrown:
// the constitution is a safety rail; a silent empty-constitution is worse than a hard failure.
```

---

## What to Do

1. Apply the constitution bypass fix in `skill-loader.service.ts` (`assemblePromptPrefix`)
2. Add the EACCES test to `skill-loader.service.test.ts`
3. Add the intent comment to `loadConstitution`
4. Confirm all 44 (now 45) tests still pass
5. Re-submit WP05 for review cycle 2
