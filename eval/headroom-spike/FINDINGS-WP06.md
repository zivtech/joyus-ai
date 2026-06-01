# WP06 — Headroom Compression: Retrieval-Rate Re-Gate Findings

**Mission:** `headroom-mcp-compression-layer-01KSZKMF` · **WP06 (re-gate after WP01 NO_GO)**
**Decision: NO_GO** — sharper and more fundamental than WP01.
Machine artifact: `wp06-spike-report.json` (schema-valid against `contracts/spike-report.schema.json`).
Raw measurements: `wp06-measurements.json`. Harness: `run-wp06.py`.

Subject: **Headroom** proxy engine `headroom-ai` **0.22.3** (Python, with the Rust `_core`
extension present), npm client `headroom-ai` **0.1.0**. All numbers measured **live on the real
proxying path** — `POST /v1/messages` with Claude Sonnet 4.5 in the loop through `headroom proxy`
— on synthetic, realistically-shaped Joyus payloads (C-006). This is the gap WP01 left open: WP01
measured the `/v1/compress` endpoint plus a hand-built curl retrieve loop; WP06 measures what the
model-facing proxy actually does.

---

## Why NO_GO — the structure

WP01 said: reversible CCR compresses ~62% *compress-only*, but on must-read tool outputs the agent
retrieves the dropped body back, so **net ≤ 0**. The decisive unknown was the *retrieval rate* on
real multi-turn traces. WP06 went to measure it and found something more basic: **the reversible
compress→retrieve loop the spec, WP01, and T102 all assume does not engage in the model-facing
`/v1/messages` path for the priority prose families** — and the path that *does* engage leaves the
agent unable to answer without re-fetching, which loops.

### 1. The CCR retrieve loop is not delivered on the proxying path (T102 premise is false)

T102 asserts *"the proxy injects `headroom_retrieve` and CCR fires end-to-end."* Verified false in
this install:

- `<<ccr:HASH,string,SIZE>>` reversible markers reliably appear **only via the dedicated
  `/v1/compress` endpoint** (WP01's path). Driving the same prose through `/v1/messages` applies
  `router:tool_result:text`/`:mixed`/`:smart_crusher` compression and surfaces **no resolvable
  marker** to the model.
- The proxy does **not** auto-inject the `headroom_retrieve` tool for a bare client. The
  `/v1/retrieve/tool_call` handler is, per its own docstring (`proxy/server.py:2805`), *"for agent
  frameworks to call"* — the client must wire it. So any faithful measurement requires a client
  retrieve-shim, which `joyus-ai-mcp-server` would have to build.
- **The documented retrieve endpoint is broken out of the box.** `parse_tool_call`
  (`ccr/tool_injection.py:500-503`) rejects any hash that is not **exactly 24 hex chars**
  ("prevents hash spoofing"), but the markers Headroom emits carry **12-hex** hashes
  (`d4a0c616a106`, `87c39b0e6114`). An agent that calls `headroom_retrieve` with the hash it was
  shown gets `"Invalid tool call"`. Only the undocumented `GET /v1/retrieve/{hash}` resolves the
  12-hex form (and does so byte-identically).

### 2. On the priority prose families, the agent cannot answer from the compressed output (16/16)

Driving the realistic content-MCP + RAG-chunk corpus through `/v1/messages` (control = same payload
uncompressed, direct to Anthropic; both temp=0):

| family | n | realized net savings (request-level) | compressed-condition answer rate |
|---|---|---|---|
| content_mcp | 10 | **12.2%** (sd 1.2pp) | **0 / 10** answered from compressed output |
| rag_chunk | 6 | **11.2%** (sd 0.7pp) | **0 / 6** answered from compressed output |

In all 16 cases the agent **declined to answer the compressed payload and attempted to re-fetch the
original** (it re-issued the `content_get_item` tool call). The proxy compresses the tool result
~55–61%, but at request level that nets only ~11–12% (diluted by fixed system+tools+question
overhead) — and the savings are illusory because the re-fetch resends the full payload.

> **Honesty note on accuracy.** `wp06-spike-report.json` records `accuracyDelta` −0.90 / −0.667.
> That figure **conflates fact-stripping with answer-refusal** and must not be read as a calibrated
> lossy-degradation measure: the compressed-condition answer rate is a clean 0/16, but the cause
> (did compression strip the fact, or did the agent distrust the compressed form and re-fetch?) is
> not separable from this data, and the control itself carries exact-match scorer noise (`seven`
> vs `7`, `four` vs `4`). **The decision does not rest on this number** — it rests on NFR-002 (net
> savings ≈ 11–12% « 50%) and the broken/ephemeral retrieve path.

### 3. Servicing the re-fetch loops indefinitely (operability hazard)

When the agent's re-fetch is serviced — return the same content, let the proxy re-compress —
**3/3 tested payloads looped all 5 hops and never answered.** The compressed tool output is
uninformative enough that the agent keeps re-fetching, and compression re-strips it identically.
The production path can drive an **unbounded re-fetch loop**, burning tokens and latency without
ever producing an answer. This is the operative latency/cost finding — not the ~3 ms per-call
compression latency.

### 4. Realistic arrays barely compress; big array savings are the lossy path to avoid

| array scenario | net savings (request-level) | retrieval |
|---|---|---|
| low_need (answer in 1 of 40 rows) | **+5.2%** | none |
| must_read (count across 40 rows) | **−20.8%** | none |

`must_read` goes **negative** — the fixed retrieve-tool/overhead exceeds the tiny compression
(FR-009 risk). The 76–97% array reductions only appear on **pathologically redundant** content via
the lossy SmartCrusher row-drop path, which carries no CCR backing in this config and which the
spec explicitly says to bypass. Partial/query retrieve (`?query=`) returned **0 items** on every
probe — there is no working "read 3 of 100 results" low-retrieval-fraction regime.

### 5. Reference-many amortization is defeated by Headroom's own design

`PrefixFreezeConfig` (`config.py`, `force_compress_threshold=0.5`) freezes provider-cached prefixes
so Headroom won't recompress them unless compression saves >50% — explicitly to protect Anthropic's
90% prefix-cache read discount. The "one retrieval amortized across many turns" regime WP01 named is
closed by the tool itself. (Live single-shot calls showed `cache_read=0`; the freeze wasn't even
engaged, so any amortization claim would be measured against an uncached strawman.)

### 6. Reversibility (where it exists) is ephemeral and cross-tenant

Where a CCR marker does exist, `GET /v1/retrieve/{hash}` round-trips **byte-identical** (NFR-004
holds, narrowly). But the default store is **in-memory, content-addressed (cross-tenant dedup),
5-min TTL** → **FR-006 durability and FR-007 isolation fail** without our own per-tenant Postgres
store. `tenantIsolationFit = unsupported` (reconfirmed via the cross-tenant identical-content probe).

---

## The conditional-GO threshold (algebra, not a live result)

For the CCR-retrieve regime, `net ≈ compress_only × (1 − f)` for large payloads, so net ≥ 50%
requires a retrieval fraction:

- content_mcp (compress_only 0.621): **f ≤ 0.195**
- rag_chunk (compress_only 0.606): **f ≤ 0.175**

i.e. the agent would have to leave ~80% of dropped content un-retrieved **and** answer correctly
without it. WP06 found this regime is not reachable on the proxying path: prose partial-retrieve
doesn't work (all-or-nothing per marker), the retrieve loop isn't delivered, and the documented
endpoint is broken. A real GO would require, at minimum: (a) a working partial/query retrieve, (b)
the retrieve loop wired and resolving in the proxying path, (c) durable per-tenant reversibility
(our own store), and (d) a payload family that genuinely measures f ≤ ~0.18 at zero degradation —
ideally validated on **real** Joyus traffic, not synthetic traces.

## What stays from WP01 (unchanged)

- Compression + GET round-trip reversibility work where a marker exists (byte-identical).
- No in-process library mode in Node (npm client is a proxy client) → `recommendedMode = proxy`.
- The 97% lossy row-drop path exists and must be bypassed.

## Negative space — what this does NOT claim

- Not that Headroom's compression is *useless* in general — only that, **as installed and on the
  model-facing `/v1/messages` path, for Joyus's priority content/RAG prose families**, it does not
  clear NFR-002 net savings at NFR-001's zero-degradation bar.
- Not a calibrated lossy-accuracy number (see Honesty note in §2).
- Not a claim of nondeterministic "drift": the 57% (tool-result-level) vs 12% (request-level)
  figures are two denominators, not instability; a cold first-call reproduced ~61% tool-result
  savings, consistent.
- Not a verdict on a Headroom build with the retrieve loop correctly wired and the 12/24-hex bug
  fixed — that is a different artifact; this evaluates the pinned beta as shipped (C-002).

## Reproduce

```bash
cd eval/headroom-spike
. .venv/bin/activate   # headroom-ai[proxy]==0.22.3 (rust _core present)
pkill -f 'headroom proxy'; headroom proxy --port 8787 &   # FRESH in-memory store
export ANTHROPIC_API_KEY=...                              # control leg hits api.anthropic.com
python3 run-wp06.py                                       # -> wp06-measurements.json
node ... ajv 2020 validate wp06-spike-report.json against contracts/spike-report.schema.json
```
