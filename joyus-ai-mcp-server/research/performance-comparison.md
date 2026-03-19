# Feature 010: Inngest vs Custom Executor — Performance Comparison

**Date:** 2026-03-19
**Feature:** 010-inngest-evaluation
**Work Package:** WP05 — Performance Comparison
**Environment:** Mock mode (in-process, no real DB or Inngest server)

---

## 1. Methodology

### What is measured

This benchmark isolates the **infrastructure overhead** of each executor — the cost imposed
by the orchestration layer on top of actual step handler work. Both executors run against
in-process mocks with zero I/O latency, making it possible to measure pure framework cost.

| Layer | Custom Executor | Inngest Adapter |
|-------|-----------------|-----------------|
| Handler | No-op (returns immediately) | No-op (returns immediately) |
| DB | Proxy mock (zero I/O) | Not used |
| Transport | None | Mock `step.run()` calls `fn()` directly |

### What is NOT measured

Real-world step latency includes additional overhead that the mock cannot capture:

| Overhead source | Custom executor | Inngest (self-hosted) | Inngest (cloud) |
|---|---|---|---|
| PostgreSQL round-trips | **+3–8 ms/step** | N/A | N/A |
| HTTP callback (Inngest → server) | N/A | **+5–20 ms/step** | **+100–500 ms/step** |
| Redis polling interval | N/A | **+0–1 s** (queue drain) | N/A |

See Section 5 for how to interpret mocked numbers in a production context.

### Benchmark parameters

- **Iterations:** 50 sequential executions per executor (T021, T022)
- **Warmup:** 5 iterations discarded before measurement begins
- **Cold-start:** First execution before warmup (T023)
- **Runner:** `npx tsx src/benchmarks/step-latency.ts`
- **Node.js:** v24.13.0

---

## 2. Results: Custom Executor (T021)

The custom executor uses `StepRunner`, which performs these operations per step:
1. `db.update(executionSteps).set({ status: 'running' })` — mark running
2. `db.select().from(executionSteps).where(idempotencyKey)` — idempotency check
3. `db.update(executionSteps).set({ attempts, idempotencyKey })` — update attempt counter
4. `handler.execute(config, context)` — actual handler call
5. `db.update(executionSteps).set({ status: 'completed' })` — mark done

**Mock-mode results (50 iterations, no real DB):**

| Metric | Latency |
|--------|---------|
| Cold-start (first exec) | **3.104 ms** |
| min | 0.014 ms |
| mean | 0.070 ms |
| **p50** | **0.030 ms** |
| **p95** | **0.112 ms** |
| **p99** | **0.773 ms** |
| max | 0.773 ms |

The 3.1 ms cold-start reflects JIT compilation of the `StepRunner` class and initialization
of the Proxy-based mock DB on first invocation. Subsequent warm calls average 0.07 ms.

**Projected real-world latency (per step, with PostgreSQL):**

Each of the 4–5 Drizzle ORM calls incurs a full PostgreSQL round-trip. In a co-located
deployment (same VPC, ~0.5–2 ms per query):

| Scenario | Estimated step latency |
|----------|----------------------|
| Co-located PostgreSQL (ideal) | **~5–12 ms** |
| Cross-AZ PostgreSQL | **~15–30 ms** |
| First execution (cold start + DB pool init) | **~1–3 s** |

---

## 3. Results: Inngest Adapter (T022)

The Inngest adapter wraps `handler.execute()` inside `step.run()`:

```ts
return step.run(stepName, () => handler.execute(config, context)) as Promise<StepResult>;
```

In mock mode, `step.run()` invokes the callback immediately with no transport overhead.

**Mock-mode results (50 iterations, no real Inngest server):**

| Metric | Latency |
|--------|---------|
| Cold-start (first exec) | **0.040 ms** |
| min | 0.000 ms |
| mean | 0.000 ms |
| **p50** | **0.001 ms** |
| **p95** | **0.003 ms** |
| **p99** | **0.008 ms** |
| max | 0.008 ms |

The adapter is a thin wrapper (~3 lines), so mock-mode overhead approaches zero. The real
cost emerges only when a genuine Inngest server is interposed.

**Projected real-world latency (per step, with real Inngest):**

Each `step.run()` checkpoint requires Inngest to:
1. Return an interrupt response to the current HTTP call
2. Persist the checkpoint state
3. Re-invoke the function handler via a new HTTP request

| Scenario | Estimated step latency |
|----------|----------------------|
| Self-hosted Inngest (local Docker) | **~15–40 ms** |
| Self-hosted Inngest (same VPC) | **~10–25 ms** |
| Inngest cloud (US-East) | **~100–300 ms** |
| Inngest cloud (cross-region) | **~200–500 ms** |

---

## 4. Cold-Start Comparison (T023)

Cold-start is the latency from system startup to first completed step execution.

### Custom Executor
| Phase | Typical duration |
|-------|-----------------|
| Node.js process startup | ~200–500 ms |
| Express server listen | ~50–100 ms |
| PostgreSQL connection pool init | ~100–300 ms |
| EventBus subscription setup | ~5–20 ms |
| First step (infrastructure JIT) | ~3–10 ms |
| **Total cold-start** | **~400 ms – 1 s** |

The infrastructure JIT overhead observed in the benchmark (3.1 ms) is dominated by real-world
process and connection pool startup.

