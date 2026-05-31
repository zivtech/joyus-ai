# Tasks: Headroom MCP Compression Layer

**Mission:** `headroom-mcp-compression-layer-01KSZKMF`
**Planning base branch:** `claude/headroom-compression-spec`
**Merge target branch:** `claude/headroom-compression-spec`
**Spec:** [spec.md](spec.md) · **Plan:** [plan.md](plan.md)

> **Gate-first.** WP01 is a go/no-go evaluation spike. **WP02–WP05 do not start
> unless WP01 records `decision = go`** (FR-004). If WP01 returns `no_go`, the
> mission ends here — by design. The implementation target is
> `joyus-ai/joyus-ai-mcp-server`; these packages are the blueprint promoted there.
>
> **WP01 outcome (2026-05-31): NO_GO.** Net savings on must-read tool outputs are ≤ 0%
> (the agent retrieves the dropped body → it re-enters context); ≥50%-at-zero-degradation
> was not demonstrated. See `spec.md` §0 and `eval/headroom-spike/FINDINGS.md`. **WP02–WP05
> are BLOCKED.** A re-gate, **WP01b — Retrieval-Rate Spike**, defines the one measurement
> (retrieval rate on realistic multi-turn traces) that could flip the decision.

## Subtask Index

| ID | Description | WP | Parallel |
|----|-------------|----|----------|
| T001 | Assemble sanitized/synthetic payload corpus (3 kinds, content_mcp priority) | WP01 | |
| T002 | Define fixed task/answer suite per payload kind | WP01 | [P] |
| T003 | Compress+measure harness, both modes (library + proxy): savings + p95 latency | WP01 | |
| T004 | Reversibility check: byte-identical round-trip; compute reversibilityRate | WP01 | [P] |
| T005 | Tenant-isolation probe: byte-identical content, two tenants, no cross-tenant access | WP01 | [P] |
| T006 | Accuracy A/B: uncompressed vs compressed; accuracyDelta per kind | WP01 | |
| T007 | Emit spike-report.md + SpikeReport JSON; go/no-go + primaryTarget + recommendedMode | WP01 | |
| T008 | Define CompressionAdapter interface per contract | WP02 | |
| T009 | Implement adapter wrapping pinned headroom-ai (single call site) | WP02 | |
| T010 | Config module: kill switch + pinned version constant | WP02 | [P] |
| T011 | Pass-through fallback (FR-010) + no-negative-savings bypass (FR-009) | WP02 | |
| T012 | Static check: Headroom imported only in the adapter (NFR-006) | WP02 | [P] |
| T013 | Per-tenant partitioned originals store (tenantId partition key) | WP03 | |
| T014 | Per-tenant dedup keys (never global); identical content → separate entries | WP03 | |
| T015 | Reversible retrieve by tenant-scoped originalRef (byte-identical) | WP03 | |
| T016 | Tenant deletion purges partition wholly | WP03 | [P] |
| T017 | Reversibility test suite (NFR-004, 100%) | WP03 | [P] |
| T018 | Isolation test suite incl. byte-identical case (NFR-005, 0 leak) | WP03 | [P] |
| T019 | Hook adapter into the WP01-selected payload egress | WP04 | |
| T020 | Enforce no-negative-savings + bypass binary/incompressible at the hook | WP04 | |
| T021 | Kill switch end-to-end: disabled → pre-integration behavior | WP04 | [P] |
| T022 | Propagate originalRef so downstream retrieval works | WP04 | |
| T023 | Accuracy A/B CI gate (NFR-001 zero degradation) | WP05 | |
| T024 | Wire reversibility + isolation suites as CI gates | WP05 | [P] |
| T025 | Kill-switch runbook + clean-removal verification (SC-006) | WP05 | [P] |
| T026 | Savings/latency reporting (NFR-002/003/007) | WP05 | [P] |

---

## WP01 — Evaluation Spike (GATE) · `tasks/WP01-evaluation-spike.md`

**Goal:** Prove or disprove the premise. Measure per-type token savings, accuracy
delta, reversibility, tenant-isolation fit, and latency on real Joyus payloads, and
emit a single go/no-go decision with a primary target and recommended deployment mode.
**Priority:** P0 (gates everything). **Dependencies:** none.
**Independent test:** `spike-report.md` + a schema-valid `SpikeReport` JSON exist and
state an unambiguous `go`/`no_go` with disclosed sample size and variance.
**Estimated prompt size:** ~420 lines.

- [ ] T001 Assemble sanitized/synthetic payload corpus (3 kinds, content_mcp priority) (WP01)
- [ ] T002 Define fixed task/answer suite per payload kind (WP01)
- [ ] T003 Compress+measure harness, both modes: savings + p95 latency (WP01)
- [ ] T004 Reversibility check: byte-identical round-trip (WP01)
- [ ] T005 Tenant-isolation probe: byte-identical content, two tenants (WP01)
- [ ] T006 Accuracy A/B: uncompressed vs compressed; accuracyDelta per kind (WP01)
- [ ] T007 Emit spike-report.md + SpikeReport JSON; go/no-go decision (WP01)

## WP01b — Retrieval-Rate Spike (RE-GATE) · `tasks/WP01b-retrieval-rate-spike.md`

