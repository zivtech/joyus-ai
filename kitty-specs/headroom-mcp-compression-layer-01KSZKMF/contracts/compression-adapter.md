# Contract: CompressionAdapter (the single boundary)

The **only** module permitted to reference Headroom (NFR-006). Every payload path
in `joyus-ai-mcp-server` talks to this interface, never to Headroom directly.

## Interface (TypeScript shape)

```ts
interface CompressionAdapter {
  /** Compress a tenant-scoped payload. Fails open to identity on backend error (FR-010). */
  compress(input: {
    tenantId: string;            // non-null; isolation key (NFR-005)
    kind: 'content_mcp' | 'rag_chunk' | 'executor_output';
    content: string | Uint8Array;
  }): Promise<{
    compressed: string | Uint8Array;
    originalRef: string;         // tenant-scoped handle (FR-006)
    savingsRatio: number;        // >= 0 — never negative (FR-009)
    lossless: boolean;           // true on the reversible/CCR path (default)
    bypassed: boolean;           // true for incompressible/binary/disabled (FR-008/FR-009)
  }>;

  /** Retrieve the exact original. Tenant-scoped; cross-tenant ref is unresolvable (NFR-005). */
  retrieve(input: { tenantId: string; originalRef: string }):
    Promise<{ original: string | Uint8Array }>;  // byte-identical (NFR-004)

  /** Operator kill switch state (FR-008). */
  readonly enabled: boolean;
}
```

## Behavioral guarantees (testable)

| ID | Guarantee | Test |
|----|-----------|------|
| G1 | `retrieve(compress(x))` is byte-identical to `x` within a tenant | reversibility suite (NFR-004) |
| G2 | `retrieve({tenantId: B, originalRef: <A's ref>})` never returns A's data | isolation suite (NFR-005) |
| G3 | `savingsRatio >= 0` always | property test (FR-009) |
| G4 | backend down → `bypassed=true`, original content passes through, no throw | fault-injection (FR-010) |
| G5 | `enabled=false` → all calls bypass, server behaves as pre-integration | kill-switch test (FR-008) |
| G6 | Headroom imported in this module only | static check / grep (NFR-006) |
