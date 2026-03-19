---
work_package_id: WP06
title: Review Gates
lane: "done"
dependencies: []
base_branch: main
base_commit: 2faf56cb1a73cd0f0bd607f652f2ad5ca78a6df0
created_at: '2026-03-16T18:19:05.821929+00:00'
subtasks: [T030, T031, T032, T033, T034, T035]
phase: Phase D - Review Gates & Scheduling
assignee: "Claude"
agent: "claude-sonnet"
shell_pid: "35709"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP06: Review Gates

## Objective

Build the human-in-the-loop review gate mechanism. When a pipeline reaches a `review_gate` step, execution pauses, pending artifacts are routed to the tenant's review queue, and the pipeline resumes only when all review decisions are submitted. Rejected artifacts include structured feedback. Gates that exceed their timeout are escalated, never auto-approved.

## Implementation Command

```bash
spec-kitty implement WP06 --base WP04
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-006: review gates, FR-007: escalation, FR-008: rejection feedback)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md` (R5: Review Queue Integration)
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (ReviewDecision table, PipelineExecution state transitions)

Review gates are the platform's mechanism for human oversight of automated content production (Constitution §2.7). The pipeline framework defines how pipelines interact with review queues — the review queue UI itself is out of scope.

**Key design decisions from research.md (R5)**:
- Pipeline pauses with `paused_at_gate` status when it hits a review_gate step
- One ReviewDecision row per artifact per gate (not one per execution)
- Resumption is triggered when all decisions for a gate are submitted
- Rejected artifacts are removed from the forward path; approved artifacts continue
- Escalation checks run hourly via cron; never auto-approve or auto-reject
- Escalation is configurable per pipeline (default: 48 hours, escalate to admin)

---

## Subtask T030: Implement ReviewGate — Pause Execution and Create Decisions

**Purpose**: When the executor encounters a review_gate step, pause the pipeline and create pending review decision records for each artifact.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/review/gate.ts`
2. Implement `ReviewGate` class:
   ```typescript
   export class ReviewGate {
     constructor(private db: DrizzleClient) {}

     /**
      * Pause a pipeline execution at a review gate step.
      * Creates ReviewDecision rows for each artifact requiring review.
      * Returns the created decision IDs.
      */
     async pauseAtGate(
       execution: PipelineExecution,
       gateStep: ExecutionStep,
       artifacts: ArtifactRef[],
       profileVersionRef?: string,
     ): Promise<string[]>;
   }
   ```
3. **pauseAtGate(execution, gateStep, artifacts, profileVersionRef)**:
   - For each artifact in the artifacts array:
     - INSERT into `review_decisions` table:
       - executionId = execution.id
       - executionStepId = gateStep.id
       - tenantId = execution.tenantId
       - artifactRef = artifact (jsonb)
       - profileVersionRef = profileVersionRef (from upstream profile generation step)
       - status = 'pending'
     - Collect the created decision IDs
   - Update the execution_step (gateStep) status to `running` (it stays running while awaiting review)
   - Update the pipeline_execution status to `paused_at_gate`
   - Update the pipeline_execution `currentStepPosition` to the gate step's position
   - Return the decision IDs
4. The executor (WP04 T018) calls this method when it encounters a `review_gate` step type, then breaks its step loop (stops processing further steps)

**Artifact resolution**: The gate step's config specifies which upstream steps' outputs are artifacts for review. The executor resolves these from `previousStepOutputs` using the gate step's `inputRefs`. If `inputRefs` is empty, all outputs from immediately preceding steps are treated as artifacts.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/review/gate.ts` (new, ~80 lines)

**Validation**:
- [ ] Creates one ReviewDecision row per artifact
- [ ] Sets execution status to `paused_at_gate`
- [ ] Sets execution_step status to `running`
- [ ] Returns correct decision IDs
- [ ] Handles zero artifacts gracefully (skip gate, continue pipeline)

---

## Subtask T031: Implement Decision Recording and Pipeline Resumption

