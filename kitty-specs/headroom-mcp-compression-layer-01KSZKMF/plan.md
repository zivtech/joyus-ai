# Implementation Plan: Headroom MCP Compression Layer

**Branch**: `claude/headroom-compression-spec` | **Date**: 2026-05-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `kitty-specs/headroom-mcp-compression-layer-01KSZKMF/spec.md`
**Mission**: `headroom-mcp-compression-layer-01KSZKMF`

## Summary

Evaluate-then-integrate Headroom (Apache-2.0, beta) as a token-cost compression
layer for `joyus-ai-mcp-server`. The plan is **gate-first**: WP01 is an evaluation
spike that must prove ≥50% token savings at **zero measurable accuracy
degradation** on real Joyus payloads before any integration begins. On "go,"
later work packages introduce compression behind a single adapter boundary
(pinned version, kill switch) with per-tenant isolation of stored originals
(Spec-008). Memory substrate, `headroom learn`, and any `joyus-ai-state` change
are out of scope and routed elsewhere (see `planning/headroom-evaluation-routing-2026-05-31.md`).

## Technical Context

**Language/Version**: TypeScript / Node (the `joyus-ai-mcp-server` runtime; Express-based).
**Primary Dependencies**: Headroom — `headroom-ai` npm package (library mode) **or**
`headroom proxy` sidecar (proxy mode). Decision deferred to WP01 evidence. Existing
server stack: Drizzle ORM + PostgreSQL, Inngest.
**Storage**: per-tenant originals store. Candidate backends: existing PostgreSQL
(Drizzle) or Headroom's pluggable Qdrant/Neo4j. Partitioning model chosen in WP02.
**Testing**: accuracy A/B harness (uncompressed vs compressed on a fixed task suite);
reversibility round-trip tests; tenant-isolation tests including byte-identical content.
**Target Platform**: Linux server (multi-tenant cloud), per joyus-ai-ops deploy.
**Project Type**: web/service (MCP server backend).
**Performance Goals**: primary payload type ≥50% mean token reduction (NFR-002);
added p95 compression latency ≤150 ms (NFR-003).
**Constraints**: zero measurable accuracy degradation (NFR-001); 100% reversible
round-trip (NFR-004); 0 cross-tenant leakage (NFR-005); Headroom reachable from
exactly 1 adapter module (NFR-006); pinned beta version + kill switch (C-001/C-002).
**Scale/Scope**: all payloads flowing through the MCP server toward the LLM, scoped
post-WP01 to the highest-value payload type first.

## Charter Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: SKIPPED — no `.kittify/charter/charter.md` at project root** (charter context
returned compact mode with `Project root: None`). Governance in effect: template set
`software-dev-default`, directive `DIR-001`. No charter gates to evaluate. Repo-level
governance from `CLAUDE.md` (never plan on `main`, cross-repo safety, multi-tenant
isolation) is honored by this plan: planning on a feature branch, implementation target
is `joyus-ai` (promoted per governance-hub workflow), isolation designed in from WP02.

## Project Structure

### Documentation (this feature)

```
kitty-specs/headroom-mcp-compression-layer-01KSZKMF/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (adapter interface + spike-report schema)
└── tasks.md             # Phase 2 output (/spec-kitty.tasks — NOT created here)
```

### Source Code (implementation target: `joyus-ai/joyus-ai-mcp-server`)

The WP01 spike is **throwaway evaluation code** (a harness + corpus + report), not
production integration. Production integration (WP02+) lands only on "go":

```
joyus-ai-mcp-server/
├── src/
│   ├── compression/                 # NEW — the single adapter boundary (WP02)
│   │   ├── compression-adapter.ts   # the ONLY Headroom call site (NFR-006)
│   │   ├── originals-store.ts       # per-tenant reversible store (FR-006/FR-007)
│   │   └── config.ts                # kill switch + pinned version (FR-008/C-001)
│   └── mcp/                          # existing tool/RAG dispatch — hooks the adapter
└── tests/
    ├── accuracy/                     # A/B task suite (NFR-001)
    ├── reversibility/                # round-trip (NFR-004)
    └── isolation/                    # cross-tenant (NFR-005)

eval/headroom-spike/                  # WP01 — throwaway harness + corpus + report
├── corpus/                           # sampled payloads (sanitized/synthetic, C-006)
├── run-spike.ts                      # compress + measure
└── spike-report.md                   # the go/no-go evidence artifact
```

**Structure Decision**: single-service backend. The compression layer is a new
`src/compression/` module in `joyus-ai-mcp-server` acting as the sole adapter
boundary; the WP01 spike lives in a disposable `eval/` tree and produces only a
report, never shipped code.

## Phased Work-Package Outline (gate-first)

> Detailed WP files come from `/spec-kitty.tasks`. This is the dependency skeleton.

- **WP01 — Evaluation spike (GATE).** Build the throwaway harness; assemble the
  sampled corpus (content MCP outputs [priority], RAG chunks, executor outputs);
  measure per-type savings, accuracy delta, reversibility, tenant-isolation fit,
  latency; recommend deployment mode. **Output: go/no-go decision.** All later WPs
  depend on WP01 = "go". *(FR-001, FR-002, FR-003, FR-004; NFR-001, NFR-002, NFR-007)*
- **WP02 — Adapter boundary + config (depends: WP01=go).** Single
  `compression-adapter.ts`, pinned version, kill switch, pass-through fallback.
  *(FR-005, FR-008, FR-009, FR-010; NFR-006; C-001, C-002)*
- **WP03 — Per-tenant originals store + reversibility (depends: WP02).** Tenant-
  partitioned store; lossless round-trip retrieval. *(FR-006, FR-007; NFR-004,
  NFR-005; C-004)*
- **WP04 — Wire compression into the selected payload path (depends: WP02, WP03).**
  Apply to the WP01-chosen primary payload type; enforce no-negative-savings.
  *(FR-005, FR-009)*
- **WP05 — Acceptance harness + rollout safety (depends: WP03, WP04).** Accuracy
  A/B, reversibility, isolation test suites as CI gates; kill-switch runbook.
  *(NFR-001, NFR-004, NFR-005; SC-003..SC-006)*

**Branch contract (restated):** planning commits on `claude/headroom-compression-spec`;
implementation WPs land there via worktrees and the mission merges to that branch,
then PRs to `main`. Implementation itself happens in `joyus-ai` once the spec is
promoted per the governance-hub workflow.

## Complexity Tracking

No Charter Check violations (charter absent). The one deliberate complexity is the
**evaluation gate** (WP01 before any integration); justified because token cost is
currently unmeasured, so committing to integration without evidence would be
building on an unproven premise.
