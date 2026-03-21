# Talent and Role Adaptation Policy

**Version**: 1.0
**Date**: 2026-03-21
**Owner**: Platform Lead
**Spec reference**: 007-org-scale-agentic-governance §Talent and Org Evolution, FR-015

---

## Purpose

This policy defines how role expectations shift as teams operate at Level 3 and above, and establishes safeguards to ensure early-career engineers retain meaningful growth pathways in a specification-first delivery model.

This policy governs role expectations and development safeguards within the agentic operating model. It does **not** govern HR processes, hiring decisions, compensation structures, or performance management — those remain within their respective organizational owners.

---

## Role Expectation Shift at Level 3 and Above

At Level 3 and above, the primary value a practitioner delivers shifts from writing implementation to writing specifications and evaluating outcomes. This is not a reduction in the difficulty or importance of the work — it is a change in where cognitive effort is directed.

The expectation is not that engineers stop understanding code. It is that the primary deliverable is a specification precise enough for an agent to implement correctly, followed by judgment about whether the outcome meets the stated criteria.

Engineers who operate well at Level 3+ are expected to:
- Author implementation-quality specs that an agent can execute without ambiguity
- Evaluate agent output against stated acceptance criteria — not rewrite it
- Identify when agent output is incorrect and articulate why, in terms of the spec
- Participate in governance processes (scenario review, level classification, monthly assessment)

---

## New Competencies at Level 3+

Four competency areas become primary at Level 3 and above. These should be reflected in team onboarding, skill development conversations, and peer review culture — not as formal HR criteria, but as shared understanding of what good work looks like.

### 1. Specification Quality
Writing specs that are complete, unambiguous, and implementation-ready. Includes knowing when a spec is too vague to give to an agent, and how to iterate on a spec before execution rather than after.

### 2. Outcome Evaluation
Judging whether agent output satisfies the spec's acceptance criteria. Includes identifying failure modes that are spec gaps (the spec was wrong) versus implementation gaps (the agent didn't follow the spec).

### 3. Scenario Writing
Authoring behavioral scenarios that test workflow correctness without being visible to the agent during implementation. Includes understanding what makes a scenario a useful holdout signal versus a redundant test.

### 4. Governance Participation
Active participation in governance processes: monthly level classification reviews, scenario pass rate reviews, CI governance check remediation. Not passive compliance — active contribution to the accuracy and health of governance records.

---

## Early-Career Safeguards

The shift toward specification-first delivery creates risk for early-career engineers if not managed deliberately. The following safeguards apply to engineers in their first two years of professional software development, or in their first year at this organization.

### Safeguard 1 — Supervised Implementation Access
Early-career engineers retain access to implementation-level work in supervised contexts. This means pair sessions, guided tasks, or explicitly scoped implementation assignments where a senior engineer is present to provide feedback. The goal is continued growth in understanding how software is built, not removal from implementation contexts.

### Safeguard 2 — Spec Mentorship
Early-career engineers are paired with a senior engineer for spec authoring until they have authored at least three specs that were successfully executed by an agent without mid-task clarification. Mentorship means co-authoring and reviewing specs together, not writing specs for the engineer to copy.

### Safeguard 3 — No Level 4+ Sole Ownership Without Mentorship Pairing
An early-career engineer may not be the sole spec author or outcome evaluator for a Level 4 or Level 5 workflow without an active mentorship pairing in place. This is a requirement, not a recommendation. A mentorship pairing means a named senior engineer who co-reviews specs and scenario results for that workflow on a defined cadence.

### Safeguard 4 — Progression Equity
Governance processes must not systematically disadvantage early-career engineers in level classification or career progression assessment. Platform Lead reviews the Team Classification Register quarterly to confirm that early-career engineers are advancing in competency, not being held in low-autonomy roles indefinitely. If a pattern of stagnation is identified, the Platform Lead escalates to the relevant people management chain.

---

## Quarterly Review

The Platform Lead conducts a quarterly review of:
- Early-career safeguard compliance (are pairings in place, are they active?)
- Competency development patterns (are engineers building specification and evaluation skills?)
- Progression equity indicators (are early-career engineers advancing or stagnating?)

Review findings are documented and stored at `governance/talent-review-YYYY-QN.md`. Findings that indicate systemic issues are escalated to relevant organizational stakeholders.

---

## Scope Limits

This policy does not govern:
- Hiring criteria or candidate evaluation
- Compensation levels or adjustments
- Formal performance improvement processes
- Promotion decisions outside the agentic operating model context

Those processes remain with their respective organizational owners. This policy governs only the operating expectations and development safeguards within the agentic delivery model.
