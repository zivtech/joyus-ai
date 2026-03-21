# Legacy System Migration Guide

**Version**: 1.0
**Date**: 2026-03-21
**Owner**: Platform Lead
**Spec reference**: 007-org-scale-agentic-governance §Legacy Migration Path, FR-014, User Story 5

---

## Purpose

This guide defines the four-phase migration path for teams operating on brownfield systems who need a realistic, gated path toward higher-autonomy operation — rather than a forced jump to Level 4 or Level 5.

The Platform Lead **holds** (not advises) teams at their current phase when exit criteria are unmet. Progression is not time-based; it is evidence-based.

---

## Phase Overview

| Phase | Name | Target Autonomy Level | Minimum Duration |
|-------|------|-----------------------|-----------------|
| 1 | Assist | Level 2 | 6 weeks |
| 2 | Documentation | Level 2–3 | Until behavior specs complete |
| 3 | Pipeline | Level 3 (new features only) | Until CI gates stable |
| 4 | Selective Autonomy | Level 4 (bounded domains) | Platform Lead authorization required |

---

## Phase 1 — Assist

**Goal**: Introduce agentic tooling into the existing workflow without changing delivery model or review expectations.

**Entry criteria**:
- Team has completed basic onboarding
- At least one senior engineer understands Level 2 operating behaviors
- Governance checks configured in local environment

**Activities**:
- Use Level 2 workflows for all agent-assisted work: multi-file execution, full human review of every diff
- Identify 3–5 candidate workflows suitable for behavioral documentation in Phase 2
- Begin collecting baseline ROI metrics (see ROI Metrics section in spec.md)
- No agentic commit path to main; all commits are human-authored or human-reviewed line-by-line

**Exit criteria**:
- Minimum 6 weeks in Phase 1
- Governance checks passing with no P0 failures for the final 2 weeks
- 3–5 candidate workflows identified and documented in the legacy system assessment (see template below)
- Baseline ROI metrics collected for at least 2 weeks

**Risk signals** (indicate Phase 1 is not ready to exit):
- Human reviewers are rewriting agent output rather than reviewing diffs
- Governance check failures are accumulating without remediation
- Team cannot articulate what the agent is doing differently from manual implementation

---

## Phase 2 — Documentation

**Goal**: Extract and codify the current system's behavioral specifications and create the scenario foundation needed for higher autonomy.

**Entry criteria**:
- Phase 1 exit criteria met
- Platform Lead has reviewed the legacy system assessment and approved Phase 2 entry

**Activities**:
- Extract behavioral specs: write explicit `spec.md` artifacts for the candidate workflows identified in Phase 1
- Create scenario sets in `governance/scenarios/{workflow-name}/` for each candidate workflow (see scenario-policy.md)
- Document integration dependencies: identify all external systems the workflow touches
- Identify which integrations would require a digital twin for Level 4 operation

**Exit criteria**:
- Behavioral specs exist for all candidate workflows
- At least one scenario set created and reviewed per candidate workflow
- External integration inventory complete
- No new P0 governance check failures introduced

**Risk signals**:
- Behavioral specs are being written from memory rather than observed system behavior — pause and verify against the running system
- Scenario sets reference the same examples used in spec files (anti-overfitting violation — see scenario-policy.md)

---

## Phase 3 — Pipeline

**Goal**: Update CI/CD and quality gates to handle AI-generated change volume; apply Level 3 to new features only.

**Entry criteria**:
- Phase 2 exit criteria met
- Scenario sets reviewed and approved by Platform Lead

**Activities**:
- Add governance CI checks (spec-governance.yml) to the repository if not present
- Update review processes to support diff-based judgment (Level 3 behavior) for new feature work only
- Existing legacy code paths remain at Level 2 until a documented scenario set covers them
- Verify governance checks pass consistently for 4+ weeks

**Exit criteria**:
- CI governance checks running and passing for 4+ consecutive weeks
- Level 3 behaviors demonstrated on at least 2 new feature deliveries
- ROI metrics stable (no regression for 6+ weeks)
- Platform Lead has reviewed and confirmed Phase 3 exit in writing

**Risk signals**:
- Level 3 behaviors applied to legacy code paths without scenario coverage — revert to Level 2 for those paths
- CI governance checks failing intermittently without root cause identification

---

## Phase 4 — Selective Autonomy

**Goal**: Promote bounded, well-documented domains to Level 4. Level 5 is not a target for legacy migration without additional evidence-gating beyond this guide.

**Entry criteria**:
- Phase 3 exit criteria met
- Scenario sets at ≥90% pass rate for all candidate workflows
- Digital twin strategy documented and validated for any critical-class integrations
- Platform Lead written authorization on file for each workflow being promoted

**Activities**:
- Promote candidate workflows to Level 4 one at a time
- Monitor scenario pass rates monthly; hold promotion if pass rate drops below 90%
- Legacy code paths not covered by scenario sets remain at Level 2 or Level 3
- Continue collecting ROI metrics and comparing measured vs perceived productivity

**Exit criteria** (this phase does not "complete" — it is an ongoing operating state):
- Each promoted workflow maintains ≥90% scenario pass rate
- No critical scenario failures
- Team Classification Register reflects current state monthly

**Risk signals**:
- Multiple workflows promoted simultaneously — slow down, one at a time
- Scenario pass rate declining across workflows — pause promotions, investigate root cause

---

## Governance Gate

The Platform Lead **holds** teams at their current phase when exit criteria are unmet. This is not advisory — a team cannot self-certify Phase exit. The Platform Lead reviews evidence, confirms criteria are met, and records the decision before Phase transition occurs.

If a team requests Phase progression and criteria are unmet, the Platform Lead documents the specific unmet criteria and the remediation path. Timelines are evidence-driven, not calendar-driven.

---

## Legacy System Assessment Template

Complete this assessment during Phase 1 and store at `governance/legacy-assessment-{system-name}.md`.

```markdown
# Legacy System Assessment: {System Name}

**Date**: YYYY-MM-DD
**Assessor**: Platform Lead / Senior Engineer
**Phase at assessment**: Phase 1

## System Overview

[Brief description of the system, its age, primary language/framework]

## Candidate Workflows for Agentic Migration

| Workflow | Complexity | External Integrations | Risk Level | Phase 2 Priority |
|----------|-----------|----------------------|------------|-----------------|
| [Name]   | Low/Med/High | [list]            | Low/Med/High | 1/2/3         |

## Integration Inventory

| Integration | Type | Critical Class? | Digital Twin Needed? | Notes |
|-------------|------|----------------|----------------------|-------|
| [Name]      | REST/DB/Queue | Yes/No | Yes/No       | [notes] |

## Behavioral Documentation Gaps

[What behavior currently exists only in code or tribal knowledge, not in written specs]

## Baseline ROI Metrics

| Metric | Baseline Value | Collection Date | Notes |
|--------|---------------|-----------------|-------|
| Lead time (standard task) | | YYYY-MM-DD | |
| Throughput per sprint | | YYYY-MM-DD | |

## Platform Lead Sign-Off

- [ ] Phase 1 entry approved
- [ ] Phase 2 entry approved (date: YYYY-MM-DD)
- [ ] Phase 3 entry approved (date: YYYY-MM-DD)
- [ ] Phase 4 workflow authorization (workflow: [name], date: YYYY-MM-DD)
```
