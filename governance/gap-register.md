# Governance Gap Register

**Date**: 2026-03-21
**Source**: baseline-matrix.md v1.0
**Total gaps**: 17

All 17 dimensions scored below 3 are recorded here (no dimension reached score 3). Each gap has a unique ID, severity, and target work package for remediation.

---

## Gap Table

| Gap ID | Dimension | Score | Severity | Gap Description | Target WP |
|--------|-----------|-------|----------|----------------|-----------|
| G001 | D01 — Pilot cohort and champion model | 1 | P0 | No standalone pilot criteria document or champion role definition exists; intent described in spec only | WP03 |
| G002 | D07 — MCP integration approval rubric | 1 | P0 | No rubric document, approval form, or assessed integration record exists; rubric dimensions listed in spec only | WP03 |
| G003 | D09 — Artifact completeness | 2 | P0 | Feature 008 missing `checklists/` directory; CI check only P0-gates `execution`/`done` lifecycle features — P1-severity gaps in earlier lifecycle states do not block merges | WP04 |
| G004 | D17 — Governance checks in CI | 2 | P0 | CI governance check covers spec/artifact integrity only; rollout, ROI, MCP approval, and autonomy-level dimensions have no CI enforcement | WP05 |
| G005 | D04 — ROI metrics contract | 1 | P1 | No standalone metrics contract document; no baseline data collected; owners are role labels only; no dashboard or tracking artifact | WP03 |
| G006 | D05 — Review cadence | 1 | P1 | Review cadence stated in spec only; no scheduled meeting template, standing agenda, or cadence enforcement mechanism | WP03 |
| G007 | D06 — Measured vs perceived productivity tracking | 0 | P1 | No survey instrument, data collection process, or tracking artifact exists for this metric pair | WP03 |
| G008 | D10 — Cross-reference integrity | 2 | P1 | REF-001 check scoped to defined directories only; inter-repo cross-references and external URL validity are not checked; no periodic human review cadence | WP05 |
| G009 | D11 — Constitution sync | 2 | P1 | CI enforces sync but no explicit human review cadence for constitution content changes; PR review discipline is the only quality gate | WP03 |
| G010 | D12 — Autonomy level classification | 1 | P1 | No classification record assigns any team or workflow to a current maturity level; no monthly review mechanism or baseline assessment exists | WP06 |
| G011 | D13 — Scenario holdout policy | 1 | P1 | No scenario repository, holdout directory, or scenario set exists; policy documented as intent only; no enforcement prevents Level 4/5 deployment without scenarios | WP06 |
| G012 | D02 — Onboarding assets and checkpoints | 0 | P2 | No guided workflows, command examples, or checkpoint templates exist anywhere in the repo | WP03 |
| G013 | D03 — Enablement cadence | 1 | P2 | Cadence described in spec only; no calendar artifact, process template, or scheduled cadence document exists | WP03 |
| G014 | D08 — MCP catalog lifecycle and audit | 0 | P2 | No approved integration catalog, quarterly audit record, or deprecation log exists | WP03 |
| G015 | D14 — Digital twin / simulation requirements | 1 | P2 | No simulation strategy document, sandbox environment definition, or digital twin design exists; requirement stated in spec only | WP06 |
| G016 | D15 — Legacy migration path | 1 | P2 | Migration path defined in spec only; no per-team migration assessment, readiness checklist, or gating criteria artifact exists | WP06 |
| G017 | D16 — Talent and role adaptation policy | 1 | P2 | No standalone talent policy document; no role expectation update, career ladder revision, or supervised environment definition exists | WP03 |

---

## Gap Count by Severity

- **P0**: 4 gaps (G001, G002, G003, G004) — must resolve before org-scale rollout
- **P1**: 7 gaps (G005, G006, G007, G008, G009, G010, G011) — resolve within 2 sprints
- **P2**: 6 gaps (G012, G013, G014, G015, G016, G017) — resolve within current quarter

**Total**: 17 gaps — all 17 dimensions scored below 3. The table contains 17 rows (G001–G017).

---

## Target WP Cross-Reference

| Work Package | Gaps Assigned |
|---|---|
| WP03 — Governance document remediations | G001, G002, G005, G006, G007, G009, G012, G013, G014, G017 |
| WP04 — Metadata and artifact contracts | G003 |
| WP05 — Automated checks and CI | G004, G008 |
| WP06 — Autonomy leveling and scenario policy | G010, G011, G015, G016 |
