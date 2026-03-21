---
work_package_id: "WP04"
title: "Workflow and Metadata Contracts"
lane: "planned"
dependencies: ["WP02"]
subtasks: ["T014", "T015", "T016", "T017"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-sonnet"
---

# WP04: Workflow and Metadata Contracts

**Implementation command**: `spec-kitty implement WP04`
**Target repo**: `joyus-ai`
**Dependencies**: WP02 (remediation-backlog.md must exist)
**Priority**: P1
**Parallel with**: WP03 (can run concurrently after WP02 completes)

## Objective

Harden the spec metadata standard across all active features, update spec-kitty generation rules to require the new fields, and publish the two primary governance policy documents: `governance/policy-v1.0.md` and `governance/roi-metrics-contract.md`.

## Context

The `FeatureGovernanceMeta` schema from `data-model.md` defines four fields that must be present in every feature's `meta.json`:
- `measurement_owner`: named role responsible for metric collection
- `review_cadence`: `weekly` | `monthly` | `quarterly`
- `risk_class`: `low` | `platform` | `critical`
- `lifecycle_state`: `spec-only` | `planning` | `execution` | `done`

As of WP01's baseline assessment, these fields are likely absent or inconsistently present across features. This WP adds them to all active feature `meta.json` files and updates the generation tooling so future features include them automatically.

The governance policy document (`policy-v1.0.md`) is the umbrella document that references all other governance artifacts. It is the first document a new team member should read to understand the operating model. The ROI metrics contract (`roi-metrics-contract.md`) is the specific measurement agreement required by FR-004 and FR-005.

---

## Subtasks

### T014: Add required metadata fields to all active feature meta.json

**Purpose**: Backfill `measurement_owner`, `review_cadence`, `risk_class`, and `lifecycle_state` into every feature `meta.json` that lacks them.

**Steps**:

1. List all feature directories under `joyus-ai/kitty-specs/`.
2. For each feature, read its `meta.json` and identify missing fields from the `FeatureGovernanceMeta` schema.
3. Assign values based on available evidence:
   - `lifecycle_state`: derive from feature content — does it have a tasks.md with WP files? → `execution`; only spec.md? → `spec-only`; plan.md but no WP files? → `planning`
   - `risk_class`: assign based on feature scope:
     - `critical`: features that touch auth, multi-tenancy isolation, or data pipelines
     - `platform`: features that change shared infrastructure, APIs, or core workflows
     - `low`: features that add optional capabilities, docs, or isolated tooling
   - `measurement_owner`: use role names from spec.md §ROI Metrics — "Engineering Operations" as default; "Platform Lead" for strategic/adoption features
   - `review_cadence`: `weekly` during first 8 weeks post-launch; `monthly` for steady-state features; `quarterly` for done/archived features
4. Update each `meta.json` with the new fields. Do not remove or rename existing fields.
5. Record which features were updated in `governance/remediation-backlog.md`.

**meta.json schema extension**:

```json
{
  "feature_number": "007",
  "title": "Org-Scale Agentic Governance",
  "measurement_owner": "Platform Lead",
  "review_cadence": "weekly",
  "risk_class": "platform",
  "lifecycle_state": "planning"
}
```

**risk_class guidance for known features**:

| Feature | Expected risk_class |
|---------|-------------------|
| 001 MCP Server AWS Deployment | platform |
| 003 Orchestrator | critical |
| 007 Org-Scale Governance | platform |
| Features adding docs or tooling only | low |

**Files**:
- `joyus-ai/kitty-specs/NNN-*/meta.json` for all active features (updated)

**Validation**:
- [ ] All four fields (`measurement_owner`, `review_cadence`, `risk_class`, `lifecycle_state`) are present in every feature `meta.json`
- [ ] No existing meta.json fields were removed or renamed
- [ ] `lifecycle_state` values match actual feature artifact presence (no feature without WP files is marked `execution`)
- [ ] `risk_class` values are one of `low` | `platform` | `critical` (no freeform text)

---

### T015: Update spec-kitty generation rules for new fields

**Purpose**: Ensure that when spec-kitty generates a new feature, it includes the four governance metadata fields in the generated `meta.json` template so future features are compliant by default.

**Steps**:

1. Locate spec-kitty's generation rules or command templates in `joyus-ai`. Look for:
   - A `meta.json` template or schema file
   - A generation script (Python, shell, or JS)
   - A CLAUDE.md or AGENTS.md rule that defines the `meta.json` structure
2. Add the four `FeatureGovernanceMeta` fields to the `meta.json` template with sensible defaults:
   - `measurement_owner`: `"[REQUIRED — assign to Engineering Operations or Platform Lead]"`
   - `review_cadence`: `"weekly"` (safest default for new features)
   - `risk_class`: `"platform"` (safest non-critical default)
   - `lifecycle_state`: `"spec-only"` (correct state for a newly generated feature)
3. If a generation script exists, add validation that rejects a `meta.json` without these fields.
4. If the generation rule is in a markdown command template (e.g., CLAUDE.md), add the fields to the example `meta.json` in that template.
5. Document the change: add a note to `governance/policy-v1.0.md` §Spec Standards stating when this change took effect.

**If spec-kitty uses a markdown template** (most likely case):

Find the section that defines `meta.json` content and extend it:

```markdown
## meta.json Requirements

Every feature must have a `meta.json` with these fields:

```json
{
  "feature_number": "NNN",
  "title": "Feature Title",
  "measurement_owner": "Engineering Operations",
  "review_cadence": "weekly",
  "risk_class": "platform",
  "lifecycle_state": "spec-only"
}
```

`measurement_owner`, `review_cadence`, `risk_class`, and `lifecycle_state` are required.
The governance check script will fail on any feature missing these fields.
```

**Files**:
- Spec-kitty template or generation script (updated)
- `joyus-ai/governance/policy-v1.0.md` §Spec Standards note (updated in T016)

**Validation**:
- [ ] The meta.json template or generation script includes all four new fields
- [ ] Default values are present and sensible (not blank, not "TBD")
- [ ] If a validation step exists, it rejects meta.json missing any required field
- [ ] The generation change is documented with an effective date

---

### T016: Write governance policy document v1.0

**Purpose**: Produce the umbrella governance policy document that consolidates the operating model, references all governance artifacts, and serves as the first-read document for new team members.

**Steps**:

1. Create `joyus-ai/governance/policy-v1.0.md` covering all sections below.
2. Every section that references another governance artifact must include a relative path link.
3. Version the document with a changelog at the bottom — v1.0 with the current date.
4. The document must be self-contained enough that a reader can understand the governance model without needing to read all referenced artifacts first.

**Document structure**:

```markdown
# Joyus AI Agentic Governance Policy

**Version**: 1.0
**Date**: YYYY-MM-DD
**Owner**: Platform Lead
**Review cadence**: Monthly during first 6 months; quarterly thereafter

## Purpose

This document defines the operating model for org-scale agentic workflows at Joyus AI.
It governs how teams adopt AI-assisted development, how we measure outcomes, how we
approve new integrations, and how autonomy levels are assigned and reviewed.

## Scope

Applies to all teams using the Joyus AI platform and all Spec Kitty-governed features.
Does not apply to prototype work outside the `joyus-ai` repository.

## 1. Rollout Model

Teams onboard through a structured pilot → launch → scale → sustain sequence.

- **Pilot**: 20–50 users meeting cohort criteria defined in §Pilot Criteria
- **Champion model**: Pilot users serve as internal mentors and office-hours hosts
- **Launch event**: Organization kickoff with guided workflows and shared examples
- **Enablement cadence**: Weekly training thread, weekly office hours, biweekly retros for 8 weeks

**Pilot Criteria** (teams are selected based on):
1. Workflow breadth — teams with diverse task types generate more generalizable patterns
2. Documentation willingness — teams who will record patterns, not just use them
3. Baseline availability — teams able to collect 2-week pre-rollout metrics

See: [rollout operations guide](./rollout-operations.md) (stub — pending authoring)

## 2. ROI Measurement

See: [roi-metrics-contract.md](./roi-metrics-contract.md)

Key principle: collection and review ownership must be named before rollout starts.
Anecdotal reporting is not acceptable as a primary signal.

Measured-vs-perceived productivity divergence is a first-class health signal (FR-013).
If divergence persists for 2+ weeks, scale-up is paused until remediation actions are logged.

## 3. MCP Integration Governance

See: [mcp-integration-rubric.md](./mcp-integration-rubric.md)

No new MCP integration reaches production without completing the four-stage approval lifecycle.
The Security Team owns assessment and quarterly audit.

## 4. Spec and Artifact Standards

All features governed by Spec Kitty must have:
- `spec.md`, `plan.md`, `tasks.md` (required)
- `data-model.md` (required for features with persistent state)
- `meta.json` with `measurement_owner`, `review_cadence`, `risk_class`, `lifecycle_state`

Governance checks run in CI. P0 check failures block merge. See: [../scripts/governance-check.py]

## 5. Autonomy Level Classification

See: [autonomy-levels.md](../../../governance/autonomy-levels.md)

Near-term default target: Level 3 (agent implements, human judges via diffs).
Level 4 is opt-in by workflow once scenario readiness criteria pass.
Level 5 is permitted only where scenario holdout validation and simulation controls are mature.

## 6. Governance Review Cadence

| Review Type | Frequency | Owner |
|------------|-----------|-------|
| ROI metrics | Weekly (first 8 weeks), then monthly | Eng Operations |
| MCP catalog audit | Quarterly | Security Team |
| Autonomy level re-classification | Monthly | Platform Lead |
| Policy document review | Monthly (first 6 months) | Platform Lead |

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | YYYY-MM-DD | Initial publication |
```

**Files**:
- `joyus-ai/governance/policy-v1.0.md` (new, ~100 lines)

**Validation**:
- [ ] All 6 policy sections are present
- [ ] Every cross-reference to another governance doc uses a relative path link
- [ ] Rollout model matches spec.md §Adoption Plan (pilot cohort size, champion model, 8-week cadence)
- [ ] Autonomy level references match spec.md §Operating Maturity Model
- [ ] Changelog is present with v1.0 entry
- [ ] Document has owner and review cadence in header

---

### T017: Draft ROI metrics contract with owner attribution

**Purpose**: Produce the specific measurement agreement that Engineering Operations and the Platform Lead sign off on before rollout begins. This is the artifact that satisfies FR-004 and FR-005.

**Steps**:

1. Create `joyus-ai/governance/roi-metrics-contract.md`.
2. Include all 6 core metrics from `spec.md §ROI Metrics`:
   - Lead time for standard tasks
   - Throughput per sprint
   - Suggestion acceptance proxy metrics
   - Spend per active user and per task type
   - Onboarding time-to-productivity
   - Measured vs perceived productivity delta
3. For each metric: define the measurement method, data source, collection owner, and review owner.
4. Define the baseline collection period (2 weeks pre-rollout) and what constitutes a valid baseline.
5. Define the review cadence table: weekly for first 8 weeks, monthly at steady state.
6. Define remediation trigger: what divergence or regression threshold triggers a required remediation action.
7. Include a sign-off section with named owner roles (not individual names — roles only).

**Document structure**:

```markdown
# ROI Metrics Contract

**Version**: 1.0
**Date**: YYYY-MM-DD
**Collection Owner**: Engineering Operations
**Review Owner**: Platform Lead
**Baseline Period**: 2 weeks pre-rollout for each participating team

## Metrics

### M01: Lead Time for Standard Tasks
- **Definition**: Elapsed time from task assignment to PR merge for a defined set of standard task types
- **Measurement method**: Git/project management tooling — PR open timestamp to merge timestamp
- **Data source**: GitHub API or project tracker
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M02: Throughput per Sprint
- **Definition**: Count of completed story points or tasks per sprint per team
- **Measurement method**: Sprint report from project tracker
- **Data source**: Jira or equivalent
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M03: Suggestion Acceptance Proxy
- **Definition**: Ratio of AI-generated code blocks retained in final PR vs total AI-generated blocks
- **Measurement method**: Diff analysis on PRs tagged with AI-assist label
- **Data source**: GitHub PR diffs + AI-assist label
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M04: Spend per Active User and Task Type
- **Definition**: Monthly AI platform spend divided by active users; segmented by task type where tooling permits
- **Measurement method**: Platform billing API + user activity log
- **Data source**: Anthropic API billing + internal usage logs
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M05: Onboarding Time-to-Productivity
- **Definition**: Time from first platform access to first independently completed AI-assisted task
- **Measurement method**: User onboarding log; define "productive task" threshold before rollout
- **Data source**: Platform activity logs + self-report
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M06: Measured vs Perceived Productivity Delta
- **Definition**: Difference between M01/M02 trend and self-reported productivity score (weekly survey, 1–5 scale)
- **Measurement method**: M01/M02 normalized trend vs weekly pulse survey
- **Data source**: Metric calculations + survey tool
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead
- **Special rule**: Persistent divergence (≥2 weeks with measured flat or declining, perceived positive) triggers mandatory remediation before scale-up

## Review Cadence

| Period | Frequency | Forum | Trigger for Remediation |
|--------|-----------|-------|------------------------|
| Weeks 1–8 | Weekly | Platform sync | Any M01/M02 regression OR M06 divergence ≥2 weeks |
| Week 9+ | Monthly | Platform review | M01/M02 regression >10% from week-8 baseline |

## Baseline Validity Criteria

A baseline is valid when:
1. At least 10 business days of data collected before rollout
2. At least 3 team members contributing to data (single-contributor baselines are invalid)
3. No major concurrent process changes during baseline period (releases, reorgs, major incidents)

## Sign-off

| Role | Responsibility |
|------|--------------|
| Engineering Operations | Metric collection, data source maintenance, weekly reporting |
| Platform Lead | Review ownership, remediation trigger calls, escalation |

*Both roles must confirm readiness before rollout begins for any new team cohort.*
```

**Files**:
- `joyus-ai/governance/roi-metrics-contract.md` (new, ~90 lines)

**Validation**:
- [ ] All 6 metrics from spec.md §ROI Metrics are present
- [ ] Each metric has measurement method, data source, collection owner, review owner
- [ ] M06 (measured vs perceived) has the special remediation trigger rule
- [ ] Review cadence table covers weekly (8 weeks) and monthly (steady state)
- [ ] Baseline validity criteria are present
- [ ] Sign-off section has role-level (not individual-name) owners

---

## Definition of Done

- [ ] All active feature `meta.json` files have the four required governance fields
- [ ] Spec-kitty generation template updated to include new fields with defaults
- [ ] `governance/policy-v1.0.md` published with all 6 sections
- [ ] `governance/roi-metrics-contract.md` published with all 6 metrics
- [ ] All WP04 RI items in `remediation-backlog.md` updated to `done`
- [ ] WP05 can validate all WP04 outputs (metadata fields, doc existence) without errors

## Risks

- **meta.json field conflicts**: Existing features may have non-standard fields. Read before writing — do not overwrite custom fields that may be spec-kitty internal state.
- **Policy document scope creep**: `policy-v1.0.md` should reference other docs, not duplicate them. Keep sections concise; if a section exceeds 20 lines, it likely belongs in a dedicated doc.
- **ROI metrics calibration**: The measurement methods for M03 (suggestion acceptance proxy) and M06 (measured vs perceived) require tooling that may not yet exist. Document the intended method and note which require tooling development before they are collectible.
- **Generation rule location**: Spec-kitty generation rules may live in a CLAUDE.md, a script, or a separate config. If the location is unclear, search for where `meta.json` templates appear and update that canonical source.

## Reviewer Guidance

- Check that `policy-v1.0.md` is genuinely self-contained — a new team member should understand the governance model from this document alone, without reading all referenced artifacts first.
- Verify that the ROI metrics contract's remediation trigger for M06 matches the spec (persistent divergence ≥2 weeks, not a one-time occurrence).
- Confirm that `meta.json` updates do not break any existing spec-kitty workflows — the new fields should be additive, not replace existing ones.
- The spec-kitty generation rule update is load-bearing for future compliance. Check that the default `lifecycle_state` of `spec-only` is correct (new features should not default to `execution`).
