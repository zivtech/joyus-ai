# AG-UI Mediation Approval Decision

**Feature**: `006-content-infrastructure`
**Issue**: `#72`
**Status**: Accepted for first proof-of-concept slice
**Scope**: Public platform architecture for human approval of mediated actions

## Spec Kitty Routing

This work is a post-completion extension to `006-content-infrastructure`, not a
new standalone platform feature.

The approval surface belongs to the mediation gateway because it decides what
happens when a generated, citation-bearing response is paused by the judge layer
before delivery. The existing mission already owns the mediation API, session
handling, entitlement filtering, content-aware generation, and response delivery
contracts. This addendum records the new human-review event surface without
reopening every legacy work package in the completed mission.

## Dependency

The approval adapter depends on the judge-layer contract from issue `#71`.
Without that contract, there is no structured `revise` or `escalate` outcome to
surface to a reviewer. Without this adapter, those outcomes have no standard
client-facing approval event shape.

## Requirement Trace

| Requirement | Relationship |
|---|---|
| `FR-020` Mediation API | Approval events extend the mediation API behavior for paused actions. |
| `FR-021` Two-layer auth | Approval payloads must not expose raw API-key, tenant, or user auth context. |
| `FR-022` Entitlement enforcement | Approval payloads carry summaries and durable refs, not unauthorized source lists or raw evidence. |
| `FR-023` Mediated response delivery | `approve`, `reject`, and `revise_with_edits` determine whether delivery executes, cancels, or reruns the judge. |
| `SC-006` 100 concurrent sessions | The first slice is a typed adapter; streaming and persistence follow after this contract stabilizes. |

## Decision

Use a thin local AG-UI-compatible adapter for the first approval slice.

This keeps the proof of concept aligned with the current TypeScript mediation
module and the judge-layer contract. It also avoids adopting a larger frontend
or graph runtime before the platform has a stable review UI and persistence
model.

Library positioning:

| Option | Decision | Rationale |
|---|---|---|
| Thin local adapter | Use now | Minimal dependency change, exact fit for current judge output, easy to test. |
| CopilotKit | Revisit for UI | Strong AG-UI-native React surface once the review UI exists. |
| Mastra | Defer | Runtime adoption overlaps with broader orchestrator decisions. |
| LangGraph | Reference only | Useful interrupt semantics, but a heavier runtime mismatch for this slice. |

## Acceptance Criteria

1. `revise` and `escalate` judge outcomes produce an AG-UI-compatible event
   stream containing `RUN_STARTED`, `STATE_DELTA`, `CUSTOM`, and `RUN_FINISHED`.
2. Approval requests include stable resume identifiers for the proposal,
   judgment, request, and session when available.
3. Approval responses support exactly `approve`, `reject`, and
   `revise_with_edits`, mapping to `execute`, `cancel`, and `rerun_judge`.
4. Client-facing payloads exclude raw authorization context, raw evidence, judge
   criteria, API keys, tenant IDs, user IDs, entitlement lists, and generated
   response text.
5. Tests cover event stability, expiry behavior, response validation, resume
   identifiers, and payload minimization.

## Implementation Surface

| Surface | Purpose |
|---|---|
| `joyus-ai-mcp-server/src/content/mediation/agui.ts` | Typed approval request, event, and response adapter. |
| `joyus-ai-mcp-server/src/content/mediation/index.ts` | Public mediation barrel exports. |
| `joyus-ai-mcp-server/tests/content/mediation/agui.test.ts` | Focused adapter coverage. |
| `joyus-ai-mcp-server/docs/AGUI_MEDIATION_APPROVALS.md` | Detailed protocol mapping and library comparison. |

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| Section 2.1 Multi-Tenant from Day One | PASS | Tenant/user context remains server-side and is not emitted in approval payloads. |
| Section 2.3 Sandbox by Default | PASS | Only judge-paused actions produce approval requests; allowed actions proceed without extra exposure. |
| Section 2.4 Monitor Everything | PASS | Resume identifiers preserve the audit chain between proposal, judgment, and decision. |
| Section 2.6 Mediated AI Access | PASS | The adapter is model-agnostic and tied to mediation actions, not a specific provider. |
| Section 2.10 Client-Informed, Platform-Generic | PASS | Artifact names and examples are generic platform concepts. |
| Section 3.3 Non-Negotiables | PASS | The design preserves human authority before paused actions execute. |

## Out Of Scope

- Persisting approval requests and decisions.
- Authenticated decision endpoints.
- Server-sent event streaming.
- Review UI implementation.
- Broad adoption of a new agent or graph runtime.
- Client-specific policy, corpus, or reviewer examples.

## Validation

Result on 2026-05-25: targeted adapter, judge, and router-judge tests passed;
full `npm test` passed with 1491 tests passed and 50 skipped; `build`, `lint`,
and `db:check` passed. Staged client-abstraction and diff checks passed before
commit.

Run from `joyus-ai-mcp-server/`:

```bash
npm test -- --run tests/content/mediation/agui.test.ts tests/content/mediation/judge.test.ts tests/content/mediation/router-judge.test.ts
npm run build
npm run lint
npm run db:check
```

Run from the repository root:

```bash
./scripts/check-client-abstraction.sh --staged
git diff --cached --check
```
