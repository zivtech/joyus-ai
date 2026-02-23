# Agentic Coding Remediation Backlog - 2026-02-23 to 2026-03-20

## Prioritization Basis
- Priority lens: adoption plus ROI first.
- Scope: public plus process artifacts in this repository.

## Epic E1 - Adoption and Rollout Spec

| ID | Priority | Owner Role | Target Files | Acceptance Test | Due Date |
|---|---|---|---|---|---|
| E1-01 | P1 | Platform Product Lead | `kitty-specs/007-org-scale-agentic-governance/spec.md` | Spec contains pilot cohort, champion model, launch event, enablement cadence, onboarding flow | 2026-03-04 |
| E1-02 | P1 | Developer Experience Lead | `.claude/commands/spec-kitty.specify.md` | New platform-level specs require adoption section in generation/checklist rules | 2026-03-06 |
| E1-03 | P1 | Documentation Owner | `README.md`, `ROADMAP.md` | Public docs reference the new governance stream and no longer conflict with current feature state | 2026-03-08 |

## Epic E2 - ROI Metrics Spec

| ID | Priority | Owner Role | Target Files | Acceptance Test | Due Date |
|---|---|---|---|---|---|
| E2-01 | P0 | Engineering Operations | `kitty-specs/007-org-scale-agentic-governance/spec.md` | Spec includes baseline metrics, owner model, review cadence, and instrumentation path | 2026-03-04 |
| E2-02 | P0 | Spec Governance Owner | `kitty-specs/*/meta.json` | Metadata includes `measurement_owner`, `review_cadence`, and `risk_class` | 2026-03-07 |
| E2-03 | P1 | Validation Maintainer | `scripts/spec-governance-check.py` | Script reports missing ROI metadata and platform-level ROI section gaps | 2026-03-10 |

## Epic E3 - Security and MCP Governance Spec

| ID | Priority | Owner Role | Target Files | Acceptance Test | Due Date |
|---|---|---|---|---|---|
| E3-01 | P0 | Security Lead | `kitty-specs/007-org-scale-agentic-governance/spec.md` | Spec contains MCP approval rubric, curated catalog model, quarterly audit cadence | 2026-03-04 |
| E3-02 | P0 | Governance Maintainer | `spec/spec-governance.md` | Governance doc defines required security plus MCP sections and validation policy | 2026-03-09 |
| E3-03 | P1 | Tooling Maintainer | `scripts/spec-governance-check.py`, `scripts/pride-status.py` | Checks surface security plus MCP governance coverage for platform-risk features | 2026-03-11 |

## Epic E4 - Spec Workflow Hardening

| ID | Priority | Owner Role | Target Files | Acceptance Test | Due Date |
|---|---|---|---|---|---|
| E4-01 | P0 | Tooling Maintainer | `scripts/spec-governance-check.py` | Artifact completeness, markdown links, constitution drift, and checklist consistency checks run in one command | 2026-03-12 |
| E4-02 | P0 | CI Maintainer | `.github/workflows/spec-governance.yml` | Governance checks run on push and pull request, failing on P0 violations | 2026-03-13 |
| E4-03 | P1 | Command Template Owner | `.claude/commands/spec-kitty.specify.md` | Checklist template includes adoption/ROI/security governance checks | 2026-03-13 |

## Epic E5 - Docs and Reference Consistency

| ID | Priority | Owner Role | Target Files | Acceptance Test | Due Date |
|---|---|---|---|---|---|
| E5-01 | P0 | Architecture Owner | `spec/plan.md`, `spec/internal-ai-portal-spec.md`, `spec/hosting-comparison.md` | No broken local markdown references in planning docs | 2026-03-05 |
| E5-02 | P0 | Governance Owner | `spec/constitution.md`, `.kittify/memory/constitution.md` | Constitution sync check passes after title-normalized diff | 2026-03-05 |
| E5-03 | P1 | Spec Maintainer | `kitty-specs/003-platform-architecture-overview/plan.md`, `kitty-specs/003-platform-architecture-overview/research.md`, `kitty-specs/003-platform-architecture-overview/tasks.md`, `kitty-specs/005-content-intelligence/checklists/requirements.md` | Missing artifacts are present and pass governance check | 2026-03-08 |

## Exit Criteria for 2026-03-20 Freeze
1. All P0 items complete.
2. Governance check reports zero failing checks.
3. Remaining P1/P2 items listed with owner and dates.
4. Governance baseline marked as vNext in `spec/spec-governance.md`.