**Purpose**: Record reviewer decisions (approve/reject) and resume the pipeline when all decisions for a gate are complete.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/review/decision.ts`
2. Implement `DecisionRecorder` class:
   ```typescript
   export class DecisionRecorder {
     constructor(private db: DrizzleClient) {}

     /**
      * Record a single review decision.
      * If all decisions for this gate are complete, triggers pipeline resumption.
      */
     async recordDecision(
       decisionId: string,
       tenantId: string,
       status: 'approved' | 'rejected',
       reviewerId: string,
       feedback?: ReviewFeedback,
     ): Promise<{ allDecisionsComplete: boolean; executionId: string }>;

     /**
      * Check if all decisions for a given gate step are complete.
      */
     async areAllDecisionsComplete(executionId: string, executionStepId: string): Promise<boolean>;

     /**
      * Resume a pipeline execution after all review decisions are submitted.
      */
     async resumeExecution(executionId: string): Promise<void>;
   }
   ```
3. **recordDecision(decisionId, tenantId, status, reviewerId, feedback)**:
   - Load the ReviewDecision by ID
   - Verify it belongs to the specified tenant (tenant isolation)
   - Verify its current status is `pending` (reject duplicate decisions)
   - Update the row: status, reviewerId, decidedAt = now(), feedback (if rejected)
   - Check if all decisions for this gate are complete (call areAllDecisionsComplete)
   - If all complete: call resumeExecution
   - Return `{ allDecisionsComplete, executionId }`
4. **areAllDecisionsComplete(executionId, executionStepId)**:
   - Query review_decisions WHERE executionId AND executionStepId
   - Return true if ALL rows have status != 'pending'
5. **resumeExecution(executionId)**:
   - Load the pipeline_execution
   - Partition review decisions into approved and rejected sets
   - Update the execution's context: downstream steps should only process approved artifacts
   - Store rejected artifact references and feedback in the execution's `outputArtifacts` or a separate field for downstream reference
   - Update execution_step (the gate step) status to `completed`, set completedAt
   - Update pipeline_execution status from `paused_at_gate` to `running`
   - The executor will pick up this execution on its next poll cycle and continue from the next step

**Important implementation details**:
- Resumption does NOT re-run the step runner. It simply changes the execution status back to `running`. The executor's poll loop detects this and continues from `currentStepPosition + 1`.
- The executor needs to support resuming: on finding an execution with status `running` and `currentStepPosition > 0`, it should continue from that position rather than starting over.
- If ALL artifacts at a gate are rejected, the pipeline may need to handle the "no artifacts to forward" case. The next step receives an empty artifact set and can decide to be a no-op.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/review/decision.ts` (new, ~120 lines)

**Validation**:
- [ ] Records decision with correct status, reviewer, feedback, timestamp
- [ ] Verifies tenant isolation (rejects cross-tenant decisions)
- [ ] Rejects duplicate decisions on the same review_decision row
- [ ] Detects when all decisions are complete
- [ ] Resumes execution by changing status from paused_at_gate to running
- [ ] Partitions artifacts into approved/rejected sets

---

## Subtask T032: Implement Structured Rejection Feedback and Artifact Path Filtering

**Purpose**: Store rejection feedback as structured signals and ensure rejected artifacts are excluded from downstream steps.

**Steps**:
1. In `decision.ts`, enhance the resumeExecution logic:
2. When partitioning decisions:
   - Approved artifacts: extract artifact references, add to execution context for downstream
   - Rejected artifacts: extract artifact references + feedback, store as structured signals
3. Structured rejection signal shape (stored in ReviewDecision.feedback jsonb):
   ```typescript
   {
     reason: string;            // Human-readable rejection reason
     category: string;          // e.g., 'accuracy', 'tone', 'compliance', 'formatting', 'other'
     details?: string;          // Optional detailed explanation
     suggestedAction?: string;  // What to do differently (e.g., "Adjust tone parameters")
   }
   ```
4. Update execution context for downstream steps:
   - Add a `reviewGateResults` field to the execution's output that downstream steps can reference:
     ```typescript
     {
       gateStepPosition: number;
       approvedArtifacts: ArtifactRef[];
       rejectedArtifacts: Array<{ artifact: ArtifactRef; feedback: ReviewFeedback }>;
       approvalRate: number; // 0.0-1.0
     }
     ```
