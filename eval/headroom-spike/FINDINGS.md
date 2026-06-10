# WP01 — Headroom MCP Compression: Evaluation Spike Findings

**Mission:** `headroom-mcp-compression-layer-01KSZKMF` · **WP01 (gate)**
**Decision: NO_GO** — for the spec as written and the scenario tested. A *conditional* GO
remains open but depends on a measurement this spike did not take (see "The real gate").
Machine artifact: `spike-report.json` (schema-valid against `contracts/spike-report.schema.json`).

Subject: **Headroom** — proxy engine `headroom-ai` **0.22.3** (Python), npm client
`headroom-ai` **0.1.0**. Measured live against a local `headroom proxy` on synthetic,
realistically-shaped Joyus payloads (C-006).

---

## Why no_go (the one that matters)

NFR-002 requires **≥50% token reduction _at_ NFR-001's zero-degradation bar** — both, for the
same interaction. This spike never achieved both at once:

| Quantity | content_mcp | rag_chunk | State it was measured in |
|---|---|---|---|
| Compress-only savings | +62.1% | +60.6% | body dropped to a `<<ccr:hash>>` marker, **never read** |
| Accuracy delta | 0.000 | 0.000 | agent **retrieved the dropped body back** (all 16 tasks) |
| **Net savings (must-read, 1 retrieval)** | **≈ −56%** | **≈ −59%** | compressed + retrieved body + retrieve-tool overhead vs. full |

The 62% and the 0-delta are **mutually exclusive**. Savings exist only while the body stays
dropped; zero degradation required pulling the full body back into context. For a single-shot
tool-output→answer where the answer is in the body — **100% of the suite** — the model ends up
receiving the full body anyway (via retrieval), plus the marker and the injected retrieve-tool
schema. **Net result: CCR costs *more* than just sending the payload.**

This is structural, not a small-sample artifact: in must-read single-shot, net savings is
`−(marker + tool-overhead)/full` — asymptotically **0% for large payloads, negative for small**,
**never ≥50%.** (The exact −56%/−59% magnitude is inflated by small payloads + fixed ~55–110-token
tool overhead; the sign and ceiling are what matter.)

## The real gate (what WP02 must measure before anyone trusts a savings number)

CCR savings are real **only to the extent content is NOT retrieved.** Roughly:

> `expected_savings ≈ compress_only_ratio × (1 − retrieval_rate)`

and `retrieval_rate` is **unmeasured here** (the suite was 100% must-read, single-shot — the worst
case). CCR wins in exactly two regimes this spike did not exercise:
1. **Low retrieval rate** — large tool outputs where the agent needs only a fraction (e.g. a
   100-result search where it reads 3) and leaves the rest dropped.
2. **Read-once / reference-many** — one big payload retrieved once but kept compact in history
   across many subsequent turns, amortizing the retrieval.

**Path to a conditional GO:** instrument real (multi-turn) agent traces for the fraction of
tool-output content actually read, then re-run net economics. Do not green-light WP02–WP05 on the
current evidence — net ≥50%-at-zero-degradation is not demonstrated.

---

## What the spike *did* establish (keep these)

- **Compression + reversibility work.** Large prose fields (≥~400 chars: article bodies,
  generated content, RAG chunks) are replaced by a CCR marker and the original is retrievable
  **byte-identical** (reversibility 8/8). Latency p95 8 ms (after one-time model warmup).
- **Retrieval preserves accuracy.** With the `headroom_retrieve` loop wired, compressed+retrieve
  answers were verbatim-identical to full-payload answers on all 16 tasks (accuracyDelta 0).
- **Reversibility is EPHEMERAL.** CCR originals live in an in-memory store, default **5-min TTL**,
  LRU-evicted at 1000 entries. After expiry the marker dangles → `/v1/retrieve` 404. FR-006
  "retrievable on demand" is **not durably** satisfied by Headroom's default store → needs a
  persistent backend (our Postgres store, WP03/R2).
- **No in-process library mode (Node).** npm `headroom-ai` 0.1.0 is a thin proxy client (no
  in-process compression, no `retrieve`); the engine is the Python proxy. R1 is forced to `proxy`.
- **Tenant isolation: unsupported by default, configurable.** CCR store is content-addressed —
  identical content across tenants collides to the same hash. Needs `HEADROOM_CCR_TENANT_PREFIX`
  / per-tenant backend (or our Postgres store). Routes the store decision (R2); not a hard gate.
- **A high-savings lossy path exists and must be avoided.** Huge repetitive arrays/logs get up to
  97% via SmartCrusher row-drop, but with **no CCR backing** in the standard (rust-less) install →
  unrecoverable. Not the content path; must be bypassed.

## Savings envelope (compress-only, by payload family)

| Family | Compress-only | Reversible | Net on must-read |
|---|---|---|---|
| Large prose (get_item body, generated, RAG chunk) | 59–93% | byte-identical CCR (≤5min) | ≤ 0% |
| Metadata arrays (issue/source/sync lists) | 35–49% | inline (no drop) | = compress-only (no retrieval) |
| Search result lists (short excerpts) | ~16% | inline | = compress-only |
| Huge repetitive logs/arrays | up to 97% | NO (lossy drop) | n/a (lossy) |

Note: metadata arrays / search lists compress *inline* (no body drop, no retrieval), so their
modest savings (16–49%) ARE net — but they fall short of 50%. Large prose clears 50% only
compress-only, and collapses to ≤0% net once the body is read.

## Limitations / honesty
- Corpus synthetic (C-006), modeled on real `joyus-ai-mcp-server` shapes; modest N (content_mcp
  5 payloads/10 tasks; rag_chunk 3/6). Net-economics magnitude is payload-size sensitive.
- Accuracy used Sonnet (a capable, retrieval-aware agent); weaker/non-retrieving agents degrade.
- The decisive missing measurement is **retrieval rate on realistic multi-turn traces** — the
  variable that determines whether CCR ever nets positive for Joyus.

## Reproduce
```bash
cd eval/headroom-spike
python3 -m venv .venv && . .venv/bin/activate && pip install "headroom-ai[proxy]"
pkill -f 'headroom proxy'; headroom proxy --port 8787 &   # FRESH store (CCR TTL = 5 min)
python3 build-runset.py                                    # corpus + runset + savings/reversibility
# accuracy A/B: one subagent per (payload,condition) over runset/*; write runset/scored.json
#   then add net economics (tiktoken: compressed + body + tool overhead) to scored.json
npm install && npx tsx run-spike.ts                        # -> spike-report.json (decision) + .md
```
