# Feature Specification: Automated Pipelines Framework

**Feature Branch**: `009-automated-pipelines-framework`
**Created**: 2026-03-10
**Status**: Draft
**Phase**: 3 (Platform Framework)
**Dependencies**: 006 (Content Infrastructure), 007 (Org-Scale Agentic Governance), 005 (Content Intelligence), 008 (Profile Isolation and Scale)
**Constitution**: §2.7 (Automated Pipelines), §2.4 (Monitor Everything), §2.5 (Feedback Loops)

## Purpose

The platform's value proposition depends on automation. A legal advocacy org needs publication sections regenerated when federal regulations change. A marketing team needs content refreshed when brand voice profiles are updated. A consulting firm needs client deliverables rebuilt when source data shifts. Every one of these is a pipeline: an event triggers a sequence of steps that consume content, apply profiles, produce artifacts, and route results for review.

Today, these workflows exist as ad-hoc scripts or manual processes. This spec defines the platform's first-class pipeline abstraction — a generic, event-driven execution framework that connects triggers (regulatory changes, corpus updates, schedule ticks) to actions (content generation, profile regeneration, fidelity checks) with built-in monitoring, failure handling, and human-in-the-loop review gates.

This is not a general-purpose workflow engine. It is scoped to content-and-profile workflows that the platform already understands, using the platform's existing content infrastructure (Spec 006), profile engine (Spec 005/008), and governance model (Spec 007).

## Scope

### In Scope

- Event-driven pipeline triggers (corpus-change, manual-request as MVP)
- Schedule-driven pipeline triggers (cron-style expressions)
- Pipeline step execution with configurable retry policies and exponential backoff
- Forward-only execution with pause-on-failure semantics
- Human-in-the-loop review gates with escalation on timeout
- Structured reviewer rejection feedback linked to artifacts and profiles
- Circular dependency detection at configuration time and runtime
- Tenant-scoped pipeline data isolation
- Pipeline templates for common workflows
- Pipeline execution analytics and metrics
- Idempotent pipeline steps

### Out of Scope

- General-purpose workflow engine (scoped to content-and-profile workflows only)
- Custom pipeline steps that call arbitrary external APIs (step interface should not preclude them, but not built in this spec)
- Real-time streaming pipeline execution (batch/async only)
- Review queue implementation (this spec defines how pipelines interact with review queues, not the queue itself)
- Event bus infrastructure (consumed from Core Orchestrator WP07; this spec defines the pipeline consumer)
- External webhook trigger authentication (deferred to P3)

## User Scenarios & Testing

### User Story 1 - Event-Triggered Pipeline Execution (Priority: P1)

A tenant configures a pipeline: "When my corpus is updated, regenerate affected author profiles and run fidelity checks on the new versions." The tenant adds 12 documents to their corpus. The platform detects the corpus change event, identifies affected authors, triggers profile regeneration (Spec 008), runs attribution scoring against the new profiles, and delivers a summary report to the tenant's review queue.

**Why this priority:** This is the minimum viable pipeline — a single trigger type (corpus change) connected to the platform's core capabilities (profile generation + fidelity scoring). Without this, every corpus update requires manual orchestration.

**Independent Test:** Configure a corpus-change pipeline for a tenant. Upload 12 documents. Verify the pipeline executes end-to-end without manual intervention and produces a fidelity report.

**Acceptance Scenarios:**

- **Given** a pipeline configured with a corpus-change trigger, **when** documents are added to the tenant's corpus, **then** the pipeline executes within 5 minutes of the change event and processes all affected authors.

- **Given** a pipeline execution that completes successfully, **when** the tenant views their pipeline history, **then** the execution is logged with start time, end time, trigger event reference, steps executed, and output artifacts produced.

- **Given** a pipeline configured with a corpus-change trigger, **when** a corpus change occurs but affects zero authors (e.g., metadata-only update), **then** the pipeline evaluates the trigger, determines no action is needed, and logs a no-op execution rather than running unnecessary steps.

- **Given** two pipelines configured for the same trigger event, **when** the event fires, **then** both pipelines execute independently and neither blocks the other.

### User Story 2 - Pipeline Failure Handling and Recovery (Priority: P1)

A pipeline step fails midway (e.g., profile generation times out for one of 5 authors). The platform marks the failed step, retries it according to the pipeline's retry policy, and if retries are exhausted, pauses the pipeline and notifies the tenant with a clear description of what failed and what succeeded.

**Why this priority:** Pipelines that cannot handle failure are not pipelines — they are scripts. Failure handling is not optional for a production system.

**Independent Test:** Configure a pipeline with 5 profile regeneration steps. Simulate a timeout on step 3. Verify steps 1-2 are marked complete, step 3 retries per policy, and steps 4-5 are held until step 3 resolves or the pipeline is manually advanced.

