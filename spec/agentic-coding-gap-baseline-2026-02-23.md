# Agentic Coding Gap Baseline - 2026-02-23

## Benchmark
- Source: Anthropic, "Scaling agentic coding across your organization" (2025)
- Benchmark date context: guide reflects insights through August 2025; baseline completed on February 23, 2026.
- Scope: `spec/`, `kitty-specs/`, `.claude/commands/`, `.kittify/`, `README.md`, `ROADMAP.md`.

## Maturity Rubric (0-3)

| Dimension | 0 - Missing | 1 - Ad hoc | 2 - Defined | 3 - Operationalized |
|---|---|---|---|---|
| Rollout Operating Model | No rollout model | Pilot ideas only | Written model with roles and stages | Active cadence with checkpoints and owners |
| CLAUDE.md Governance | No standard | Local conventions only | Required sections + review expectations | Enforced updates in workflow/onboarding |
| Prompt/TDD Operating Standard | No guidance | Scattered examples | Standardized format + decomposition + test-first guidance | Validated in command templates + checks |
| ROI Measurement Contract | No metrics contract | Isolated metrics mention | Baseline metrics + owner + cadence | Measured and reviewed on schedule |
| Security + MCP Governance | No governance lifecycle | Security principles only | Approval rubric + curated catalog + review cycle | Enforced by policy checks |
| Spec Integrity | No artifact standards | Manual consistency only | Required artifact matrix + validation script | CI gate + periodic audit |
| Source-of-Truth Freshness | Docs drift unmanaged | Known drift documented | Drift checks + owners | Automated checks + release updates |

## Baseline Matrix

| Dimension | Score | Evidence | Gap | Severity |
|---|---:|---|---|---|
| Rollout Operating Model | 1 | `spec/plan.md:134` has a rollout plan for session tracking pilot only; no org-wide champion/hackathon/workshop model | Missing reusable org-scale rollout operating model | P1 |
| CLAUDE.md Governance | 2 | `CLAUDE.md:16` enforces abstraction rule; references in platform specs (`kitty-specs/003-platform-architecture-overview/spec.md:236`) | Missing explicit review cadence and onboarding gate in governance docs | P1 |
| Prompt/TDD Operating Standard | 2 | Strong command guidance in `.claude/commands/spec-kitty.specify.md`; no explicit test-first/two-step prompt standard as a required cross-feature gate | Standard exists but not encoded as enforceable contract | P1 |
| ROI Measurement Contract | 1 | Success criteria exist per feature; no central ROI contract with baseline metrics, owner, cadence | Missing org-level ROI measurement contract | P0 |
| Security + MCP Governance | 1 | Security principles present in constitution; no MCP approval lifecycle or periodic review policy in governance | Missing standardized MCP governance lifecycle | P0 |
| Spec Integrity | 1 | `spec/spec-governance.md:106` lifecycle rules exist, but missing concrete artifact matrix and automated validation | No enforced artifact completeness + consistency checks | P0 |
| Source-of-Truth Freshness | 1 | Drift visible: `README.md:105` says `001` complete while pride status shows in-progress; missing linked docs in `spec/plan.md:32` and `spec/plan.md:101` | Source docs not auto-validated for drift | P0 |

## High-Confidence Gaps (Validated)

1. No explicit org rollout operating model spec for pilot cohort/champions/enablement cadence.
2. No formal ROI contract equivalent to benchmark guide.
3. No formal MCP integration governance lifecycle.
4. Constitution drift existed between `spec/constitution.md` and `.kittify/memory/constitution.md`.
5. Artifact inconsistency:
- `kitty-specs/003-platform-architecture-overview` missing planning artifacts.
- `kitty-specs/005-content-intelligence` missing `checklists/requirements.md`.
6. Broken references in `spec/plan.md` for `hosting-comparison.md` and `internal-ai-portal-spec.md`.
7. Status drift between `README.md` and current feature state.

## Severity Definition
- P0: breaks governance reliability or blocks trustworthy rollout decisions.
- P1: materially reduces adoption, execution speed, or consistency.
- P2: quality improvement that can follow after P0/P1 closure.
