# WP01 raw probe evidence (preliminary, pre-corpus)

Proxy: headroom-ai Python 0.22.3, `headroom proxy` localhost:8787, defaults.
npm client: headroom-ai@0.1.0 (proxy client; no in-process compression, no retrieve()).
Endpoint: POST /v1/compress (lossless structural path). Token counts = proxy's tiktoken.

| Payload (synthetic, realistic shapes) | tokens_before | tokens_after | reduction | ccr_hashes | transforms |
|---|---|---|---|---|---|
| content_search, 12 items (prose excerpts), tool msg | 1432 | 1232 | 14.0% | 0 | router:mixed:0.67 |
| content_search, 100 items (repetitive, 4 recycled bodies) | 7415 | 3840 | 48.2% | 0 | router:mixed:0.40 |
| github issues, 40 (structured + body prose) | 4597 | 3893 | 15.3% | 0 | router:mixed:0.56 |

CCR store after all probes: entry_count=0, backend=memory, total_retrievals=0.
CCRConfig.enabled=True by default; CCR stores originals only when SmartCrusher crushes a
tool output. Our prose-bearing JSON routed to `router:mixed` (general path), NOT SmartCrusher,
so no CCR hash, no reversible handle. SmartCrusher.min_tokens_to_crush=200.

## Reading
- Lossless savings on realistic content_mcp/executor payloads: ~14–48%, below NFR-002's 50% bar.
- Best case (artificially repetitive 100-item dump) = 48.2%, still under 50%.
- Reversible CCR path does not engage on prose-bearing content (the spec's content_mcp priority).
- Headline 60–95% (Headroom README) are CCR drop-and-retrieve on low-entropy repetitive tool
  outputs (code search, logs) and/or lossy ML text compression (spec-disabled by default).
- Tenant isolation: global hash store, no namespacing -> unsupported (routes to Postgres per R2).

Trajectory: no_go for the spec's posture (>=50% lossless on content_mcp at zero degradation).

---
## Decisive follow-up (CCR triggered / proven un-triggerable, per reviewer)

SmartCrusher DOES engage on low-entropy, NON-prose, repetitive data:
| Payload | before | after | reduction | transform | ccr_hashes |
|---|---|---|---|---|---|
| 200 code-search records (no prose) | 10435 | 5650 | 45.9% | smart_crusher:0.29 | [] |
| 500 repetitive log lines | 18528 | 565 | 97.0% | smart_crusher:0.03 | [] |

**The 97% is LOSSY row-drop, NOT reversible.** Inspected the compressed output: it keeps
log lines req-00000..00003 then jumps to 00049, 00098, 00147, 00196... — every ~49th line,
the rest silently DROPPED. No `<<ccr:HASH>>` marker. CCR store entry_count stayed 0.
Dropped lines are unrecoverable -> fails NFR-004 (reversibility) AND NFR-001 (zero degradation).

**Why CCR never fired:** `headroom._rust` is NOT installed in standard `pip install
headroom-ai[proxy]` (ModuleNotFoundError). Per smart_crusher.py #389 comment, the Rust
crusher backs the CCR row-drop markers + store; without it the bridge no-ops and the
row-drop path is lossy with no retrievable original. => the spec's R4 reversible-CCR default
is NOT available in the standard Node/proxy install; it needs a native build (C-002 risk).

**Isolation tempered:** CCR store supports `HEADROOM_CCR_TENANT_PREFIX` + pluggable
per-tenant backends (compression_store.py). So tenant isolation is plausibly SUPPORTABLE
with per-tenant prefix/backend — NOT the blocker. (Earlier "global hash, unsupported" was
the default-config read; correct it.)

**Egress:** /v1/compress made no outbound POST during probes (only periodic GET heartbeats
to api.openai.com). compress path is local -> C-006 holds for compress.

## Bottom line (robust, multi-signal)
- content_mcp (prose-bearing, the spec's PRIORITY): ~14-48% LOSSLESS -> fails NFR-002 (>=50%).
- >=50% is reachable ONLY on low-entropy repetitive NON-content_mcp data AND only via LOSSY
  row-drop that fails reversibility + zero-degradation.
- Reversible CCR (R4) not available in standard install (no Rust ext).
=> Trajectory: NO_GO for content_mcp under the spec's lossless/zero-degradation posture.
  The accuracy A/B (LLM spend) is moot: the savings>=50% path drops unrecoverable data, so it
  would fail NFR-001 by construction; the lossless path preserves accuracy but fails NFR-002.

---
## CORRECTION (I was wrong about no_go) — CCR reversibility VERIFIED

Earlier I concluded the high-savings path was lossy/un-reversible. That was WRONG for PROSE.
Two distinct transforms; I conflated them:
- ARRAY row-drop (huge repetitive arrays/logs): lossy, no CCR marker, unrecoverable in this
  rust-less build. (Real, but not the content path.)
- LARGE STRING FIELD (>=~400 chars: article bodies, RAG text): CCR replaces with
  `<<ccr:HASH,string,NKB>>` marker AND stores byte-identical original. VERIFIED:
  GET /v1/retrieve/927bdcb2d58e -> HTTP 200, original_content byte-identical=True. store entry_count=2.

### Corrected lossless/reversible savings envelope (Joyus-shaped payloads)
| Payload family | reduction | reversible? | mechanism |
|---|---|---|---|
| content_get_item body / content_generate / rag_chunk (large prose) | 88-93% | YES byte-identical CCR | CCR string drop+retrieve |
| content_search result list (short excerpts) | ~16% | n/a (inline) | light/mixed |
| metadata arrays (issue/source/sync lists) | 35-49% | inline, no drop | smart_crusher structural (lossless, ids preserved) |
| huge repetitive arrays/logs | up to 97% | NO (lossy drop, rust-less build) | row-drop |

CCR string threshold ~400 chars (200=no, 400=yes).
Isolation: CCR store is CONTENT-ADDRESSED -> identical content under two tenants => SAME hash
(dedup crosses tenants) by default. Requires HEADROOM_CCR_TENANT_PREFIX per tenant or per-tenant
backend to isolate. Configurable -> supportable, but a hard WP03 requirement, not free.

### Corrected verdict
Premise HOLDS for a SPECIFIC sub-target: large-prose content payloads (article bodies,
generated content, RAG chunks) -> 88-93% byte-identical REVERSIBLE savings via CCR.
NOT a no_go. Remaining gate = ACCURACY A/B WITH RETRIEVE TOOL WIRED (does the agent retrieve
the dropped body when it needs it?). That is the LLM/subagent step.
Search result lists (~16%) and metadata arrays (35-49%) do NOT clear 50% reversibly -> de-prioritize.

---
## FINAL: CCR works, but reversibility is EPHEMERAL (decisive durability finding)
- Fresh prose payload -> CCR marker -> GET /v1/retrieve/{hash} = byte-identical original. VERIFIED.
- BUT compression_store default_ttl=300s (5 min), in-memory, LRU evict at 1000 entries.
  After TTL, marker dangles -> /v1/retrieve 404. Re-compressing expired content re-emits the
  same content-addressed marker without re-storing (stale-key) -> 404.
- Implication: FR-006 "retrievable on demand" is NOT durably satisfied by Headroom's default
  store. Durable reversibility => persistent per-tenant backend (our Postgres store, WP03 / R2).

## Accuracy A/B result (16 tasks, Sonnet both arms, exact-match)
content_mcp: accuracyDelta=0.000 (10/10 verbatim agree); rag_chunk: 0.000 (6/6).
savings content_mcp 62.1%±2.9pp (N=5), rag_chunk 60.6%±1.5pp (N=3). reversibility 8/8=1.0.
latency p95 8ms (warm). DECISION = GO (primary content_mcp, mode proxy), conditioned (see FINDINGS.md).

## RE-CORRECTION (advisor caught free-lunch): DECISION = NO_GO
The 62% (compress-only, body dropped) and accuracyDelta=0 (body RETRIEVED) are mutually
exclusive states. Net savings on must-read single-shot = compressed + retrieved body + tool
overhead vs full ≈ -56%/-59% (≤0% structurally; never >=50%). NFR-002 "≥50% AT zero
degradation" NOT demonstrated -> no_go. Real gate = retrieval-rate (unmeasured); CCR viable
only for low-retrieval-rate or read-once-reference-many workloads. See FINDINGS.md.
