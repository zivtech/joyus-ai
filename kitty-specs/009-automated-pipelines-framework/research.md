# Research: Automated Pipelines Framework
*Phase 0 output for Feature 009*

## R1: Event Bus Patterns in Node.js/TypeScript

**Decision**: Use PostgreSQL LISTEN/NOTIFY as the event transport for MVP, behind an `EventBus` interface that abstracts the transport mechanism. Trigger events are persisted to a `trigger_events` queue table as the source of truth; NOTIFY acts as a low-latency wakeup signal for the executor's poll loop.

**Rationale**:
- Already using PostgreSQL (Drizzle ORM + pg). No new infrastructure dependency.
- LISTEN/NOTIFY is built into PostgreSQL and the `pg` driver already handles it — `client.on('notification', callback)` after `LISTEN channel_name`.
- The queue table provides delivery guarantee. If NOTIFY is lost (connection drop, long transaction), the executor's poll loop picks up pending events on its next cycle (default: 30s).
- The `EventBus` interface is the swap point. A future Redis Streams or RabbitMQ implementation requires only a new class implementing the same interface — no changes to the executor, triggers, or pipeline logic.

**Alternatives considered**:

- **Node.js EventEmitter (in-process)**: No delivery guarantee. Events lost on process restart. Not suitable for durable pipeline triggers. Spec requires delivery guarantee (Assumption: "Async event bus with delivery guarantee").
- **Redis Pub/Sub**: Low latency, but no delivery guarantee (fire-and-forget). Redis Streams would provide durability, but adds an external dependency. Not justified for MVP when PostgreSQL LISTEN/NOTIFY + queue table achieves the same result.
- **RabbitMQ / NATS / Kafka**: Production-grade message brokers with delivery guarantees, but each adds significant operational complexity (separate service, connection management, monitoring). Over-engineered for a single-instance MVP with <100 events/minute expected throughput.
- **BullMQ (Redis-backed job queue)**: Popular Node.js job queue. Adds Redis dependency. Better fit if we needed complex job scheduling (priorities, rate limiting, delayed jobs), but pipeline execution is simpler — trigger → execute → done.

**Interface shape**:

```typescript
interface EventBus {
  /**
   * Publish an event. The implementation MUST persist the event
   * before returning (delivery guarantee).
   */
  publish(event: EventEnvelope): Promise<void>;

  /**
   * Subscribe to events of a given type. The handler is called
   * for each event. The implementation manages acknowledgment.
   */
  subscribe(eventType: string, handler: EventHandler): void;

  /**
   * Remove a subscription.
   */
  unsubscribe(eventType: string): void;

  /**
   * Start listening. Call after all subscriptions are registered.
   */
  start(): Promise<void>;

  /**
   * Stop listening and clean up resources.
   */
  stop(): Promise<void>;
}

interface EventEnvelope {
  eventId: string;
  tenantId: string;
  eventType: string;       // 'corpus_change' | 'schedule_tick' | 'manual_request'
  payload: Record<string, unknown>;
  timestamp: Date;
}

type EventHandler = (event: EventEnvelope) => Promise<void>;
```

**Implementation notes for PgNotifyBus**:

- On `publish`: INSERT into `trigger_events` table with status `pending`, then `NOTIFY pipeline_events, '<event_id>'`.
- On `start`: Acquire a dedicated `pg.Client` (not from the pool — LISTEN requires a persistent connection). Execute `LISTEN pipeline_events`. On notification: look up the event by ID from `trigger_events`, call the matching handler, update status to `acknowledged`.
- Poll loop as fallback: Every 30 seconds, query `trigger_events` for `pending` events older than 10 seconds (missed NOTIFYs). Process them in order.
- On `stop`: `UNLISTEN pipeline_events`, release the dedicated client.

## R2: Pipeline Execution Engine Patterns

**Decision**: Async worker pattern — a `PipelineExecutor` class runs a poll loop, picks up pending trigger events from the queue table, matches them to pipeline definitions, and executes steps sequentially via a `StepRunner`. The executor is a long-lived process within the MCP server.

