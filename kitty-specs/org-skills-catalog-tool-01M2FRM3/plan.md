---
title: Organization skill catalog core implementation plan
status: planned
---

# Implementation plan

**Scope:** WP01/WP02; no implementation started.

**Requirements:** [spec.md](spec.md). Contracts: [org-skills.md](contracts/org-skills.md), [catalog-source.md](contracts/catalog-source.md), [access-policy.md](contracts/access-policy.md), [refresh.md](contracts/refresh.md).

## Summary and engineering alignment

Build an optional catalog service around two separate ports: a source adapter that fetches immutable approved content, and a policy reader that proves current permission on every call. Validate full generations before atomic activation. Add one static `org_skills` tool supporting only list and info. Query the authenticated user's unique current default tenant membership directly; do not reuse a general-purpose, more permissive resolver as the catalog's access grant.

The reference production policy adapter reads a bounded object (schema in `contracts/access-policy.md`) live, independently of cached content, via one uncached authenticated read. Its exact deployment coordinates, credentials and operational roles are outside this package and are a separately authorized private operations concern. This makes the no-new-database-migration scope concrete, with per-call network latency and a fail-closed availability cost. A malformed shared object affects every catalog tenant; conditional writes, validation and versioned recovery are required at the operational layer. Do not soften the membership or policy requirement to avoid that cost.

## Technical context

| Aspect | Plan |
|---|---|
| Target | the target MCP server implementation repository; exact base revision to be reconfirmed before editing |
| Runtime | existing Node >=20, TypeScript, HTTP framework, SQL ORM, schema validation library |
| Additional libraries | maintained `yaml` parser; modular AWS S3 SDK for the policy reader; lock compatible versions during WP01 |
| Source HTTP | existing HTTP client with redirects disabled, streaming bounds and cancellation; no dependency on individual OAuth |
| Storage | existing membership table read-only; in-memory immutable generations and bounded refresh statuses; no new database table |
| Testing | existing test runner; fake source/policy/clock for deterministic contract tests; real primary DB and two-instance authority proof are separate gates |
| Validation | the target repository's existing validate/build/coverage scripts, run in the server directory |
| Bounds | contracts fix entries, byte limits, timeouts, concurrency, page sizes, five-minute refresh and one-hour stale cutoff |
| Performance | record membership/policy/total call latency and process memory under maximum fixtures; no invented throughput or latency SLA |

## Governance and review

Repository rules require exact scope, secret-free diffs, tests for new runtime logic, at least 80% new-code coverage, build verification and preservation of unrelated changes. Source/config startup proof applies when runtime implementation occurs. This documentation-only package validates artifacts, not build/runtime success.

The private/public boundary holds: real source evidence, auth design rationale, deployment coordinates and actual tenant/corpus identifiers stay outside this package. No exception is requested.

## Proposed implementation structure and ownership

Paths below are proposed new paths, not claims that they exist now. Reuse the target repository's existing naming/test conventions when implementing, recording any move in spec/plan/tasks.

```text
joyus-ai-mcp-server/
  src/skills/catalog/
    types.ts                 # immutable contracts and safe error taxonomy
    config.ts                # optional settings and secret-alias validation
    policy-s3.ts             # live policy port implementation
    source-github.ts          # pinned source port implementation
    validation.ts            # index/frontmatter/original bytes
    service.ts                # coherent generations and refresh lifecycle
    refresh-routes.ts         # separately authenticated operator endpoint
    access.ts                # exact default membership and live policy check
    cursor.ts                # opaque authenticated-encrypted cursor
  src/tools/
    org-skills-tools.ts       # static descriptor
    org-skills-executor.ts    # strict list/info arguments and safe output
    index.ts                 # append descriptor to base tools
    executor.ts               # exact-name dispatch before OAuth lookup
  src/index.ts                # startup/refresh wiring; catalog audit sanitizer
  tests/catalog-*.test.ts     # mirror existing test placement if different
  docs/org-skills.md          # generic feature use; private operator runbook kept separately
```

WP01 owns catalog types/config/source/validation/service/policy/refresh files, their tests, and startup/refresh routing in `src/index.ts`. WP02 owns access/cursor/tool descriptor/executor, tool registration/dispatch, catalog audit filtering in `src/index.ts`, integration tests and generic operator documentation. WP02 starts after WP01 passes its contract tests; shared entrypoint changes are sequential. No independent implementers should edit `src/index.ts` concurrently. Both owners preserve unrelated edits and keep functions/files within repository limits.

## Sequence and checkpoints

