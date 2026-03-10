# Work Packages: Org-Scale Agentic Governance

**Total**: 6 work packages, 34 subtasks (T001–T034)

## Dependency Graph

```
Layer 0: WP01 (baseline & scoring), WP03 (MCP governance)         [parallel]
Layer 1: WP02 (ROI metrics, depends on WP01), WP04 (spec governance, depends on WP01)  [parallel]
Layer 2: WP05 (automated checks, depends on WP04)
Layer 3: WP06 (autonomy & scenario policy, depends on WP01)
```

## Parallelization Opportunities

- **Layer 0**: WP01 + WP03 can start simultaneously (no shared dependencies)
- **Layer 1**: WP02 + WP04 can run in parallel (both depend only on WP01)
- **WP06** can start after WP01 completes (needs maturity rubric as input)

---

### WP01 — Baseline & Scoring
**Prompt**: [`tasks/WP01-baseline-scoring.md`](tasks/WP01-baseline-scoring.md)
**Dependencies**: none
**Estimate**: ~3 days
**Subtasks**: T001–T007

- [ ] T001: Define measurable criteria for each maturity level (Levels 0–5) with observable, countable indicators (e.g., "≥80% of commits are AI-generated and pass quality gates")
  - *Acceptance*: Rubric has ≥3 measurable criteria per level; no criterion uses subjective adjectives without a threshold
- [ ] T002: Publish maturity rubric document at `docs/governance/maturity-rubric.md`
  - *Acceptance*: Document follows project markdown conventions; all 6 levels defined with progression criteria
- [ ] T003: Score all participating teams at baseline using the rubric
  - *Acceptance*: Each team has a scored level with evidence links per criterion
- [ ] T004: Tag all identified gaps as P0/P1/P2 severity
  - *Acceptance*: Every gap has a severity, a brief description, and a reference to the rubric criterion it fails
- [ ] T005: Write rollout playbook at `docs/governance/rollout-playbook.md` covering: pilot cohort criteria, champion model, launch event template, enablement cadence (weekly training, office hours, biweekly retros)
  - *Acceptance*: Playbook covers all 4 rollout stages from FR-001 (pilot, launch, scale, sustain)
- [ ] T006: Define pilot cohort selection criteria and champion ownership model (FR-002)
  - *Acceptance*: Criteria are documented in rollout playbook; champion responsibilities are explicit
- [ ] T007: Define onboarding assets checklist and review checkpoints (FR-003)
  - *Acceptance*: Checklist covers first 8 weeks; review checkpoints have named owners

---

### WP02 — ROI Metrics Contract
**Prompt**: [`tasks/WP02-roi-metrics.md`](tasks/WP02-roi-metrics.md)
**Dependencies**: WP01 (needs baseline scoring as input)
**Estimate**: ~2 days
**Subtasks**: T008–T013

- [ ] T008: Define ROI metrics contract document at `docs/governance/roi-metrics-contract.md` with: metric definitions, collection method, ownership, review cadence (FR-004, FR-005)
  - *Acceptance*: All 6 core metrics from spec §ROI Metrics are defined with collection method and named owner
- [ ] T009: Define baseline collection protocol (2-week pre-rollout window)
  - *Acceptance*: Protocol specifies what data, from where, who collects, and storage format
- [ ] T010: Define measured vs perceived productivity comparison methodology (FR-013)
  - *Acceptance*: Includes self-report survey template, comparison formula, and divergence threshold that triggers remediation
- [ ] T011: Define weekly review format for first 8 weeks
  - *Acceptance*: Review template with required sections; escalation criteria for metric regression
- [ ] T012: Define monthly steady-state review format
  - *Acceptance*: Monthly template that rolls up weekly data; includes maturity re-scoring trigger
- [ ] T013: Verify SC-002: "ROI dashboard inputs are captured weekly for pilot teams"
  - *Acceptance*: At least one pilot team's metrics are captured for ≥2 consecutive weeks

---

### WP03 — MCP Governance Lifecycle
**Prompt**: [`tasks/WP03-mcp-governance.md`](tasks/WP03-mcp-governance.md)
**Dependencies**: none
**Estimate**: ~2 days
**Subtasks**: T014–T018

- [ ] T014: Define MCP integration approval rubric with scoring dimensions: data access scope, credential model, logging/auditability, external dependency risk, sandbox constraints (FR-006)
  - *Acceptance*: Rubric has ≥5 dimensions; each dimension has a 1–5 scoring scale with anchored descriptions
- [ ] T015: Define curated MCP catalog structure and lifecycle: request → assessment → pilot allowlist → full approval/deprecation (FR-007)
  - *Acceptance*: Lifecycle stages documented with entry/exit criteria for each transition
- [ ] T016: Define quarterly integration review process with keep/restrict/deprecate outcomes
  - *Acceptance*: Review template includes checklist per integration; outcomes are actionable
- [ ] T017: Publish MCP governance lifecycle document at `docs/governance/mcp-governance-lifecycle.md`
  - *Acceptance*: Document covers FR-006 and FR-007 completely
- [ ] T018: Verify SC-003: "New MCP integrations cannot reach production without rubric assessment"
  - *Acceptance*: At least one integration has been scored against the rubric as a validation exercise

---

### WP04 — Spec Governance Contracts
**Prompt**: [`tasks/WP04-spec-governance.md`](tasks/WP04-spec-governance.md)
**Dependencies**: WP01 (gap inventory informs governance rules)
**Estimate**: ~2 days
**Subtasks**: T019–T024