**Acceptance Scenarios:**

- **Given** a pipeline step that fails with a transient error, **when** the retry policy allows retries, **then** the step is retried up to the configured maximum (default: 3) with exponential backoff, and the pipeline resumes from the failed step on success.

- **Given** a pipeline step that exhausts all retries, **when** the step is marked as failed, **then** the pipeline pauses, the tenant is notified with the failure context (step name, error type, retry count, partial outputs), and no downstream steps execute until the failure is resolved.

- **Given** a paused pipeline with a failed step, **when** the tenant manually resolves the issue and resumes the pipeline, **then** execution continues from the failed step (not from the beginning) and previously completed steps are not re-executed.

- **Given** a pipeline step that fails with a non-transient error (e.g., invalid profile schema), **when** the error is classified as non-retryable, **then** the step is immediately marked as failed without retries, and the pipeline pauses with a diagnostic message.

### User Story 3 - Human-in-the-Loop Review Gates (Priority: P1)

A pipeline is configured with a review gate after content generation: "After drafts are generated, hold for human review before publishing." The pipeline executes generation steps, then pauses at the review gate and routes the generated artifacts to the tenant's review queue. A reviewer approves or rejects each artifact. Approved artifacts proceed to the next pipeline step; rejected artifacts are logged with reviewer feedback and routed to a revision queue.

**Why this priority:** Constitution §2.7 requires human review gates for content that will be published or shared externally. Pipelines without review gates cannot be used for any client-facing output.

**Independent Test:** Configure a pipeline with a review gate between generation and publication. Run the pipeline. Verify it pauses at the gate, routes artifacts to the review queue, and resumes only after reviewer action.

**Acceptance Scenarios:**

- **Given** a pipeline with a review gate, **when** execution reaches the gate, **then** the pipeline pauses and all pending artifacts are visible in the tenant's review queue with full context (source trigger, pipeline name, generation parameters).

- **Given** artifacts in the review queue, **when** a reviewer approves an artifact, **then** the approved artifact proceeds to the next pipeline step and the approval is logged with reviewer identity and timestamp.

- **Given** artifacts in the review queue, **when** a reviewer rejects an artifact with feedback, **then** the rejected artifact is removed from the pipeline's forward path, the feedback is stored as a structured signal (linked to the artifact, the profile used, and the pipeline execution), and the pipeline continues with remaining approved artifacts.

- **Given** a review gate with a configured timeout (e.g., 48 hours), **when** the timeout expires without reviewer action, **then** the pipeline escalates to the tenant's configured escalation path (secondary reviewer or admin notification) rather than auto-approving or auto-rejecting.

### User Story 4 - Scheduled Pipeline Execution (Priority: P2)

A tenant configures a pipeline to run on a schedule: "Every Monday at 9am, check for regulatory changes in the Federal Register and flag any that affect our publication topics." The platform executes the pipeline on schedule, queries the configured source, and produces a change report.

**Why this priority:** Not all triggers are event-driven. Regulatory monitoring, periodic content audits, and compliance checks are schedule-driven. Required for the legal advocacy use case but not for initial platform launch.

**Independent Test:** Configure a weekly pipeline. Advance the clock past the scheduled time. Verify the pipeline executes and produces an output (change report or no-op confirmation).

**Acceptance Scenarios:**

- **Given** a pipeline with a cron-style schedule, **when** the scheduled time arrives, **then** the pipeline executes automatically and the execution is logged with the schedule reference.

- **Given** a scheduled pipeline, **when** the previous execution is still running at the next scheduled time, **then** the new execution is skipped (not queued) and a warning is logged indicating schedule overlap.

- **Given** a scheduled pipeline that has been disabled, **when** the scheduled time arrives, **then** no execution occurs and the skip is logged.

### User Story 5 - Pipeline Templates (Priority: P2)

The platform provides pipeline templates for common workflows: corpus-update-to-profiles, regulatory-change-monitor, content-audit, and brand-voice-refresh. A tenant selects a template, configures tenant-specific parameters, and activates the pipeline.

**Why this priority:** Reduces onboarding friction. Templates encode best practices and reduce configuration errors.

**Independent Test:** Instantiate the corpus-update-to-profiles template for a tenant. Trigger a corpus update. Verify the pipeline executes correctly with the tenant's parameters.

**Acceptance Scenarios:**

- **Given** a pipeline template, **when** a tenant instantiates it with their parameters, **then** a fully configured pipeline is created that is owned by the tenant and editable by them.

- **Given** a template-derived pipeline, **when** the tenant modifies a step or adds a review gate, **then** the modification is saved to the tenant's pipeline instance without affecting the template or other tenants' instances.

