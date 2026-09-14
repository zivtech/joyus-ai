---
title: Catalog core acceptance matrix
status: not-executed
---

# Acceptance matrix

Every row is **NOT RUN**. These are future observations required of the implementation, not test results from writing this package. "WP01" and "WP02" refer to the two work packages in this package. Real-content/operations receipts are private and separate from synthetic tests.

| ID | Owner | Requirements | Required observation |
|---|---|---|---|
| AT-01 | WP02 | FR-01, FR-11, FR-15 | `tools/list` descriptor byte-identical for 1 and 100 fixture skills; no menu, private coordinates or bodies; descriptor may remain while disabled |
| AT-02 | WP02 | FR-01, FR-05, FR-14 | member without GitHub connection completes list/info; both success/failure HTTP audit rows exclude malicious secret/URL inputs and raw cursor/name; existing OAuth families keep their connection rules |
| AT-03 | WP02 | FR-02, FR-03, FR-09, FR-14, FR-15 | current exact default member succeeds regardless of member/admin/operator role; missing/revoked/no-default/ambiguous default, self-only, env-only, other-tenant operator, API-key-only and DB-query failure deny without metadata/body; malicious headers/arguments cannot change tenant |
| AT-04 | WP02 | FR-07, FR-08, FR-13, FR-14 | list contains no bodies; info returns exact original UTF-8 after JSON decoding, including LF/CRLF frontmatter; wrong expected revision returns catalog-changed without body; unknown/inaccessible name indistinguishable within the same access state |
| AT-05 | WP01 | FR-06, FR-07, FR-10 | parameterized cases: duplicate names/JSON keys/YAML fields, unsupported schema, invalid scalar types, extra fields, aliases/tags/merge keys, missing/empty files, invalid UTF-8/BOM, traversal/symlink/submodule, metadata/bytes mismatch and incomplete tree each reject candidate without mutating active generation |
| AT-06 | WP01 | FR-04, FR-05, FR-08 | advance approved branch during fetch; every index/tree/blob fetch stays pinned to initially resolved immutable revision; redirect attempts cause rejection and no credential forwarding |
| AT-07 | WP01 | FR-08, FR-09, FR-16, FR-17, FR-19 | barriers force reads during refresh, duplicate triggers, delayed superseded attempts and shutdown; each read sees all old or all new; one candidate per logical source; no late activation from old epoch, including source credential rotation mid-download; two tenants sharing repository/ref retain independent epoch eligibility |
| AT-08 | WP01 | FR-17, FR-20 | activate B; policy selects approved earlier A with fresh epoch; delayed old B cannot overwrite A; operator procedure generates a new epoch rather than restoring the historical one |
| AT-09 | WP02 | FR-02, FR-03, FR-15, FR-18, FR-19 | two instances have fresh content; acknowledge membership deletion or policy disable/source removal; new calls on both including old cursors deny; policy failure denies; re-enable/new epoch stays unavailable until source re-verification; previously authorized in-flight calls obey five-second bound |
| AT-10 | WP02 | FR-11, FR-12, FR-13, FR-14 | default 20/max100 pages, deterministic equal-priority ordering, empty/final page null cursor; tampered/wrong-source/wrong-tenant tokens fail; cross-instance same-epoch/revision works; old epoch/revision gives catalog-changed; fractional/out-of-range/unknown args rejected without echo |
| AT-11 | WP01 | FR-17, FR-18 | fake clock: <5min fresh; >=5min or transient failure stale; just below1h may serve stale; exactly1h/above unavailable; failures do not advance verification time; same-revision successful check refreshes it; 401/403 immediately unavailable on observing instance until verified; policy disable always wins |
| AT-12 | WP01 | FR-05, FR-16, FR-19 | invalid refresh credential causes no policy/source read; reject override fields/body>1KiB; informational ref ignored; duplicate coalesces; per-source local rate/capacity bounds; accepted/in-progress/activated/rejected/unavailable all observable; scoped status cannot read other source jobs; bounded status retention and no secrets/bodies |
| AT-13 | WP01 | FR-10, FR-16, FR-17 | test just below/at/above index/document/aggregate/count/deadline budgets, dishonest Content-Length and decoded transport expansion; abort sibling fetches; 32MiB active admission cap leaves refresh headroom under64MiB total; a new tenant at capacity is explicitly rejected and succeeds after disabled-entry cleanup frees capacity; bounded fair scheduling and status retention; at most4 downloads/candidate and2 source refreshes/instance |
| AT-14 | WP02 + corpus owner | FR-04, FR-06, FR-07, FR-08, FR-13 | private approval receipt names approver, source revision, expected names/count and timestamp; real list/info match those original documents; a PR head, fixture or linter result does not substitute |
| AT-15 | WP02 | FR-01, FR-14, FR-20 | target repository validate/build pass; coverage >=80% for new code with explicit access-negative tests; no migration/new storage changes; no getAllTools/session/orchestrator/resources changes; optional catalog failure does not stop other tools; dependency/secret/public-diff checks recorded |
| AT-16 | WP02 + operations owner | FR-02, FR-05, FR-18, FR-19, FR-20 | actual primary policy object and two instances demonstrate write/read-back acknowledged disable, no replica/cache/version-pinned read, denied policy outage, epoch re-enable verification, credential rotation and rollback; record latency and private evidence separately from mocks |

## Evidence receipt fields

Each executed test row records selected implementation commit, test command/scenario, expected versus observed result, timestamp, evidence path, reviewer and any unmet prerequisite. Retain failing observations; never replace a runtime failure with a spec/checklist pass. Corpus and operations receipts additionally name their approving owner privately. Source/credential values must not be printed into generic test logs.

Core implementation can be reviewed with generic-fixture evidence. Real-content readiness cannot close without AT-14; live-authority readiness cannot close without AT-16. Neither closes gated later session-identity work. Merge/deployment need their own scope and authorization.