5. Downstream steps that consume artifacts via input_refs should only receive approved artifacts. The step runner resolves input_refs from `previousStepOutputs`, which is updated after the gate to only include approved items.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/review/decision.ts` (extend from T031, ~30 additional lines)

**Validation**:
- [ ] Rejection feedback is stored with correct structure (reason, category, details, suggestedAction)
- [ ] Downstream steps receive only approved artifacts
- [ ] reviewGateResults includes both approved and rejected lists
- [ ] Approval rate is computed correctly

---

## Subtask T033: Implement Timeout Escalation Logic

**Purpose**: Detect review gates that have exceeded their timeout and escalate to secondary reviewers or admin notification.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/review/escalation.ts`
2. Implement `EscalationChecker` class:
   ```typescript
   export class EscalationChecker {
     constructor(private db: DrizzleClient, private notificationService?: NotificationService) {}

     /**
      * Check all paused_at_gate executions for timeout violations.
      * Called by the escalation cron job.
      */
     async checkAndEscalate(): Promise<EscalationResult[]>;
   }
   ```
3. **checkAndEscalate()**:
   - Query pipeline_executions WHERE status = 'paused_at_gate'
   - For each paused execution:
     - Load the parent pipeline to get `reviewGateTimeoutHours`
     - Find the gate step (execution_step with status = 'running' and step type = 'review_gate')
     - Compute time since gate was entered (gateStep.startedAt or execution.updatedAt)
     - If elapsed time > reviewGateTimeoutHours:
       - Check if already escalated (review_decisions have escalatedAt set) — skip if so
       - Update review_decisions for this gate: set escalatedAt = now()
       - Send escalation notification:
         - Message includes: pipeline name, execution ID, gate step name, time waiting, number of pending decisions
         - Recipient: tenant admin (or configurable escalation path in pipeline config)
       - Log escalation event
       - Return escalation result for this execution
   - NEVER auto-approve or auto-reject (Constitution §3.3: tenant retains approval authority)
4. Define `EscalationResult`:
   ```typescript
   export interface EscalationResult {
     executionId: string;
     pipelineId: string;
     tenantId: string;
     gateStepName: string;
     hoursWaiting: number;
     pendingDecisionCount: number;
     escalatedTo: string;
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/review/escalation.ts` (new, ~100 lines)

**Validation**:
- [ ] Identifies paused executions past timeout
- [ ] Does NOT auto-approve or auto-reject
- [ ] Updates escalatedAt on review_decisions
- [ ] Sends escalation notification
- [ ] Skips already-escalated gates
- [ ] Handles missing notification service gracefully (logs warning, still marks escalated)

---

## Subtask T034: Create Escalation Cron Job and Barrel Export

**Purpose**: Set up the hourly cron job that runs escalation checks and provide module exports.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/review/index.ts`
2. Implement cron job setup:
   ```typescript
   import cron from 'node-cron';
   import { EscalationChecker } from './escalation.js';

   let escalationJob: cron.ScheduledTask | null = null;

   export function startEscalationJob(checker: EscalationChecker): void {
     // Run every hour (ESCALATION_CHECK_INTERVAL_CRON from types.ts)
     escalationJob = cron.schedule('0 * * * *', async () => {
       try {
         const results = await checker.checkAndEscalate();
         if (results.length > 0) {
           console.log(`[pipelines] Escalated ${results.length} review gates`);
         }
       } catch (error) {
         console.error('[pipelines] Escalation check failed:', error);
       }
     });
   }

   export function stopEscalationJob(): void {
     if (escalationJob) {
       escalationJob.stop();
       escalationJob = null;
     }
   }
   ```
3. Re-export all review module types and classes:
   ```typescript
   export { ReviewGate } from './gate.js';
   export { DecisionRecorder } from './decision.js';
   export { EscalationChecker } from './escalation.js';
   export type { EscalationResult } from './escalation.js';
   ```
4. Update `src/pipelines/index.ts` to export from review module

**Files**:
- `joyus-ai-mcp-server/src/pipelines/review/index.ts` (new, ~35 lines)
- `joyus-ai-mcp-server/src/pipelines/index.ts` (modify — add review export)

**Validation**:
- [ ] Cron job starts and runs hourly
- [ ] Cron job stops cleanly on shutdown
- [ ] All review exports accessible
- [ ] `npm run typecheck` passes

---

## Subtask T035: Unit Tests for Review Gate, Decision, and Escalation

**Purpose**: Verify correctness of the complete review gate lifecycle.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/review/gate.test.ts`
2. Gate test cases:
   - **Pause with artifacts**: 3 artifacts, creates 3 ReviewDecision rows, execution status = paused_at_gate
   - **Pause with zero artifacts**: Gate with no upstream artifacts, pipeline skips gate and continues
   - **Execution state**: Verify execution.currentStepPosition and execution_step.status are set correctly
