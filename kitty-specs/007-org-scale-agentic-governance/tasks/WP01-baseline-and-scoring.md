---
work_package_id: WP01
title: Baseline and Scoring
lane: planned
dependencies: []
subtasks: [T001, T002, T003, T004]
history:
- date: '2026-03-14'
  action: created
  agent: claude-sonnet
---

# WP01: Baseline and Scoring

**Implementation command**: `spec-kitty implement WP01`
**Target repo**: `joyus-ai`
**Dependencies**: None
**Priority**: P0 (Foundation — all other WPs depend on this)

## Objective

Produce the governance baseline matrix and gap register for the Joyus AI platform. Score each governance dimension 0–3 against observed current state, tag all gaps by severity (P0/P1/P2), and publish the two foundation documents that all downstream work packages use as their input.

## Context

This is a governance spec, not a feature implementation. The deliverables are markdown documents — structured reference artifacts that express measurable organizational state. No runtime code changes are made in WP01.

The governance dimension taxonomy covers the full scope of FR-001 through FR-015 from the spec: rollout model, ROI contract, MCP governance lifecycle, spec artifact completeness, cross-reference integrity, constitution sync, autonomy leveling, scenario validation, legacy migration path, talent policy, and CI enforcement.

The maturity score scale (0–3) maps to:
- **0** — Not present; no artifact or practice exists
- **1** — Partially present; intent documented but incomplete or inconsistent
- **2** — Mostly present; exists but not enforced or not systematically applied
- **3** — Fully present; documented, enforced, and reviewed on cadence

Severity tagging (P0/P1/P2) follows FR-009:
- **P0** — Blocking; blocks adoption safety, CI enforcement, or security gate. Must be resolved before scale-up.
- **P1** — High; degrades governance confidence or measurement accuracy. Must resolve within 2 sprints.
- **P2** — Medium; completeness or polish item. Resolve within the current quarter.

---

## Subtasks

### T001: Define governance dimension taxonomy

**Purpose**: Establish the complete list of governance dimensions that will be scored. This list defines the rows of the baseline matrix.

**Steps**:

1. Map each functional requirement (FR-001–FR-015) from `spec.md` to one named governance dimension.
2. Group dimensions into four domains: **Rollout & Adoption**, **Measurement & ROI**, **Security & MCP**, **Spec & Artifact Integrity**, **Autonomy & Safety**.
3. Write a one-sentence description of what "fully present" (score = 3) looks like for each dimension.
4. Record the taxonomy in a working notes file at `governance/baseline-notes.md` before producing the matrix.

**Dimension list (derive from spec)**:

| # | Domain | Dimension Name | Maps to FR |
|---|--------|---------------|-----------|
| D01 | Rollout & Adoption | Pilot cohort and champion model | FR-001, FR-002 |
| D02 | Rollout & Adoption | Onboarding assets and checkpoints | FR-003 |
| D03 | Rollout & Adoption | Enablement cadence | FR-001 |
| D04 | Measurement & ROI | ROI metrics contract | FR-004 |
| D05 | Measurement & ROI | Review cadence | FR-005 |
| D06 | Measurement & ROI | Measured vs perceived productivity tracking | FR-013 |
| D07 | Security & MCP | MCP integration approval rubric | FR-006 |
| D08 | Security & MCP | MCP catalog lifecycle and audit | FR-007 |
| D09 | Spec & Artifact Integrity | Artifact completeness | FR-008 |
| D10 | Spec & Artifact Integrity | Cross-reference integrity | FR-008 |
| D11 | Spec & Artifact Integrity | Constitution sync | FR-008 |
| D12 | Autonomy & Safety | Autonomy level classification | FR-010 |
| D13 | Autonomy & Safety | Scenario holdout policy | FR-011 |
| D14 | Autonomy & Safety | Digital twin / simulation requirements | FR-012 |
| D15 | Autonomy & Safety | Legacy migration path | FR-014 |
| D16 | Autonomy & Safety | Talent and role adaptation policy | FR-015 |
| D17 | CI Enforcement | Governance checks in CI | NFR-001 |

**Files**:
- `joyus-ai/governance/baseline-notes.md` (working notes, ~30 lines)

**Validation**:
- [ ] All 17 dimensions are listed with a domain, description, and FR mapping
- [ ] No FR from spec.md is unmapped
- [ ] Each dimension has a clear "score = 3" definition

---

### T002: Score each dimension against current state

**Purpose**: Assess the current state of each governance dimension in `joyus-ai` by reading existing artifacts and code, producing an honest 0–3 score with evidence citations.

**Steps**:

1. For each dimension, read the relevant artifacts in `joyus-ai`:
   - `spec/constitution.md`
   - Feature `meta.json` files in `kitty-specs/`
   - Existing CI workflows in `.github/workflows/`
   - `README.md` and roadmap files
   - Any existing governance docs
2. Assign a score (0–3) and record:
   - **Evidence**: what was found (file path and section)
   - **Gap**: what is missing or insufficient
3. Be conservative: a dimension scores 3 only if it is documented, applied consistently, and has a review mechanism. Partial documentation scores 1.

**Scoring guidance by dimension**:

- D01 (Pilot cohort): Score 0 if no pilot criteria document exists; 1 if mentioned in plan but not formalized
- D04 (ROI metrics): Score 0 if no named owner + metric list document; 1 if metrics listed but no owner or cadence
- D07 (MCP rubric): Score 0 if no rubric document; check `governance/` directory and spec notes
- D09 (Artifact completeness): Score by sampling — check 5 features for presence of spec.md, plan.md, tasks.md, data-model.md
- D17 (CI enforcement): Score 0 if no governance-check workflow exists; check `.github/workflows/`

**Files**:
- Scores recorded in `joyus-ai/governance/baseline-notes.md` (extend from T001)