1. **Documentation and workflow handoff:** validate this package. Before runtime work, obtain explicit target-repository authorization and record the selected source base. Do not begin implementation merely because the documents exist.
2. **WP01 — source, policy and refresh:** write failure-first tests; implement typed ports, bounded validation and adapters; build immutable generations; implement refresh/rollback/stale state; add the operator HTTP surface and optional startup. No tool registration or skill activation behavior. A read-only source verification may use generic fixtures; it does not require real corpus approval. Use two-port tests to ensure policy cannot become a content-cache entitlement.
3. **WP01 review checkpoint:** review moving-ref, delayed old-epoch activation, rollback, whole-candidate rejection, resource bounds and secret redaction. Confirm no database migration dependency appeared. A production policy object need not be provisioned to pass deterministic service tests, but is mandatory for deployed authority proof (a separate gate; see acceptance matrix AT-16).
4. **WP02 — membership and tool integration:** test exact membership and error transport first; add the dedicated access boundary, opaque cursors and strict action schemas; register one descriptor; add exact-name dispatch before connected-service routing; sanitize raw args in both audit paths. Complete unit, integration and existing regression tests. No `getAllTools` signature/session change.
5. **WP02 review checkpoint:** route implementation review to the project's standard code and security review process; examine catalog security boundaries specifically. Address findings, run validation/build/coverage, and record actual outputs.
6. **Separate readiness gates:** record a named approved real-content revision and retrieval receipt; provision/test live authority in a separately authorized operations action; then determine release readiness. Merging, deployment and production availability are outside this package's scope.

## Test and evidence strategy

[Acceptance matrix](checklists/acceptance.md) maps every FR to an observable test and owning WP. Use injected clocks/barriers for races instead of timing sleeps. Test the HTTP wrapper for audit/error behavior, not just the service. Exercise two service instances sharing policy and membership authorities to prove revocation while both content caches are fresh. Check database query failures and API-key-only contexts. Use actual original UTF-8 fixtures and byte equality after JSON decoding. No real tenant or private skill body enters generic test fixtures.

Run the target repository's existing validation/build plus focused coverage of new files. Require >=80% for new code and explicit execution of every access-negative case; aggregate coverage cannot hide an untested authorization branch. Do not silently change unrelated failing tests. Existing failures must be reproduced on the selected base and recorded separately before claiming a clean regression result.

## Dependencies and gate ownership

| Dependency | What it blocks | Fallback / evidence |
|---|---|---|
| Registered implementation workflow and target-repo authorization | implementation command dispatch and cross-repo edits | documents remain formal but registration pending |
| Primary membership schema and DB access | member reads/integration proof | generic injected tests only; no self-scope fallback |
| Read-only approved-source credential and source/ref assignment | source verification | cold catalog unavailable; fixture adapter for development |
| Policy object, runtime read role, independent operator write role | deployed live-policy acceptance | injected authority for tests; unavailable in deployment until configured |
| Approved real-content revision | real-content readiness | fixture-only evidence explicitly labeled |
| Existing session/skill-enablement storage repair | only later, unrelated session integration | no dependency for WP01/WP02 |
| Interactive-client persistence result + stable session identity (WP0/WP3) | all WP3 enable/disable work | WP3 stays gated; no claim made here |

No dependency on any draft MCP transport proposal is introduced: this slice uses the existing tools/list and tools/call behavior. Resources, activation and token optimization remain follow-ons. External source and policy dependencies sit behind separate adapter contracts; alternatives must preserve tests and failure behavior.

## Risks, alternatives and rollback

| Risk | Detection / mitigation | Recovery |
|---|---|---|
| Authorization reused from a general-purpose resolver/cache | deny-matrix and two-instance revocation tests | disable catalog policy; retain other tools |
| Policy outage/malformed shared object | fail closed, bounded reads, whole-object validation, latency metrics | validated conditional replacement with new epoch and read-back |
| Source changes during download | pinned-revision assertions | reject candidate, bounded stale prior generation |
| Superseded refresh overwrites rollback | clock/barrier tests; current epoch and sequence checks | select earlier approved revision under new epoch and revalidate |
| Resource exhaustion | streamed and aggregate budgets, bounded concurrency/status retention | reject candidate and abort remaining work |
| Raw args or source exceptions leak | wrapper-level malicious-input tests | exact-tool audit filter and sanitized stable errors |
| Fixture test becomes an approval claim | separate approval/retrieval receipt | keep real-content gate open |

Alternatives considered: fetch-only-on-info reduces server storage but accepts an unvalidated catalog; eager bounded validation is chosen instead. Environment-variable policy is cheaper but lacks shared, immediate authority across instances; a shared policy object is chosen for the no-migration slice, with a documented latency/blast-radius tradeoff. A catalog-policy database table could be simpler operationally, but requires a separately scoped schema change. Random server-side cursors are simpler but fail across instances; authenticated-encrypted cursors retain opaque binding across instances without a new store.

The weakest assumption is operational, not the retrieval algorithm: a live policy authority must actually be provisioned and remain reachable on every read. This is explicitly a deployment prerequisite, not hidden behind "operator configuration." If unacceptable latency or cost is measured, revisit the adapter architecture before release rather than caching authorization by accident.
