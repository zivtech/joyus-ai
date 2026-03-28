---
work_package_id: WP02
title: Backlog and Ownership
lane: planned
dependencies: [WP01]
subtasks: [T005, T006, T007, T008]
history:
- date: '2026-03-14'
  action: created
  agent: claude-sonnet
---

# WP02: Backlog and Ownership

**Implementation command**: `spec-kitty implement WP02`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (gap-register.md must exist)
**Priority**: P0/P1

## Objective

Convert every P0 and P1 gap from the WP01 gap register into a structured `RemediationItem` record with an assigned owner role, due date, acceptance criteria, and target files. Publish the remediation backlog document that WP03, WP04, WP05, and WP06 will execute against.

## Context

This WP is entirely document production. The input is `joyus-ai/governance/gap-register.md` (WP01 output). The output is `joyus-ai/governance/remediation-backlog.md`.

The `RemediationItem` schema (from `data-model.md`) governs the structure of each item:
- `id`: string (RI-001, RI-002, ...)
- `epic`: string (the WP that owns resolution)
- `priority`: P0, P1, or P2
- `owner_role`: named role (e.g., "Platform Lead", "Engineering Operations", "Security Team")
- `target_files`: list of files to create or modify
- `acceptance_test`: a single verifiable statement — what does done look like?
- `due_date`: relative sprint reference (e.g., "Sprint +1", "Sprint +2")
- `status`: initialized to `open`

P2 gaps are listed in the backlog but do not require a due date or acceptance test at this stage — they are tracked for awareness, not immediate action.

Owner role assignments follow the spec's defined role model:
- **Platform Lead**: rollout model, autonomy leveling, ROI contract oversight
- **Engineering Operations**: metric collection, review cadence execution
- **Security Team**: MCP rubric, catalog lifecycle, audit cadence
- **Spec Author / Agent**: artifact completeness, reference integrity, constitution sync, CI workflow

---

## Subtasks

### T005: Convert P0 gaps to remediation items with owners

**Purpose**: Produce `RemediationItem` records for every P0 gap. P0 gaps block safe rollout and must be resolved in the first sprint.

**Steps**:

1. Read `governance/gap-register.md` and filter rows where Severity = P0.
2. For each P0 gap, produce a remediation item with all fields populated.
3. P0 items require:
   - A specific owner role (not "TBD")
   - At least one named target file (the artifact to create or update)
   - A single-sentence acceptance test that can be verified by a human reviewer or a CI check
   - Due date: Sprint +1 (within the current sprint cycle)

**Expected P0 items** (based on spec dimensions; actual IDs depend on WP01 output):

| Likely Gap | Owner Role | Target File | Acceptance Test |
|-----------|-----------|------------|----------------|
| No pilot cohort criteria | Platform Lead | `governance/policy-v1.0.md` §Rollout | Pilot criteria section present with ≥3 selection criteria and champion role defined |
| No MCP integration rubric | Security Team | `governance/mcp-integration-rubric.md` | Rubric file exists with all 5 approval dimensions scored |
| Artifact completeness gaps | Spec Author | Per-feature stub files | CI artifact check passes with 0 missing required files |
| No governance CI check | Spec Author | `.github/workflows/governance.yml` | PR to joyus-ai triggers governance check; P0 failures block merge |

4. Record items in a working section of `governance/remediation-backlog.md` (draft mode — full structure finalized in T008).

**Files**:
- `joyus-ai/governance/remediation-backlog.md` (draft started)

**Validation**:
- [ ] All P0 gaps from gap-register.md have a corresponding RI item
- [ ] No P0 item has "TBD" in owner_role or target_files
- [ ] Acceptance tests are verifiable (not vague statements like "improve governance")

---

### T006: Convert P1 gaps to remediation items with owners

**Purpose**: Produce `RemediationItem` records for every P1 gap. P1 items target the next sprint (Sprint +2) and cover measurement integrity, reference integrity, and autonomy classification.

**Steps**:

1. Filter P1 rows from `gap-register.md`.
2. Produce remediation items following the same schema as T005.
3. P1 items require the same field completeness as P0 but allow Due date = Sprint +2.
4. Where multiple P1 gaps share the same target file (e.g., several reference integrity gaps all point to `spec/constitution.md`), group them under a single remediation item with multiple acceptance tests.

**Expected P1 item categories** (based on spec dimensions):

| Category | Owner Role | Sprint |
|---------|-----------|-------|
| ROI metrics contract (D04, D05, D06) | Engineering Operations | Sprint +2 |
| Cross-reference integrity (D10) | Spec Author | Sprint +2 |
| Constitution sync (D11) | Platform Lead | Sprint +2 |
| Autonomy level classification (D12) | Platform Lead | Sprint +2 |
| Scenario holdout policy (D13) | Platform Lead | Sprint +2 |

5. For ROI-related items, include the specific metric names from spec.md §ROI Metrics in the acceptance test (lead time, throughput, acceptance proxy, spend per user, onboarding time, measured-vs-perceived delta).

**Files**:
- `joyus-ai/governance/remediation-backlog.md` (extended)

**Validation**:
- [ ] All P1 gaps from gap-register.md have a corresponding RI item
- [ ] No P1 item acceptance test is identical to a P0 item's test (they must be distinct)
- [ ] Grouped items have one RI ID with multiple sub-tests, not duplicate IDs

---

