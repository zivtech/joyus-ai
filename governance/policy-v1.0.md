# Joyus AI Agentic Governance Policy

**Version**: 1.0
**Date**: 2026-03-21
**Owner**: Platform Lead
**Review cadence**: Monthly during first 6 months; quarterly thereafter

## Purpose

This document defines the operating model for org-scale agentic workflows at Joyus AI. It governs how teams adopt AI-assisted development, how we measure outcomes, how we approve new integrations, and how autonomy levels are assigned and reviewed.

## Scope

Applies to all teams using the Joyus AI platform and all Spec Kitty-governed features. Does not apply to prototype work outside the `joyus-ai` repository.

## 1. Rollout Model

Teams onboard through a structured pilot → launch → scale → sustain sequence.

- **Pilot**: 20–50 users meeting cohort criteria
- **Champion model**: Pilot users serve as internal mentors and office-hours hosts
- **Launch event**: Organization kickoff with guided workflows and shared examples
- **Enablement cadence**: Weekly training thread, weekly office hours, biweekly retros for 8 weeks

**Pilot Criteria** (teams are selected based on):
1. Workflow breadth — teams with diverse task types generate more generalizable patterns
2. Documentation willingness — teams who will record patterns, not just use them
3. Baseline availability — teams able to collect 2-week pre-rollout metrics

## 2. ROI Measurement

See: [roi-metrics-contract.md](./roi-metrics-contract.md)

Key principle: collection and review ownership must be named before rollout starts. Anecdotal reporting is not acceptable as a primary signal.

Measured-vs-perceived productivity divergence (M06) is a first-class health signal. If divergence persists for 2+ weeks, scale-up is paused until remediation actions are logged.

## 3. MCP Integration Governance

See: [mcp-integration-rubric.md](./mcp-integration-rubric.md)

No new MCP integration reaches production without completing the four-stage approval lifecycle: request → assessment → pilot allowlist → full approval/deprecation. The Security Team owns assessment and quarterly audit. Any integration scoring 0 on any approval dimension is automatically blocked regardless of aggregate score.

## 4. Spec and Artifact Standards

All features governed by Spec Kitty must have:
- `spec.md`, `plan.md`, `tasks.md` (required for execution state)
- `data-model.md` (required for features with persistent state)
- `meta.json` with required fields: `measurement_owner`, `review_cadence`, `risk_class`, `lifecycle_state`

Governance checks run in CI on every pull request. P0 check failures block merge.

As of 2026-03-21, all new features generated via Spec Kitty include governance metadata fields by default.

## 5. Autonomy Level Classification

See: [autonomy-levels.md](./autonomy-levels.md)

- **Near-term default target**: Level 3 (agent implements, human judges via diffs)
- **Level 4**: Opt-in by workflow once scenario readiness criteria pass
- **Level 5**: Permitted only where scenario holdout validation and simulation controls are mature; requires per-workflow authorization from Platform Lead

## 6. Governance Review Cadence

| Review Type | Frequency | Owner |
|------------|-----------|-------|
| ROI metrics | Weekly (first 8 weeks), then monthly | Engineering Operations |
| MCP catalog audit | Quarterly | Security Team |
| Autonomy level re-classification | Monthly | Platform Lead |
| Policy document review | Monthly (first 6 months), then quarterly | Platform Lead |

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-03-21 | Initial publication |
