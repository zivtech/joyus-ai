# Governance Baseline Matrix

**Date**: 2026-03-21
**Assessor**: Claude Sonnet (automated assessment against repo state)
**Version**: 1.0
**Spec**: 007-org-scale-agentic-governance

---

## Scoring Key

| Score | Meaning |
|-------|---------|
| 0 | Not present — no artifact or practice exists |
| 1 | Partially present — intent documented but incomplete or inconsistent |
| 2 | Mostly present — exists but not enforced or not systematically applied |
| 3 | Fully present — documented, enforced, and reviewed on cadence |

---

## Dimension Scores

| # | Dimension | Domain | Score | Evidence | Gap Description | Severity |
|---|-----------|--------|-------|----------|----------------|----------|
| D01 | Pilot cohort and champion model | Rollout & Adoption | 1 | `kitty-specs/007-org-scale-agentic-governance/spec.md` §Adoption Plan: pilot cohort size (20–50), champion role, office hours described at spec level | Pilot criteria document not created; champion role not formalized in a standalone governance artifact; no assignment or onboarding record exists | P0 |
| D02 | Onboarding assets and checkpoints | Rollout & Adoption | 0 | No onboarding assets found in repo — no guided workflows, command examples, or checkpoint templates | No onboarding assets, checkpoint templates, or review criteria exist | P2 |
| D03 | Enablement cadence | Rollout & Adoption | 1 | `spec.md` §Adoption Plan: weekly training thread, weekly office hours, biweekly retrospectives described | Cadence is documented as intent in the spec only; no scheduled cadence document, calendar artifact, or process template exists | P2 |
| D04 | ROI metrics contract | Measurement & ROI | 1 | `spec.md` §ROI Metrics: six core metrics listed with collection and review owners (Engineering Operations, Platform Product Lead) and cadence (weekly × 8, then monthly) | No standalone metrics contract document; no baseline data collected; no dashboard or tracking artifact; owners are role labels only, not named individuals | P1 |
| D05 | Review cadence | Measurement & ROI | 1 | `spec.md` §ROI Metrics: weekly review for first 8 weeks, monthly thereafter | Cadence is documented in spec only; no scheduled review meeting, standing agenda template, or cadence enforcement mechanism exists | P1 |
| D06 | Measured vs perceived productivity tracking | Measurement & ROI | 0 | `spec.md` §User Story 4 and FR-013 define the requirement; no tracking mechanism, survey instrument, or data collection process exists | No artifact captures this distinction; neither survey nor measurement tooling exists | P1 |
| D07 | MCP integration approval rubric | Security & MCP | 1 | `spec.md` §Security + MCP Governance: five rubric dimensions listed (data access scope, credential/auth model, logging/auditability, external dependency risk, sandbox/execution constraints); lifecycle stages defined (request → assessment → pilot allowlist → full approval/deprecation) | No standalone rubric document; no approval workflow or request form; no record of any integration being assessed against the rubric | P0 |
| D08 | MCP catalog lifecycle and audit | Security & MCP | 0 | No MCP catalog document found in repo; no approved integration list, quarterly audit record, or deprecation log exists | Full catalog lifecycle tooling is absent | P2 |
| D09 | Artifact completeness | Spec & Artifact Integrity | 2 | `scripts/spec-governance-check.py`: ART-001/ART-002/ART-003 checks enforce presence of `spec.md`, `meta.json`, `checklists/requirements.md`, `plan.md`, `tasks.md`, `research.md` per lifecycle state. Sampled features: 002, 004, 005, 006, 007 — all complete for their lifecycle state. Feature 003 missing `tasks.md` placeholder only (spec-only lifecycle, lower bar). Feature 008 missing `checklists/` directory. | Check is automated and runs in CI (via `spec-governance.yml`), but enforcement gap: feature 008 (`kitty-specs/008-profile-isolation-and-scale`) has no `checklists/` directory despite `spec-only` state; check is P0-severity for `execution`/`done` features only, P1 for others — so non-`done` features with missing artifacts generate warnings that do not block merges | P0 |
| D10 | Cross-reference integrity | Spec & Artifact Integrity | 2 | `scripts/spec-governance-check.py`: REF-001 check validates all local markdown links in `spec/`, `kitty-specs/`, `.claude/commands`, `.kittify/memory`, `README.md`, `ROADMAP.md`, `.kittify/AGENTS.md` | Check runs in CI but only covers the scoped directories; inter-repo cross-references and external URL validity are not checked; no periodic review process beyond CI gate | P1 |
| D11 | Constitution sync | Spec & Artifact Integrity | 2 | `scripts/spec-governance-check.py`: CONST-001/CONST-002 checks enforce that `spec/constitution.md` and `.kittify/memory/constitution.md` are in sync (normalized text comparison). Constitution source confirmed present (v1.7, updated 2026-03-19). `.kittify/memory/constitution.md` confirmed present. | CI check enforces sync on push/PR; no explicit human review cadence for constitution content changes; CONST-002 triggers on any drift beyond title normalization, so enforcement is automated but review quality depends entirely on PR review discipline | P1 |
| D12 | Autonomy level classification | Autonomy & Safety | 1 | `spec.md` §Operating Maturity Model: Levels 0–5 defined with descriptions and governance position (default Level 3 target, Level 4 opt-in with scenario readiness criteria, Level 5 only with simulation controls) | No classification record assigns any team or workflow to a current level; no baseline maturity assessment document exists; no monthly review mechanism defined | P1 |
| D13 | Scenario holdout policy | Autonomy & Safety | 1 | `spec.md` §Scenario Validation Model and FR-011: behavioral scenarios stored separately from implementation context, used as holdout evaluation, pass/fail required release signal for Level 4/5 | No scenario repository, holdout directory, or scenario set exists; policy is documented as intent only; no enforcement mechanism prevents Level 4/5 deployment without scenarios | P1 |
| D14 | Digital twin / simulation requirements | Autonomy & Safety | 1 | `spec.md` §Scenario Validation Model and FR-012: high-autonomy workflows must define simulation or digital-twin strategy before production use | No simulation strategy document, sandbox environment definition, or digital twin design exists; requirement is stated but no artifact supports it | P2 |
| D15 | Legacy migration path | Autonomy & Safety | 1 | `spec.md` §Legacy Migration Path and FR-014: four-stage path defined (assist → document behavior → redesign CI/CD → selective autonomy) | Migration path is documented at spec level only; no per-team migration assessment, readiness checklist, or gating criteria artifact exists | P2 |
| D16 | Talent and role adaptation policy | Autonomy & Safety | 1 | `spec.md` §Talent and Org Evolution and FR-015: role shift toward specification and judgment work acknowledged; early-career safeguards mentioned | No standalone talent policy document; no role expectation update, career ladder revision, or supervised environment definition exists | P2 |
| D17 | Governance checks in CI | CI Enforcement | 2 | `.github/workflows/spec-governance.yml`: runs `scripts/spec-governance-check.py` on all PRs and pushes to `main`. Script checks: artifact presence by lifecycle (ART-001/003), metadata completeness (META-001), broken markdown links (REF-001), constitution sync (CONST-001/002), checklist consistency (CHK-001), platform-required sections (PLAT-001/002). Exits non-zero on P0 failures, blocking merges. | CI check covers spec/artifact governance only; no CI checks for rollout, ROI, MCP approval, or autonomy-level governance dimensions; coverage is narrow relative to the full governance model | P0 |

---

## Summary

- **Total dimensions**: 17
- **Score 3 (fully present)**: 0
- **Score 2 (mostly present)**: 4 — D09, D10, D11, D17
- **Score 1 (partially present)**: 10 — D01, D03, D04, D05, D07, D12, D13, D14, D15, D16
- **Score 0 (absent)**: 3 — D02, D06, D08
- **P0 gaps**: 4 (D01, D07, D09, D17)
- **P1 gaps**: 7 (D04, D05, D06, D10, D11, D12, D13)
- **P2 gaps**: 6 (D02, D03, D08, D14, D15, D16)

> **Note on count**: D17 scores 2 (partially enforced CI) but is P0-severity because CI coverage is incomplete relative to the full governance model; D09 scores 2 for the same reason.

**Governance health**: RED — No dimension reaches full compliance (score 3); the governance framework exists as documented intent in `spec.md` but has not been materialized into standalone artifacts, enforcement tooling, or review cadence. The four P0 gaps (pilot model, MCP rubric, artifact completeness enforcement breadth, CI governance scope) must be resolved before safe org-scale rollout can begin.
