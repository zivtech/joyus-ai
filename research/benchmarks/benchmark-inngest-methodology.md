# Inngest Benchmark Methodology

## Purpose

This document describes how to reproduce the Inngest-side performance measurements
when a live self-hosted Inngest server is available. The custom executor numbers are
in `benchmark-custom-executor.mjs` (already measured). These instructions complete
the comparison for `research/performance-comparison.md`.

## Prerequisites

1. Docker Compose stack running (base + inngest overlay):
   ```bash
   docker-compose -f deploy/docker-compose.yml -f deploy/docker-compose.inngest.yml up -d
   ```
2. `joyus-ai-mcp-server` running on port 3000 with Inngest env vars set:
   ```dotenv
   INNGEST_BASE_URL=http://localhost:8288
   INNGEST_EVENT_KEY=local-dev-key
   INNGEST_SIGNING_KEY=local-signing-key
   ```
3. App registered in Inngest dev UI (http://localhost:8288 → Add App →
   `http://host.docker.internal:3000/api/inngest`).

## Step 1 — Send 50 Sequential Events

Run the following shell loop. Sequential (not concurrent) sends mirror the
custom executor benchmark conditions.

```bash
#!/usr/bin/env bash
# benchmark-inngest.sh — send 50 corpus.changed events sequentially

EVENT_URL="http://localhost:8288/e/local-dev-key"
N=50

echo "Sending $N pipeline/corpus.changed events..."
for i in $(seq 1 $N); do
  curl -s -X POST "$EVENT_URL" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"pipeline/corpus.changed\",\"data\":{\"tenantId\":\"tenant-bench\",\"corpusId\":\"corpus-${i}\",\"changeType\":\"updated\"}}" \
    > /dev/null
  echo -n "."
done
echo ""
echo "Done. Open http://localhost:8288 to view run durations."
```

Wait for all 50 runs to reach `Completed` status before reading metrics
(cron and retry runs will not appear unless triggered separately).

## Step 2 — Read Metrics from the Dev UI

1. Open http://localhost:8288
2. Navigate to **Functions** → `corpus-update-pipeline`
3. Click **Runs** tab
4. Sort by **Started** descending — the 50 bench runs are at the top
5. Export or manually record the **Duration** column for each run

The Duration shown is wall-clock time from event receipt to function completion,
including both `step.run()` checkpoints (profile-generation + fidelity-check).

To get per-step latency (what the custom executor benchmark measures):

- Click into any run
- Each `step.run()` checkpoint shows its individual duration in the timeline
- Record the duration of each step across all 50 runs

## Step 3 — Compute Percentiles

With the 50 step durations collected (per step, not total function time):

```javascript
// Node.js snippet to compute percentiles from a collected array
const timings = [/* paste values here */];
const sorted = [...timings].sort((a, b) => a - b);
const N = sorted.length;
const p50 = sorted[Math.floor(N * 0.50)];
const p95 = sorted[Math.floor(N * 0.95)];
const p99 = sorted[Math.floor(N * 0.99)];
console.log({ p50, p95, p99, min: sorted[0], max: sorted[N-1] });
```

## Step 4 — Measure Cold Start

Cold start = time from first event send (after Inngest server restart) to function
`Completed`. Isolate it by:

1. Restart the Inngest server (`docker-compose restart inngest-server`)
2. Wait for the app to re-register (watch logs: `Registered functions`)
3. Send a single event and record the total Duration in the UI

Repeat 3 times and average. Expected range: 200–600ms (SDK registration handshake
+ Redis enqueue + first HTTP round-trip).

## Expected Metric Ranges (from Inngest docs + community reports)

| Metric | Expected Range | Source |
|--------|---------------|--------|
| Per-step p50 | 10–30ms | Redis default poll interval: 100ms; min 5ms |
| Per-step p95 | 30–80ms | Redis queue contention under load |
| Per-step p99 | 80–150ms | Worst-case poll wait + state write |
| Cold start | 200–600ms | SDK re-registration + HTTP handshake |
| Event ingestion | 1–5ms | HTTP POST to `/e/` endpoint |

## Latency Sources in Inngest Step Execution

Each `step.run()` call involves:

1. **Return checkpoint**: function handler returns a special "step planned" response
   to Inngest server (~HTTP round-trip: ~2-5ms on localhost)
2. **Redis enqueue**: Inngest server writes step result to Redis (~1-3ms)
3. **Poll wait**: worker polls Redis for next step trigger
   (default interval: 100ms; configurable down to 5ms via `INNGEST_POLL_INTERVAL`)
4. **State hydration**: Inngest re-invokes the function handler with previous step
   results restored from state store (~2-10ms depending on payload size)
5. **Actual handler execution**: the `PipelineStepHandler.execute()` call itself

Steps 1–4 are Inngest overhead. Step 5 is what the custom executor benchmark measures.

## Notes on Self-Hosted vs Cloud Inngest

- Self-hosted uses local Redis — expect lower latency than Inngest Cloud (which adds
  network hops to their managed Redis)
- Inngest Cloud p50 step latency is reported as 30–100ms in production use cases
- Self-hosted with tuned `INNGEST_POLL_INTERVAL=5` can reach ~10ms p50 step overhead