**Validation**:
- [ ] All 17 dimensions have a numeric score (0–3)
- [ ] Every score has at least one evidence citation (file path)
- [ ] Every score below 3 has a gap description
- [ ] No score is assumed — each has a verifiable evidence source

---

### T003: Produce baseline matrix document

**Purpose**: Consolidate T001 and T002 output into the canonical baseline matrix — the primary reference for all downstream WPs.

**Steps**:

1. Create `joyus-ai/governance/baseline-matrix.md` using the structure below.
2. One row per dimension. Columns: Dimension, Domain, Score, Evidence, Gap Description, Severity (to be filled in T004).
3. Add a summary section below the table with score distribution and overall governance health assessment.
4. Include document metadata (date, assessor, version).

**Template**:

```markdown
# Governance Baseline Matrix

**Date**: YYYY-MM-DD
**Assessor**: [agent or human role]
**Version**: 1.0
**Spec**: 007-org-scale-agentic-governance

## Scoring Key

| Score | Meaning |
|-------|---------|
| 0 | Not present |
| 1 | Partially present — intent documented but incomplete |
| 2 | Mostly present — exists but not enforced or systematically applied |
| 3 | Fully present — documented, enforced, reviewed on cadence |

## Dimension Scores

| # | Dimension | Domain | Score | Evidence | Gap Description | Severity |
|---|-----------|--------|-------|----------|----------------|----------|
| D01 | Pilot cohort and champion model | Rollout & Adoption | 0 | none | No pilot criteria or champion role defined | P0 |
| ... | ... | ... | ... | ... | ... | ... |

## Summary

- Total dimensions: 17
- Score 3 (fully present): N
- Score 2 (mostly present): N
- Score 1 (partial): N
- Score 0 (absent): N
- P0 gaps: N
- P1 gaps: N
- P2 gaps: N

**Governance health**: [Red / Amber / Green with one-sentence rationale]
```

**Files**:
- `joyus-ai/governance/baseline-matrix.md` (new, ~60 lines)

**Validation**:
- [ ] All 17 dimensions appear in the table
- [ ] No blank cells in Score or Evidence columns
- [ ] Summary counts match the table
- [ ] Document has date and version header

---

### T004: Tag all gaps P0/P1/P2 and publish gap register

**Purpose**: Extract every gap from the baseline matrix into a dedicated gap register that will drive WP02 backlog creation.

**Steps**:

1. Filter all dimensions where Score < 3 from `baseline-matrix.md`.
2. Apply severity criteria:
   - **P0**: Gaps in D01 (pilot model), D07 (MCP rubric), D09 (artifact completeness), D17 (CI enforcement) — directly impact adoption safety or security
   - **P1**: Gaps in D04, D05, D06 (ROI/metrics), D10, D11 (reference/constitution), D12, D13 (autonomy leveling)
   - **P2**: Gaps in D02, D03, D08, D14, D15, D16 (enablement cadence, digital twin, migration, talent)
3. Create `joyus-ai/governance/gap-register.md` — one row per gap, with a unique gap ID (G001, G002, ...).
4. Gaps with Score 0 should be flagged as higher severity than same-dimension gaps at Score 1 or 2.

**Template**:

```markdown
# Governance Gap Register

**Date**: YYYY-MM-DD
**Source**: baseline-matrix.md v1.0
**Total gaps**: N

| Gap ID | Dimension | Score | Severity | Gap Description | Target WP |
|--------|-----------|-------|----------|----------------|-----------|
| G001 | D01 Pilot cohort | 0 | P0 | No pilot criteria or champion role defined | WP03 |
| G002 | D07 MCP rubric | 0 | P0 | No MCP integration approval rubric exists | WP03 |
| ... | ... | ... | ... | ... | ... |

## Gap Count by Severity

- P0: N gaps
- P1: N gaps
- P2: N gaps
```

5. Cross-reference each gap to its target WP (WP03 for doc remediations, WP04 for metadata, WP05 for CI, WP06 for autonomy policy).

**Files**:
- `joyus-ai/governance/gap-register.md` (new, ~40 lines)

**Validation**:
- [ ] Every dimension with Score < 3 appears in the gap register
- [ ] Every gap has a unique ID (G001, G002, ...)
- [ ] Every gap has a severity and a target WP
- [ ] P0 severity is not applied to optional/P2-tier dimensions
- [ ] Summary counts match the row count

---

## Definition of Done

- [ ] `governance/baseline-matrix.md` published with all 17 dimensions scored
- [ ] Every score has an evidence citation
- [ ] `governance/gap-register.md` published with all gaps tagged P0/P1/P2
- [ ] All gaps cross-referenced to a target WP
- [ ] Both documents have date and version headers
- [ ] WP02 can begin immediately using gap-register.md as input

## Risks

- **Evidence scarcity**: Some dimensions may have no artifacts at all in `joyus-ai`. Score these 0 rather than inferring from intent. Inference inflates scores and hides real gaps.
- **Scope creep**: T002 involves reading many files. Stop at evidence gathering — do not fix gaps discovered during scoring. That is WP03's job.
- **Severity inflation**: Avoid marking everything P0. Reserve P0 for gaps that block safe rollout or security gates. Over-flagging P0 creates backlog noise and undermines triage.

## Reviewer Guidance

- Check that the baseline matrix actually reflects the current state of `joyus-ai`, not the aspirational state described in the spec.
- Verify that Score 3 was not assigned to any dimension without a CI or cadence enforcement mechanism.
- Confirm that gap IDs in `gap-register.md` correspond 1:1 with rows in `baseline-matrix.md` where Score < 3.
- The output of this WP is the single source of truth for all remediation work. Errors here propagate downstream — review carefully before WP02 begins.
