# Digital Twin Requirements

**Version**: 1.0
**Date**: 2026-03-21
**Owner**: Platform Lead
**Spec reference**: 007-org-scale-agentic-governance §Scenario Validation Model, FR-012

---

## Purpose

High-autonomy workflows that interact with external services or critical integrations must have a simulation or digital twin strategy before production use. This requirement prevents a Level 4 or Level 5 workflow from producing irreversible side effects in external systems during evaluation or speculative execution.

---

## When a Digital Twin Is Mandatory

A digital twin or simulation strategy is required in all of the following cases:

1. **Level 5 workflows** — all workflows operating at Level 5 require a validated digital twin, regardless of the integrations involved.
2. **Level 4 workflows with critical-class integrations** — any Level 4 workflow that interacts with an integration classified as critical (financial transactions, healthcare records, authentication systems, production data stores, or any system where errors cannot be trivially reversed) requires a digital twin before production promotion.
3. **Any workflow where a scenario set includes a failure scenario targeting an external dependency** — if a scenario tests what happens when an external system is unavailable or returns an error, that integration must have a digital twin for the scenario to be executable in CI.

---

## Approved Approaches

Four approaches satisfy the digital twin requirement. The chosen approach must be documented in the workflow's strategy template (see below).

### 1. Mock Server
A locally-runnable HTTP server that returns pre-defined responses matching the external API's contract. Suitable for REST or GraphQL integrations where the response shape is stable and well-documented.

### 2. Recorded Replay
Responses from the real external system are recorded in a controlled environment and replayed deterministically during CI runs. Suitable for integrations with complex response payloads. Recordings must be refreshed when the external API changes.

### 3. Behavioral Contract
A contract test suite that verifies the workflow's integration layer against a shared schema, without calling the external system. Suitable when the external provider maintains a published OpenAPI or similar contract. The contract must be version-pinned.

### 4. Staging Environment
A dedicated staging instance of the external system, managed by the integration owner, used exclusively for CI and evaluation runs. Suitable when the external system is operated internally or when the provider offers a stable sandbox. The staging environment must be isolated from production data.

---

## Minimum Fidelity Requirements

Regardless of approach, a digital twin implementation must satisfy all of the following:

- **Response shape coverage**: The twin must reproduce all response shapes (including error responses) that the workflow's scenario set exercises. Gaps in shape coverage are treated as fidelity failures.
- **Failure scenario coverage**: The twin must simulate at least two distinct failure modes (e.g., timeout, 5xx error, malformed response). Workflows with no failure scenarios in their scenario set are considered incomplete.
- **Version pinning**: The twin must be pinned to a specific version of the external API or contract. Unpinned twins that drift silently with the real API are treated as fidelity failures.
- **CI-runnable**: The twin must execute in the CI environment without external network calls. Local execution must be reproducible with a single documented setup command.

---

## Review and Authorization Process

1. **Team documents strategy**: The workflow's Platform Lead or designated senior engineer completes the Strategy Template below and stores it at `governance/scenarios/{workflow-name}/digital-twin-strategy.md`.
2. **Platform Lead reviews**: Confirms that the chosen approach satisfies minimum fidelity requirements and that the implementation exists and is CI-runnable.
3. **Security Team reviews**: Confirms that the twin does not introduce credential leakage, does not use production data in recording replay, and does not create unauthorized network paths.
4. **Authorization recorded**: Platform Lead records authorization in the Team Classification Register with a link to the strategy document and the date of approval.

A workflow may not be promoted to Level 5 until all four steps are complete and recorded.

---

## Digital Twin Strategy Template

Store completed strategy documents at `governance/scenarios/{workflow-name}/digital-twin-strategy.md`.

```markdown
# Digital Twin Strategy: {Workflow Name}

**Version**: 1.0
**Date**: YYYY-MM-DD
**Workflow level**: Level 4 / Level 5
**Reviewed by**: Platform Lead
**Security reviewed by**: Security Team
**Authorization date**: YYYY-MM-DD

## Approach

[Mock server | Recorded replay | Behavioral contract | Staging environment]

## Rationale

[Why this approach was chosen for this workflow]

## API Coverage

| Integration | API Version | Coverage Approach | Failure Scenarios | Last Verified |
|-------------|-------------|------------------|-------------------|---------------|
| [Name]      | [version]   | [approach]       | [count]           | YYYY-MM-DD    |

## Setup Command

```
[Single command to start the twin locally]
```

## CI Configuration

[Location of CI configuration that runs the twin]

## Fidelity Gaps

[Any known gaps in coverage, with remediation plan and target date]

## Refresh Schedule

[How often recorded responses or contracts are updated, and who is responsible]
```

---

## Fidelity Failure Response

If a digital twin fails a fidelity check (response shape mismatch, version drift, CI failure):

1. The workflow is suspended at its current level until fidelity is restored.
2. Platform Lead is notified within one business day.
3. Production use of the affected workflow is halted until fidelity is confirmed restored.
4. A post-incident note is added to the Team Classification Register.

---

## Key Rules

- A Level 5 workflow without a validated digital twin cannot be authorized. There are no exceptions.
- Production data must never be used in recorded replay twins.
- Twin implementations must be CI-runnable without external network calls.
- Fidelity failures trigger workflow suspension, not a grace period.
