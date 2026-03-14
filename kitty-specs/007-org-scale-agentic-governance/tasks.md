# Tasks: Org-Scale Agentic Governance (Spec 007)

## Subtask Index

| ID | WP | Title | Priority | Status |
|----|----|-------|----------|--------|
| T001 | WP01 | Define governance dimension taxonomy | P0 | open |
| T002 | WP01 | Score each dimension 0–3 against current state | P0 | open |
| T003 | WP01 | Produce baseline matrix document | P0 | open |
| T004 | WP01 | Tag all gaps P0/P1/P2 and publish gap register | P0 | open |
| T005 | WP02 | Convert P0 gaps to remediation items with owners | P0 | open |
| T006 | WP02 | Convert P1 gaps to remediation items with owners | P1 | open |
| T007 | WP02 | Set due dates and acceptance criteria per item | P1 | open |
| T008 | WP02 | Publish remediation backlog document | P1 | open |
| T009 | WP03 | Align constitutions across joyus-ai and joyus-ai-internal | P0 | open |
| T010 | WP03 | Resolve broken cross-spec reference links | P1 | open |
| T011 | WP03 | Update README and roadmap for consistency | P1 | open |
| T012 | WP03 | Fill identified feature artifact gaps (missing plans, specs) | P1 | open |
| T013 | WP03 | Draft MCP integration approval rubric and catalog | P1 | open |
| T014 | WP04 | Add required metadata fields to all active feature meta.json | P1 | open |
| T015 | WP04 | Update spec-kitty generation rules for new fields | P1 | open |
| T016 | WP04 | Write governance policy document v1.0 | P1 | open |
| T017 | WP04 | Draft ROI metrics contract with owner attribution | P1 | open |
| T018 | WP05 | Implement governance validation Python script | P0 | open |
| T019 | WP05 | Extend pride-status to surface governance check results | P1 | open |
| T020 | WP05 | Add CI workflow for governance gates | P1 | open |
| T021 | WP05 | Publish governance verification report | P1 | open |
| T022 | WP06 | Write five-level maturity classification guide | P1 | open |
| T023 | WP06 | Define Level 4/5 holdout-scenario policy | P1 | open |
| T024 | WP06 | Define digital-twin/simulation requirements | P2 | open |
| T025 | WP06 | Write legacy system migration staging guide | P2 | open |
| T026 | WP06 | Write talent and org-model adaptation policy | P2 | open |

---

## WP01 — Baseline and Scoring

**Goal**: Produce the governance baseline matrix and gap register that all downstream WPs depend on.

- [ ] T001: Define governance dimension taxonomy (11 dimensions from spec: rollout model, ROI contract, MCP governance, spec artifact completeness, reference integrity, constitution sync, autonomy leveling, scenario validation, legacy migration, talent policy, CI enforcement)
- [ ] T002: Score each dimension 0–3 against observed current state in `joyus-ai`
- [ ] T003: Produce `governance/baseline-matrix.md` — table of dimension × score × evidence × gap description
- [ ] T004: Tag all gaps P0/P1/P2 using severity criteria from spec FR-009; publish `governance/gap-register.md`

**Deliverables**:
- `joyus-ai/governance/baseline-matrix.md`
- `joyus-ai/governance/gap-register.md`

---

## WP02 — Backlog and Ownership

**Goal**: Convert scored gaps into actionable remediation items with owners and due dates.

- [ ] T005: Convert every P0 gap from gap-register into a `RemediationItem` record (id, epic, owner_role, target_files, acceptance_test, due_date)
- [ ] T006: Convert every P1 gap into a `RemediationItem` record
- [ ] T007: Assign due dates (P0: ≤ 1 sprint; P1: ≤ 2 sprints) and write acceptance criteria for each item
- [ ] T008: Publish `governance/remediation-backlog.md` — sortable table with all items, status column initialized to `open`

**Deliverables**:
- `joyus-ai/governance/remediation-backlog.md`

---

## WP03 — Governance Remediations

**Goal**: Execute the remediation items targeting governance docs, constitution alignment, and artifact gaps.

- [ ] T009: Compare constitution sections between `joyus-ai/spec/constitution.md` and any references in `joyus-ai-internal`; resolve conflicts, update version header
- [ ] T010: Scan all spec cross-references for broken links (spec→plan→tasks→WP files); fix or stub missing targets
- [ ] T011: Update `joyus-ai/README.md` and roadmap entries to reflect current feature lifecycle states
- [ ] T012: For each feature flagged with artifact gaps in the gap register, create the missing plan.md, tasks.md, or data-model.md stubs
- [ ] T013: Draft `governance/mcp-integration-rubric.md` — approval rubric (5 dimensions), catalog template, quarterly audit checklist

