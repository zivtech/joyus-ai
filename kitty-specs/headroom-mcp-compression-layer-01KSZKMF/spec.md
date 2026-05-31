# Specification: Headroom MCP Compression Layer

**Mission:** `headroom-mcp-compression-layer-01KSZKMF`
**Mission Type:** `software-dev`
**Date:** 2026-05-31
**Status:** WP01 complete — **NO_GO** (gate not met); conditional re-evaluation defined as WP06
**Planning base branch:** `claude/headroom-compression-spec`
**Merge target branch:** `claude/headroom-compression-spec` (PR to `main`)
**Routing decision:** `planning/headroom-evaluation-routing-2026-05-31.md`

## 0. Evaluation Outcome (WP01, 2026-05-31)

**Decision: NO_GO.** Evidence: `eval/headroom-spike/spike-report.json` (schema-valid) +
`eval/headroom-spike/FINDINGS.md`. WP02–WP05 do **not** proceed (FR-004); they are blocked
pending the WP06 re-evaluation below.

**Why.** NFR-002 requires ≥50% reduction **at** NFR-001's zero-degradation bar — both at once.
Headroom's reversible CCR compresses large prose fields ~62% *compress-only* (body dropped to a
marker) and retrieval restores it **byte-identical** with **zero accuracy loss** — but those two
results occur in **mutually exclusive states**. For must-read tool outputs the agent retrieves the
dropped body, so **net tokens ≈ full payload + marker + retrieve-tool overhead (≤ 0% net savings,
measured ≈ −56%)**. ≥50%-at-zero-degradation was never achieved simultaneously.

**The real gate (now WP06):** `expected_savings ≈ compress_only × (1 − retrieval_rate)`. The
retrieval rate is **unmeasured**; the WP01 suite was 100% must-read single-shot (worst case). CCR
nets positive only for **low-retrieval-rate** payloads (large outputs mostly skimmed) or
**read-once/reference-many** (one retrieval amortized across turns). Measuring that on realistic
multi-turn traces is the precondition for any GO.

**Findings that revise the original assumptions** (detail in FINDINGS.md):
- **No in-process library mode in Node** — npm `headroom-ai` is a thin proxy client; the engine is
  the Python proxy. R1 is forced to **proxy** mode.
- **CCR reversibility is ephemeral** — in-memory store, 5-min TTL, LRU-evicted. FR-006 "retrievable
  on demand" is not durably satisfied by Headroom's store → use our own per-tenant Postgres store
  (R2/WP03) if pursued.
- **Tenant isolation** is content-addressed/cross-tenant by default; needs per-tenant prefix/backend.
- A **97% lossy row-drop path** exists (no CCR backing in the standard install) and must be bypassed.

The original spec below is retained as written; Section 0 governs.

## 1. Overview

### Problem

Tool outputs and retrieved knowledge chunks flow through `joyus-ai-mcp-server`
into the LLM uncompressed. These payloads — connector/sync/search responses,
integration-executor JSON, RAG chunks — are high-volume and low signal-density,
consuming token budget (and therefore cost and latency) that is currently
**unmeasured**. The platform has no layer that reduces what an agent reads before
it reaches the model.

This is a real gap, but it is also **not yet a named roadmap lane**. The platform
has never measured its own token spend, so the size of the prize is unproven. A
spec that assumes savings would be building on an unverified premise. Therefore
this mission is structured as **evaluate-then-integrate**: an evidence gate
decides whether the rest of the work happens at all.

The closest comparable capabilities are deliberately **out of scope** because they
are already owned by in-flight work that is further along (each already has an
evaluation gate):

- Cross-agent / durable **memory** is owned by `joyus-context` (provider adapter
  contract + adoption gate; already rejected Zep/Graphiti).
- **Learning from failed sessions** is owned by `joyus-flywheel` (capture →
  curate → eval → drift → release; managed-vs-controlled bakeoff).

### Solution

Evaluate, then conditionally integrate, **Headroom** (`chopratejas/headroom`,
Apache-2.0, v0.22.4 beta) as a compression layer for `joyus-ai-mcp-server`.

1. **WP01 — Evaluation spike (gates everything after it).** Compress a
   representative sample of real Joyus payloads and measure token savings,
   accuracy delta, reversibility correctness, multi-tenant isolation fit, and
   latency. Produce a **go/no-go recommendation** including which deployment mode
   (in-process library vs. sidecar proxy) to adopt. No further work proceeds
   without a documented "go." This mirrors the platform's Inngest Evaluation Spike
   pattern.
2. **Conditional integration (only on "go").** Introduce compression behind an
   adapter boundary with a pinned dependency version, scoped to the
   highest-value payload type identified by WP01, with per-tenant isolation of any
   stored originals.

### Users

- **Platform operators / FinOps**: want lower token cost and latency without
  accuracy regressions on tenant content.
