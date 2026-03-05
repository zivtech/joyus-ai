# Tasks: Org-Scale Agentic Governance

## Objective
Implement enforceable governance controls that remove status drift, formalize lifecycle gates, and block unsafe autonomy progression.

## Subtask Index

| ID | Description | WP | Parallel |
|----|-------------|----|----------|
| T001 | Define five-level governance maturity rubric with scoring criteria | WP01 | |
| T002 | Produce baseline matrix across active features and governance surfaces | WP01 | |
| T003 | Classify findings into P0/P1/P2 with severity rationale | WP01 | [P] |
| T004 | Convert P0/P1 findings into remediation backlog records | WP02 | |
| T005 | Add owner role, due date, and acceptance check per remediation item | WP02 | [P] |
| T006 | Define canonical status registry schema and required fields | WP03 | |
| T007 | Implement status consistency validator (meta lifecycle vs canonical registry) | WP03 | |
| T008 | Add CI workflow for status and governance validation | WP03 | [P] |
| T009 | Replace hand-maintained status language with canonical terms in public docs | WP03 | [P] |
| T010 | Define feature lifecycle contract (required artifacts + metadata) | WP04 | |
| T011 | Implement lifecycle transition guards (planning->execution->done) | WP04 | |
| T012 | Add artifact-completeness validator (spec/plan/tasks/meta checks) | WP04 | [P] |
| T013 | Generate governance verification report artifact in CI | WP05 | |
| T014 | Add PR review guidance that references governance report outputs | WP05 | [P] |
| T015 | Define autonomy-level advancement policy with objective prerequisites | WP06 | |
| T016 | Define holdout-scenario requirements for L4/L5 readiness | WP06 | [P] |
| T017 | Define simulation/digital-twin evidence expectations for high-autonomy changes | WP06 | [P] |
| T018 | Implement fail-closed policy gate for missing L4/L5 evidence | WP06 | |

## Work Packages

### WP01 - Baseline and Scoring (Week 1)
- T001, T002, T003
- Output: governance baseline matrix and severity-tagged findings.

### WP02 - Backlog and Ownership (Week 1)
- T004, T005
- Output: remediation backlog with ownership and acceptance checks.

### WP03 - Status Canonicalization and CI Drift Gates (Week 1-2)
- T006, T007, T008, T009
- Output: canonical status contract + CI mismatch failure path.

### WP04 - Lifecycle Contract Hardening (Week 2)
- T010, T011, T012
- Output: enforceable feature artifact and lifecycle-transition policy.

### WP05 - Governance Reporting and PR Integration (Week 2-3)
- T013, T014
- Output: machine-generated governance report consumed in PR review.

### WP06 - Autonomy Leveling and Holdout Policy (Week 3-4)
- T015, T016, T017, T018
- Output: objective autonomy progression framework with fail-closed high-autonomy gating.

## Completion Criteria
1. CI fails on status drift, missing required artifacts, and invalid lifecycle transitions.
2. Every P0/P1 governance gap has a backlog item with owner and acceptance check.
3. Governance report is generated and attached to every validation run.
4. L4/L5 promotions are blocked unless holdout and simulation evidence are present.
