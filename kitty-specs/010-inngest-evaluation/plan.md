# Plan 010: Inngest Evaluation Spike

## Approach

This is a research spike with a fixed scope and a binary decision output. Work proceeds sequentially: environment first, then incrementally more complex validations, ending with a written recommendation.

No production code is changed. The spike runs in an isolated branch and package. If the decision is "go", a follow-on feature (011) would execute the migration.

---

## Dependency Graph

```
Layer 0: WP01 (environment setup — blocks everything)
Layer 1: WP02 (pipeline port — blocks WP03, WP04)
Layer 2: WP03, WP04 (parallel — both depend on WP02)
Layer 3: WP05 (performance — depends on WP02-WP04)
Layer 4: WP06 (decision doc — depends on all)
```

---

## Phase A: Environment

### WP01 — Local Inngest Server Setup
Stand up Inngest server self-hosted (docker-compose: Inngest + Redis), verify it connects to the existing Postgres instance, and register a stub Inngest function from the MCP server codebase. Confirm the Inngest dev UI is accessible and shows the registered function.

**Deliverable**: `docker-compose.inngest.yml`, updated `src/inngest/client.ts`, stub function registration confirmed in UI.

---

## Phase B: Core Validation

### WP02 — Port One Pipeline to Inngest Functions
Port the corpus-update-to-profiles pipeline (corpus_change trigger → profile-generation step → fidelity-check step) to Inngest. Reuse existing step handlers via adapter wrappers. The Inngest function calls step handlers using `inngest.step.run()` with existing handler interfaces.

**Deliverable**: `src/inngest/functions/corpus-update-pipeline.ts`, adapter wrappers, end-to-end execution confirmed via Inngest UI trace.

### WP03 — Review Gate via step.waitForEvent()
Implement the review gate pause/resume pattern using `step.waitForEvent()`. When the pipeline function reaches a review gate step, it calls `step.waitForEvent('review-decision', { timeout: '7d' })`. The existing `DecisionRecorder` sends the resume event. Validate partial approval and rejection paths.

**Deliverable**: Updated pipeline function with gate step, `DecisionRecorder` sends Inngest event, manual test of approve/reject/timeout confirmed.

### WP04 — Per-Tenant Concurrency and Cron Scheduling
Validate that `concurrency: { key: 'event.data.tenantId', limit: 1 }` prevents cross-tenant contamination. Implement a schedule_tick pipeline as an Inngest cron function; confirm overlap detection (Inngest concurrency key prevents concurrent runs of same pipeline).

**Deliverable**: Concurrency test (two tenants run simultaneously, no contamination), cron function firing confirmed in UI.

---

## Phase C: Assessment

### WP05 — Performance Comparison
Measure step execution p95 latency for the ported pipeline vs the custom executor. Use 50 sequential executions for each. Record: cold-start time, per-step overhead, end-to-end duration. Document the comparison.

**Deliverable**: `research/performance-comparison.md` with raw numbers and analysis.

### WP06 — Decision Document and Migration Plan
Write the go/no-go recommendation based on WP01-WP05 evidence. If "go": produce a deletion inventory (files/classes in Feature 009 that would be removed), a migration sequence, and scope estimate for Feature 011. If "no-go": document the blockers and recommended mitigations for the custom implementation.

**Deliverable**: `research/decision.md` with recommendation, evidence summary, and (if go) migration plan outline.

---

## Key Decisions

| Decision | Options | Notes |
|---|---|---|
| Self-hosted vs cloud | Self-hosted (Postgres+Redis) vs Inngest Cloud | Spike validates self-hosted first; cloud is fallback if self-hosted too immature |
| Schema reconciliation | Keep 009 tables + sync vs replace with Inngest state | Deferred to Feature 011 if spike passes |
| Rollout strategy | Full replace vs parallel run | Deferred to Feature 011 |

---

## Out of Scope

- Migrating all 009 pipelines to Inngest (Feature 011, if approved)
- Changes to step handler interfaces
- Changes to API routes or MCP tools
- Multi-tenant Inngest isolation at the server level (beyond concurrency keys)
