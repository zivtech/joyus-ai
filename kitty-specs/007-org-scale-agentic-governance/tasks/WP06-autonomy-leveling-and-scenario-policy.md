---
work_package_id: "WP06"
title: "Autonomy Leveling and Scenario Policy"
lane: "planned"
dependencies: ["WP01"]
subtasks: ["T022", "T023", "T024", "T025", "T026"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-sonnet"
---

# WP06: Autonomy Leveling and Scenario Policy

**Implementation command**: `spec-kitty implement WP06`
**Target repo**: `joyus-ai`
**Dependencies**: WP01 (baseline scores needed to anchor current level assessments)
**Priority**: P1/P2
**Parallel with**: WP02 through WP05 (only needs WP01 baseline)

## Objective

Define and publish the five-level operating maturity classification system, the holdout-scenario policy for Level 4/5 workflows, digital-twin and simulation requirements for high-autonomy integrations, the four-phase legacy system migration guide, and the talent and org-model adaptation policy. Together these five documents constitute the long-horizon governance framework that governs how the organization progresses beyond Level 3.

## Context

This is an entirely documentation WP. No code is written. The five deliverables are governance reference documents committed to `joyus-ai/governance/`.

The five-level model is defined in `spec.md §Operating Maturity Model`:
- **Level 0**: Spicy autocomplete
- **Level 1**: Coding intern
- **Level 2**: Junior developer (multi-file execution, full human review)
- **Level 3**: Developer as manager (agent implements, human judges via diffs)
- **Level 4**: Developer as PM (specification and outcome-based evaluation)
- **Level 5**: Dark factory (specification in, software out, no human code review)

Governance position from the spec:
- Near-term default target: measurable excellence at Level 3 and selective Level 4.
- Level 5: permitted only where scenario holdout validation and simulation controls are mature.

The WP01 baseline will show where each team currently operates. This WP produces the classification methodology and policy documents; actual team assessments are performed using those documents (not part of this WP's scope).

---

## Subtasks

### T022: Write five-level maturity classification guide

**Purpose**: Produce `governance/autonomy-levels.md` — the classification guide that defines observable behaviors, progression criteria, and assessment cadence for each level. This document is used monthly to assign and review team-level classifications.

**Steps**:

1. Define observable behaviors for each level (what does a team look like at this level in practice, not in theory).
2. Define progression criteria for each level transition (what must be true before a team moves up).
3. Define regression criteria (what triggers a forced step-down).
4. Define the assessment process: who conducts it, how often, what evidence is required.
5. Add a team classification register template at the end.

**Document structure**:

```markdown
# Autonomy Level Classification Guide

**Version**: 1.0
**Date**: YYYY-MM-DD
**Owner**: Platform Lead
**Assessment cadence**: Monthly

## Level Definitions

### Level 0: Spicy Autocomplete
**Observable behaviors**:
- AI used only for in-editor completion; no multi-line or multi-file generation
- No specification artifacts used
- All code reviewed and accepted manually per line

**Progression criteria to Level 1**:
- Team has completed Level 1 onboarding module
- At least one team member can describe the difference between suggestion acceptance and outcome evaluation

**Regression from Level 1**:
- N/A (Level 0 has no lower state)

---

### Level 1: Coding Intern
**Observable behaviors**:
- AI generates single functions or small code blocks on explicit request
- Human always writes the specification; AI never initiates work
- All AI output reviewed and tested by a human before merge

**Progression criteria to Level 2**:
- Team has used AI-assisted generation on at least 5 distinct tasks
- At least one spec artifact exists for work generated at this level
- Measured acceptance rate for generated suggestions is recorded (even informally)

**Regression from Level 2**:
- Team's measured acceptance rate drops below 30% for two consecutive sprints
- Team stops writing spec artifacts

---

### Level 2: Junior Developer
**Observable behaviors**:
- AI generates across multiple files from a single prompt or spec section
- Human reviews every diff before merge; no AI-generated code merges unreviewed
- Spec artifact exists before generation begins
- Tests exist for all AI-generated code

**Progression criteria to Level 3**:
- At least 8 weeks at Level 2 with no governance regressions
- All work at this level has spec artifacts
- Team can articulate the difference between reviewing implementation correctness vs reviewing specification quality
- Baseline metrics (M01/M02) collected for at least 4 sprints

**Regression from Level 3**:
- Any merge of unreviewed AI-generated code
- Spec artifact absence for two or more consecutive features

---

### Level 3: Developer as Manager *(Near-term default target)*
**Observable behaviors**:
- Agent implements full features from spec artifacts; human judges via diffs
- Human's primary review activity is: does this diff match the spec? Is the spec correct?
- CI gates (lint, type check, test) run on all AI-generated code
- Governance checks pass on all features

**Progression criteria to Level 4**:
- Team has operated at Level 3 for at least 3 months
- All governance checks pass (WP05 CI workflow green)
- Team has produced at least one scenario set for a target workflow (see T023)
- Platform Lead has reviewed and approved the scenario set
- ROI metrics show stable or improving M01/M02 with no persistent M06 divergence

**Regression from Level 4**:
- Scenario holdout pass rate drops below threshold defined in `scenario-policy.md`
- M06 divergence persists for 3+ weeks
- Any P0 governance check failure

---

### Level 4: Developer as PM
**Observable behaviors**:
- Human writes specifications and evaluates outcomes; agent writes all code
- Human does not review individual diffs — evaluates whether spec acceptance criteria are met
- Scenario holdout evaluation runs before every production release
- All integrations scored against MCP rubric before use

**Progression criteria to Level 5**:
- Team has operated at Level 4 for at least 6 months
- Scenario holdout pass rate ≥ 95% across 3 consecutive release cycles
- Digital twin or simulation strategy documented and validated (see T024)
- Security Team has approved all integrations used at this level
- Level 5 authorization obtained from Platform Lead in writing

**Regression from Level 5**:
- Scenario holdout pass rate drops below 90%
- Digital twin fidelity assessment fails
- Any undetected regression in production traced to missing scenario coverage

---

### Level 5: Dark Factory *(Evidence-gated only)*
**Observable behaviors**:
- Specification in; software out. No human code writing or review.
- All quality gates are automated (tests, governance checks, scenario holdout)
- Production releases are gated by automated scenario pass/fail signals
- Continuous simulation or digital twin validates integrations before promotion

**Governance constraints**:
- Level 5 is never a default or target for general rollout
- Level 5 authorization is per-workflow, not per-team
- Each Level 5 workflow requires an active digital twin strategy (T024)
- Level 5 status is reviewed monthly; automatic regression to Level 4 if controls lapse

---

## Assessment Process

1. **Monthly assessment**: Platform Lead reviews team evidence for each level
2. **Evidence required**:
   - Current level behaviors observed (with example)
   - Progression criteria met (or not met, with gap)
   - Governance check status
   - ROI metric trend for M01, M02, M06
3. **Classification record**: updated in Team Classification Register below

## Team Classification Register

| Team | Current Level | Last Assessed | Evidence | Next Review |
|------|--------------|--------------|---------|------------|
| (team name) | Level 3 | YYYY-MM-DD | [link to evidence] | YYYY-MM-DD |
```

**Files**:
- `joyus-ai/governance/autonomy-levels.md` (new, ~130 lines)

**Validation**:
- [ ] All 5 levels defined with observable behaviors
- [ ] Each level (1–5) has progression criteria and regression criteria
- [ ] Level 3 is marked as near-term default target
- [ ] Level 5 constraints are explicit (per-workflow, monthly review, digital twin required)
- [ ] Assessment process section is present
- [ ] Team Classification Register template is present

---

### T023: Define Level 4/5 holdout-scenario policy

**Purpose**: Produce `governance/scenario-policy.md` — the policy that governs how behavioral scenarios are created, stored, and used as release gates for Level 4 and Level 5 workflows.

**Steps**:

1. Define what a scenario set is and how it differs from internal tests.
2. Define the structural requirements for a scenario set (format, storage location, labeling).
3. Define the pass/fail criteria for release gate decisions.
4. Define anti-overfitting controls (why scenarios must be stored separately from implementation context).
5. Define the scenario set lifecycle (creation, review, deprecation).
6. Add a scenario set template appendix.

**Document structure**:

```markdown
# Holdout Scenario Policy

**Version**: 1.0
**Date**: YYYY-MM-DD
**Owner**: Platform Lead
**Applies to**: Level 4 and Level 5 workflows only

## Purpose

Holdout scenarios function as behavioral acceptance criteria that are intentionally
withheld from the agent's implementation context. They detect overfitting to internal
tests — the case where a workflow passes all internal quality gates but fails on real
inputs not seen during development.

## What a Scenario Is

A scenario is a self-contained behavioral test case with:
- An input (prompt, spec fragment, or API call)
- An expected output or outcome criterion
- A pass/fail determination method (automated or human-judged)

Scenarios are NOT:
- Unit tests in the implementation codebase
- Integration tests visible to the agent during generation
- Acceptance criteria embedded in spec.md files

## Scenario Set Structure

Each workflow targeted for Level 4/5 operation must have a scenario set at:
`joyus-ai/governance/scenarios/{workflow-name}/`

Required files:
- `README.md`: workflow description, scenario count, last updated date
- `scenarios.json`: machine-readable scenario definitions
- `HOLDOUT-NOTICE.md`: explicit notice that these scenarios must not be provided to agents

### scenarios.json format

```json
[
  {
    "id": "SCN-001",
    "description": "Agent generates correct migration script from a breaking schema change spec",
    "input": "...",
    "expected_outcome": "Migration script reverses cleanly; no data loss on rollback",
    "evaluation_method": "human",
    "pass_threshold": "rollback succeeds with zero row delta"
  }
]
```

## Anti-Overfitting Controls

1. Scenario sets are stored in `governance/scenarios/`, not in `kitty-specs/`
2. Scenarios must not appear in any file that an agent reads during implementation
3. Scenario content must not be referenced in spec.md, plan.md, or tasks.md
4. If a scenario is discovered to have leaked into implementation context, it is invalidated and must be replaced before the next release

## Release Gate Criteria

A release is permitted to proceed to production at Level 4/5 when:
- Scenario holdout pass rate ≥ 90% (Level 4) or ≥ 95% (Level 5)
- No scenario marked `critical` has a fail status
- Scenario evaluation is completed after the final implementation commit (not mid-development)

A release is blocked when:
- Pass rate is below threshold
- Any `critical` scenario fails
- Scenario set has not been updated within the last 90 days (stale scenarios do not count)

## Scenario Set Lifecycle

1. **Creation**: Platform Lead or Spec Author writes initial scenario set before Level 4 authorization
2. **Review**: Scenarios reviewed by a second person who did not write the implementation
3. **Execution**: Run after each implementation cycle; results recorded in `scenario-results/`
4. **Deprecation**: Scenarios that no longer apply to current behavior are marked `deprecated` (not deleted)

## Scenario Set Template

See: `governance/scenarios/_template/`

```

**Files**:
- `joyus-ai/governance/scenario-policy.md` (new, ~90 lines)
- `joyus-ai/governance/scenarios/_template/README.md` (stub)
- `joyus-ai/governance/scenarios/_template/HOLDOUT-NOTICE.md` (stub)

**Validation**:
- [ ] Scenario set structure with storage path `governance/scenarios/{workflow-name}/` is defined
- [ ] Anti-overfitting controls explicitly prohibit scenarios from appearing in spec files
- [ ] Release gate pass thresholds are defined: 90% (Level 4), 95% (Level 5)
- [ ] `critical` scenario fail is an unconditional block
- [ ] Scenario lifecycle (creation → review → execution → deprecation) is defined
- [ ] `_template/` directory stubs are created

---

### T024: Define digital-twin and simulation requirements

**Purpose**: Produce `governance/digital-twin-requirements.md` — the policy that defines when a digital twin or simulation strategy is required, what minimum fidelity means, and how it is reviewed before Level 5 authorization.

**Steps**:

1. Define the scope: which integrations require a digital twin strategy.
2. Define what "digital twin" means in this context (not full system replica — a controlled simulation of the external dependency's behavior).
3. Define minimum fidelity criteria.
4. Define the review and authorization process.
5. Provide a template for documenting a digital twin strategy.

**Document structure**:

```markdown
# Digital Twin and Simulation Requirements

**Version**: 1.0
**Date**: YYYY-MM-DD
**Owner**: Platform Lead
**Applies to**: Level 5 workflows and Level 4 workflows with critical-class integrations

## Purpose

A digital twin strategy is required when an agentic workflow at Level 4/5 has external
dependencies whose failure or unexpected behavior could produce production side effects
that are difficult to reverse. The digital twin simulates the dependency's behavior in
a controlled environment so the workflow can be validated before real production calls.

## When a Digital Twin Is Required

A digital twin strategy is mandatory when ALL of the following are true:
1. The workflow operates at Level 4 or Level 5
2. The workflow calls an external service, API, or data store that is NOT sandboxed
3. The external dependency has a `risk_class` of `platform` or `critical` (per MCP rubric)
4. The workflow can produce side effects (writes, deletes, external notifications) that
   are not automatically reversible

For read-only, idempotent, or fully sandboxed integrations, a digital twin is recommended
but not required.

## What "Digital Twin" Means Here

A digital twin strategy is NOT a full replica of the external system. It is a documented
approach to simulating the external dependency's behavior for validation purposes. This may be:

- **Mock server**: A local HTTP server that simulates the external API's responses
- **Recorded replay**: Captured real responses replayed in test runs
- **Behavioral contract**: A formal contract (OpenAPI spec or similar) that the agent's
  calls are validated against, without making real requests
- **Staging environment**: A non-production instance of the dependency with production-like
  data shape but isolated state

The chosen approach must be documented in the digital twin strategy document.

## Minimum Fidelity Criteria

A digital twin strategy meets minimum fidelity when:
1. It covers the response shapes for all API calls the workflow makes (not just happy path)
2. It includes at least two failure scenarios (4xx/5xx responses or timeout)
3. It is version-pinned — if the external API changes, the twin must be updated
4. It can be run in CI without external network access

## Review and Authorization Process

1. Team documents their digital twin strategy using the template below
2. Platform Lead reviews for fidelity criteria coverage
3. Security Team reviews for any gaps in failure scenario coverage
4. Authorization is recorded in the team's Level 5 authorization document

## Digital Twin Strategy Template

```markdown
# Digital Twin Strategy: {Workflow Name}

**Workflow**: {name}
**External dependency**: {service name, version}
**Twin approach**: [mock server | recorded replay | behavioral contract | staging]
**Fidelity version**: 1.0
**Last validated**: YYYY-MM-DD

## API Coverage

| Endpoint | Method | Happy Path | Failure Scenarios |
|----------|--------|-----------|------------------|
| /resource | POST | yes | 400, 503, timeout |

## CI Integration

Location: `tests/twins/{workflow-name}/`
Run command: `{command}`
Network access required: no

## Known Gaps

(list any endpoints or scenarios not yet covered)
```
```

**Files**:
- `joyus-ai/governance/digital-twin-requirements.md` (new, ~90 lines)

**Validation**:
- [ ] Scope criteria are explicit (when twin is mandatory vs recommended)
- [ ] Four acceptable twin approaches are listed (mock, replay, contract, staging)
- [ ] Minimum fidelity criteria include: response shape coverage, failure scenarios, version pinning, CI-runnable
- [ ] Strategy template is present with API coverage table
- [ ] Document applies to Level 5 and critical-class Level 4 workflows

---

### T025: Write legacy system migration staging guide

**Purpose**: Produce `governance/legacy-migration-guide.md` — the four-phase migration path for teams maintaining brownfield systems who need a realistic progression to higher-autonomy operation without skipping prerequisites.

**Steps**:

1. Define the four phases from `spec.md §Legacy Migration Path`: assist, documentation, pipeline, selective autonomy.
2. For each phase: define entry criteria, activities, exit criteria, and risk signals.
3. Define the governance gate: what readiness criteria must pass before a team can progress to the next phase.
4. Address the case where readiness criteria are unmet (keep team at current phase — per User Story 5).
5. Add a legacy system assessment template.

**Document structure**:

```markdown
# Legacy System Migration Guide

**Version**: 1.0
**Date**: YYYY-MM-DD
**Owner**: Platform Lead
**Applies to**: Teams maintaining systems with existing code, behavior, and test debt

## Purpose

This guide provides a phased migration path for legacy systems. It prevents forced
jumps to high-autonomy operation before the prerequisite controls are in place.

A team on a legacy system that cannot yet produce behavioral specs or scenarios must
not be pushed to Level 3+ operation — doing so creates invisible risk, not productivity.

## Phase 1: Assist

**Entry criteria**: Any team; no prerequisites
**Activities**:
- Use Level 2 workflows in current delivery model
- AI assists with documentation, refactoring, and test generation
- No autonomous generation of new business logic
- Human reviews 100% of AI-generated output

**Exit criteria** (move to Phase 2):
- Team is comfortable at Level 2 for at least 6 weeks
- At least 20% of routine tasks use AI assistance
- Team can identify which parts of the system have adequate test coverage

**Risk signals that delay progression**:
- Acceptance rate below 25% (agent output consistently misses the mark)
- More than 2 regression incidents traced to AI-generated changes in 8 weeks

---

## Phase 2: Documentation

**Entry criteria**: Phase 1 exit criteria met
**Activities**:
- Extract and codify current system behavior into specs and scenarios
- Document all known behavioral contracts (what the system does, not just what it should do)
- Identify gaps between documented and actual behavior
- Write behavioral scenarios for critical paths (these become the Level 4/5 holdout set)

**Exit criteria** (move to Phase 3):
- Critical system paths documented in spec format
- At least one behavioral scenario set exists for a critical workflow
- Known gaps between docs and actual behavior are listed (not required to be resolved yet)

**Risk signals that delay progression**:
- Documentation reveals more behavioral complexity than expected — extend Phase 2
- Scenario writing reveals undocumented side effects in production — resolve before advancing

---

## Phase 3: Pipeline

**Entry criteria**: Phase 2 exit criteria met
**Activities**:
- Update CI/CD and quality gates for AI-generated change volume
- Add governance checks (WP05) to the legacy system's pipeline
- Begin generating new features at Level 3 (not modifying existing core logic yet)

**Exit criteria** (move to Phase 4):
- Governance checks pass in CI
- Level 3 workflows applied to at least 3 new features with no regressions
- Scenario holdout pass rate ≥ 90% for at least 2 release cycles

**Risk signals that delay progression**:
- Governance CI failures in more than 2 consecutive PRs
- Regression in any scenario marked `critical`

---

## Phase 4: Selective Autonomy

**Entry criteria**: Phase 3 exit criteria met; Platform Lead authorization required
**Activities**:
- Move bounded, well-documented domains to Level 4 operation
- Do NOT apply Level 4+ to core legacy logic until full behavioral documentation and scenario coverage exists
- Maintain Level 2/3 for all undocumented legacy domains

**Governance constraint**: Teams must not request Level 5 authorization for any legacy system domain
until 100% of that domain's behavioral scenarios pass for 3 consecutive cycles.

---

## Governance Gate

If a team's readiness criteria for the next phase are not met, the Platform Lead keeps
the team at the current phase. Governance does not grant exceptions based on schedule
pressure or delivery commitments.

Progression gate evidence is recorded in the Team Classification Register
(see `autonomy-levels.md`).

## Legacy System Assessment Template

```markdown
# Legacy System Assessment: {System Name}

**Date**: YYYY-MM-DD
**Team**: {team name}
**Current phase**: Phase N
**Assessed by**: Platform Lead

## System Profile

- Primary language/stack: ...
- Estimated code age: ...
- Test coverage (estimated): ...%
- Known undocumented behaviors: N identified

## Phase Readiness

| Criterion | Met? | Evidence |
|-----------|------|---------|
| (list phase exit criteria) | yes/no | (link or description) |

## Risks and Blockers

...

## Recommendation

Advance to Phase N+1 / Hold at Phase N until: ...
```
```

**Files**:
- `joyus-ai/governance/legacy-migration-guide.md` (new, ~120 lines)

**Validation**:
- [ ] All four phases are defined (assist, documentation, pipeline, selective autonomy)
- [ ] Each phase has entry criteria, activities, and exit criteria
- [ ] Risk signals that delay progression are listed for each phase
- [ ] Governance gate rule is explicit: schedule pressure does not override readiness criteria
- [ ] Assessment template is present
- [ ] Phase 4 constraint on legacy domains (100% scenario coverage for 3 cycles) is explicit

---

### T026: Write talent and org-model adaptation policy

**Purpose**: Produce `governance/talent-adaptation-policy.md` — the policy that governs how role expectations shift under specification-first delivery, what early-career development safeguards are in place, and how the org avoids removing growth pathways.

**Steps**:

1. Define the shift: what changes about developer roles at Level 3 and above.
2. Define the new competencies required (specification quality, outcome evaluation).
3. Define early-career safeguards: what must be preserved to protect junior developer growth.
4. Define the role and talent review process.
5. Keep this document policy-level, not prescriptive HR policy — it addresses the governance angle (FR-015), not performance management.

**Document structure**:

```markdown
# Talent and Org-Model Adaptation Policy

**Version**: 1.0
**Date**: YYYY-MM-DD
**Owner**: Platform Lead
**Review cadence**: Quarterly

## Purpose

Governance acknowledges that specification-first, agentic delivery changes the nature
of software development work. This policy defines how the organization adapts role
expectations without removing career development pathways — particularly for early-career
developers.

## What Changes at Level 3+

At Level 3 and above, the primary developer activity shifts from:
- Writing implementation code → Writing specifications and evaluating outcomes
- Reviewing code correctness → Reviewing whether outcomes match intent
- Debugging implementation bugs → Identifying specification gaps

This is not a reduction in developer responsibility — it is a shift in where judgment
is applied. The quality of a specification has the same leverage that code quality had
in traditional delivery.

## New Competency Expectations

Teams operating at Level 3 or above must develop proficiency in:

1. **Specification quality**: Writing specs that are precise enough for an agent to
   implement correctly without repeated clarification cycles
2. **Outcome evaluation**: Assessing whether delivered software meets the intent of the
   specification, not just whether it passes tests
3. **Scenario writing**: Producing behavioral scenarios that catch overfitting and
   reveal edge cases not anticipated during spec authoring
4. **Governance participation**: Understanding and applying the autonomy level model;
   contributing to team-level assessments honestly

## Early-Career Development Safeguards

Specification-first delivery must not remove junior developer growth pathways.
The following safeguards apply:

1. **Supervised implementation access**: Early-career developers must have structured
   opportunities to read and trace AI-generated implementations, even at Level 3+.
   Removing all exposure to implementation detail removes the learning path for
   specification and debugging skills.

2. **Specification mentorship**: Specification quality is a learnable skill. Teams must
   have explicit mentorship structures for junior developers learning to write
   production-quality specs — this is the new primary technical skill to develop.

3. **No Level 4+ for early-career developers without mentorship pairing**: Developers
   in their first two years on a team should not be sole owners of Level 4/5 workflows
   without a senior pairing arrangement. They can contribute to and co-own workflows
   but should not bear sole responsibility for scenario evaluation decisions.

4. **Progression equity**: Career progression criteria must reflect the new competency
   mix. Developers should not be disadvantaged for having less implementation output
   if their specification quality and outcome evaluation are high.

## Role and Talent Review Process

1. **Quarterly review**: Platform Lead reviews team composition against competency
   expectations at the team's current autonomy level
2. **Competency gap identification**: Gaps in specification quality or outcome evaluation
   are addressed with training and pairing, not headcount reduction
3. **Early-career tracking**: For each team at Level 3+, confirm that early-career
   developers have active mentorship plans and specification skill development plans

## What This Policy Does Not Govern

- Individual performance management (governed by HR policy)
- Hiring decisions (governed by talent acquisition)
- Compensation bands (governed by compensation policy)

This policy governs governance-layer role expectations only.
```

**Files**:
- `joyus-ai/governance/talent-adaptation-policy.md` (new, ~80 lines)

**Validation**:
- [ ] Shift from implementation to specification work is described clearly
- [ ] Four new competency expectations are listed
- [ ] Four early-career safeguards are present
- [ ] No Level 4+ sole ownership without mentorship pairing — rule is explicit
- [ ] Quarterly review process is defined
- [ ] Scope limits (what this policy does NOT govern) are explicit

---

## Definition of Done

- [ ] `governance/autonomy-levels.md` published — all 5 levels with observable behaviors, progression, and regression criteria
- [ ] `governance/scenario-policy.md` published — scenario set structure, anti-overfitting controls, release gate thresholds
- [ ] `governance/digital-twin-requirements.md` published — scope, fidelity criteria, strategy template
- [ ] `governance/legacy-migration-guide.md` published — all 4 phases with entry/exit criteria and risk signals
- [ ] `governance/talent-adaptation-policy.md` published — competency expectations and early-career safeguards
- [ ] `governance/scenarios/_template/` stubs created (README.md, HOLDOUT-NOTICE.md)
- [ ] All documents have version header, owner, and date
- [ ] WP05 `check_reference_integrity()` passes on all WP06 document paths

## Risks

- **Level definitions drift**: The five-level model in `autonomy-levels.md` must exactly match the definitions in `spec.md`. If the spec is updated, this document must be updated too — they are not independent.
- **Scenario policy complexity**: The holdout concept is non-obvious. If the scenario policy is too abstract, teams will not use it correctly. Prefer concrete examples over general principles in T023.
- **Digital twin scope ambiguity**: "Digital twin" is an overloaded term. T024 must be explicit that this is not a full system replica — it is a controlled simulation approach for external dependencies only.
- **Talent policy sensitivity**: T026 addresses a topic (role change, early-career) that can be sensitive. Keep the document policy-level and governance-scoped; avoid prescribing HR or compensation decisions.
- **WP06 runs in parallel**: Since WP06 only depends on WP01, it can run concurrently with WP02 through WP05. However, T022's autonomy levels must be consistent with the WP03/WP04 governance docs. Review for consistency before marking WP06 done.

## Reviewer Guidance

- Verify that `autonomy-levels.md` Level 5 constraints match the spec exactly: "permitted only where scenario holdout validation and simulation controls are mature" — no softening language.
- Check that the scenario policy's holdout storage path (`governance/scenarios/`) is separate from `kitty-specs/` — the anti-overfitting control depends on this separation.
- Confirm that the legacy migration guide's governance gate rule is unambiguous: the Platform Lead holds, not advises, a team at its current phase when criteria are unmet.
- The talent policy's early-career safeguard #3 (no Level 4+ sole ownership without mentorship) is a hard rule — verify it is stated as a requirement, not a recommendation.
- Cross-check T022's progression criteria with T023's scenario policy: Level 3 → Level 4 progression requires a scenario set — make sure both documents agree on this dependency.
