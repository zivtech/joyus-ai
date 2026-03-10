# Implementation Plan: Org-Scale Agentic Governance

**Branch**: `007-org-scale-agentic-governance` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/007-org-scale-agentic-governance/spec.md`

## Summary

Implement organization-wide governance for agentic coding: a maturity model (Levels 0–5), rollout operating model, ROI measurement framework, MCP integration governance, spec artifact validation tooling, scenario-based evaluation for high-autonomy workflows, and legacy migration guidance. Deliverables are a mix of governance documents (markdown), validation tooling (TypeScript/Python scripts), and CI enforcement (GitHub Actions).

## Technical Context

**Language/Version**: TypeScript 5.x (validation scripts), Markdown (governance documents)
**Primary Dependencies**: Vitest (testing), `@joyus-ai/shared` (existing schema utilities), `gray-matter` (YAML frontmatter parsing), `ajv` (JSON schema validation)
**Storage**: Governance artifacts in `kitty-specs/` and `docs/governance/`. Validation state in `meta.json` per feature.
**Testing**: `pnpm test` (Vitest), `pnpm typecheck` (tsc --noEmit)
**Target Platform**: GitHub Actions CI, local CLI
**Project Type**: Monorepo extension — new `packages/governance/` package + `docs/governance/` documents

## Constitution Check

*Validated against Constitution v1.6*

| Principle | Status | Notes |
|-----------|--------|-------|
| §1.0 Platform Identity | PASS | Governance model applies to any organization deploying joyus-ai (internal, managed, self-service). |
| §2.1 Multi-Tenant from Day One | PASS | Maturity levels and governance checks are per-team, supporting multi-tenant deployments. |
| §2.2 Skills as Encoded Knowledge | PASS | Governance validates that skills are loaded and enforced per Feature 004. Maturity rubric includes skill adoption as a progression criterion. |
| §2.3 Sandbox by Default | PASS | Governance enforces sandbox-first posture; Level 4/5 require explicit evidence before relaxation. |
| §2.4 Monitor Everything | PASS | Adds explicit instrumentation: ROI metrics, adoption tracking, measured vs perceived productivity comparison. Four-layer monitoring (Usage, Output Accuracy, Guardrails, Insights) mapped to maturity levels. |
| §2.5 Feedback Loops | PASS | Weekly review cadence for pilot (8 weeks), biweekly retros, monthly steady-state. Divergence triggers remediation. |
| §2.6 Mediated AI Access | PASS | Governance model assumes mediated access as the default. Direct agent access is Level 0/1; mediated access is Level 2+. |
| §2.7 Automated Pipelines | PASS | Scenario holdout validation (FR-011) and simulation strategy (FR-012) govern pipeline autonomy. |
| §2.8 Open Source | N/A | Governance documents are internal; no open-source implications. |
| §2.9 Assumption Awareness | PASS | Maturity rubric requires explicit assumption tracking. Legacy migration path includes assumption extraction phase. |
| §2.10 Client-Informed Platform-Generic | PASS | Governance model uses generic team/org terminology. No client-specific references. |
| §3.3 Audit Trail | PASS | NFR-004 requires auditable autonomy-level decisions with evidence links. |
| §5.2 Cost Awareness | PASS | ROI metrics include spend-per-user and spend-per-task-type tracking. |

## Project Structure

### Documentation (this feature)

```
kitty-specs/007-org-scale-agentic-governance/
├── spec.md              # Feature specification
├── plan.md              # This file
├── tasks.md             # Work package breakdown
├── data-model.md        # Governance data schemas
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks/               # WP prompt files (to be created)
```

### Source Code (repository root)

```
docs/governance/
├── rollout-playbook.md          # WP01: Rollout operating model
├── maturity-rubric.md           # WP01: Level 0-5 scoring rubric
├── roi-metrics-contract.md      # WP02: ROI measurement framework
├── mcp-governance-lifecycle.md  # WP03: MCP approval + audit process
├── scenario-validation-guide.md # WP06: Holdout evaluation + simulation
├── legacy-migration-guide.md    # WP06: Staged migration path
└── talent-adaptation-policy.md  # WP06: Role evolution + early-career safeguards

packages/governance/
├── src/
│   ├── checks/
│   │   ├── artifact-completeness.ts  # WP05: Required fields per artifact type
│   │   ├── reference-integrity.ts    # WP05: Cross-reference link validation
│   │   ├── constitution-sync.ts      # WP05: Constitution version alignment
│   │   └── index.ts                  # Check registry
│   ├── scoring/
│   │   ├── maturity-classifier.ts    # WP01: Team maturity level scoring
│   │   └── rubric-schema.ts          # WP01: Rubric data types
│   ├── reporting/
│   │   ├── terminal-reporter.ts      # NFR-002: Human-readable output
│   │   └── json-reporter.ts          # NFR-002: Machine-parseable output
│   └── cli.ts                        # CLI entry point
├── tests/
│   ├── checks/
│   ├── scoring/
│   └── reporting/
├── package.json
└── tsconfig.json

.github/workflows/
└── governance.yml                # WP05: CI enforcement workflow
```

## Work Breakdown

1. **WP01 — Baseline & Scoring**: Publish maturity rubric with measurable criteria per level. Score all current teams. Produce rollout playbook.
2. **WP02 — ROI Metrics Contract**: Define baseline collection protocol, metric definitions, ownership, review cadence. Produce ROI contract document.
3. **WP03 — MCP Governance Lifecycle**: Define approval rubric, curated catalog, quarterly audit process. Produce governance lifecycle document.
4. **WP04 — Spec Governance Contracts**: Define required metadata fields, artifact completeness rules, governance policy document.
5. **WP05 — Automated Checks & CI**: Implement validation scripts (artifact completeness, reference integrity, constitution sync). Add CI workflow. Dual-format output (terminal + JSON).
6. **WP06 — Autonomy & Scenario Policy**: Define holdout evaluation criteria, simulation strategy, legacy migration stages, talent adaptation policy.

## Risks

1. **Rubric subjectivity**: Without measurable criteria per level, maturity classification becomes opinion-based. Mitigation: WP01 defines observable, countable criteria (e.g., "≥80% of commits are AI-generated").
2. **Adoption resistance**: Governance perceived as bureaucratic overhead. Mitigation: Rollout playbook emphasizes enablement (office hours, champions) over enforcement.
3. **Validation scope creep**: Governance checks could expand indefinitely. Mitigation: Start with 3 core checks (completeness, references, constitution sync); add checks only with P0 justification.
4. **Cross-feature dependency**: Governance checks consume Feature 004's audit trail. If 004 isn't deployed, governance tooling runs against static artifacts only. Mitigation: Design checks to work with filesystem artifacts first, extend to runtime audit data later.

## Exit Criteria

1. All 7 success criteria from spec.md are verifiable.
2. Governance validation script runs locally and in CI (NFR-001).
3. Output is dual-format: terminal-readable and JSON-parseable (NFR-002).
4. All governance documents are versioned in repository (NFR-003).
5. Maturity level decisions include evidence links (NFR-004).
6. P0 findings block CI merges; P1/P2 are advisory.

## Deferred Items

| Item | Reason | Target |
|------|--------|--------|
| Runtime audit trail integration | Depends on Feature 004 deployment | Phase 3 |
| Automated maturity level re-scoring | Requires production metrics pipeline | Post-rollout |
| Digital twin infrastructure | FR-012 defines policy; implementation depends on Feature 009 pipeline framework | Feature 009 |
| Dashboard UI for governance metrics | Governance data is queryable via JSON; visual dashboard is nice-to-have | Future |
