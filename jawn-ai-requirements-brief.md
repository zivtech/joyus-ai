# jawn-ai Requirements Brief

> **Purpose:** Feed this into `spec-kitty specify` to generate the feature spec for jawn-ai.
> **Generated:** 2026-02-16 by Claude session in ~/gitjawns/nclclib
> **Evidence source:** Workflow analysis of the nclclib Drupal accessibility project (PR #708, 43 branches, 15+ defect fixes across multiple sessions)

---

## Context for the Specifying Session

This brief was produced by analyzing real workflow failures in the nclclib project (`~/gitjawns/nclclib`, branch `feature/a11y-652-remaining-fixes`). If you need to verify any claims or see the raw evidence:

- **nclclib git log:** `git -C ~/gitjawns/nclclib log --oneline -30` shows the commit history including wrong-branch commits, cherry-picks, reverts, and safety branches
- **Branch sprawl:** `git -C ~/gitjawns/nclclib branch | wc -l` (43 branches)
- **Document drift:** Compare `~/gitjawns/nclclib/NCLC-test-files/accessibility-fixes-todo.md` (Jan 15 version) vs `~/gitjawns/claude-files/nclc/accessibility-fixes-todo.md` (Feb 9 version) - same file, divergent content
- **Tracking CSV conflicts:** `git -C ~/gitjawns/nclclib log --oneline --all -- NCLC-test-files/accessibility-audit-tracking.csv` shows it modified in nearly every merge
- **Session memory:** `/Users/AlexUA/.claude/projects/-Users-AlexUA-gitjawns-nclclib/memory/MEMORY.md` documents known pain points the user has encoded
- **Failed patch artifacts:** `find ~/gitjawns/nclclib/pr703-drupal-theme-a11y -name "*.rej"` (20+ failed patches)
- **Safety branches:** `git -C ~/gitjawns/nclclib branch | grep safety` - branches created to rescue nearly-lost work
- **Existing spec-kitty setup:** `~/gitjawns/zivtech-ai-platform/.kittify/` has AGENTS.md, missions, templates
- **Existing skills:** `~/gitjawns/zivtech-claude-skills/` has Drupal coding standards, security, and other skills that exist but aren't auto-enforced
- **Session transcript** (if needed for deep context): `/Users/AlexUA/.claude/projects/-Users-AlexUA-gitjawns-nclclib/65aa7a1e-bfad-4647-9b3d-c6a63fe2e067.jsonl`

---

## Feature Description

**jawn-ai** is a mediator layer between less-technical users and AI coding agents (Claude Code, Codex, etc.). It enforces workflow discipline, quality gates, and contextual awareness that individual AI sessions lack on their own.

The product does NOT replace Claude Code or spec-kitty. Spec-kitty manages specifications. Claude Code executes tasks. **jawn-ai sits between the user and the agent**, enriching prompts with context, enforcing skill usage, gating risky actions, and maintaining state across sessions.

### The core thesis

AI coding agents are powerful but stateless and permissive. They will:
- Commit to the wrong branch if you don't tell them the right one
- Ignore relevant coding standards unless explicitly invoked
- Lose track of which file version is canonical across sessions
- Push code without running tests unless forced
- Burn through context with unfocused work

Less-technical users (junior devs, PMs, content editors) amplify all of these failure modes because they don't know what to ask for and can't catch mistakes in code they don't understand.

jawn-ai prevents these failures through **structured mediation** -- not by limiting what users can do, but by ensuring the right checks, context, and skills are always in play.

---

## User Tiers

### Tier 1: Junior Developers (PRIMARY - spec this first)
- Can write code but need workflow enforcement
- Understand git basics but make branch/merge mistakes
- Won't remember to invoke coding standards skills
- Need quality gates they can't skip without justification

### Tier 2: Power Users (Alex-tier)
- Comfortable with CLI, git, Claude Code
- Need guardrails for consistency, not capability
- Want configurable flags, not hand-holding
- The testbed user -- if it works for them, it works for everyone

### Tier 3: Non-Technical Staff (future phase)
- PMs, content editors, stakeholders
- Can't use CLI directly
- Need a chat or web interface
- Require maximum automation and human-readable explanations

---

## Problem Domains (10 areas, with evidence)

### 1. Canonical Document Management

**Problem:** Reference documents (tracking CSVs, specs, audit reports) get copied into multiple locations. Git-tracked copies diverge from working copies. Claude updates one and forgets the other.

**Evidence:** accessibility-fixes-todo.md exists in two locations with different content and different dates. The tracking CSV conflicts on every merge.

**User scenario:** Junior dev asks Claude to "update the tracking spreadsheet" -- which one? The git-tracked copy that will conflict, or the claude-files copy that's more current but not versioned?

**Needs:**
- Single source of truth with declared location
- Sync mechanism between vault and working copies
- Conflict-resistant storage (not a CSV in a git repo that 5 branches touch)

### 2. Session State Continuity

**Problem:** Claude loses context across compactions and session restarts. Memory.md helps but only captures stable facts, not active work state (current branch, in-progress task, which files were just modified, what was decided but not yet committed).

**Evidence:** This analysis session is itself a continuation from a compacted session. The continuation summary is 8000+ words just to restore context. Previous session had to cherry-pick a commit to the right branch after committing to the wrong one -- context about "which branch am I on" was lost.

**User scenario:** Junior dev's session compacts mid-task. New session picks up but doesn't know the current branch is `feature/a11y-652-remaining-fixes`, that 3 files were modified but not committed, and that the last test showed 2 failures that need investigation.

**Needs:**
- Active state snapshot (branch, modified files, pending tasks, last test results)
- Automatic state persistence on session end/compaction
- State restore protocol at session start
- Distinct from memory.md (memory = stable facts; state = ephemeral work-in-progress)

### 3. Skill Enforcement

**Problem:** Relevant skills (drupal-coding-standards, drupal-security, drupal-contribute-fix, etc.) exist but are never auto-invoked. The AI writes Drupal filter plugins without checking coding standards. It patches contrib modules without searching drupal.org for existing fixes.

**Evidence:** In the nclclib session, FilterPipeSeparators.php was written from scratch without invoking drupal-contribute-fix (which would have checked if a contrib module already does this). Multiple Twig templates and theme JS were written without drupal-coding-standards.

**User scenario:** Junior dev says "add autocomplete to the login form." Claude writes a hook_form_alter without the drupal-security skill checking for XSS vectors or the drupal-coding-standards skill enforcing Drupal's annotation format.

**Needs:**
- File-pattern-to-skill routing table (glob -> required skills)
- Auto-invocation before edits, not just on request
- "Did you check?" prompts for contrib/upstream before writing patches
- Skill audit trail (which skills were invoked for which changes)

### 4. Configurable Quality Gates

**Problem:** Code gets pushed with no automated checks. Visual regression tests, accessibility audits, linting, and coding standards checks all exist as tools but are never run before push/commit.

**Evidence:** Multiple pushes to PR #708 with zero pre-push checks. backstop_data/ (64MB visual regression baseline) exists but was never run. Playwright tests exist but aren't in the push workflow.

**User scenario:** Junior dev says "push this to the PR." Should the system just push, or should it ask: "Run visual regression tests? Run accessibility audit? Run linting?"

**Needs:**
- Pre-commit and pre-push hook system with configurable checks
- "Always run" vs "optional" vs "ask me" tiers
- CLI flags for power users: `--visual-regression --a11y --notify`
- Interactive mode for junior devs: checkbox selection of available checks
- Per-project and per-feature configuration
- Results gating: fail = block, warn = prompt, pass = proceed

### 5. Git Sanity

**Problem:** Branch sprawl (43 branches), wrong-branch commits, cherry-pick chains that create duplicate commits, safety branches created in panic to rescue work, failed patches (.rej files), and merge conflicts on tracking files.

**Evidence:** In this session, accessibility fixes were committed to `AccessibilityIntegration` instead of `feature/a11y-652-remaining-fixes`, requiring cherry-pick + reset. The reflog shows rapid branch switching with resets. Safety branches like `safety/theme-a11y-uncommitted-fixes` indicate near-data-loss events.

**User scenario:** Junior dev is on the wrong branch and doesn't notice. Commits 3 changes. Realizes the mistake. Has to cherry-pick, which conflicts, which requires resolution, which introduces subtle errors.

**Needs:**
- Pre-commit branch verification ("You're on X, expected Y based on your task -- continue?")
- Branch naming enforcement
- Active branch limit warnings
- Stale branch cleanup reminders
- Cherry-pick guardrails (warn about conflict likelihood)
- "Current working context" display showing branch + task + PR

### 6. Tracking Data Architecture

**Problem:** Using CSV files in git for collaborative tracking data guarantees merge conflicts. Every branch modifies the same rows. Resolution strategies (`--theirs`) lose information.

**Evidence:** The accessibility-audit-tracking.csv (822KB) conflicts on nearly every cherry-pick. Memory.md explicitly documents this: "resolve with `--theirs`" -- meaning data loss is the accepted norm.

**User scenario:** Two junior devs work on different accessibility fixes. Both update the tracking CSV. Merge conflict. Whoever resolves it loses the other's updates unless they manually diff line by line.

**Needs:**
- Alternative to CSV-in-git for tracking data (database, API, structured YAML with per-item files, or append-only log)
- Migration path from existing CSV workflows
- Merge-friendly data formats for things that must stay in git

### 7. Error Recovery / Undo

**Problem:** When the AI makes a mistake (wrong branch commit, bad code, broken config), the recovery path requires git expertise that junior devs don't have.

**Evidence:** Revert/reapply cycles in git log (`Revert "NCLCRS-323"` followed by `Reapply "NCLCRS-323"` followed by another revert). Safety branches created to rescue uncommitted work. 20+ .rej files from failed patch applications that were never cleaned up.

**User scenario:** Junior dev approves a commit. Tests fail. They say "undo that." The system needs to know: revert the commit? Reset? Cherry-pick out? What about files that were modified but not committed?

**Needs:**
- Checkpoint/snapshot system before risky operations
- "Undo last action" that understands git state
- Graduated rollback (undo commit vs undo push vs undo merge)
- Orphaned artifact cleanup (.rej files, backup branches, temp files)

### 8. Audit Trail

**Problem:** Across multiple sessions and agents, there's no unified record of what was changed, why, by whom (human vs AI), and what the reasoning was.

**Evidence:** PR #708 has 6 commits from multiple sessions. The connection between defect IDs, code changes, and verification results exists only in session transcripts that get compacted. The automated code review bot comment is generic and doesn't reference specific defects.

**User scenario:** QA asks "which commit fixed defect 24128 and was it verified?" Currently this requires reading git log, PR description, and session transcripts. Should be a single query.

**Needs:**
- Change-to-requirement traceability (commit -> defect -> verification)
- Session action log (human-readable, not raw transcript)
- Agent attribution (which AI model, which session, which skills were active)
- Queryable history ("show me everything related to defect 24128")

### 9. Token/Cost Guardrails

**Problem:** Unfocused prompts, redundant file reads, and exploratory searches burn through context windows. Junior devs don't know they're being inefficient. Sessions hit compaction, losing important context, because earlier work was wasteful.

**Evidence:** The nclclib session that preceded this one ran out of context after: installing an MCP server via browser automation, downloading a Google Sheet via curl, running 3 parallel verification agents, and attempting Playwright verification -- much of which could have been more focused.

**User scenario:** Junior dev asks "make the site accessible" -- Claude reads every file in the theme, explores 20 directories, and exhausts context before writing a single line of code.

**Needs:**
- Prompt coaching ("Your request is broad -- want to narrow to specific WCAG criteria?")
- Context budget awareness (warn when approaching limits)
- Efficient tool routing (use Grep not Explore for simple searches)
- Task scoping assistance (break big requests into focused steps)

### 10. Context Handoff Protocol

**Problem:** When a session ends (compaction, restart, crash), the next session gets a summary but loses active state. The handoff is lossy -- key decisions, file modifications in progress, and test results are lost or compressed beyond usefulness.

**Evidence:** This session's continuation summary is 8000+ words and still missed details (e.g., exact file line numbers, intermediate decisions about stripping "- Mobile" from nav labels). The Playwright MCP server being disconnected was a state loss from a browser crash mid-session.

**User scenario:** Junior dev's session compacts. They restart and say "continue." The new session reads memory.md but doesn't know: (a) which files were just modified, (b) what tests were passing/failing, (c) what the current git status is, (d) what decisions were made and why.

**Needs:**
- Structured handoff document (not prose summary -- structured state)
- Auto-generated on session end/compaction
- Machine-readable so the next session can restore state programmatically
- Includes: branch, modified files, git status, task progress, last test results, pending decisions, active MCP connections

---

## Open Architectural Questions

These need to be resolved during the spec/plan phase:

1. **Runtime form:** Is jawn-ai a CLI wrapper, a daemon, a set of hooks, or a service? How does it intercept user-to-Claude communication?

2. **Hook vs middleware:** Does jawn-ai work via Claude Code hooks (pre/post tool use) or as a middleware that rewrites prompts before they reach Claude?

3. **State storage:** Where does session state live? A file? A local DB? An API? How does it survive across Claude Code restarts?

4. **Skill routing engine:** How does file-pattern-to-skill matching work at runtime? Is it a hook that fires on file reads/edits? A prompt injection? A pre-processing step?

5. **Risk tiering:** Who defines what's low/medium/high risk? Is it per-project config, per-user, or derived from the action itself (e.g., `git push` = high, `edit file` = low)?

6. **Multi-agent coordination:** If jawn-ai mediates multiple AI agents (Claude, Codex, Gemini), how does it maintain consistent state and skill enforcement across them?

7. **Spec-kitty integration:** jawn-ai is separate from spec-kitty, but spec-kitty manages its spec. At runtime, does jawn-ai use spec-kitty artifacts (constitution, task lists) as input, or are they independent?

---

## Constraints

- Must work with existing Claude Code infrastructure (hooks, CLAUDE.md, MCP servers)
- Must be incrementally adoptable -- teams can start with just quality gates and add more later
- Must not require users to learn a new CLI -- mediation should be invisible or minimal
- Must be open to multiple AI backends (Claude, Codex, Gemini) even if Claude is first
- Spec-kitty manages the spec; jawn-ai is the product
- Existing zivtech-claude-skills should be leveraged, not rewritten (redesign is a later phase)

---

## Suggested Spec Priority

1. **Session state + context handoff** (solves the most painful daily problem)
2. **Quality gates** (highest ROI for junior devs)
3. **Skill enforcement** (prevents the most dangerous silent failures)
4. **Git sanity** (prevents the most time-consuming recovery scenarios)
5. **Canonical document management** (prevents the most confusing divergence)
6. **Error recovery** (safety net for everything above)
7. **Token/cost guardrails** (efficiency)
8. **Audit trail** (compliance and traceability)
9. **Tracking data architecture** (CSV replacement)
10. **Multi-tier user interface** (future phase for non-technical users)
