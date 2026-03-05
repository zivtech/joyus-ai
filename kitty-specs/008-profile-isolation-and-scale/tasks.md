# Tasks: Profile Isolation and Scale

## Work Packages
### WP01 - Isolation Contract
- Define tenant-scoped profile APIs and storage boundaries.
- Define lifecycle states for profile and profile version.

### WP02 - Enforcement
- Implement deny-by-default cross-tenant checks.
- Add profile access audit events.

### WP03 - Scale Path
- Implement batch ingestion queueing and retries.
- Add backpressure and overload protections.

### WP04 - Validation
- Add integration tests for tenant isolation.
- Add load tests for ingestion and verification latency.
