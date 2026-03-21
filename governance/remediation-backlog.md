# Governance Remediation Backlog

**Date**: 2026-03-21
**Source**: gap-register.md v1.0
**Total items**: 17 (P0: 4, P1: 7, P2: 6)

## Summary

| Target WP | P0 Items | P1 Items | P2 Items |
|-----------|----------|----------|----------|
| WP03 | 2 | 4 | 4 |
| WP04 | 1 | 0 | 0 |
| WP05 | 1 | 1 | 0 |
| WP06 | 0 | 2 | 2 |

---

## P0 Items (Sprint +1)

### RI-001: Pilot Cohort Criteria and Champion Role Definition
- **Gap**: G001
- **Owner**: Platform Lead
- **Target files**: `governance/policy-v1.0.md` (§Rollout section)
- **Acceptance test**: `governance/policy-v1.0.md` exists and contains a §Rollout section that defines measurable pilot cohort selection criteria and a named champion role with explicit responsibilities
- **Due**: Sprint +1
- **Status**: open

---

### RI-002: MCP Integration Approval Rubric
- **Gap**: G002
- **Owner**: Security Team
- **Target files**: `governance/mcp-approval-rubric.md`
- **Acceptance test**: `governance/mcp-approval-rubric.md` exists, contains a scored evaluation matrix with at minimum the dimensions defined in the spec, and includes at least one completed example assessment record
- **Due**: Sprint +1
- **Status**: open

---

### RI-003: Feature Artifact Completeness — Checklists Directory and Lifecycle CI Gate
- **Gap**: G003
- **Owner**: Spec Author
- **Target files**: `checklists/` directory (create); `.github/workflows/governance-check.yml` (modify)
- **Acceptance test**: The `checklists/` directory exists and contains at minimum one template file; the CI governance check workflow blocks merges when P1-severity artifact gaps are detected at the `in-progress` lifecycle state or later
- **Due**: Sprint +1
- **Status**: open

---

### RI-004: CI Governance Coverage — Rollout, ROI, MCP Approval, Autonomy Dimensions
- **Gap**: G004
- **Owner**: Spec Author
- **Target files**: `.github/workflows/governance-check.yml` (modify)
- **Acceptance test**: `.github/workflows/governance-check.yml` contains enforcement rules for rollout, ROI contract, MCP approval status, and autonomy-level classification dimensions — and all four checks are exercised by the CI run on the branch introducing this change
- **Due**: Sprint +1
- **Status**: open

---

## P1 Items (Sprint +2)

### RI-005: ROI Metrics Contract and Baseline Collection
- **Gap**: G005
- **Owner**: Engineering Operations
- **Target files**: `governance/metrics-contract.md`
- **Acceptance test**: `governance/metrics-contract.md` exists and contains a named metric owner for each KPI, a defined baseline collection method, and a designated tracking artifact or dashboard reference
- **Due**: Sprint +2
- **Status**: open

---

### RI-006: Review Cadence Template and Scheduling Artifact
- **Gap**: G006
- **Owner**: Engineering Operations
- **Target files**: `governance/review-cadence.md`
- **Acceptance test**: `governance/review-cadence.md` exists and contains a standing meeting template with agenda, recurrence definition, and a mechanism (calendar link, CI check, or scheduled reminder) that enforces the cadence rather than relying on manual recall
- **Due**: Sprint +2
- **Status**: open

---

### RI-007: Measured vs. Perceived Productivity Survey Instrument
- **Gap**: G007
- **Owner**: Engineering Operations
- **Target files**: `governance/productivity-survey.md`
- **Acceptance test**: `governance/productivity-survey.md` exists and contains a survey instrument with distinct questions targeting measured productivity and perceived productivity, plus a documented data collection and storage process
- **Due**: Sprint +2
- **Status**: open

---

### RI-008: Cross-Reference Integrity — Inter-Repo and External URL Coverage
- **Gap**: G008
- **Owner**: Spec Author
- **Target files**: `.github/workflows/governance-check.yml` (modify); `governance/cross-ref-review-cadence.md`
- **Acceptance test**: The REF-001 check in `.github/workflows/governance-check.yml` covers inter-repo cross-references and external URLs, AND `governance/cross-ref-review-cadence.md` exists with a documented human review schedule of no less than quarterly
- **Due**: Sprint +2
- **Status**: open

---

### RI-009: Constitution Human Review Cadence
- **Gap**: G009
- **Owner**: Platform Lead
- **Target files**: `governance/review-cadence.md` (add §Constitution Review subsection)
- **Acceptance test**: `governance/review-cadence.md` contains a §Constitution Review subsection that defines a periodic human review schedule (not just PR review) with a named reviewer role and minimum frequency
- **Due**: Sprint +2
- **Status**: open

---

### RI-010: Autonomy Level Classification Record and Monthly Review
- **Gap**: G010
- **Owner**: Platform Lead
- **Target files**: `governance/autonomy-classifications.md`
- **Acceptance test**: `governance/autonomy-classifications.md` exists and assigns a current maturity level to each active team or workflow, includes a baseline assessment date, and defines a monthly review trigger or scheduled mechanism
- **Due**: Sprint +2
- **Status**: open

---

### RI-011: Scenario Holdout Repository and Enforcement Gate
- **Gap**: G011
- **Owner**: Platform Lead
- **Target files**: `governance/scenarios/` directory (create); `governance/policy-v1.0.md` (§Autonomy section)
- **Acceptance test**: The `governance/scenarios/` directory exists with at least one scenario definition file; `governance/policy-v1.0.md` contains an §Autonomy section that explicitly gates Level 4/5 deployment on the presence of a non-empty scenario set in that directory
- **Due**: Sprint +2
- **Status**: open

---

## P2 Items (Tracked)

| ID | Gap | Owner | Target | Status |
|----|-----|-------|--------|--------|
| RI-012 | G012 | Spec Author | `governance/onboarding/` directory with guided workflow and checkpoint template | tracked |
| RI-013 | G013 | Spec Author | `governance/enablement-calendar.md` with cadence schedule and process template | tracked |
| RI-014 | G014 | Security Team | `governance/mcp-catalog.md` with approved integrations, audit log section, and deprecation log | tracked |
| RI-015 | G015 | Platform Lead | `governance/simulation-strategy.md` with sandbox definition and digital twin design outline | tracked |
| RI-016 | G016 | Platform Lead | `governance/migration-path.md` with per-team readiness checklist and gating criteria | tracked |
| RI-017 | G017 | Spec Author | `governance/talent-policy.md` with role expectations, career ladder notes, and supervised environment definition | tracked |
