# Mediation Judge Layer Decision

**Feature**: `006-content-infrastructure`  
**Date**: 2026-05-25  
**Status**: Accepted for first implementation slice  
**Scope**: Public platform architecture for content mediation actions

## Decision

Joyus AI will add a judge layer before the mediation gateway delivers generated
responses to an authenticated integration caller.

The current public codebase does not yet contain a moderation-decision
application endpoint. The highest-risk implemented boundary is therefore
`deliver_mediation_response`: the point where a generated, citation-bearing
response crosses from internal generation state into an external API response.
That boundary already has user, tenant, integration, session, entitlement,
profile, citation, and operation-log context available, so it can exercise the
judge contract without adding unrelated product surface.

## Action Surface Map

| Action | Tier | Boundary crossed | Affected parties | Judge needed? | Human review needed? |
|---|---:|---|---|---|---|
| `GET /api/mediation/health` | 1 | Public read-only health probe | Operators | No | No |
| `POST /api/mediation/sessions` | 2 | Authenticated request to internal session row | Current user, integration operator | Post-action audit | No |
| `GET /api/mediation/sessions/:sessionId` | 1 | Authenticated read of session state | Current user | No, auth scope is the control | No |
| `DELETE /api/mediation/sessions/:sessionId` | 2 | Active session to closed session | Current user, integration operator | Post-action audit now, pre-action judge later if closure gains downstream effects | No |
| Resolve entitlements for a session message | 2 | External entitlement source to session-scoped access view | Current user, tenant operator | Post-action audit and fail-closed access logic | Escalate only on conflicting grants |
| Retrieve/search content for a message | 1 | Internal read of entitled content | Current user | No, entitlement filtering is the control | No |
| Generate a mediation response | 2 | Internal model output and generation log | Current user | Post-action audit and drift monitoring | No |
| Deliver generated mediation response | 3 | Internal generated response to external API caller | Current user, integration operator, tenant operator | Pre-action judge | Escalate on ambiguous authorization, policy conflict, high-risk exposure, or insufficient context |
| Increment mediation session counters | 2 | Internal session metrics update | Operators | Post-action audit | No |
| Write generation, cache, and operation logs | 2 | Internal append-only audit record | Operators, reviewers | No, append-only audit is the control | No |
| Create or revoke mediation API keys | 3 | Admin action changes integration access | Tenant operator, integration operator, users | Pre-action judge in a later slice | Human approval for broad or production access changes |

## First Boundary

The first judged boundary is `deliver_mediation_response`.

Rationale:

- It is implemented today in `joyus-ai-mcp-server/src/content/mediation/router.ts`.
- It is the first point where generated content leaves the platform.
- It has enough structured context to make the judge deterministic and testable.
- It supports issue #71 without adding AGUI, human review UI, multi-judge
  composition, or asynchronous job routing.

The actor must create an `ActionProposal` before delivery. The runtime must
persist the proposal, judgment, and enforcement outcome to `content.operation_logs`
before it delivers or withholds the response.

## Judge Criteria Specification

### Authorization

- Does the proposal include tenant, user, session, and integration context from
  the authenticated request?
- Does the proposal context match the session context?
- If a profile is used, is that profile included in resolved entitlements?
- Is the proposed response being delivered only to the authenticated requester
  and their integration?
- Is the actor relying on a current authenticated request rather than a stale or
  inferred instruction?

### Evidence

- Does the proposal cite at least one authoritative source when the response
  presents content-backed guidance?
- Are all cited source IDs included in the resolved entitlement source list?
- Are any cited sources marked stale, ambiguous, or contradicted?
- Is the payload reference durable enough for an auditor to inspect the
  generation record?

### Exposure And Risk

- What data would be exposed by the response, and to whom?
- Would a wrong response affect anyone beyond the authenticated requester?
- Is the action reversible, or is there at least a manual correction path?
- Does the proposal carry high-risk flags such as broad external exposure,
  sensitive data exposure, or irreversible external effect?

### Policy

- Does the proposal respect tenant/profile isolation?
- Does the response preserve source attribution requirements from Feature 006?
- Does uncertainty route to `revise` or `escalate` rather than `allow`?
- Does the policy version appear in both proposal and judgment records?

## Decision Rules

| Outcome | Runtime behavior |
|---|---|
| `allow` | Persist audit record, deliver the generated response, increment session counters. |
| `block` | Persist audit record, do not deliver the generated response, return a blocked judgment response. |
| `revise` | Persist audit record, do not deliver the generated response, return concrete revision instructions. |
| `escalate` | Persist audit record, do not deliver the generated response, return escalation data for a future review queue. |

## Rollout Plan

1. Add typed `ActionProposal` and `JudgeResult` contracts for mediation actions.
2. Add a deterministic, injectable judge service for the first boundary.
3. Gate `deliver_mediation_response` in the mediation router.
4. Persist proposal, judgment, and enforcement result to append-only operation logs.
5. Add a 20-case evaluation suite covering `allow`, `block`, `revise`, and
   `escalate`, including per-outcome metrics.
6. Defer additional boundaries, AGUI, human review UI, and multi-judge
   composition to follow-on issues.

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| Section 2.1 Multi-Tenant from Day One | PASS | Judge inputs include tenant, session, user, integration, profile, and entitlement context. |
| Section 2.3 Sandbox by Default | PASS | Missing or mismatched authorization fails closed. |
| Section 2.4 Monitor Everything | PASS | Every proposal and judgment writes an operation-log audit event. |
| Section 2.6 Mediated AI Access | PASS | The judge is part of the mediation boundary, not model-specific logic. |
| Section 2.10 Client-Informed, Platform-Generic | PASS | The contract uses only generic platform terms and synthetic examples in tests. |
| Section 3.3 Non-Negotiables | PASS | Delivery is blocked unless the judgment allows it and audit logging succeeds. |

## Out Of Scope

- Judging every mediation action boundary in this slice.
- Human review UI or AGUI approval protocol.
- Specialist judge composition.
- Memory provenance labels for judge inputs.
- Private tenant policy, private corpus examples, or client-specific rules.
