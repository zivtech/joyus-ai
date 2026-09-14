---
title: Organization skill catalog tool — traceability
status: planned
---

# Traceability

WP01 = catalog service, source adapter, validation, policy read port, refresh lifecycle (T001–T009).
WP02 = `org_skills` tool, cursor/access boundary, executor and audit wiring (T010–T017), depends on WP01.

All subtasks below are **planned only**. No runtime implementation has been performed.

## Task files

- [WP01 — Catalog service and refresh](tasks/WP01-catalog-service-and-refresh.md) — T001–T009 (9 subtasks)
- [WP02 — Tool and access boundary](tasks/WP02-tool-and-access-boundary.md) — T010–T017 (8 subtasks)

Global subtask count: **17**, numbered T001–T017, unique across both files.

## AT ID key (root acceptance matrix)

AT-01 descriptor · AT-02 no OAuth & audit · AT-03 identity matrix · AT-04 exact bytes · AT-05 invalid candidates · AT-06 pinned revision · AT-07 concurrency · AT-08 rollback · AT-09 two-instance revocation · AT-10 pagination · AT-11 freshness · AT-12 refresh auth/status · AT-13 resource limits · AT-14 approved corpus · AT-15 regression/build/coverage · AT-16 policy deployment receipt.

## FR → task/AT traceability

| FR | Owning task(s) | AT ID(s) |
|---|---|---|
| FR-01 | T010, T016 | AT-01 |
| FR-02 | T004, T012, T016 | AT-03, AT-09 |
| FR-03 | T012 | AT-03 |
| FR-04 | T002 | AT-06 |
| FR-05 | T002, T007, T016 | AT-02, AT-06 |
| FR-06 | T003 | AT-05 |
| FR-07 | T003 | AT-04, AT-05 |
| FR-08 | T003, T005, T014 | AT-04, AT-06 |
| FR-09 | T005, T012 | AT-07, AT-03 |
| FR-10 | T001, T002, T003, T005, T006 | AT-13 |
| FR-11 | T013, T014 | AT-10 |
| FR-12 | T013, T014 | AT-10, AT-07 |
| FR-13 | T011, T014 | AT-04 |
| FR-14 | T011, T014, T015, T016 | AT-02, AT-03, AT-04, AT-10, AT-15 |
| FR-15 | T015, T016 | AT-02, AT-09 |
| FR-16 | T007 | AT-12 |
| FR-17 | T006, T008 | AT-06, AT-07, AT-08 |
| FR-18 | T005, T006 | AT-11 |
| FR-19 | T007, T008 | AT-12 |
| FR-20 | T007, T009, T017 | AT-08, AT-16 |

Regression/build/coverage (AT-15) is owned jointly by both WPs' closing subtasks (T009, T017), which require actual passing test/build/coverage evidence during authorized implementation. No runtime tests are executed by this planning package. Approved-corpus receipt (AT-14) and policy deployment receipt (AT-16) are cross-cutting private evidence, not implementation subtasks; T009 and T017 record the explicit dependency on those private receipts without producing them.
