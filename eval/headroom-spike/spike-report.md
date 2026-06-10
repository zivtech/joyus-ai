# WP01 Spike Report — Headroom MCP Compression

**Headroom version:** proxy-engine=headroom-ai@0.22.3; npm-client=headroom-ai@0.1.0
**Decision:** NO_GO
**Recommended mode:** proxy
**Reversibility rate:** 1 (byte-identical CCR round-trip)
**Tenant isolation (default store):** unsupported
**Added p95 latency:** 9 ms (budget 150 ms)

> **savingsMean below is COMPRESS-ONLY** (raw ratio when the dropped body is never read).
> It is NOT net savings. Zero accuracyDelta required the agent to RETRIEVE the body back, which
> re-enters context — see net economics in `runset/scored.json` and the rationale.

| kind | compress-only savings | savings sd | accuracyDelta | sampleSize (payloads) |
|------|-----------------------|------------|---------------|------------------------|
| content_mcp | 62.1% | 2.9pp | 0 | 5 |
| rag_chunk | 60.6% | 1.5pp | 0 | 3 |

**Rationale:** NET savings under the retrieval that zero-degradation requires do NOT clear 0.5 for any kind (content_mcp compress-only=62% / net-must-read=-56%; rag_chunk compress-only=61% / net-must-read=-59%). Compression is real and reversible (reversibility=1, accuracyDelta=0 WITH retrieval), but for must-read tool outputs the agent retrieves the dropped body, so net tokens ≈ full payload + marker + retrieve-tool overhead — i.e. ≤ 0% net, never ≥50%. The savings the spec needs only materialize when content is NOT retrieved (low retrieval-rate) or a single retrieval is amortized across many turns (reference reuse) — and that retrieval rate is UNMEASURED here (the suite was 100% must-read, single-shot). Recommend proxy mode if pursued. Headroom's default store is content-addressed (cross-tenant dedup) and ephemeral (5-min TTL); durable, isolated reversibility needs a per-tenant persistent backend (our Postgres store, WP03/R2). Path to a conditional GO: measure retrieval-rate / fraction-of-content-actually-read on realistic multi-turn agent traces; CCR is viable only for low-retrieval-rate or read-once-reference-many payloads. The lossy array row-drop path (no CCR backing, rust-less install) must be bypassed regardless.

---
_Savings use the proxy's tiktoken counts on synthetic, realistically-shaped Joyus payloads.
Accuracy is a fixed fact-extraction A/B (uncompressed vs CCR-compressed + retrieve), scored
exact-match by orchestrated subagents; see runset/. Reversibility is a live byte-identical
round-trip of each CCR-dropped field. Corpus is synthetic (C-006); sample sizes above._