- [ ] T019: Define required metadata fields per feature artifact type (meta.json, spec.md, plan.md, tasks.md)
  - *Acceptance*: Schema document lists required fields per artifact; each field has a validation rule
- [ ] T020: Define artifact completeness rules: which sections are mandatory, which are optional, per mission type
  - *Acceptance*: Completeness rules are machine-parseable (JSON schema or equivalent)
- [ ] T021: Define reference integrity rules: cross-references between spec/plan/tasks, links to constitution, links to downstream features
  - *Acceptance*: Rules specify what references must resolve and what counts as broken
- [ ] T022: Define constitution sync rules: how to detect stale principle names, missing principles, version drift
  - *Acceptance*: Rules specify the current constitution version and required principle coverage
- [ ] T023: Define severity classification for governance findings (P0 blocks merge, P1 advisory with due date, P2 advisory) aligned with FR-009
  - *Acceptance*: Each severity level has clear criteria; P0 list is explicitly enumerated
- [ ] T024: Publish governance policy document updating spec generation rules and metadata requirements
  - *Acceptance*: Policy document is referenced by governance validation scripts (WP05)

---

### WP05 — Automated Checks & CI
**Prompt**: [`tasks/WP05-automated-checks.md`](tasks/WP05-automated-checks.md)
**Dependencies**: WP04 (needs governance rules as input)
**Estimate**: ~4 days
**Subtasks**: T025–T031

- [ ] T025: Scaffold `packages/governance/` package with TypeScript config, Vitest, and CLI entry point
  - *Acceptance*: `pnpm typecheck` and `pnpm test` pass in the new package
- [ ] T026: Implement artifact completeness check (`checks/artifact-completeness.ts`) per rules from T020
  - *Acceptance*: Check detects missing required sections; unit tests cover pass/fail for each artifact type
- [ ] T027: Implement reference integrity check (`checks/reference-integrity.ts`) per rules from T021
  - *Acceptance*: Check detects broken cross-references; unit tests cover internal links, constitution refs, and downstream feature refs
- [ ] T028: Implement constitution sync check (`checks/constitution-sync.ts`) per rules from T022
  - *Acceptance*: Check detects stale principle names and missing MUST principles; unit tests cover current vs stale naming
- [ ] T029: Implement dual-format reporting: terminal-readable (`reporting/terminal-reporter.ts`) and JSON (`reporting/json-reporter.ts`) per NFR-002
  - *Acceptance*: Both reporters produce valid output; terminal output uses colors/icons for severity; JSON output validates against a schema
- [ ] T030: Create GitHub Actions workflow (`.github/workflows/governance.yml`) that runs checks on PRs and blocks merge on P0 findings per NFR-001
  - *Acceptance*: Workflow runs on PR, exits non-zero on P0, posts summary comment with findings
- [ ] T031: Verify SC-004: "Governance checks run in CI and block merges on P0 failures"
  - *Acceptance*: Submit a PR with an intentional P0 violation; CI blocks merge. Fix violation; CI passes.

---

### WP06 — Autonomy Leveling & Scenario Policy
**Prompt**: [`tasks/WP06-autonomy-scenario.md`](tasks/WP06-autonomy-scenario.md)
**Dependencies**: WP01 (needs maturity rubric)
**Estimate**: ~3 days
**Subtasks**: T032–T034 (+ sub-deliverables)

- [ ] T032: Define scenario-based holdout evaluation policy for Level 4/5 workflows (FR-011, FR-012):
  - Holdout scenario format definition (structure, storage, isolation from implementation context)
  - Evaluation criteria: pass/fail thresholds, behavioral correctness signals
  - Simulation/digital-twin strategy for critical external dependencies
  - Publish at `docs/governance/scenario-validation-guide.md`
  - *Acceptance*: Guide covers scenario format, storage rules, evaluation runner interface, and pass/fail criteria. A Level 4/5 workflow can be evaluated against the guide.
- [ ] T033: Define legacy migration staging guide (FR-014):
  - 4 phases: assist → document behavior → redesign CI/CD → selective autonomy
  - Prerequisites for each phase transition
  - Publish at `docs/governance/legacy-migration-guide.md`
  - *Acceptance*: Guide covers all 4 phases with entry/exit criteria; a legacy team lead can follow it without additional context
- [ ] T034: Define talent adaptation policy (FR-015):
  - Role evolution for specification-first delivery
  - Early-career development safeguards
  - Publish at `docs/governance/talent-adaptation-policy.md`
  - *Acceptance*: Policy addresses junior/mid/senior role expectations; early-career safeguards are explicit (not just "supervised learning environments" — actionable steps)

---

## Verification Checklist

After all WPs complete, verify all 7 success criteria:

- [ ] SC-001: Rollout model approved and used for new team onboarding (WP01)
- [ ] SC-002: ROI dashboard inputs captured weekly for pilot teams (WP02)
- [ ] SC-003: No MCP integration reaches production without rubric assessment (WP03)
- [ ] SC-004: Governance checks run in CI and block merges on P0 failures (WP05)
- [ ] SC-005: Every pilot team has baseline and monthly maturity classification (WP01 + WP02)
- [ ] SC-006: Level 4/5 workflows demonstrate scenario holdout validation (WP06)
- [ ] SC-007: Measured vs perceived productivity reviewed weekly with remediation on divergence (WP02)