**Rationale**:
- Sequential step execution within a pipeline matches the spec's forward-only, pause-on-failure semantics (FR-005). There is no need for a DAG execution engine.
- The poll-based worker pattern is simple, debuggable, and sufficient for MVP scale. The executor:
  1. Polls `trigger_events` for `pending` events
  2. For each event, finds matching active pipelines (by tenant + trigger type)
  3. Checks concurrency policy (skip_if_running, queue, allow_concurrent)
  4. Creates a `pipeline_execution` record
  5. Iterates through pipeline steps in order, delegating to `StepRunner`
  6. On completion/failure, updates execution record

**Alternatives considered**:

- **DAG execution engine (Airflow-style)**: Supports parallel steps, complex dependencies, conditional branching. Massive overkill for sequential content-and-profile pipelines. The spec explicitly limits scope to sequential execution. DAG engines also bring scheduling complexity, executor pools, and retry semantics that duplicate what we're building.
- **State machine (XState / custom FSM)**: Good formal model for pipeline states, but adds a dependency and conceptual overhead for what is a linear sequence with pause/resume. The pipeline's state transitions are simple enough to model with status enums and sequential logic.
- **Temporal.io / Inngest**: Durable execution frameworks with built-in retry, timeout, and state management. Excellent for complex workflows but add significant infrastructure dependency. Not justified for content-and-profile pipelines at MVP scale.

**Execution flow**:

```
TriggerEvent (pending)
  → PipelineExecutor.processTrigger()
    → Find matching pipelines (tenant_id + trigger_type)
    → For each pipeline:
      → Check concurrency policy
      → Create PipelineExecution (status: running)
      → For each step in pipeline.steps:
        → If step is review_gate:
          → Pause execution (status: paused_at_gate)
          → Route artifacts to review queue
          → STOP (execution resumes when review decisions arrive)
        → Else:
          → StepRunner.executeStep(step, context)
          → On success: mark step completed, continue
          → On transient failure: retry per policy
          → On non-transient failure or retries exhausted:
            → Mark step failed
            → Pause execution (status: paused_on_failure)
            → Notify tenant
            → STOP
      → All steps complete: mark execution completed
```

## R3: Retry Strategies with Exponential Backoff

**Decision**: Custom retry implementation with configurable exponential backoff. No external library needed — the logic is ~50 lines of TypeScript.

**Rationale**:
- The spec defines a specific default policy: 3 retries with 30s/60s/120s backoff (FR-004). This is a simple geometric sequence, not a complex retry algorithm.
- Libraries like `p-retry`, `async-retry`, or `cockatiel` add dependencies for functionality we can implement in a few lines. The retry logic is:
  1. Attempt the step
  2. If transient error and attempts < maxRetries: wait for `baseDelay * 2^attempt` milliseconds, retry
  3. If non-transient error or retries exhausted: fail

**Error classification**:

Errors are classified at the step handler level. Each `PipelineStepHandler` returns a result that includes an `isTransient` flag:

| Error Type | Classification | Example |
|-----------|---------------|---------|
| Network timeout | Transient | Profile engine API timeout |
| Rate limit (429) | Transient | Content source API rate limit |
| Service unavailable (503) | Transient | Upstream service restarting |
| Invalid configuration | Non-transient | Step references deleted profile |
| Schema validation failure | Non-transient | Step output does not match expected schema |
| Authorization failure | Non-transient | Tenant's access to profile revoked |
| Data integrity error | Non-transient | Duplicate idempotency key violation |

**Retry policy shape**:

```typescript
interface RetryPolicy {
  maxRetries: number;        // Default: 3
  baseDelayMs: number;       // Default: 30000 (30s)
  maxDelayMs: number;        // Default: 300000 (5 min) — caps exponential growth
  backoffMultiplier: number; // Default: 2 (exponential)
}

// Computed delay for attempt N (0-indexed):
// delay = min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs)
// Attempt 0: 30s, Attempt 1: 60s, Attempt 2: 120s (matches spec default)
```

**Implementation notes**:
- Retry delay is implemented with `setTimeout` wrapped in a Promise — the step runner awaits the delay before the next attempt.
- Each attempt is logged to the `execution_steps` table with attempt number, error detail, and next retry time.
- The pipeline executor does not retry — it delegates retry entirely to the step runner. If the step runner exhausts retries, it returns a failure result and the executor handles the pause-on-failure logic.