- **Given** a template update by the platform operator, **when** a tenant has an existing pipeline derived from that template, **then** the tenant's pipeline is NOT automatically updated. The tenant is notified of the template change and can choose to apply it.

### User Story 6 - Pipeline Analytics and Feedback Loops (Priority: P3)

The platform tracks pipeline execution metrics over time: success rate, average execution duration, most common failure modes, reviewer approval rate, and time-to-review. These metrics are available to the tenant and feed back into platform governance (Spec 007) as quality signals.

**Why this priority:** Required for continuous improvement but not for initial pipeline operation.

**Independent Test:** Run a pipeline 20 times with varying outcomes (15 success, 3 retried-then-succeeded, 2 failed). Verify the analytics dashboard shows accurate aggregate metrics.

**Acceptance Scenarios:**

- **Given** 20 pipeline executions, **when** the tenant views pipeline analytics, **then** they see aggregate success rate, mean and p95 execution duration, failure breakdown by step and error type, and reviewer approval rate.

- **Given** a pattern of reviewer rejections on a specific pipeline step (>30% rejection rate over 10 executions), **when** the analytics engine detects the pattern, **then** a quality signal is emitted to the governance layer (Spec 007) flagging the step for review.

### Edge Cases

- **Empty trigger payload:** A corpus-change event fires but the changeset is empty (e.g., a no-op save). The pipeline evaluates the trigger, determines no action is needed, and logs a no-op. No downstream steps execute.
- **Circular pipeline triggers:** Pipeline A's output triggers Pipeline B, whose output triggers Pipeline A. The platform detects the cycle at configuration time and rejects the second pipeline with a clear error. If a cycle is detected at runtime (defensive check), the pipeline is halted and the tenant is notified.
- **Tenant at pipeline limit:** Each tenant has a configurable maximum number of active pipelines (default: 20). Attempts to create additional pipelines are rejected with a clear error referencing the limit and the tenant's entitlement tier.
- **Review gate with no configured reviewers:** Pipeline creation is rejected if a review gate is present but no reviewers are assigned. Existing pipelines with review gates are paused if all assigned reviewers are deactivated.
- **Pipeline step references a deleted profile:** The step fails with a non-retryable error referencing the deleted profile. The tenant is notified with the profile ID and version last known.

## Requirements

### Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | The platform MUST support event-driven pipeline triggers. The minimum viable trigger types are: corpus-change and manual-request. | P1 |
| FR-002 | The platform MUST support schedule-driven pipeline triggers using cron-style expressions. | P2 |
| FR-003 | Every pipeline execution MUST be logged with: trigger reference, start time, end time, steps executed, step outcomes (success/failure/skipped/no-op), output artifact references, and error details for failed steps. | P1 |
| FR-004 | Pipeline steps MUST support configurable retry policies with exponential backoff. The default policy MUST be 3 retries with 30s/60s/120s backoff. | P1 |
| FR-005 | Failed pipeline steps MUST NOT cause previously completed steps to roll back. Pipelines use forward-only execution with pause-on-failure semantics. | P1 |
| FR-006 | Pipelines MUST support human-in-the-loop review gates that pause execution and route artifacts to a tenant's review queue. | P1 |
| FR-007 | Review gate timeouts MUST escalate (not auto-approve). The default timeout MUST be configurable per pipeline (default: 48 hours). | P1 |
| FR-008 | Reviewer rejection feedback MUST be stored as a structured signal linked to the artifact, the profile version used, the pipeline execution, and the rejection reason. | P1 |
| FR-009 | Pipeline configuration MUST reject circular trigger dependencies at creation time. A runtime cycle detector MUST exist as a defensive fallback. | P1 |
| FR-010 | All pipeline data (configurations, executions, artifacts, review decisions) MUST be scoped to the owning tenant. Cross-tenant pipeline access MUST be denied. | P1 |
| FR-011 | The platform MUST provide at least 3 pipeline templates for common workflows. Templates MUST be instantiable with tenant-specific parameters. | P2 |
| FR-012 | Template-derived pipelines MUST be independently editable by the tenant. Template updates MUST NOT propagate to existing instances without tenant consent. | P2 |
| FR-013 | Pipeline execution metrics MUST be tracked and available to the tenant: success rate, execution duration (mean and p95), failure modes, and reviewer approval rate. | P3 |
| FR-014 | Pipeline steps MUST be idempotent. Re-executing a step with the same inputs MUST produce the same outputs without side effects (e.g., duplicate artifacts). | P1 |
| FR-015 | Concurrent pipeline executions for the same tenant MUST be supported. Concurrent executions of the same pipeline definition SHOULD be prevented by default (configurable). | P1 |

### Non-Functional Requirements