### Inngest (Self-Hosted)
| Phase | Typical duration |
|-------|-----------------|
| Node.js process startup | ~200–500 ms |
| Inngest Dev Server startup (Docker) | ~2–5 s |
| Inngest worker registration | ~500 ms – 1 s |
| First event delivery to worker | ~500 ms – 2 s |
| **Total cold-start** | **~3–9 s** |

### Inngest (Cloud)
| Phase | Typical duration |
|-------|-----------------|
| Node.js process startup | ~200–500 ms |
| Inngest SDK registration | ~1–3 s |
| First event delivery (polling interval) | ~0.5–5 s |
| **Total cold-start** | **~2–9 s** |

**Winner (cold start):** Custom executor — no external service dependency.

---

## 5. Interpreting the Mock Numbers

The mock-mode p50 ratio is **~44x** in favor of the Inngest adapter over StepRunner. This
is **misleading** and should not be used to evaluate production fit. Here is why:

- **StepRunner mock overhead** reflects 4–5 chained `Promise.resolve()` calls (the mock DB).
  In production these become real PostgreSQL round-trips, adding **3–8 ms/step** on top.

- **Inngest adapter mock overhead** is near-zero because `step.run()` calls `fn()` directly.
  In production, Inngest interposes an HTTP round-trip **for every step**, adding
  **10–500 ms/step** depending on deployment.

| Metric | Mock | Real (co-located) | Real (Inngest cloud) |
|--------|------|-------------------|----------------------|
| Custom executor p50 | 0.030 ms | ~5–12 ms | N/A |
| Inngest adapter p50 | 0.001 ms | ~15–40 ms | ~100–300 ms |

**In real-world conditions, the custom executor is lower-latency for per-step execution.**

---

## 6. Latency Anomalies and Flags (T025)

### Flag 1 — Redis polling interval (custom executor)
The `PipelineExecutor` uses an `EventBus` backed by PostgreSQL LISTEN/NOTIFY (spec 009).
There is no Redis in the current implementation. However, if the EventBus were migrated to
a Redis-backed queue (a commonly considered upgrade), a polling interval of 100–250 ms
would add consistent tail latency to every pipeline trigger, pushing p99 from ~10 ms to
~250 ms. **Current status: not applicable. Flagged for future consideration.**

### Flag 2 — Inngest self-hosted overhead
The `step.run()` pattern requires Inngest to round-trip for **each checkpoint**. For a
2-step pipeline (profile-generation + fidelity-check), that is 2 HTTP call interrupts +
2 re-invocations = 4 HTTP requests through the Inngest Dev Server, plus the initial trigger.
At local Docker latency (~5 ms/HTTP call), this adds ~20–40 ms over the full pipeline
compared to the custom executor's sequential DB writes.

### Flag 3 — `step.waitForEvent()` blocks function execution
The review gate (WP03, T011) uses `step.waitForEvent('pipeline/review.decided', { timeout: '7d' })`.
During the wait period, the Inngest function is suspended and consumes no CPU or memory.
This is a durability advantage. However, resuming from a 7-day wait incurs a full
function cold-start on the worker pod handling the callback.

### Flag 4 — Per-tenant concurrency key
WP04 added `concurrency: { key: 'event.data.tenantId', limit: 1 }` to the corpus-update
pipeline. Under high tenant-event load, new events queue behind the running function,
increasing p99 latency by one full pipeline duration per queued event. For a 2-step
pipeline running ~20 ms total, p99 can spike to `(queue_depth × 20) ms`.

### Flag 5 — Custom executor idempotency adds one DB read per attempt
`StepRunner.runStep()` calls `checkIdempotency()` on every attempt, even the first.
This unconditional SELECT adds 1 round-trip per step. For a 2-step pipeline, that is
2 extra PostgreSQL queries that could be deferred until a retry is actually detected.
**Low-impact optimization opportunity for a future WP.**

---

## 7. Summary and Recommendation

| Dimension | Custom Executor | Inngest (self-hosted) | Inngest (cloud) |
|-----------|----------------|----------------------|-----------------|
| Per-step latency (real) | ~5–12 ms | ~15–40 ms | ~100–300 ms |
| Cold-start | ~400 ms – 1 s | ~3–9 s | ~2–9 s |
| Durability | Manual DB state | Built-in checkpointing | Built-in checkpointing |
| Observability | None built-in | Inngest UI + traces | Inngest UI + traces |
| Review gate | Custom (DecisionRecorder) | step.waitForEvent() | step.waitForEvent() |
| Cron support | Custom scheduler | Native schedule trigger | Native schedule trigger |
| Operational cost | Own infrastructure | +1 service (Dev Server) | Managed SaaS |

**For latency-sensitive workloads:** the custom executor wins by ~3–4x on per-step wall
time in co-located PostgreSQL deployments.

**For durability and observability:** Inngest wins decisively. Automatic checkpointing,
visual execution traces, and `step.waitForEvent()` eliminate significant engineering work
that the custom executor would need to replicate.

**Recommendation (spike conclusion):** Use Inngest for the pipeline orchestration layer.
The latency delta (~5 ms vs ~20 ms per step) is acceptable for async content pipelines
where total execution time is dominated by LLM calls (100–3000 ms). The durability and
observability benefits of Inngest outweigh the per-step overhead for this use case.

---

*Generated by Feature 010 WP05 evaluation spike. See `src/benchmarks/step-latency.ts` for the benchmark script.*
