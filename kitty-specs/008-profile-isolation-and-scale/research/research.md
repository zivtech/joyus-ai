# Research: Profile Isolation and Scale

## Inputs
- Spec 005 (Content Intelligence) drift monitoring interface and event contracts.
- Spec 006 (Content Infrastructure) content schema and profileId reference patterns.
- Spec 007 (Governance) audit event and access control patterns.
- joyus-profile-engine Python library: 129-feature stylometrics, 97.9% accuracy baseline.

## R1: Tenant Isolation via Guard Pattern
- Decision: Enforce tenant isolation via `assertProfileAccessOrAudit()` at the service layer, not the route layer.
- Why: Route-layer guards can be bypassed by new code paths (event listeners, background workers). A single guard called unconditionally at the service boundary catches all callers regardless of entry point.

## R2: LRU vs Redis Caching
- Decision: In-memory LRU cache with configurable TTL (default 1 hour), no external Redis dependency.
- Why: Profile feature vectors are ~2KB each; 1000 cached profiles fit within 50MB. Redis adds operational overhead (additional infrastructure, latency hop) for a use case well-served by in-process LRU. Redis can be introduced later if cross-instance cache coherence becomes necessary.

## R3: Advisory Locks for Concurrent Retraining
- Decision: Use `pg_advisory_xact_lock(hashCode(profileId))` to serialize retraining for the same profile.
- Why: Two concurrent drift events for the same profile must not create two new versions simultaneously. Database-level advisory locks prevent this without requiring a separate lock table or distributed coordination. The lock is held only for the duration of the transaction.

## R4: PostgreSQL JSONB for Feature Vectors
- Decision: Store 129-dimensional feature vectors as JSONB in PostgreSQL rather than a separate vector store.
- Why: The profile engine produces structured float arrays, not embedding vectors requiring ANN search. JSONB is sufficient for storage, retrieval, and diffing use cases within this spec. A dedicated vector store would be introduced only if nearest-neighbor profile search (out of scope) is added.

## R5: NullClient Pattern for Engine Abstraction
- Decision: Define a `ProfileEngineClient` TypeScript interface and ship a `NullProfileEngineClient` stub alongside the real client.
- Why: The Python profile engine communication mechanism (subprocess, HTTP, FFI) is TBD and may change. The NullClient enables full development and testing of the platform layer without a running Python engine. The interface ensures the engine can be swapped without touching platform code.
