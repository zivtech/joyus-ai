# Scenario Holdout Policy

**Version**: 1.0
**Date**: 2026-03-21
**Owner**: Platform Lead
**Spec reference**: 007-org-scale-agentic-governance §Scenario Validation Model, FR-011

---

## Purpose

Scenarios are behavioral test cases used to evaluate whether a high-autonomy workflow produces correct outcomes. They are withheld from the agent's implementation context — the agent never sees them during execution. This holdout property is what makes them useful as an external correctness signal.

This policy applies to all workflows operating at Level 4 or Level 5.

---

## What Scenarios Are

A scenario describes a specific situation the workflow must handle correctly: given a defined input or system state, the workflow must produce an observable outcome that matches the expected result. Scenarios are written in human-readable form and translated to executable checks as part of the scenario review process.

Scenarios differ from unit or integration tests in one critical way: they are never part of the implementation context. An agent implementing or modifying a workflow must not have access to scenario content. This prevents the agent from optimizing for scenario outcomes rather than genuine correctness.

---

## Storage

Scenario sets live at:

```
governance/scenarios/{workflow-name}/
```

They do **not** live in `kitty-specs/`, `spec/`, `plan.md`, `tasks.md`, or any file that is routinely passed to agents during implementation. Storage in `kitty-specs/` is explicitly prohibited.

Each workflow's scenario directory contains:
- `scenarios.json` — the scenario definitions (see format below)
- `README.md` — human-readable summary of the scenario set
- `HOLDOUT-NOTICE.md` — explicit notice that this content must not be provided to agents

---

## Anti-Overfitting Rule

Scenario content must never appear in:
- Spec files (`spec.md`, `kitty-specs/**`)
- Plan or task files (`plan.md`, `tasks.md`, `tasks/**`)
- Prompt templates, command definitions, or agent context files
- Code comments in implementation files

If a scenario is found in any of these locations, it is considered compromised and must be replaced before the next evaluation cycle. The Platform Lead must be notified immediately.

---

## Release Gates

| Level | Minimum Pass Rate | Critical Scenario Failure |
|-------|------------------|--------------------------|
| Level 4 | ≥90% pass | Unconditional block |
| Level 5 | ≥95% pass | Unconditional block |

A **critical scenario** is any scenario marked `"critical": true` in `scenarios.json`. A single critical scenario failure blocks release regardless of overall pass rate.

Pass rate is calculated as: `(passing scenarios / total scenarios) × 100`. Skipped or errored scenarios count as failures.

---

## Scenario Format

```json
{
  "workflow": "workflow-name",
  "version": "1.0",
  "created": "YYYY-MM-DD",
  "reviewed_by": "Platform Lead",
  "scenarios": [
    {
      "id": "S001",
      "description": "Human-readable description of the situation being tested",
      "critical": true,
      "input": {
        "field": "value"
      },
      "expected_outcome": "Human-readable description of the required result",
      "verification_method": "automated | manual | hybrid"
    },
    {
      "id": "S002",
      "description": "Another scenario",
      "critical": false,
      "input": {},
      "expected_outcome": "Expected result description",
      "verification_method": "automated"
    }
  ]
}
```

---

## Lifecycle

### Creation
- Written by Platform Lead or designated senior engineer
- Must not be shared with engineers implementing the workflow
- Reviewed by a second senior engineer before activation
- Stored in `governance/scenarios/{workflow-name}/` before the workflow is promoted to Level 4

### Review
- Reviewed monthly as part of the Team Classification Register assessment
- Reviewed immediately when a workflow regresses or a critical failure occurs
- Scenarios may be added but not removed during active use without Platform Lead approval

### Execution
- Run as part of the CI pipeline before any production release of a Level 4/5 workflow
- Results recorded with timestamp, pass rate, and any critical failures
- Execution logs stored for audit; minimum retention 12 months

### Deprecation
- A scenario is deprecated when the behavior it tests no longer applies (e.g., the workflow is decommissioned or the integration it tests is removed)
- Deprecation requires Platform Lead approval and a written rationale
- Deprecated scenarios are archived, not deleted, and marked `"deprecated": true` in `scenarios.json`

---

## Key Rules

- Scenarios must exist before a workflow is promoted to Level 4. There are no exceptions.
- Scenario content is never provided to an agent during implementation. Violation is treated as scenario compromise.
- A critical scenario failure is an unconditional release block. It cannot be overridden by pass rate.
- Scenario sets for Level 5 workflows are reviewed monthly, not quarterly.
