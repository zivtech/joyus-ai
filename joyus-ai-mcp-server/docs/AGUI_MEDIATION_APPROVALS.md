# AG-UI Mediation Approval Design

Status: issue #72 evaluation and proof of concept
Last refreshed: 2026-05-25

## Source Refresh

The current AG-UI docs describe AG-UI as a lightweight, event-based protocol between user-facing applications and agent backends. The architecture remains transport-flexible: an endpoint can accept `RunAgentInput` and stream `BaseEvent` objects over HTTP SSE, binary HTTP, WebSockets, or another adapter. The event set includes lifecycle, step, message, tool, state, raw, and custom events. `STATE_DELTA` uses JSON Patch operations, and `CUSTOM` carries application-specific event names and values.

Sources checked:

- [AG-UI overview](https://docs.ag-ui.com/introduction)
- [AG-UI core architecture](https://docs.ag-ui.com/concepts/architecture)
- [AG-UI JavaScript event model](https://docs.ag-ui.com/sdk/js/core/events)
- [CopilotKit AG-UI docs](https://docs.copilotkit.ai/langgraph-python/ag-ui)
- [Mastra and CopilotKit AG-UI starter note](https://mastra.ai/blog/copilotkitmastra)
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

## Recommendation

Use a thin local AG-UI-compatible adapter for the first approval slice.

This keeps the first implementation aligned with the existing TypeScript MCP server, Inngest-backed orchestration, and the judge layer from issue #71. It avoids adopting a larger frontend or graph runtime before the product has a stable review UI surface. CopilotKit remains the strongest candidate once a React approval UI exists. Mastra should be revisited only as part of the broader orchestrator runtime decision. LangGraph is useful prior art for interrupt semantics, but it is a heavier runtime fit here.

## Protocol Mapping

| Judge outcome     | Platform state                                  | AG-UI event mapping                                                                                    | User decision needed       |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| `allow`           | `completed`                                     | No approval event. Normal mediation response proceeds.                                                 | No                         |
| `block`           | `blocked`                                       | Terminal response with judge summary. Future clients may render a non-actionable `CUSTOM` event.       | No                         |
| `revise`          | `awaiting_revision`                             | `RUN_STARTED`, `STATE_DELTA /mediationApproval`, `CUSTOM mediation.approval.requested`, `RUN_FINISHED` | Yes, editable              |
| `escalate`        | `awaiting_approval`                             | `RUN_STARTED`, `STATE_DELTA /mediationApproval`, `CUSTOM mediation.approval.requested`, `RUN_FINISHED` | Yes, approve/reject/revise |
| approval response | `approved`, `rejected`, or `revision_submitted` | `CUSTOM mediation.approval.decided`                                                                    | No, resumes server flow    |

The custom request event value is `MediationApprovalRequest`. It includes:

- `approvalRequestId`
- `actionProposalId`
- `judgmentId`
- `judgeOutcome`
- `actionType`
- `actionTarget`
- `payloadSummary`
- `payloadRef`
- `judgment.reasonCode`, `judgment.summary`, `judgment.policyVersion`, `judgment.judgedAt`
- optional `requiredRevision`
- optional `escalation`
- deterministic `expiresAt`
- `responseContract`
- `resume.requestId`, `resume.sessionId`, `resume.actionProposalId`, `resume.judgmentId`

The event intentionally excludes raw authorization context, raw evidence, judge criteria, API keys, tenant IDs, user IDs, profile authorization lists, source authorization lists, and generated response text.

## Response Contract

Clients submit one of three decisions:

| Decision            | Required fields                                                 | Server next action |
| ------------------- | --------------------------------------------------------------- | ------------------ |
| `approve`           | `approvalRequestId`, `actionProposalId`                         | `execute`          |
| `reject`            | `approvalRequestId`, `actionProposalId`                         | `cancel`           |
| `revise_with_edits` | `approvalRequestId`, `actionProposalId`, `editedPayloadSummary` | `rerun_judge`      |

The current proof of concept is type-level and serialization-level. A follow-on route should persist the request, validate the authenticated requester, and only then execute, cancel, or re-run the judge.

## Integration Design

Current mediation flow:

1. The mediation router validates integration and user auth.
2. `GenerationService` produces a response proposal.
3. `createMediationResponseProposal()` converts the generated response into an `ActionProposal`.
4. `MediationJudgeService` returns `allow`, `block`, `revise`, or `escalate`.
5. `allow` proceeds to response delivery.
6. `block`, `revise`, and `escalate` halt delivery.

The adapter added for issue #72 fits between steps 4 and 6:

```ts
const judgment = await judgeService.judge(proposal);
const events = createMediationApprovalAguiEvents(proposal, judgment, {
  approvalRequestId,
  now,
});
```

Initial event transport can be either:

- response-embedded event objects for a narrow mediation API prototype, or
- an SSE stream mounted beside the existing session/event routes.

The second path is the recommended production direction. It lets authenticated clients subscribe once, render judge pauses in real time, and send a separate decision command.

## Library Comparison

| Option                   | Fit         | Strength                                                                                         | Risk                                                                                            | Recommendation                     |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| Thin local AG-UI adapter | High        | Minimal dependency change, matches existing TypeScript services, works with current judge output | More UI glue later                                                                              | Use now                            |
| CopilotKit               | Medium-high | AG-UI-native React hooks, subscriptions, and frontend state                                      | Introduces frontend framework assumptions before review UI is settled                           | Revisit for UI implementation      |
| Mastra                   | Medium      | TypeScript-native agent/workflow runtime with visible AG-UI path                                 | Larger runtime adoption decision and overlap with existing orchestration                        | Defer to orchestrator runtime work |
| LangGraph                | Medium-low  | Mature interrupt/resume and checkpoint model                                                     | Runtime mismatch and heavier graph semantics; side effects before interrupts must be idempotent | Use as semantic reference only     |

## Proof of Concept

Implemented in `src/content/mediation/agui.ts`:

- creates deterministic approval requests for `revise` and `escalate`
- emits AG-UI-compatible `RUN_STARTED`, `STATE_DELTA`, `CUSTOM`, and `RUN_FINISHED` events
- models approval responses as `approve`, `reject`, and `revise_with_edits`
- maps responses to `execute`, `cancel`, and `rerun_judge`
- keeps event payloads minimized for public-safe client rendering

Test coverage in `tests/content/mediation/agui.test.ts` asserts event stability, expiry behavior, response validation, resume/audit IDs, and payload minimization.

## Follow-on Work

- Persist approval requests so decisions can be validated against server state.
- Add an authenticated decision endpoint.
- Stream approval events via SSE rather than returning static arrays.
- Wire the approved path to execute the original action only after the persisted decision matches the proposal and judgment.
- Add a review UI after the event contract stabilizes.