**Deliverables**:
- Updated `joyus-ai/spec/constitution.md`
- Updated `joyus-ai/README.md`
- `joyus-ai/governance/mcp-integration-rubric.md`
- Stub files for artifact-gap features

---

## WP04 — Workflow and Metadata Contracts

**Goal**: Harden spec metadata standards and publish the governance policy document.

- [ ] T014: Add `measurement_owner`, `review_cadence`, `risk_class`, and `lifecycle_state` fields to `meta.json` for all features that lack them (using `FeatureGovernanceMeta` schema from data-model.md)
- [ ] T015: Update spec-kitty generation rules (command templates or generation scripts) to require the new fields on all new features
- [ ] T016: Write `governance/policy-v1.0.md` — covers rollout model, ROI contract, MCP approval flow, autonomy progression rules, and review cadence
- [ ] T017: Write `governance/roi-metrics-contract.md` — named owners, 6 core metrics, baseline period definition, weekly/monthly cadence table

**Deliverables**:
- Updated `meta.json` files for all active features
- `joyus-ai/governance/policy-v1.0.md`
- `joyus-ai/governance/roi-metrics-contract.md`

---

## WP05 — Automated Checks and CI

**Goal**: Make governance checks runnable locally and enforce them in CI.

- [ ] T018: Implement `scripts/governance-check.py` — checks artifact completeness, reference integrity, constitution sync, and metadata field presence; outputs `GovernanceCheckResult` records as JSON and human-readable terminal output
- [ ] T019: Extend pride-status reporting to surface governance check results (pass/warn/fail counts by severity)
- [ ] T020: Add `.github/workflows/governance.yml` — runs `governance-check.py` on PRs; fails CI on any P0 result; annotates PRs with warn/fail details
- [ ] T021: Run full check suite; publish `governance/verification-report.md` — check-by-check results, residual open items, sign-off criteria

**Deliverables**:
- `joyus-ai/scripts/governance-check.py`
- Updated pride-status integration
- `.github/workflows/governance.yml`
- `joyus-ai/governance/verification-report.md`

---

## WP06 — Autonomy Leveling and Scenario Policy

**Goal**: Define the five-level maturity classification process, holdout-scenario policy, digital-twin requirements, and legacy migration path.

- [ ] T022: Write `governance/autonomy-levels.md` — five-level classification guide (Level 0–5 definitions, observable behaviors, progression criteria, assessment cadence)
- [ ] T023: Write `governance/scenario-policy.md` — holdout-scenario requirements for Level 4/5; scenario set structure, pass/fail criteria, anti-overfitting controls
- [ ] T024: Write `governance/digital-twin-requirements.md` — simulation/digital-twin expectations for high-autonomy integrations; when required, minimum fidelity, review process
- [ ] T025: Write `governance/legacy-migration-guide.md` — four-phase migration path (assist → document → pipeline → selective autonomy); per-phase readiness checklist
- [ ] T026: Write `governance/talent-adaptation-policy.md` — role expectation shifts, specification quality competency definition, early-career development safeguards

**Deliverables**:
- `joyus-ai/governance/autonomy-levels.md`
- `joyus-ai/governance/scenario-policy.md`
- `joyus-ai/governance/digital-twin-requirements.md`
- `joyus-ai/governance/legacy-migration-guide.md`
- `joyus-ai/governance/talent-adaptation-policy.md`

---

## Dependency Graph

```
WP01 (Baseline)
  └── WP02 (Backlog)
        ├── WP03 (Remediations)    ← parallel with WP04
        └── WP04 (Metadata/Policy) ← parallel with WP03
              └── WP05 (CI/Checks) ← requires WP03 + WP04
WP01
  └── WP06 (Autonomy Leveling)    ← independent of WP02-05
```

WP03 and WP04 run in parallel after WP02 completes.
WP06 runs in parallel with WP02 through WP05 (only needs WP01 baseline scores).

---

## Summary

| WP | Title | Subtasks | Priority | Depends On |
|----|-------|----------|----------|-----------|
| WP01 | Baseline and Scoring | T001–T004 | P0 | — |
| WP02 | Backlog and Ownership | T005–T008 | P0/P1 | WP01 |
| WP03 | Governance Remediations | T009–T013 | P0/P1 | WP02 |
| WP04 | Workflow and Metadata Contracts | T014–T017 | P1 | WP02 |
| WP05 | Automated Checks and CI | T018–T021 | P0/P1 | WP03, WP04 |
| WP06 | Autonomy Leveling and Scenario Policy | T022–T026 | P1/P2 | WP01 |
