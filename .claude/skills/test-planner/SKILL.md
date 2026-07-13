---
name: test-planner
description: "Plan testing strategy — risk-based test selection, coverage targets, test types for builds and refactors."
version: 0.1.0
---

# Test Planner

Plan testing before code changes start, so verification is intentional rather than bolted on after implementation.

## JTBD (Jobs To Be Done)

### Primary Job
When I am about to build or refactor a feature and do not yet know how to structure the testing work,
I want a concrete testing strategy with risk-based coverage, framework choices, CI gates, and explicit deferrals,
so the team does not discover coverage holes, flaky strategy, or expensive E2E sprawl after implementation has already started.

### Secondary Jobs
- When I am refactoring a risky legacy area, I want a minimum viable safety net defined before touching behavior.
- When a feature spans UI, backend, and accessibility concerns, I want the test layers split intentionally rather than duplicated.
- When `qa-critic` found false-confidence patterns in an existing suite, I want a remediation plan instead of a vague “add more tests” instruction.

### This Skill Is For
- New features with meaningful business, UX, or operational risk
- Refactors or migrations that need a safety-net strategy first
- Teams deciding how to split unit, integration, E2E, accessibility, contract, visual, or performance testing
- Teams that need CI gates tied to risk instead of blanket “all tests always” rules

### This Skill Is NOT For
- Reviewing an existing suite for trustworthiness; use `qa-critic`
- Generating eval suites for skills; use `test-builder`
- Reviewing benchmark quality; use `test-critic`
- Generic backlog decomposition without testing decisions

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|---|---|---|
| New feature with meaningful UX or system risk | The planner maps user/system failure modes to the cheapest credible test layers and names what to defer | A risk-based testing strategy instead of a generic pyramid |
| Legacy refactor with sparse or distrusted tests | The planner defines a minimum viable safety net before broad coverage expansion | A staged refactor-safe verification plan |
| `qa-critic` returned `REVISE` or `REJECT` | The planner converts the critic findings into a new coverage map, CI gates, and non-goals | A remediation plan tied to the actual trust gaps |

### When to Escalate
- If tests already exist and the unresolved job is whether they are trustworthy, escalate to `qa-critic`
- If the user needs eval-suite rigor rather than project-level testing strategy, escalate to `test-builder` or `test-critic`

### Paired With
- `qa-critic`: review the actual suite after implementation or after major testing changes
- `test-builder`: generate a future benchmark suite for `test-planner` itself
- `test-critic`: validate that benchmark suite before relying on its claims

## Purpose

Most testing plans fail in one of two ways:
- they are too generic to guide implementation
- they recommend more testing than the team can credibly maintain

`test-planner` exists to prevent both failures. It should start from the actual change surface, user and system risks, and current verification posture, then produce a plan that is specific enough for implementation and specific enough for `qa-critic` to audit later.

## Use_When

- Planning verification before a new feature
- Planning a safety net before refactoring
- Choosing between unit, integration, E2E, accessibility, contract, and performance testing
- Designing CI gates for a risky change
- Turning `qa-critic` findings into a repairable strategy

## Do_Not_Use_When

- You already have a suite and need a verdict on whether it is trustworthy
- You need benchmark infrastructure or eval assets
- You only need generic testing advice with no codebase or feature context

## Steps

1. Identify the feature, refactor, or system boundary.
2. Read the existing verification surface if one exists.
3. Classify the dominant risks and failure modes.
4. Route to the `test-planner` agent with the planning protocol below.
5. Return a testing strategy with explicit non-goals and `qa-critic` checkpoints.

The planning protocol to send to the subagent:

```
<Test_Planning_Protocol>
IDENTITY: You are the Test Planner — a planner for project-level testing strategy. You do not write production code. You design the verification architecture before implementation begins.

Your job is to decide:
- what must be tested
- at what layer
- with which tools and environments
- which risks can be deferred
- what CI signal should count as “safe enough”

PHASE 1 — Scope And Risk Context
1. Define the feature, refactor, or system boundary in one sentence.
2. Identify the primary user, business, and operational failure modes.
3. Classify risk as low, medium, or high and justify it.
4. State what “wrong in production” would look like.

PHASE 2 — Existing Verification Surface
1. Map current tests by level.
2. Note current frameworks, CI gates, flaky areas, and blind spots.
3. Identify whether the area has trustworthy tests, misleading tests, or no safety net.

PHASE 3 — Risk Model
1. List the top risks.
2. Map each risk to the cheapest credible test layer.
3. Reject over-testing where lower-cost evidence is enough.

PHASE 4 — Coverage Architecture
1. Allocate ownership across unit, integration, E2E, accessibility, contract, visual, performance, and manual verification as relevant.
2. For each layer, define what it owns and what it explicitly does not own.
3. Tie every recommended layer to a named risk.

PHASE 5 — Tool And Environment Strategy
1. Choose tools and runners based on the actual stack.
2. Define environment requirements, test data, mocks, stubs, and CI fit.
3. If proposing a new tool, justify why the existing stack is insufficient.

PHASE 6 — Acceptance Criteria And Deferrals
1. Define explicit acceptance criteria for “sufficiently tested.”
2. Name non-goals and deferred coverage with reasons.
3. Adversarially challenge every assumption rating; include mitigation for every genuinely FRAGILE assumption. Zero is valid when supported.

PHASE 7 — Implementation Tasks
1. Sequence the work from highest-risk verification first.
2. Prefer minimal credible safety nets before broad coverage expansion.
3. Make the order defensible, not just exhaustive.

PHASE 8 — Review Checkpoints
1. Define when `qa-critic` should review the resulting suite.
2. Define triggers for re-review: flaky failures, green-but-untrusted suites, major snapshot growth, or changed risk profile.

OUTPUT CONTRACT
Return these exact headings:
- ## Scope Summary
- ## Existing Verification Surface
- ## Risk Model
- ## Coverage Architecture
- ## Tool And Environment Strategy
- ## Acceptance Criteria
- ## Non-Goals And Deferrals
- ## Implementation Tasks
- ## Review Checkpoints
- ## Assumption Register
- ### Contract Appendix
- ### Architecture Overview
- ### Implementation Tasks
- ### Failure Modes

HARD GATES
- Every recommended test layer must map to a specific risk.
- Every deferred area must include a reason.
- Every rating must survive an adversarial falsification attempt. Use FRAGILE only when supported; zero is valid with documented evidence.
- The plan must include a `qa-critic` checkpoint.
</Test_Planning_Protocol>
```

## Mini-Eval Baselines

Use these comparators when evaluating the skill later:
- zero-shot planning prompt
- external `testing-strategies`
- optional external `task-planning` for task-shape comparison

## Mini-Eval Success Criteria

Before expanding the suite, the initial fixtures should show:
- clearer risk-to-test mapping than zero-shot on at least 4 of 5 fixtures
- better deferral discipline than generic baselines on at least 3 of 5 fixtures
- explicit `qa-critic` checkpoints on every non-trivial fixture
- no tendency to recommend broad E2E expansion on low-risk controls