**Goal:** Measure the variable WP01 left open — retrieval rate / fraction-of-content-read on
realistic multi-turn agent traces — and compute **realized net** savings (not compress-only).
**Priority:** P0 (re-gates everything). **Dependencies:** WP01.
**Independent test:** a SpikeReport reporting net (post-retrieval) savings per family with the
retrieval-rate distribution disclosed, and an unambiguous go/no_go on net ≥ 50% at accuracyDelta = 0.

- [ ] T101 Capture/assemble realistic multi-turn traces (retrieval observed, not assumed)
- [ ] T102 Wire CCR in the proxying path (`/v1/messages`) with `headroom_retrieve` auto-injected
- [ ] T103 Compute realized net savings + accuracy A/B over the same traces (NFR-007)
- [ ] T104 Re-emit SpikeReport + go/no_go (own Postgres store for durable, isolated reversibility)

## WP02 — Adapter Boundary + Config · `tasks/WP02-adapter-boundary.md`

> **BLOCKED** by WP01 no_go (FR-004). Unblocks only on a WP01b `go`.

**Goal:** The single, removable boundary to Headroom: pinned version, kill switch,
fail-open. **Priority:** P1. **Dependencies:** WP01 (= go).
**Independent test:** adapter compresses/retrieves through one module; `enabled=false`
and backend-down both fall through to uncompressed pass-through with no throw; grep
finds Headroom imported only in the adapter.
**Estimated prompt size:** ~330 lines.

- [ ] T008 Define CompressionAdapter interface per contract (WP02)
- [ ] T009 Implement adapter wrapping pinned headroom-ai (single call site) (WP02)
- [ ] T010 Config module: kill switch + pinned version constant (WP02)
- [ ] T011 Pass-through fallback + no-negative-savings bypass (WP02)
- [ ] T012 Static check: Headroom imported only in the adapter (WP02)

## WP03 — Per-Tenant Originals Store + Reversibility · `tasks/WP03-tenant-originals-store.md`

**Goal:** Reversible, tenant-partitioned storage of originals; dedup never crosses
tenants. **Priority:** P1. **Dependencies:** WP02.
**Independent test:** byte-identical content under two tenants yields two entries and
zero cross-tenant retrieval; every round-trip is byte-identical; tenant deletion purges
the partition.
**Estimated prompt size:** ~360 lines.

- [ ] T013 Per-tenant partitioned originals store (WP03)
- [ ] T014 Per-tenant dedup keys (never global) (WP03)
- [ ] T015 Reversible retrieve by tenant-scoped originalRef (WP03)
- [ ] T016 Tenant deletion purges partition wholly (WP03)
- [ ] T017 Reversibility test suite (NFR-004) (WP03)
- [ ] T018 Isolation test suite incl. byte-identical case (NFR-005) (WP03)

## WP04 — Wire Compression Into Selected Payload Path · `tasks/WP04-wire-payload-path.md`

**Goal:** Apply compression to the WP01-chosen primary payload type at the MCP egress,
end-to-end with retrieval. **Priority:** P1. **Dependencies:** WP02, WP03.
**Independent test:** selected payload type is compressed on egress, retrievable
downstream, never increases token count, and disabling the kill switch restores
pre-integration behavior.
**Estimated prompt size:** ~280 lines.

- [ ] T019 Hook adapter into the WP01-selected payload egress (WP04)
- [ ] T020 Enforce no-negative-savings + bypass binary/incompressible (WP04)
- [ ] T021 Kill switch end-to-end (WP04)
- [ ] T022 Propagate originalRef for downstream retrieval (WP04)

## WP05 — Acceptance Harness + Rollout Safety · `tasks/WP05-acceptance-rollout.md`

**Goal:** Make the gates permanent (CI) and the rollout reversible. **Priority:** P2.
**Dependencies:** WP03, WP04.
**Independent test:** CI fails on any accuracy degradation, any reversibility miss, or
any cross-tenant leak; a runbook demonstrates clean kill-switch removal.
**Estimated prompt size:** ~300 lines.

- [ ] T023 Accuracy A/B CI gate (NFR-001) (WP05)
- [ ] T024 Wire reversibility + isolation suites as CI gates (WP05)
- [ ] T025 Kill-switch runbook + clean-removal verification (WP05)
- [ ] T026 Savings/latency reporting (NFR-002/003/007) (WP05)

---

## Dependency graph

```
WP01 (gate) = NO_GO ──► WP01b (re-gate, retrieval rate) ──► [if go] WP02 ──► WP03 ──► WP05
                                                                      └──────► WP04 ──┘
```

WP01 returned no_go, so WP02–WP05 are **blocked**. WP01b is the re-gate: it measures realized
net savings under real retrieval. Only a WP01b `go` unblocks WP02 (which unlocks WP03/WP04; WP05
depends on WP03+WP04).

## MVP scope

**WP01 was the decision; it returned `no_go` — the intended cheap outcome of a gate-first plan.**
The premise (≥50% lossless/reversible savings on content_mcp) does not hold for must-read tool
outputs. WP01b is the *only* path forward: prove net savings under measured retrieval, or close
the mission. No integration code (WP02–WP05) is justified until WP01b records `go`.