### T007: Set due dates and acceptance criteria per item

**Purpose**: Review all drafted remediation items, normalize due dates to consistent sprint-relative format, and ensure every acceptance test is specific and verifiable.

**Steps**:

1. Review all P0 and P1 items drafted in T005 and T006.
2. Normalize due date format: use `Sprint +N` or an absolute date if a sprint calendar is available. Do not use "ASAP" or "soon".
3. Review each acceptance test against the following quality criteria:
   - **Specific**: names a file, metric, or CI check
   - **Binary**: can be answered yes or no
   - **Owner-independent**: can be verified by a reviewer who did not do the work
4. Rewrite any acceptance test that fails these criteria.
5. Cross-check: every acceptance test should correspond to a check that WP05's governance script can run automatically, or that a human reviewer can verify in under 2 minutes.

**Quality bar for acceptance tests** — examples:

| Weak (reject) | Strong (accept) |
|--------------|----------------|
| "Governance is improved" | "`governance/policy-v1.0.md` exists and contains §Rollout, §ROI, §MCP, §Autonomy sections" |
| "MCP process works" | "`governance/mcp-integration-rubric.md` scores ≥1 on all 5 dimensions (data scope, auth, logging, ext dependency, sandbox)" |
| "Metrics are tracked" | "`governance/roi-metrics-contract.md` lists all 6 metrics with named owner and weekly cadence for first 8 weeks" |

6. For P2 items, record them in a separate section with status `tracked` — no due date required at this stage.

**Files**:
- `joyus-ai/governance/remediation-backlog.md` (revised)

**Validation**:
- [ ] No due date field contains "TBD", "ASAP", or a blank
- [ ] Every acceptance test is binary-verifiable
- [ ] P2 items are in a separate section, not mixed with P0/P1

---

### T008: Publish remediation backlog document

**Purpose**: Finalize and publish `governance/remediation-backlog.md` in its canonical form — the document WP03 through WP06 will use to track work.

**Steps**:

1. Consolidate all items from T005, T006, T007 into the final document structure below.
2. Sort items: P0 first, then P1, then P2.
3. Add a status column initialized to `open` for all items.
4. Add a summary table at the top: counts by priority and target WP.
5. Commit the document to `joyus-ai` on a governance branch.

**Template**:

```markdown
# Governance Remediation Backlog

**Date**: YYYY-MM-DD
**Source**: gap-register.md v1.0
**Total items**: N (P0: N, P1: N, P2: N)

## Summary

| Target WP | P0 Items | P1 Items | P2 Items |
|-----------|---------|---------|---------|
| WP03 | N | N | N |
| WP04 | N | N | N |
| WP05 | N | N | N |
| WP06 | N | N | N |

---

## P0 Items (Sprint +1)

### RI-001: [Title]
- **Gap**: G00N from gap-register
- **Owner**: [Role]
- **Target files**: `path/to/file.md`
- **Acceptance test**: [Single verifiable statement]
- **Due**: Sprint +1
- **Status**: open

### RI-002: ...

---

## P1 Items (Sprint +2)

### RI-00N: [Title]
- **Gap**: G00N
- **Owner**: [Role]
- **Target files**: `path/to/file.md`
- **Acceptance test**: [Single verifiable statement]
- **Due**: Sprint +2
- **Status**: open

---

## P2 Items (Tracked, no due date)

| ID | Gap | Owner | Target | Status |
|----|-----|-------|--------|--------|
| RI-0NN | G0NN | [Role] | `file.md` | tracked |
```

**Files**:
- `joyus-ai/governance/remediation-backlog.md` (final, ~80–100 lines)

**Validation**:
- [ ] Document matches template structure
- [ ] All RI IDs are unique and sequential
- [ ] Summary counts match section row counts
- [ ] All `status` fields are initialized to `open` (P0/P1) or `tracked` (P2)
- [ ] Document is committed to the governance branch in `joyus-ai`

---

## Definition of Done

- [ ] `governance/remediation-backlog.md` is published and committed
- [ ] Every P0 gap from `gap-register.md` has a corresponding RI item with due date Sprint +1
- [ ] Every P1 gap has a corresponding RI item with due date Sprint +2
- [ ] All acceptance tests are binary-verifiable
- [ ] No owner_role is "TBD"
- [ ] WP03, WP04, WP05, WP06 can begin execution using this document as their work queue

## Risks

- **Acceptance test ambiguity**: Vague acceptance tests defer hard decisions to WP05 verification. Write tight tests now — it is cheaper to think clearly at this stage than to argue about done-ness during review.
- **Owner role gaps**: Some owner roles (e.g., "Security Team") may not yet have a named individual. Use role names from the spec — mapping to individuals is outside this WP's scope.
- **WP01 dependency**: If gap-register.md is incomplete or mislabeled, T005 and T006 will produce an incomplete backlog. Validate WP01 output before starting T005.

## Reviewer Guidance

- Verify that every P0 item has a file-level acceptance test (not a process-level one). "The file exists and has the required sections" is better than "the process is documented".
- Check that Sprint +1 items are genuinely achievable in one sprint. If a P0 item requires more than 2–3 days of work, it should be split.
- Confirm that all P2 items are truly optional — if any P2 item's absence would block a P0 or P1 item, re-classify it.
- Cross-check the target WP column: items targeting WP05 should be CI or tooling deliverables, not doc files.