- **Tenant administrators**: require that no tenant's content (compressed,
  cached, or deduplicated) is ever visible to another tenant.
- **Joyus platform maintainers**: need a reversible, version-pinned, adapter-
  isolated dependency they can remove if the beta upstream misbehaves.
- **Future agents** implementing WP02+ from the WP01 evidence.

### Scope Boundaries

**In scope:**

- A WP01 evaluation spike over real Joyus payloads — sampling **content MCP tool
  outputs (priority), RAG/knowledge chunks, and integration-executor outputs** —
  reporting per-type savings and accuracy.
- A go/no-go gate with an explicit, defensible accuracy threshold.
- A deployment-mode recommendation (library vs. proxy) grounded in measured
  isolation, latency, and savings.
- Conditional compression of MCP tool output + RAG chunks behind an adapter
  boundary with a pinned version.
- Multi-tenant isolation design for any stored originals (per-tenant store via
  Headroom's pluggable backend).
- Reversibility / round-trip retrieval correctness.

**Out of scope:**

- Headroom's memory store as the platform's memory substrate → routes to the
  `joyus-context` adoption gate (Track A1).
- `headroom learn` failed-session mining → routes to the `joyus-flywheel` bakeoff
  (Track A2).
- Any replacement, modification, or coupling to `joyus-ai-state` (canonical /
  divergence / lock / share / store).
- Lossy text compression, unless and until the accuracy gate explicitly permits
  it (default posture is zero measurable degradation).
- Compressing conversation history outside the MCP server boundary.

## 2. User Scenarios & Testing

### Scenario 1: Evaluation gate produces a defensible decision (primary)

A maintainer runs WP01 against the sampled payload corpus. The spike reports
token-savings % and accuracy delta per payload type, round-trip correctness, a
tenant-isolation assessment, and latency overhead. The output is a single
go/no-go recommendation with a named primary payload target and a recommended
deployment mode. **Test:** the spike report exists, contains all five measured
dimensions, and states an unambiguous go/no-go with rationale.

### Scenario 2: Compression preserves answer accuracy (gate condition)

For the sampled corpus, a fixed task/answer suite is run twice — once on
uncompressed payloads, once on compressed — using identical prompts and model.
**Test:** the two runs show **no measurable accuracy difference** on the suite;
any difference is a "no-go" for that payload type.

### Scenario 3: Originals never cross tenant boundaries

Two tenants process payloads that compress to overlapping or identical content.
Tenant B requests retrieval. **Test:** Tenant B can never retrieve, dedupe
against, or observe Tenant A's originals or compressed artifacts; isolation holds
even when content is byte-identical across tenants.

### Scenario 4: Reversible retrieval returns the exact original

A compressed payload's original is requested on demand. **Test:** the retrieved
content is byte-identical to the pre-compression input (lossless round-trip),
within the same tenant scope.

### Scenario 5: The dependency can be removed cleanly

An operator disables the compression layer (kill switch / config flag). **Test:**
the MCP server returns to passing uncompressed payloads with no errors and no
orphaned state; the beta dependency is reachable only through the adapter
boundary (no direct call sites elsewhere).

### Edge Cases

- Payload already small / incompressible → layer must not increase token count
  (no negative savings) and must not error.
- Compression backend unavailable → MCP server degrades to uncompressed
  pass-through, not failure.
- Non-text / binary payloads → bypassed, never corrupted.
- Tenant with zero stored originals requesting retrieval → clean empty result,
  not another tenant's data.
- Upstream beta version yanked / breaking change → pinned version protects
  running deployments; adapter localizes the blast radius.

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| FR-001 | WP01 must compress a representative sample of real Joyus payloads across all three types (content MCP tool outputs [priority], RAG/knowledge chunks, integration-executor outputs) and report per-type token savings. | Proposed |
| FR-002 | WP01 must run a fixed task/answer suite on uncompressed vs. compressed payloads and report the accuracy delta per payload type. | Proposed |
| FR-003 | WP01 must produce a single documented go/no-go recommendation naming the primary payload target and a recommended deployment mode (library or proxy), justified by measured isolation, latency, and savings. | Proposed |
| FR-004 | No work package after WP01 may begin unless WP01 records a "go." (Gate dependency.) | Proposed |
| FR-005 | On "go," compression must be applied to the selected payload type(s) within `joyus-ai-mcp-server` behind a single adapter boundary; no Headroom API may be called outside that adapter. | Proposed |
| FR-006 | Compressed payloads must be reversible: the exact pre-compression original is retrievable on demand within the same tenant scope (lossless round-trip). | Proposed |
| FR-007 | Stored originals and any deduplication index must be partitioned per tenant; cross-tenant retrieval, dedup, or observation must be impossible even for byte-identical content. | Proposed |
| FR-008 | The compression layer must be disableable via configuration (kill switch); when disabled, the server passes uncompressed payloads with no errors or orphaned state. | Proposed |
| FR-009 | Incompressible or already-small payloads must pass through without increasing token count and without error. | Proposed |
| FR-010 | When the compression backend is unavailable, the server must degrade to uncompressed pass-through rather than fail the request. | Proposed |

### 3.2 Non-Functional Requirements

| ID | Requirement | Measurable Threshold | Status |
|----|-------------|----------------------|--------|
| NFR-001 | Accuracy preservation (the gate). | Zero measurable accuracy degradation on the WP01 task suite (compressed vs. uncompressed); any measurable degradation is a no-go for that payload type. | Proposed |
| NFR-002 | Token savings worth integrating. | Primary payload type achieves ≥ 50% mean token reduction on the sampled corpus at NFR-001's zero-degradation bar; below this, WP01 should recommend no-go. | Proposed |
| NFR-003 | Latency overhead budget. | Added p95 latency from compression ≤ 150 ms per payload; reported in the spike. | Proposed |
| NFR-004 | Reversibility correctness rate. | 100% byte-identical round-trip on the reversibility test set (zero tolerance). | Proposed |
| NFR-005 | Tenant isolation verification. | 0 cross-tenant retrievals across the isolation test set, including byte-identical-content cases. | Proposed |
| NFR-006 | Dependency containment. | Headroom invoked from exactly 1 adapter module; 0 direct import/call sites elsewhere (verifiable by search). | Proposed |
| NFR-007 | Savings measurement honesty. | Reported savings use real sampled payloads, report mean and standard deviation, and disclose sample size and corpus composition. | Proposed |

### 3.3 Constraints

| ID | Constraint | Status |
|----|-----------|--------|
| C-001 | Dependency is licensed Apache-2.0 and pinned to an exact version; upgrades are deliberate, not floating. | Active |
| C-002 | Upstream is beta (v0.22.4); the integration must assume instability and be removable via the adapter + kill switch. | Active |
| C-003 | Memory substrate, learning, and `joyus-ai-state` are out of scope and must not be coupled to this layer. | Active |
| C-004 | Multi-tenant isolation (Spec-008) is a hard constraint designed in from the start, not retrofitted. | Active |
| C-005 | Planning lives in `joyus-ai-internal`; the implementation target is `joyus-ai` (`joyus-ai-mcp-server`), promoted per the governance-hub workflow. | Active |
| C-006 | No real client-private content, secrets, or credentials may be used in the WP01 corpus without explicit policy approval; synthetic or sanitized payloads otherwise. | Active |

## 4. Success Criteria

- **SC-001:** A maintainer can read one WP01 report and know whether to integrate,
  for which payload type, in which deployment mode — without rerunning anything.
- **SC-002:** The go/no-go decision is backed by measured savings and accuracy on
  real sampled payloads, with sample size and variance disclosed.
- **SC-003:** Where compression ships, users see no change in answer quality
  attributable to compression (zero measurable degradation).
- **SC-004:** Every stored original is retrievable, exactly, only by its owning
  tenant; no tenant can reach another's content.
- **SC-005:** An operator can turn the compression layer off and the server keeps
  working unchanged.
- **SC-006:** The compression dependency can be removed by deleting one adapter
  module and its configuration — nothing else references it.

## 5. Key Entities

- **Payload**: a unit of content flowing through the MCP server toward the LLM
  (tool output, RAG chunk, or executor response), owned by exactly one tenant.
- **Compression result**: the compressed form plus a reference to its retrievable
  original; carries tenant scope.
- **Originals store**: per-tenant storage of pre-compression originals enabling
  reversible retrieval; never shared across tenants.
- **Adapter boundary**: the single module through which the platform talks to the
  compression dependency; the only place the beta upstream is referenced.
- **Spike report (WP01)**: the evidence artifact carrying per-type savings,
  accuracy delta, reversibility, isolation, latency, and the go/no-go decision.

## 6. Assumptions

- Real or realistically synthetic Joyus payloads are available for WP01 without
  exposing client-private data (C-006).
- A fixed, agreed task/answer suite can be defined to measure "accuracy delta"
  per payload type (its definition is a WP01 deliverable).
- Headroom's pluggable backend can be configured for per-tenant partitioning;
  if it cannot, that is itself a no-go finding for the stored-originals path.
- Token cost is currently unmeasured; WP01 establishes the baseline, so the prize
  size is an output of the spike, not an input assumption.

## 7. Dependencies

- **Headroom** (`chopratejas/headroom`, Apache-2.0, pinned version) — the
  compression dependency under evaluation.
- **`joyus-ai-mcp-server`** (in `joyus-ai`) — the integration target.
- **Spec-008 (Profile Isolation and Scale)** — the multi-tenant isolation model
  this layer must conform to.
- **Routing brief** `planning/headroom-evaluation-routing-2026-05-31.md` — defines
  the out-of-scope boundaries (Tracks A1/A2) this spec depends on holding.
