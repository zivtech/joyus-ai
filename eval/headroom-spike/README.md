# WP01 — Headroom Evaluation Spike (harness scaffold)

This is **throwaway evaluation code** for mission `headroom-mcp-compression-layer-01KSZKMF`.
Its only product is a **decision**: `go` or `no_go`. Nothing in `src/compression/` gets
built unless this spike says `go`.

> ⚠️ **This scaffold cannot lie.** The two boundaries that need live inputs —
> Headroom compression (`lib/headroom-client.ts`) and accuracy scoring
> (`lib/accuracy.ts`) — are **stubs that throw `NotImplemented`**. Run it as-is and it
> fails loudly at the first unimplemented boundary. It will **never** emit a fabricated
> savings number or a fake `go`. The measurement math and report emission around those
> stubs are real.

## What you must supply before it produces a real answer

1. **Corpus** (`corpus/<kind>/*.json`) — replace the synthetic templates with a
   representative, **sanitized/synthetic** sample (C-006: no client-private data,
   secrets, or credentials). `content_mcp` is the priority kind.
2. **Task suite** (`task-suite/<kind>.json`) — tasks with known-correct answers, used
   for the accuracy A/B (NFR-001).
3. **Wire the stubs:**
   - `lib/headroom-client.ts` → pin `headroom-ai`, implement `compress`/`retrieve` for
     both `library` and `proxy` modes.
   - `lib/accuracy.ts` → run the task suite against your model (uncompressed vs
     compressed) and return per-task correctness.

## Run

```bash
cd eval/headroom-spike
npm install          # installs headroom-ai (pinned), tsx, ajv
npx tsx run-spike.ts # → writes spike-report.json + spike-report.md
```

## The gate (decided by `run-spike.ts`, not by hand)

`decision = go` **iff** at least one payload kind has **all** of:
- `savingsMean ≥ 0.50` (NFR-002)
- `accuracyDelta = 0` (NFR-001, strict)
- `reversibilityRate = 1.0` (NFR-004)

…and `tenantIsolationFit = supported` for that path (NFR-005). Otherwise `no_go` — and
that is a complete, successful outcome that ends the mission cheaply.

`spike-report.json` is validated against
`../../kitty-specs/headroom-mcp-compression-layer-01KSZKMF/contracts/spike-report.schema.json`.

## Files

```
eval/headroom-spike/
├── run-spike.ts            # orchestrator: real math, honest stubs, emits SpikeReport
├── lib/
│   ├── headroom-client.ts  # STUB (throws) — wire Headroom here, the ONLY Headroom call site
│   ├── accuracy.ts         # STUB (throws) — wire your model A/B here
│   └── tokens.ts           # token counting (real)
├── corpus/                 # synthetic templates — REPLACE with real sanitized samples
│   ├── manifest.template.json
│   ├── content_mcp/        # priority kind
│   ├── rag_chunk/
│   └── executor_output/
├── task-suite/             # task/answer suites per kind — FILL IN
├── package.json
└── tsconfig.json
```
