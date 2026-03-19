---
work_package_id: "WP03"
title: "Governance Remediations"
lane: "planned"
dependencies: ["WP02"]
subtasks: ["T009", "T010", "T011", "T012", "T013"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-sonnet"
---

# WP03: Governance Remediations

**Implementation command**: `spec-kitty implement WP03`
**Target repo**: `joyus-ai`
**Dependencies**: WP02 (remediation-backlog.md must exist)
**Priority**: P0/P1
**Parallel with**: WP04 (can run concurrently after WP02 completes)

## Objective

Execute the remediation items from `governance/remediation-backlog.md` that target governance documents: constitution alignment, cross-reference integrity, README and roadmap consistency, feature artifact gap-filling, and the MCP integration rubric. This WP produces the corrected and extended governance doc set that WP05's automated checks will validate.

## Context

This is a documentation-heavy WP. No new runtime code is written. The outputs are markdown files committed to `joyus-ai`. The primary consumer of these files is WP05's governance check script — each file produced here must conform to the structure that script will validate.

Constitution sync is a careful operation: the `spec/constitution.md` in `joyus-ai` is the canonical version. Any references in `joyus-ai-internal` or planning docs are informational copies. Do not modify the copy in `joyus-ai-internal` — update `joyus-ai/spec/constitution.md` only.

The MCP integration rubric (T013) is a new document created from scratch using the five approval dimensions defined in `spec.md §Security + MCP Governance`.

---

## Subtasks

### T009: Align constitutions across joyus-ai and joyus-ai-internal

**Purpose**: Ensure `joyus-ai/spec/constitution.md` is the single authoritative version and that any governance references in planning docs point to it without contradicting it.

**Steps**:

1. Read `joyus-ai/spec/constitution.md` — note current version header and key principles.
2. Read any constitution references in `joyus-ai-internal` (planning docs, ADRs, research).
3. Identify contradictions or stale references:
   - Version mismatch (e.g., planning doc references v1.4 when constitution is v1.6)
   - Principle references that no longer match the current text
   - Broken section anchors (e.g., `§2.10` references that point to wrong content)
4. Update `joyus-ai/spec/constitution.md`:
   - Add a `§Governance` section if absent, covering: agentic workflow operating principles, spec-driven development requirement, and multi-tenant governance applicability
   - Increment the version number (minor bump, e.g., v1.6 → v1.7) with a changelog entry
   - Do not change existing principles — add or clarify only
5. Update any `joyus-ai-internal` planning files that reference the old version number.

**Expected constitution additions** (if §Governance section is absent):

```markdown
## §Governance: Agentic Operating Principles

**G.1** All agentic workflows operating at Level 3 or above must have a specification artifact
before execution begins.

**G.2** Governance checks defined in Spec 007 apply to all features in this repository and
run in CI on every pull request.

**G.3** Autonomy level assignments are documented, versioned, and reviewed on the cadence
defined in `governance/autonomy-levels.md`.

**G.4** The measured-vs-perceived productivity divergence signal (FR-013) is a first-class
health indicator alongside test pass rates and deployment frequency.
```

**Files**:
- `joyus-ai/spec/constitution.md` (updated — version bump + §Governance section)

**Validation**:
- [ ] Constitution version header is incremented with a changelog entry
- [ ] `§Governance` section exists with at least 4 principles
- [ ] No existing principles are modified or removed
- [ ] All `joyus-ai-internal` version references updated to current version number

---

### T010: Resolve broken cross-spec reference links

**Purpose**: Find and fix every broken internal link in the spec ecosystem — references from one spec document to another that point to nonexistent files, sections, or anchors.

**Steps**:

1. Scan all markdown files in `joyus-ai/kitty-specs/` and `joyus-ai/spec/` for internal links (e.g. `[text](<path>)`, anchor refs `#section`).
2. For each link, verify the target file exists. Record broken links in a working list.
3. Categorize breaks:
   - **Missing file**: target `.md` file does not exist → create a stub (T012 handles stub content)
   - **Wrong path**: file exists but path is incorrect → fix the path in the source document
   - **Stale anchor**: file exists but `#section-heading` does not → update to correct heading or remove anchor
4. Fix all wrong-path and stale-anchor breaks directly.
5. For missing-file breaks, record the missing file in the T012 artifact gap list (do not create stub here — T012 does that).
6. After fixes, re-scan to verify zero remaining broken links.

**Scanning approach** (manual, since no automated link checker is assumed):

Check these high-risk reference patterns:
- `spec.md` files that reference `plan.md`, `data-model.md`, or `tasks.md` in the same feature dir
- `tasks.md` files that reference WP prompt files in `tasks/` subdirectory
- `plan.md` files that reference other specs by number (e.g., `Spec 003`)
- `constitution.md` section cross-references

**Files**:
- Multiple files in `joyus-ai/kitty-specs/` (path fixes and anchor corrections)
- Working log: `governance/reference-integrity-log.md` (record of what was found and fixed)

**Validation**:
- [ ] `governance/reference-integrity-log.md` exists with a list of all breaks found
- [ ] Zero broken path references remain in spec files (verify by re-scanning)
- [ ] Zero stale anchor references remain
- [ ] Missing-file breaks are listed in the T012 artifact gap list

---

### T011: Update README and roadmap for consistency

**Purpose**: Ensure `joyus-ai/README.md` and any roadmap files accurately reflect current feature lifecycle states, not stale planning-era descriptions.

**Steps**:

1. Read `joyus-ai/README.md` — note which features are described and what lifecycle state each is assigned.
2. Read feature `meta.json` files in `kitty-specs/` for authoritative lifecycle states (`lifecycle_state` field).
3. Identify mismatches:
   - README describes a feature as "planned" when `meta.json` shows `execution` or `done`
   - README omits features that exist in `kitty-specs/`
   - Roadmap milestone dates that are clearly stale (>3 months past)
4. Update `README.md`:
   - Feature table rows must match `meta.json` lifecycle states
   - Add any missing features (at minimum: feature number, name, lifecycle state)
   - Remove or archive stale milestone dates; replace with "see roadmap for current dates" if a live roadmap doc exists
5. If a `roadmap.md` or equivalent exists, apply the same lifecycle state reconciliation.

**README feature table format** (add or standardize if absent):

```markdown
## Features

| # | Feature | Status | Spec |
|---|---------|--------|------|
| 001 | MCP Server AWS Deployment | execution | [spec](kitty-specs/001-.../spec.md) |
| 007 | Org-Scale Agentic Governance | planning | [spec](kitty-specs/007-.../spec.md) |
| ... | ... | ... | ... |
```

**Files**:
- `joyus-ai/README.md` (updated feature table and lifecycle states)
- `joyus-ai/roadmap.md` (if exists — lifecycle state corrections)

**Validation**:
- [ ] Every feature in `kitty-specs/` appears in the README feature table
- [ ] All lifecycle states in README match `meta.json` values
- [ ] No stale dates remain without a "see live roadmap" note
- [ ] README can be read by a new team member and give an accurate picture of project state

---

### T012: Fill identified feature artifact gaps

**Purpose**: Create stub files for any feature that is missing required governance artifacts (spec.md, plan.md, tasks.md, or data-model.md), so the governance check script in WP05 can pass without errors.

**Steps**:

1. Compile the artifact gap list from:
   - WP01 T002 scoring evidence for D09 (artifact completeness)
   - Missing-file breaks recorded in T010 reference integrity log
2. For each gap, determine the minimum required stub content:
   - `spec.md` stub: frontmatter + Purpose + Scope + Requirements skeleton
   - `plan.md` stub: frontmatter + Summary + Phase Breakdown skeleton
   - `tasks.md` stub: frontmatter + Work Packages skeleton
   - `data-model.md` stub: frontmatter + Entities skeleton
3. Create each stub file with a `[STUB — pending author completion]` notice at the top.
4. Do not invent content for stubs — use only what is derivable from the feature name and any existing sibling files.
5. Record each stub created in `governance/remediation-backlog.md` — update the corresponding RI item status from `open` to `in_progress`.

**Stub header template** (apply to every stub file created):

```markdown
<!-- STUB: This file was created by WP03 to satisfy governance artifact requirements.
     Content is minimal. The feature author must complete this document before the
     feature moves to execution state. -->
```

**Files**:
- Multiple stub `.md` files under `joyus-ai/kitty-specs/NNN-*/` directories
- `governance/remediation-backlog.md` (status updates for affected RI items)

**Validation**:
- [ ] Every gap from the artifact gap list has a corresponding stub file
- [ ] No stub contains invented functional content (title and skeleton only)
- [ ] Stub header is present in every stub file
- [ ] Governance check script (WP05 T018) will pass on these stubs (they satisfy file-existence checks, not content checks)

---

### T013: Draft MCP integration approval rubric and catalog

**Purpose**: Produce the MCP integration governance document that the Security Team uses to evaluate new integration requests and conduct quarterly audits.

**Steps**:

1. Create `joyus-ai/governance/mcp-integration-rubric.md` using the five approval dimensions from `spec.md §Security + MCP Governance`:
   - Data access scope
   - Credential and auth model
   - Logging and auditability
   - External dependency risk
   - Sandbox and execution constraints
2. For each dimension, define a 3-point scoring rubric (0 = high risk, 1 = mitigated with controls, 2 = low risk or not applicable).
3. Define approval thresholds: minimum aggregate score for pilot allowlist vs full approval vs deprecation.
4. Add a request-to-approval lifecycle section with the four stages: request → assessment → pilot allowlist → full approval/deprecation.
5. Add a quarterly audit checklist section.
6. Add a catalog template appendix — the table structure that tracks approved integrations.

**Document structure**:

```markdown
# MCP Integration Approval Rubric

**Version**: 1.0
**Owner**: Security Team
**Review cadence**: Quarterly + immediate on high-severity advisories

## Approval Dimensions

### 1. Data Access Scope
- Score 0: Access to PII, credentials, or multi-tenant data without isolation controls
- Score 1: Scoped data access with documented boundaries and access logging
- Score 2: Read-only or ephemeral access; no sensitive data class involved

### 2. Credential and Auth Model
- Score 0: Shared credentials, plaintext secrets, or no revocation path
- Score 1: Per-integration credentials with rotation policy
- Score 2: OAuth or short-lived tokens with automated rotation

### 3. Logging and Auditability
- Score 0: No request logging; no audit trail
- Score 1: Requests logged but not to centralized audit store
- Score 2: Structured logs shipped to audit store with retention policy

### 4. External Dependency Risk
- Score 0: Dependency on unstable or unvetted external service with no SLA
- Score 1: Dependency on stable external service with fallback documented
- Score 2: Internal service or external service with contractual SLA

### 5. Sandbox and Execution Constraints
- Score 0: Arbitrary code execution or file system access without sandbox
- Score 1: Execution constrained by resource limits; no arbitrary FS access
- Score 2: Execution fully sandboxed or read-only with no side effects

## Approval Thresholds

| Aggregate Score | Decision |
|----------------|---------|
| 0–3 | Reject — remediate before re-submission |
| 4–6 | Pilot allowlist — approved for named pilot users only |
| 7–9 | Pilot allowlist with review at 30 days |
| 10 | Full approval |

*Any dimension score of 0 is an automatic block regardless of aggregate.*

## Lifecycle Stages

1. **Request**: Submitter files integration request with use case, data access description, and auth model
2. **Assessment**: Security Team scores each dimension; produces assessment record
3. **Pilot allowlist**: Approved for limited rollout; 30-day monitoring window
4. **Full approval / Deprecation**: Based on pilot monitoring data and re-assessment

## Quarterly Audit Checklist

- [ ] Review all approved integrations for score changes (new versions, new data access)
- [ ] Check for high-severity advisories since last audit
- [ ] Confirm each integration still has an active use case (deprecate unused ones)
- [ ] Update catalog with keep / restrict / deprecate status

## Approved Integration Catalog

| Integration | Version | Score | Status | Last Reviewed | Owner |
|-------------|---------|-------|--------|--------------|-------|
| (none yet) | | | | | |
```

**Files**:
- `joyus-ai/governance/mcp-integration-rubric.md` (new, ~80 lines)

**Validation**:
- [ ] All 5 approval dimensions are defined with 3-point scoring rubric
- [ ] Approval thresholds table covers full score range (0–10)
- [ ] Any dimension score = 0 is documented as an automatic block
- [ ] Lifecycle stages match spec.md §Security + MCP Governance exactly
- [ ] Catalog table template is present
- [ ] Document has owner and review cadence in header

---

## Definition of Done

- [ ] `joyus-ai/spec/constitution.md` updated with version bump and §Governance section
- [ ] `governance/reference-integrity-log.md` published; zero broken links remain
- [ ] `joyus-ai/README.md` feature table matches `meta.json` lifecycle states
- [ ] All artifact gaps from the gap register have stub files
- [ ] `governance/mcp-integration-rubric.md` published with all 5 dimensions and catalog template
- [ ] All RI items targeting WP03 are updated to `in_progress` or `done` in `remediation-backlog.md`
- [ ] WP05 governance check script can validate all WP03 outputs without errors

## Risks

- **Constitution edit risk**: Modifying `constitution.md` requires care — do not alter existing principles. If a principle genuinely conflicts with governance needs, flag it for human review rather than overwriting it.
- **Stub inflation**: Creating many stubs satisfies file-existence checks but does not make governance materially better. Prioritize stubs for features actually in execution; P2-tier features can wait.
- **README divergence**: If `meta.json` lifecycle states are themselves stale, the README sync will just propagate the error. Flag any `meta.json` that appears wrong to the Platform Lead before syncing.
- **MCP rubric calibration**: The 3-point scale and approval thresholds are initial proposals. The Security Team must review and adjust before the rubric is used for real assessments. Mark the doc as "Draft — pending Security Team review" until confirmed.

## Reviewer Guidance

- Verify that constitution changes are additive only — diff the file and reject any removal of existing principles.
- Check that stub files cannot be confused with real spec content — the stub header must be visually prominent.
- Confirm that the reference integrity log is complete — spot-check 3–4 cross-references manually.
- The MCP rubric is a security-sensitive document — ensure the automatic-block rule for any dimension score of 0 is explicit and cannot be overridden by aggregate scoring.