- NFR-001: Pipeline execution MUST initiate within 5 minutes of trigger event.
- NFR-002: Review gate MUST pause execution and route artifacts to review queue within 30 seconds.
- NFR-003: Pipeline execution history MUST be queryable for executions up to 90 days old with sub-second response time.
- NFR-004: Circular dependency detector MUST catch all cycles including indirect cycles of depth 5+.
- NFR-005: A tenant MUST be able to go from template selection to active pipeline in under 10 minutes.

### Key Entities

**Pipeline**
- `pipeline_id`: Unique identifier
- `tenant_id`: Scoping key
- `name`: Human-readable name
- `description`: Purpose description
- `trigger`: Trigger configuration (type + parameters)
- `steps`: Ordered list of step definitions
- `review_gates`: Positions in the step sequence where review gates are inserted
- `retry_policy`: Default retry configuration (overridable per step)
- `concurrency_policy`: `skip_if_running | queue | allow_concurrent`
- `status`: `active | paused | disabled`
- `template_id`: Reference to source template (nullable)
- `created_at`, `updated_at`

**PipelineExecution**
- `execution_id`: Unique identifier
- `pipeline_id`: Reference to pipeline
- `tenant_id`: Scoping key
- `trigger_event`: Reference to the event that triggered execution
- `status`: `running | paused_at_gate | paused_on_failure | completed | failed | cancelled`
- `steps_completed`: Count of successfully completed steps
- `steps_total`: Total steps in the pipeline
- `started_at`, `completed_at`
- `output_artifacts`: References to produced artifacts

**PipelineStep**
- `step_id`: Unique within pipeline
- `step_type`: `profile_generation | fidelity_check | content_generation | source_query | review_gate | notification | custom`
- `input_refs`: References to upstream step outputs or trigger payload
- `output_refs`: References to produced artifacts
- `retry_policy_override`: Step-specific retry configuration (nullable)
- `status`: `pending | running | completed | failed | skipped | no_op`
- `attempts`: Number of execution attempts
- `error_detail`: Structured error information (nullable)

**ReviewDecision**
- `decision_id`: Unique identifier
- `execution_id`: Reference to pipeline execution
- `step_id`: Reference to the review gate step
- `artifact_ref`: Reference to the artifact under review
- `reviewer_id`: Identity of the reviewer
- `decision`: `approved | rejected`
- `feedback`: Structured rejection reason (nullable)
- `decided_at`: Timestamp

**TriggerEvent**
- `event_id`: Unique identifier
- `tenant_id`: Scoping key
- `event_type`: `corpus_change | schedule_tick | manual_request | external_webhook`
- `payload`: Event-specific data (e.g., changed document IDs, schedule reference)
- `received_at`: Timestamp
- `pipelines_triggered`: List of pipeline IDs that executed in response

## Success Criteria

| ID | Criterion | Target |
|---|---|---|
| SC-001 | Pipeline execution initiated within target latency of trigger event | <= 5 min |
| SC-002 | Pipeline step retry policy executes correctly across 100 simulated failure scenarios | 100% correct |
| SC-003 | Review gate pauses execution and routes artifacts to review queue within target latency | <= 30s |
| SC-004 | Circular dependency detector catches all cycles in a test suite of 50 pipeline configurations (including indirect cycles of depth 5+) | 100% detected |
| SC-005 | Pipeline execution history is queryable for executions up to 90 days old with sub-second response time | <= 1s query |
| SC-006 | A tenant can go from template selection to active pipeline within target time (including parameter configuration) | <= 10 min |
| SC-007 | Pipeline analytics accurately reflect execution outcomes within 5 minutes of execution completion | <= 5 min staleness |

## Assumptions

- The event bus for trigger delivery exists or will be built as part of the Core Orchestrator (WP07). This spec defines the pipeline consumer, not the event infrastructure.
- Pipeline steps operate on platform-managed content and profiles (Specs 005, 006, 008). Custom steps that call external APIs are out of scope for this spec but the step interface should not preclude them.
- Review queues are a platform-level concept shared across features. This spec defines how pipelines interact with review queues, not the review queue implementation itself.
- Tenant entitlements (Spec 006) govern which pipeline features are available per tier (e.g., scheduled triggers may be an enterprise-tier feature).
- Async event bus with delivery guarantee (resolved from Open Question #1).

## References

- Spec 005: Content Intelligence — generation, attribution, drift detection
- Spec 006: Content Infrastructure — content sources, entitlements, content state
- Spec 007: Org-Scale Agentic Governance — governance gates, maturity scoring
- Spec 008: Profile Isolation and Scale — profile versioning, tenant scoping, regeneration triggers
- Constitution §2.7: Automated Pipelines — requires human review gates for external content
- Constitution §2.4: Monitor Everything — observability requirements for pipeline execution
- Constitution §2.5: Feedback Loops — rejection signals as quality improvement inputs
- ADR-0002: Leash Multi-Tenancy — tenant isolation model
