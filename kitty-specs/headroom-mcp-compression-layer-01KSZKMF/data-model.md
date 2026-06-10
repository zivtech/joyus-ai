# Phase 1 Data Model: Headroom MCP Compression Layer

Entities derived from spec §5. All tenant-scoped entities carry a non-nullable
`tenantId`; cross-tenant access is structurally impossible (NFR-005, C-004).

## Payload

A unit of content flowing through the MCP server toward the LLM.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | unique within tenant |
| `tenantId` | string | non-null; owning tenant |
| `kind` | enum | `content_mcp` \| `rag_chunk` \| `executor_output` |
| `content` | bytes/text | the original payload |
| `tokenCount` | int | measured pre-compression |

Rules: `kind=content_mcp` is the WP01 priority target. Binary/non-text payloads are
bypassed (FR-009 edge case), never compressed.

## CompressionResult

The compressed form plus a pointer to its retrievable original.

| Field | Type | Notes |
|-------|------|-------|
| `payloadId` | string | FK → Payload.id (same tenant) |
| `tenantId` | string | non-null; must equal Payload.tenantId |
| `compressed` | bytes/text | compressed representation |
| `originalRef` | string | handle into OriginalsStore (tenant-scoped) |
| `compressedTokenCount` | int | post-compression |
| `savingsRatio` | float | `1 - compressed/original`; must be ≥ 0 (no negative savings, FR-009) |
| `lossless` | bool | true for CCR/reversible path (default) |

State: `compressed → retrievable` (original recoverable) → `purged` (on tenant
deletion). Never `shared`.

## OriginalsStore

Per-tenant storage of pre-compression originals enabling reversible retrieval.

| Field | Type | Notes |
|-------|------|-------|
| `tenantId` | string | partition key; hard boundary |
| `originalRef` | string | unique within tenant |
| `original` | bytes/text | byte-identical to source (NFR-004) |
| `dedupKey` | string | scoped **within** tenant only — never global |

Rules: dedup keys are computed per tenant; two tenants with byte-identical content
get **separate** entries (NFR-005). Deleting a tenant purges its partition wholly.

## AdapterBoundary (logical)

The single module through which the platform talks to Headroom.

| Property | Value |
|----------|-------|
| call sites | exactly 1 (NFR-006) |
| version | pinned exact (C-001) |
| killSwitch | config flag → uncompressed pass-through (FR-008) |
| fallback | backend-unavailable → pass-through (FR-010) |

## SpikeReport (WP01 artifact)

The evidence object carrying the go/no-go decision. Schema in
`contracts/spike-report.schema.json`.

| Field | Type | Notes |
|-------|------|-------|
| `perType` | map<kind, {savingsMean, savingsStdDev, accuracyDelta, sampleSize}> | NFR-007 |
| `reversibilityRate` | float | must be 1.0 to pass (NFR-004) |
| `tenantIsolationFit` | enum | `supported` \| `unsupported` (drives R2 fallback) |
| `addedLatencyP95Ms` | float | vs ≤150 ms (NFR-003) |
| `recommendedMode` | enum | `library` \| `proxy` |
| `decision` | enum | `go` \| `no_go` |
| `primaryTarget` | kind | named payload type for WP04 |
| `rationale` | string | why go/no-go |
