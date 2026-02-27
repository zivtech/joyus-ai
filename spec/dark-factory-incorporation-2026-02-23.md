# Dark Factory Incorporation Memo - 2026-02-23

## Source Context
This memo incorporates the supplied article describing:
- Level 5 autonomous software factories (StrongDM pattern)
- high frontier internal AI-code ratios (Anthropic/Claude Code)
- measured productivity regressions in mainstream workflows (METR RCT)
- organizational/talent implications of shifting from implementation to specification + outcome judgment

## Why This Matters for Joyus
Our current governance baseline solved structural P0 gaps, but this article highlights a second-order risk:
- teams can feel faster while getting slower,
- and can over-index on tool adoption without workflow redesign.

The incorporation goal is to prevent false progress while creating an explicit path from Level 2/3 behavior to Level 4 outcomes where appropriate.

## Incorporated Policy Direction

### 1) Operating Maturity Model (Five Levels)
Adopt the five-level model as governance vocabulary:
- L0: spicy autocomplete
- L1: coding intern
- L2: junior developer
- L3: developer as manager (diff-driven)
- L4: developer as PM (spec + outcomes)
- L5: dark factory (spec in, software out)

Policy:
- No team self-declares L4/L5 without measured evidence.
- Each rollout cohort is baselined at one level and re-scored monthly.

### 2) Outcome Evaluation over Diff Evaluation
For workflows targeting L4/L5 behavior:
- Require scenario-based external evaluation, with holdout scenarios not included in agent context.
- Treat scenario pass rate and behavior correctness as shipping signals over raw diff quality metrics.

### 3) J-Curve and Perception Gap Controls
Require paired measurement for all pilot teams:
- measured throughput and lead time deltas,
- perceived productivity deltas from developer self-report.

If perception and measured outcomes diverge materially, remediation is required before scaling.

### 4) Legacy System Migration Reality
Codify staged migration for brownfield systems:
1. L2/L3 assisted implementation in existing workflows.
2. Behavior documentation and scenario extraction from legacy systems.
3. CI/CD redesign for AI-generated code at volume.
4. Selective L4/L5 adoption on net-new or bounded domains.

### 5) Org and Talent Model Updates
Recognize role shift from coordination-heavy to specification/judgment-heavy work.
Policy additions:
- define spec quality as an explicit performance competency,
- create supervised training environments for early-career engineers (residency-like model),
- track talent pipeline health as a governance metric.

## What We Are Not Adopting Yet
- Full Level 5 operation as a blanket policy.
- Human-free shipping across all domains.
- Token spend targets as a universal KPI.

These remain contingent on scenario harness maturity, legacy migration readiness, and risk class.

## Immediate Integration Targets
1. `kitty-specs/007-org-scale-agentic-governance/spec.md`
2. `spec/agentic-coding-remediation-backlog-2026-02-23.md`
3. `spec/cto-brief-agentic-governance-2026-02-23.md`

## Decision Request for Leadership
Approve this as the official interpretation:
- Target **measured Level 3/4 excellence** first,
- use Level 5 selectively where scenario validation + sandboxing + holdout governance are demonstrably mature.
