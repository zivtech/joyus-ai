# Research: Automated Pipelines Framework

## Inputs
- Spec 005 (Content Intelligence) fidelity check interface and drift event contracts.
- Spec 006 (Content Infrastructure) corpus change events and content item schema.
- Spec 008 (Profile Isolation and Scale) profile generation step and retraining events.
- Existing platform event patterns from content schema (Drizzle ORM, PostgreSQL 16).

## R1: PostgreSQL LISTEN/NOTIFY for Event Bus
- Decision: Use PostgreSQL LISTEN/NOTIFY backed by a `trigger_events` queue table for the event bus.
- Why: The platform already runs on PostgreSQL with no external message broker. LISTEN/NOTIFY delivers sub-second latency for internal events without adding operational complexity. The queue table provides durability and at-least-once delivery guarantee on server restart — NOTIFY alone is fire-and-forget and would lose events across restarts. NOTIFY payloads are capped at 8000 bytes, so only the event ID is published; the full payload is fetched from the queue table.

## R2: DFS Cycle Detection
- Decision: Run a depth-first search cycle detector on the pipeline dependency graph at creation and update time, and enforce a runtime depth counter to catch dynamic cycles.
- Why: Pipelines can trigger other pipelines via corpus_change events, creating indirect cycles. Static DFS analysis catches structural cycles before persistence. The runtime depth counter (propagated through trigger chains) catches emergent cycles that only appear with specific data patterns. Both guards are required because static analysis cannot account for runtime branching conditions.

## R3: Exponential Backoff Retry
- Decision: Retry failed steps with configurable exponential backoff (base delay, multiplier, max attempts).
- Why: Transient failures (network timeouts, engine unavailability) are common in distributed step execution. Fixed-interval retry causes thundering herd on recovery. Exponential backoff with jitter distributes retry load and gives downstream services time to recover. Max attempts prevents infinite retry loops.

## R4: Review Gate Pattern
- Decision: Implement review gates as a first-class step type that pauses execution, routes artifacts to a review queue, and resumes on decision.
- Why: Automated content generation requires human oversight before publishing. Making review a step type (not a special execution mode) allows it to appear anywhere in a pipeline definition and participate in the normal step retry and timeout mechanisms. Partial approval (some artifacts approved, some rejected) is modeled as structured JSON on the ReviewDecision entity rather than a binary pass/fail.

## R5: Cron Scheduling with Overlap Detection
- Decision: Schedule triggers use cron expressions with overlap detection enforced before each run.
- Why: If a scheduled pipeline execution takes longer than its cron interval, naive re-triggering causes concurrent runs that may conflict (e.g., two simultaneous content generation runs for the same author). Overlap detection checks for running executions under the same pipeline before launching a new one, applying the pipeline's concurrencyPolicy (skip_if_running, queue, or allow_concurrent) to decide the outcome.
