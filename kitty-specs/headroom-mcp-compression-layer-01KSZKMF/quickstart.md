# Quickstart: WP01 Evaluation Spike

The spike is throwaway code that produces one artifact — a `SpikeReport` that says
**go** or **no_go**. Nothing integrates until it says go.

## Prerequisites

- A sampled, **sanitized/synthetic** payload corpus (C-006 — no client-private data,
  secrets, or credentials). Stratified across `content_mcp` (priority), `rag_chunk`,
  `executor_output`.
- A fixed task/answer suite per payload kind (known-correct answers) for the
  accuracy A/B (R3).
- `headroom-ai` pinned to an exact version.

## Steps

1. **Assemble corpus** → `eval/headroom-spike/corpus/` with per-kind subsets and
   recorded `tokenCount` per payload.
2. **Compress** each payload via both candidate modes (library + proxy) and record
   `savingsRatio`, `addedLatencyP95Ms`.
3. **Reversibility** → for every payload, `retrieve(compress(x))` and assert
   byte-identical; compute `reversibilityRate` (must be 1.0).
4. **Isolation probe** → seed byte-identical content under two tenant IDs; confirm
   separate originals + no cross-tenant retrieval; set `tenantIsolationFit`.
5. **Accuracy A/B** → run the task suite twice (uncompressed vs compressed), identical
   prompt+model; compute `accuracyDelta` per kind. Any non-zero delta → that kind fails
   NFR-001.
6. **Decide** → emit `spike-report.md` + a `SpikeReport` JSON validating against
   `contracts/spike-report.schema.json`. `decision=go` requires: at least one kind with
   `savingsMean ≥ 0.50` AND `accuracyDelta = 0` AND `reversibilityRate = 1.0`.

## Pass / Fail (the gate)

| Outcome | Meaning |
|---------|---------|
| `go` + `primaryTarget` | Proceed to WP02 for that payload kind in `recommendedMode`. |
| `no_go` | Stop. Record why. The mission ends cheaply, as designed. |

## What success looks like

A maintainer reads `spike-report.md` and the decision is obvious and defensible —
real numbers, disclosed sample size and variance, no fabricated savings.
