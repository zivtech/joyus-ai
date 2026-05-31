# Phase 0 Research: Headroom MCP Compression Layer

> **WP01 empirical corrections (2026-05-31, see `eval/headroom-spike/FINDINGS.md`):**
> **R1** — in Node there is no in-process library mode (npm `headroom-ai` is a proxy client);
> recommended mode is forced to **proxy**. **R4** — CCR reversibility is real and byte-identical
> but **ephemeral** (in-memory, 5-min TTL); durable retrieval needs our own persistent per-tenant
> store, reinforcing **R2**'s Postgres fallback. Headline savings are **compress-only**; net
> savings after the retrieval that accuracy requires are ≤ 0% on must-read outputs — the true
> gate is retrieval rate (WP01b).

Resolves **planning** unknowns (approach, integration surface, methodology).
**Empirical** unknowns (actual savings %, actual accuracy delta) are deliberately
NOT resolved here — proving them is the job of WP01. This document fixes *how* we
will decide, not *what* the answer is.

---

## R1: Integration surface in a TypeScript/Node MCP server

**Decision**: Treat library mode (`headroom-ai` npm, in-process) and proxy mode
(`headroom proxy` sidecar) as competing candidates; WP01 prototypes both at small
scale and recommends one. Default lean: **library**, because the MCP server already
holds tenant context in-process, making per-tenant isolation (NFR-005) tractable
without re-deriving tenant identity at a network boundary.

**Rationale**: Headroom ships a TS/Node package and a language-agnostic proxy. In a
multi-tenant server, the proxy's "zero code change" benefit is offset by having to
enforce tenant isolation *at the proxy*, where tenant identity is not naturally in
scope. Library mode keeps the beta dependency containable behind one adapter module
(NFR-006) and keeps isolation where the tenant context already lives.

**Alternatives considered**: proxy-only (rejected as default for the isolation reason
above, but kept as a WP01 candidate because it isolates the beta dependency
out-of-process and is killable); MCP-server mode (`headroom_compress`/`_retrieve`
tools — rejected: adds a second MCP hop and doesn't fit compressing *our own* server's
egress).

## R2: Per-tenant isolation of stored originals

**Decision**: Originals store is partitioned by tenant key at the storage layer;
WP02 chooses between (a) existing PostgreSQL via Drizzle with a tenant column +
row-level scoping, and (b) Headroom's pluggable Qdrant/Neo4j backend with per-tenant
namespaces/collections. WP01 records whether Headroom's backend supports hard
per-tenant partitioning; **if it cannot, that is a no-go for using Headroom's own
store**, and we fall back to our own Postgres-backed reversible store.

**Rationale**: Spec-008 demands strict tenant isolation including byte-identical
content (NFR-005). Dedup across tenants is a *feature* of Headroom's memory store and
a *hazard* here — identical content from two tenants must never share a stored
original or a dedup key. Partitioning before dedup is the only safe design.

**Alternatives considered**: shared store with logical filtering (rejected —
byte-identical dedup would cross tenants); no originals store / lossy-only (separate
option tracked under R4).

## R3: Accuracy-measurement methodology (defining "zero measurable degradation")

**Decision**: WP01 defines a **fixed task/answer suite** per payload type: a set of
representative agent tasks whose correct answers are known, run twice with identical
prompt+model — once on uncompressed payloads, once on compressed. "Zero measurable
degradation" (NFR-001) = no change in task-level correctness across the suite, with
sample size and any variance disclosed (NFR-007). Ties broken conservatively toward
no-go.

**Rationale**: Headroom's published benchmarks (GSM8K/TruthfulQA/SQuAD) prove *generic*
accuracy retention, not retention on *our* payloads and *our* tasks. The gate must be
measured on Joyus content or it proves nothing relevant. A task-correctness metric is
more defensible to a client than embedding similarity.

**Alternatives considered**: embedding-similarity threshold (rejected as primary —
proxy for accuracy, not accuracy); human eval only (rejected — not repeatable in CI);
trusting vendor benchmarks (rejected — wrong corpus).

## R4: Reversibility mechanism

**Decision**: Use Headroom's reversible compression (CCR — originals retrievable on
demand) as the integration default, with the originals store partitioned per R2.
Round-trip must be byte-identical (NFR-004). Lossy text compression stays disabled
unless WP01 demonstrates zero degradation for a payload type *and* the user later
ratifies accepting it.

**Rationale**: The accuracy bar is the strictest option (zero degradation), which
aligns with reversible-by-construction. Reversibility also satisfies the "retrieve the
exact original" scenarios and the kill-switch/clean-removal requirement.

**Alternatives considered**: lossy-first for max savings (rejected — violates the
ratified zero-degradation posture); no retrieval (rejected — FR-006 requires it).

## R5: Beta-dependency containment

**Decision**: Pin `headroom-ai` to an exact version (C-001); reach it only through
`compression-adapter.ts` (NFR-006); ship a kill switch that reverts to uncompressed
pass-through (FR-008); fail open to pass-through when the backend is unavailable
(FR-010).

**Rationale**: v0.22.4 is beta with frequent releases. Containment + reversibility +
kill switch make the dependency removable by deleting one module and its config
(SC-006), bounding the blast radius of upstream churn.

**Alternatives considered**: vendoring/forking (rejected as premature — revisit only
if upstream proves unstable in practice); floating version (rejected — C-001).

---

## Open items explicitly deferred to WP01 (empirical, not plannable)

- Actual per-type token savings vs the ≥50% bar (NFR-002).
- Actual accuracy delta vs the zero-degradation bar (NFR-001).
- Whether Headroom's pluggable backend supports hard per-tenant partitioning (R2).
- Measured latency overhead vs the ≤150 ms p95 bar (NFR-003).
- Final library-vs-proxy recommendation (R1).