## R4: Circular Dependency Detection

**Decision**: Build a directed graph from pipeline trigger→output mappings across all of a tenant's pipelines. Run DFS-based cycle detection at pipeline creation/update time. Runtime fallback: execution chain depth counter.

**Rationale**:
- The spec requires detection at configuration time (FR-009). A directed graph where nodes are pipelines and edges represent "Pipeline A's output can trigger Pipeline B" is the natural model.
- DFS cycle detection is O(V+E), well-understood, and handles indirect cycles of any depth (satisfying NFR-004: "depth 5+").
- Runtime depth counter is a cheap defensive fallback: if an execution's trigger chain exceeds a configurable depth (default: 10), the execution is halted and the tenant is notified.

**Alternatives considered**:

- **Topological sort (Kahn's algorithm)**: Also detects cycles (if the sorted output has fewer nodes than the graph, there's a cycle). Equivalent to DFS for detection purposes, but DFS provides the actual cycle path for error messages — more useful for telling the tenant exactly which pipelines form the cycle.
- **Union-Find**: Detects connectivity, not directed cycles. Not applicable.
- **Transitive closure (Floyd-Warshall)**: O(V^3), overkill for pipeline dependency graphs that are small (max 20 pipelines per tenant).

**Graph construction**:

For each tenant, the graph is built as follows:

1. **Nodes**: One per pipeline definition (by `pipeline_id`)
2. **Edges**: For each pipeline P, examine its step outputs. If any step's output matches another pipeline Q's trigger type and filter (e.g., P produces a `corpus_change` event type that Q is configured to trigger on), add edge P → Q.
3. **Edge matching rules**:
   - `corpus_change` trigger: matches if any step writes to the same corpus that another pipeline monitors
   - `manual_request`: never creates an edge (manual triggers are not automatic)
   - `schedule_tick`: never creates an edge (schedule triggers are not caused by other pipelines)
   - Custom event types (future): matched by event type string equality

**DFS cycle detection algorithm**:

```
function detectCycles(graph: DirectedGraph): CycleResult {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();  // node → color
  const parent = new Map<string, string>(); // node → predecessor (for path reconstruction)
  const cycles: string[][] = [];

  for (const node of graph.nodes()) {
    color.set(node, WHITE);
  }

  for (const node of graph.nodes()) {
    if (color.get(node) === WHITE) {
      dfsVisit(node);
    }
  }

  function dfsVisit(u: string) {
    color.set(u, GRAY);
    for (const v of graph.neighbors(u)) {
      if (color.get(v) === GRAY) {
        // Back edge found — reconstruct cycle path
        cycles.push(reconstructCycle(u, v, parent));
      } else if (color.get(v) === WHITE) {
        parent.set(v, u);
        dfsVisit(v);
      }
    }
    color.set(u, BLACK);
  }

  return { hasCycle: cycles.length > 0, cycles };
}
```

**Runtime depth counter**:

Each `PipelineExecution` record stores a `triggerChainDepth` integer. When Pipeline A's output triggers Pipeline B:
- B's execution is created with `triggerChainDepth = A.triggerChainDepth + 1`
- If `triggerChainDepth > maxChainDepth` (default: 10), the execution is rejected with a cycle detection error.
- Manual triggers and schedule ticks start with `triggerChainDepth = 0`.

## R5: Review Queue Integration Patterns

**Decision**: Pipeline-side review gate implementation that pauses execution and writes structured review requests to the `review_decisions` table. The review queue UI/API is out of scope for this spec — this spec defines only the pipeline's interface to it.

**Rationale**:
- The spec explicitly states: "This spec defines how pipelines interact with review queues, not the queue itself."
- The review gate is a pipeline step type that, instead of producing an output, pauses the pipeline and creates pending `review_decision` rows — one per artifact requiring review.
- Resumption is driven by decision recording: when all artifacts at a gate have decisions (approved or rejected), the pipeline resumes.

**Gate flow**:

