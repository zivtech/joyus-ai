# Autonomy Level Classification Guide

**Version**: 1.0
**Date**: 2026-03-21
**Owner**: Platform Lead
**Spec reference**: 007-org-scale-agentic-governance §Operating Maturity Model

---

## Purpose

This guide defines the five-level operating maturity model for classifying real observed behavior of agentic coding workflows. Classification is not aspirational — it reflects what a team is actually doing today, with evidence.

The default target is **Level 3**. Level 5 is never a default and requires per-workflow authorization.

---

## Level Definitions

### Level 0 — Spicy Autocomplete

**Observable behaviors**:
- Agents used only for single-line or single-block completions
- No multi-file awareness; output is always reviewed inline before acceptance
- No spec or plan passed to the agent; prompts are ad hoc

**Progression criteria to Level 1**:
- Team has completed basic onboarding
- At least one defined workflow where the agent receives structured input (a task description or spec excerpt)
- Output reviewed against a stated acceptance criterion

**Regression criteria from Level 1**:
- Agent prompts return to entirely ad hoc, unstructured form
- No review checkpoint exists between agent output and committed code

---

### Level 1 — Coding Intern

**Observable behaviors**:
- Agent produces code for bounded, well-described tasks
- Human reviews every line before merge
- Agent context is structured (task description, relevant file excerpt) but no full spec is passed

**Progression criteria to Level 2**:
- Agent regularly works across multiple files per task
- Human review covers diff correctness, not full line-by-line reconstruction
- At least one workflow has documented acceptance criteria

**Regression criteria from Level 2**:
- Multi-file tasks are consistently broken back to single-file scope before agent use
- Human review reverts to full line reconstruction rather than diff judgment

---

### Level 2 — Junior Developer

**Observable behaviors**:
- Agent executes multi-file changes based on a spec or task description
- Full human review of every diff before merge; no agentic commit path to main
- Governance checks run but are not blocking merge in practice

**Progression criteria to Level 3**:
- Team consistently provides structured specs for agent tasks
- Human judgment shifts from reading every line to evaluating diffs against stated outcomes
- Governance checks pass on a consistent basis (no P0 failures for 4+ weeks)

**Regression criteria from Level 3**:
- Human reviewers begin rewriting agent output rather than accepting or rejecting it
- Governance check failures accumulate without remediation
- Specs are not provided to the agent before execution begins

---

### Level 3 — Developer as Manager *(default target)*

**Observable behaviors**:
- Agent implements full features from structured specs
- Human judges output by comparing diffs against stated acceptance criteria — not by rewriting
- Governance checks pass in CI; P0 failures block merge
- Team Classification Register shows Level 3 assignment with evidence

**Progression criteria to Level 4**:
- Team has operated at Level 3 for at least 3 months with governance checks consistently passing
- At least one scenario set exists for the workflow being promoted
- ROI metrics are stable (no regression for 6+ weeks)
- Platform Lead confirms readiness in writing

**Regression criteria from Level 3**:
- Governance check P0 failures are not resolved within their SLA
- Human reviewers begin implementing rather than judging
- ROI metrics show sustained regression without remediation plan

---

### Level 4 — Developer as PM

**Observable behaviors**:
- Human writes specifications and evaluates outcomes; agent handles implementation
- Scenario holdout validation is active for the workflow (≥90% pass rate required)
- No human code writing or line-level review in the normal flow; judgment is outcome-based
- Platform Lead authorization on file for each promoted workflow

**Progression criteria to Level 5**:
- Team has operated at Level 4 for at least 6 months
- Scenario pass rate ≥95% across 3 consecutive review cycles
- Digital twin or simulation strategy is validated and CI-runnable
- Platform Lead provides written authorization for each workflow being promoted

**Regression criteria from Level 4**:
- Scenario pass rate drops below 90% for any workflow
- Critical scenario failure (unconditional block — see scenario-policy.md)
- Digital twin fidelity falls below minimum requirements
- ROI metrics regress without approved remediation plan

---

### Level 5 — Dark Factory

**Observable behaviors**:
- Specification in, software out; no human code writing or review in the standard flow
- Scenario holdout pass rate ≥95% maintained continuously
- Digital twin strategy validated and running in CI
- Every promoted workflow has individual Platform Lead written authorization
- Monthly review conducted by Platform Lead with evidence log

**This level is never a default.** Authorization is granted per workflow, not per team.

**Authorization requirements**:
- 6 months demonstrated at Level 4 for the specific workflow
- ≥95% scenario pass rate for 3 consecutive review cycles
- Digital twin validated per digital-twin-requirements.md
- Platform Lead written authorization on file
- Monthly review scheduled before authorization is granted

**Regression criteria from Level 5**:
- Scenario pass rate drops below 95% for any authorized workflow → immediate Level 4 regression
- Critical scenario failure → unconditional block pending investigation
- Digital twin fidelity failure → halt production use until restored
- Monthly review missed → workflow suspended until review completed

---

## Assessment Process

**Frequency**: Monthly, conducted by Platform Lead.

**Steps**:
1. Review Team Classification Register (see template below)
2. For each team, examine evidence: governance check history, scenario pass rates (Level 4/5), ROI metrics, review pattern observations
3. Assign current level based on observable behaviors — not stated intent
4. Record any level changes with evidence links and effective date
5. Publish updated register within 5 business days of review date

**Level changes take effect on the date recorded in the register.** Retroactive level changes are not permitted.

---

## Team Classification Register Template

Store completed registers at `governance/registers/team-classification-YYYY-MM.md`.

```markdown
# Team Classification Register

**Period**: YYYY-MM
**Assessor**: Platform Lead
**Date assessed**: YYYY-MM-DD

| Team / Workflow | Current Level | Previous Level | Level Since | Evidence | Next Review |
|----------------|--------------|----------------|-------------|----------|-------------|
| [Team name]    | [0–5]        | [0–5]          | YYYY-MM-DD  | [links]  | YYYY-MM-DD  |

## Notes

[Any level changes, authorizations, or regression actions taken this period]
```

---

## Key Rules

- Level 3 is the default target for all teams during and after initial rollout.
- Level 4 requires explicit opt-in per workflow with Platform Lead confirmation.
- Level 5 requires per-workflow written authorization, monthly review, and a validated digital twin strategy — it is never granted at the team level.
- Regression is not a failure; it is a signal. Governance holds teams at the correct level until progression criteria are met.