3. Create `joyus-ai-mcp-server/tests/pipelines/review/escalation.test.ts`
4. Decision test cases (can be in gate.test.ts or separate):
   - **Approve single artifact**: Decision recorded, feedback null, decidedAt set
   - **Reject with feedback**: Decision recorded with structured feedback
   - **All approved resume**: 3 decisions all approved, pipeline resumes (status = running)
   - **Mixed decisions resume**: 2 approved, 1 rejected, pipeline resumes with only approved artifacts in context
   - **All rejected resume**: 3 decisions all rejected, pipeline resumes with empty artifact set
   - **Partial decisions no resume**: 2 of 3 decided, pipeline stays paused
   - **Duplicate decision rejected**: Attempt to decide on already-decided row, returns error
   - **Cross-tenant rejected**: Attempt to decide with wrong tenantId, returns error
5. Escalation test cases:
   - **Within timeout no escalation**: Gate paused 24h ago, timeout = 48h, no escalation
   - **Past timeout escalates**: Gate paused 50h ago, timeout = 48h, escalation triggered
   - **Already escalated skipped**: Gate already has escalatedAt set, not escalated again
   - **Never auto-approves**: After escalation, review_decisions still have status = pending
   - **Notification sent**: Verify notification service called with correct message on escalation

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/review/gate.test.ts` (new, ~200 lines)
- `joyus-ai-mcp-server/tests/pipelines/review/escalation.test.ts` (new, ~150 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] Tests cover full lifecycle: pause -> decide -> resume
- [ ] Tests verify tenant isolation and duplicate prevention
- [ ] Escalation tests verify no auto-approval/auto-rejection

---

## Definition of Done

- [ ] ReviewGate pauses execution and creates decision rows for each artifact
- [ ] DecisionRecorder records approve/reject, resumes when all decisions complete
- [ ] Rejected artifacts include structured feedback (reason, category, details, suggestedAction)
- [ ] Downstream steps receive only approved artifacts after gate resumption
- [ ] EscalationChecker detects timed-out gates and sends notifications
- [ ] Escalation NEVER auto-approves or auto-rejects (Constitution §3.3)
- [ ] Escalation cron job runs hourly
- [ ] WP04 executor updated to call ReviewGate instead of placeholder
- [ ] Unit tests cover all paths
- [ ] `npm run validate` passes with zero errors

## Risks

- **Executor resume logic**: The executor must be updated to detect `running` executions with `currentStepPosition > 0` and continue from that position. This is a cross-WP change (WP04 executor needs a resume path).
- **Partial approval complexity**: When some artifacts are approved and some rejected, downstream steps must handle a reduced artifact set. If all are rejected, the step may receive an empty set.
- **Escalation notification delivery**: If the notification service is unavailable, escalation should still update the `escalatedAt` timestamp. Don't let notification failure prevent the escalation record.

## Reviewer Guidance

- Verify ReviewGate creates exactly one ReviewDecision per artifact (not per execution)
- Check that decision recording verifies tenant isolation before updating
- Verify that resumeExecution partitions artifacts correctly and updates execution context
- Confirm escalation checks: `hoursElapsed > timeoutHours` (not `>=`)
- Verify escalation sets `escalatedAt` even if notification fails
- Confirm no code path can auto-approve or auto-reject
- Check that the cron job handles errors without crashing (try/catch in the cron callback)
- Verify executor integration: WP04's review_gate placeholder must be replaced with actual ReviewGate call

## Activity Log
- 2026-03-16T18:34:13Z – unknown – shell_pid=35709 – lane=done – ReviewGate, DecisionRecorder, EscalationChecker, cron, 14 tests.