```
Step N-1 completes → Step N is review_gate
  → Executor identifies artifacts produced by preceding steps
  → Creates ReviewDecision rows (status: pending) for each artifact
  → Sets execution status to 'paused_at_gate'
  → Emits notification to tenant (via notification step handler reuse)
  → Executor STOPS processing this execution

[External: reviewer submits decision via API]

Decision API receives approval/rejection:
  → Updates ReviewDecision row (status: approved/rejected, feedback, reviewer_id)
  → Checks: are all decisions for this gate complete?
  → If yes:
    → Partition artifacts into approved and rejected sets
    → Store rejected artifacts' feedback as structured signals
    → Update execution context: downstream steps receive only approved artifacts
    → Set execution status back to 'running'
    → Executor picks up the execution on next poll and continues from Step N+1
  → If no:
    → Do nothing (wait for remaining decisions)
```

**Escalation**:

A background cron job (every hour) checks for `paused_at_gate` executions where the gate's timeout has elapsed:

```
For each paused execution:
  gatePausedAt = execution.updatedAt (when it paused)
  timeoutHours = pipeline.review_gate_timeout (default: 48)
  if now - gatePausedAt > timeoutHours:
    → Look up tenant's escalation config
    → If secondary_reviewer configured: notify secondary reviewer
    → If no secondary reviewer: notify tenant admin
    → Log escalation event
    → Do NOT auto-approve or auto-reject
```

## R6: Cron Scheduling in Node.js

**Decision**: Reuse the existing `node-cron` (scheduling) and `cron-parser` (next-run computation) dependencies, following the same patterns established in `src/scheduler/index.ts` and `src/content/sync/scheduler.ts`.

**Rationale**:
- `node-cron` 3.x and `cron-parser` 4.x are already in `package.json` and used by the task scheduler and content sync scheduler.
- The pipeline scheduler follows the same pattern: on startup, load all pipelines with schedule triggers, register cron jobs, create trigger events on tick.
- No new dependency needed.

**Differences from existing scheduler**:

| Aspect | Existing scheduler (`src/scheduler/`) | Pipeline schedule trigger |
|--------|---------------------------------------|--------------------------|
| What it schedules | Task types (standup summary, PR reminder, etc.) | Pipeline trigger events |
| Execution | Directly runs task executor | Creates a trigger_event row; pipeline executor picks it up |
| Concurrency handling | None (tasks run independently) | Checks pipeline concurrency policy (skip_if_running) |
| Tenant scoping | User-scoped (userId) | Tenant-scoped (tenantId) |
| Overlap detection | None | FR-015: skip if previous execution still running (default policy) |

**Implementation notes**:

- `ScheduleTriggerHandler` maintains a `Map<string, cron.ScheduledTask>` of active cron jobs, keyed by pipeline ID.
- On startup: loads all active pipelines with schedule triggers, registers cron jobs.
- On pipeline create/update/delete: dynamically adds/removes cron jobs.
- On cron tick: checks if the previous execution for this pipeline is still running. If so and concurrency policy is `skip_if_running`: logs a warning and skips. Otherwise: creates a `trigger_event` with type `schedule_tick`.
- Timezone support: cron jobs use the pipeline's configured timezone (stored in trigger config), defaulting to UTC.

## R7: Idempotent Pipeline Step Design

**Decision**: Each step execution is assigned an idempotency key derived from `(execution_id, step_id, attempt_number)`. Step handlers check for existing output with the same idempotency key before performing work.

**Rationale**:
- FR-014 requires pipeline steps to be idempotent. Re-executing with the same inputs must produce the same outputs without side effects.
- The idempotency key is deterministic: given the same execution, step, and attempt, the key is always the same.
- Step handlers implement idempotency by:
  1. Computing the idempotency key
  2. Checking if an output already exists for this key
  3. If yes: return the existing output (no-op)
  4. If no: execute the step, store the output with the idempotency key

**Key generation**:

```typescript
function computeIdempotencyKey(
  executionId: string,
  stepId: string,
  attemptNumber: number,
): string {
  return createHash('sha256')
    .update(`${executionId}:${stepId}:${attemptNumber}`)
    .digest('hex');
}
```

**Notes**:
- The idempotency key is stored on the `execution_steps` row.
- Step handlers that produce artifacts (content generation, profile generation) use the key as a dedup check against the artifact store.
- Step handlers that perform side effects (notifications) are naturally idempotent if they check "was this notification already sent for this key."
