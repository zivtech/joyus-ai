---
work_package_id: WP04
title: Pipeline Executor
lane: done
dependencies: []
base_branch: main
base_commit: cbcb9e6e95036ceb0c9db29cb5e6dca45ed6f9c9
created_at: '2026-03-16T18:03:27.985487+00:00'
subtasks: [T018, T019, T020, T021, T022, T023]
phase: Phase C - Execution Engine
assignee: ''
agent: ''
shell_pid: '15023'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP04: Pipeline Executor

## Objective

Build the core pipeline execution engine: a PipelineExecutor that polls the trigger_events table for pending events, matches them to pipeline definitions, enforces concurrency policies, and runs pipeline steps sequentially via a StepRunner with configurable retry and idempotency support.

## Implementation Command

```bash
spec-kitty implement WP04 --base WP02 --base WP03
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-003: execution logging, FR-004: retry, FR-005: forward-only, FR-014: idempotent, FR-015: concurrency)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md` (R2: Execution Engine, R3: Retry, R7: Idempotency)
- **Data Model**: `kitty-specs/009-automated-pipelines-framework/data-model.md` (PipelineExecution, ExecutionStep tables)

The executor is the central runtime of the pipeline framework. It is a long-lived worker that runs inside the MCP server process. It consumes events from the event bus (WP02), uses trigger handlers (WP03) to match events to pipelines, and runs matched pipelines step by step.

**Key design decisions**:
- Sequential step execution within a pipeline (spec FR-005: forward-only)
- Parallel execution across pipelines (different pipelines can run concurrently)
- Concurrency policy per pipeline: `skip_if_running` (default), `queue`, `allow_concurrent`
- Step runner handles retry with exponential backoff; executor handles lifecycle transitions
- Idempotency key = SHA-256(executionId:stepId:attemptNumber) per research.md R7

---

## Subtask T018: Implement PipelineExecutor Class

**Purpose**: The central orchestrator that picks up trigger events, matches them to pipelines, creates execution records, and drives step-by-step execution.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/engine/executor.ts`
2. Implement `PipelineExecutor` class:
   ```typescript
   export class PipelineExecutor {
     constructor(
       private db: DrizzleClient,
       private eventBus: EventBus,
       private triggerRegistry: TriggerRegistry,
       private stepRunner: StepRunner,
       private config?: ExecutorConfig,
     ) {}

     async start(): Promise<void>;
     async stop(): Promise<void>;
     async processEvent(event: EventEnvelope): Promise<void>;
     private async executePipeline(pipeline: Pipeline, steps: PipelineStep[], triggerEvent: TriggerEvent, chainDepth: number): Promise<void>;
   }
   ```
3. **start()**:
   - Subscribe to all registered trigger event types on the event bus
   - For each event type, register a handler that calls `processEvent`
   - Start the event bus
4. **stop()**:
   - Stop the event bus
5. **processEvent(event)**:
   - Get the trigger handler from the registry for this event type
   - Call `handler.findMatchingPipelines(event.tenantId, event.payload)` to get matched pipelines
   - Update trigger_event's `pipelinesTriggered` field with matched pipeline IDs
   - For each matched pipeline:
     - Check concurrency policy:
       - `skip_if_running`: Query pipeline_executions for this pipeline with status IN ('pending', 'running', 'paused_at_gate'). If any exist, log skip and continue to next pipeline.
       - `queue`: Allow — the execution will wait its turn (simplified for MVP: just allow concurrent, true queueing deferred)
       - `allow_concurrent`: Always allow
     - Check runtime depth: if `event.triggerChainDepth >= pipeline.maxPipelineDepth`, reject with cycle detection error
     - Call `executePipeline`
   - After all pipelines processed: update trigger_event status to `processed`
6. **executePipeline(pipeline, steps, triggerEvent, chainDepth)**:
   - Create a `pipeline_executions` record: status `pending`, stepsTotal = steps.length, triggerChainDepth = chainDepth
   - Create `execution_steps` records for each step: status `pending`, position from step definition, idempotency key computed
   - Update execution status to `running`
   - Iterate through steps in position order:
     - If step type is `review_gate`: delegate to review gate handler (WP06 — for now, skip with a TODO/placeholder that sets status to `paused_at_gate`)
     - Otherwise: call `stepRunner.runStep(executionStep, pipelineStep, executionContext)`
     - On success: update execution_step status to `completed`, increment stepsCompleted, update outputArtifacts
     - On no-op: update execution_step status to `no_op`, increment stepsCompleted
     - On failure: update execution_step status to `failed`, update execution status to `paused_on_failure`, set errorDetail, break the loop
   - After all steps complete successfully: update execution status to `completed`, set completedAt
   - On unhandled error: update execution status to `failed`, set errorDetail

**Important implementation details**:
- The executor must handle graceful shutdown: track in-progress executions and wait for them to complete (with a timeout) on stop()
- The execution context passed to step runner should include: tenantId, executionId, pipelineId, triggerPayload, outputs from previous steps (for input_refs resolution)
- The `stepsCompleted` counter and `currentStepPosition` must be updated after each step for progress tracking
- Pipeline execution should be wrapped in a try/catch to prevent one pipeline's failure from affecting others

**Files**:
- `joyus-ai-mcp-server/src/pipelines/engine/executor.ts` (new, ~250 lines)

**Validation**:
- [ ] Subscribes to event bus and processes events
- [ ] Matches events to pipelines via trigger handlers
- [ ] Enforces concurrency policy (skip_if_running)
- [ ] Creates execution and execution_step records
- [ ] Runs steps sequentially, updates status after each
- [ ] Handles failure: pauses execution, does not run subsequent steps
- [ ] Handles graceful shutdown

---

## Subtask T019: Implement StepRunner

**Purpose**: Execute a single pipeline step, delegating to the appropriate step handler and managing the retry lifecycle.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/engine/step-runner.ts`
2. Implement `StepRunner` class:
   ```typescript
   export class StepRunner {
     constructor(
       private db: DrizzleClient,
       private stepHandlerRegistry: StepHandlerRegistry, // from WP05 — use interface for now
     ) {}

     async runStep(
       executionStep: ExecutionStep,
       pipelineStep: PipelineStep,
       context: ExecutionContext,
       retryPolicy: RetryPolicy,
     ): Promise<StepResult>;
   }
   ```
3. **runStep(executionStep, pipelineStep, context, retryPolicy)**:
   - Update execution_step status to `running`, set startedAt
   - Look up the step handler by `pipelineStep.stepType` from the registry
   - If handler not found: return failure (non-transient, "Unknown step type")
   - Attempt execution in a retry loop:
     - Compute idempotency key for current attempt
     - Check for existing output with this idempotency key (dedup check via T021)
     - If existing output found: return it as success (no-op replay)
     - Otherwise: call `handler.execute(pipelineStep.config, context)`
     - On success: update execution_step with outputData, status `completed`, set completedAt, return result
     - On error:
       - Classify error as transient or non-transient (from StepResult.error.isTransient)
       - If non-transient: immediately fail (no retry)
       - If transient and attempts < maxRetries: compute backoff delay, wait, increment attempts, retry
       - If transient and retries exhausted: fail
     - Update execution_step `attempts` counter after each attempt
   - On final failure: update execution_step status to `failed`, set errorDetail and completedAt, return failure result
4. Define `ExecutionContext` interface:
   ```typescript
   export interface ExecutionContext {
     tenantId: string;
     executionId: string;
     pipelineId: string;
     triggerPayload: Record<string, unknown>;
     previousStepOutputs: Map<number, Record<string, unknown>>; // position -> output
   }
   ```
5. Define `StepHandlerRegistry` interface (the actual registry is built in WP05):
   ```typescript
   export interface StepHandlerRegistry {
     getHandler(stepType: StepType): PipelineStepHandler | undefined;
   }
   ```

**Important implementation details**:
- The retry policy used is: step's `retryPolicyOverride` if set, otherwise pipeline's `retryPolicy`
- StepRunner does NOT handle review_gate steps — those are handled by the executor directly (WP06)
- The step handler registry interface is defined here but implemented in WP05. For now, tests can use a mock registry.
- Previous step outputs are accumulated by the executor and passed in context for input_refs resolution

**Files**:
- `joyus-ai-mcp-server/src/pipelines/engine/step-runner.ts` (new, ~150 lines)

**Validation**:
- [ ] Delegates to correct step handler by type
- [ ] Retries transient errors up to maxRetries
- [ ] Does NOT retry non-transient errors
- [ ] Computes correct backoff delays
- [ ] Checks idempotency before executing
- [ ] Updates execution_step record after each attempt
- [ ] Returns StepResult with success/failure/no-op

---

## Subtask T020: Implement Retry Policy with Exponential Backoff

**Purpose**: Compute retry delays using exponential backoff with configurable parameters.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/engine/retry.ts`
2. Implement delay computation:
   ```typescript
   /**
    * Compute the delay before the next retry attempt.
    * delay = min(baseDelayMs * backoffMultiplier^attempt, maxDelayMs)
    */
   export function computeRetryDelay(
     attempt: number, // 0-indexed
     policy: RetryPolicy,
   ): number;
   ```
   - Attempt 0: `baseDelayMs` (30s default)
   - Attempt 1: `baseDelayMs * backoffMultiplier` (60s default)
   - Attempt 2: `baseDelayMs * backoffMultiplier^2` (120s default)
   - Cap at `maxDelayMs`
3. Implement retry decision:
   ```typescript
   /**
    * Determine whether a failed step should be retried.
    */
   export function shouldRetry(
     error: StepError,
     currentAttempt: number,
     policy: RetryPolicy,
   ): { retry: boolean; delayMs?: number };
   ```
   - If `error.isTransient === false`: return `{ retry: false }`
   - If `currentAttempt >= policy.maxRetries`: return `{ retry: false }`
   - Otherwise: return `{ retry: true, delayMs: computeRetryDelay(currentAttempt, policy) }`
4. Implement the actual wait function:
   ```typescript
   export function waitForRetry(delayMs: number): Promise<void> {
     return new Promise(resolve => setTimeout(resolve, delayMs));
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/engine/retry.ts` (new, ~50 lines)

**Validation**:
- [ ] Default policy produces 30s, 60s, 120s delays for attempts 0, 1, 2
- [ ] Delays are capped at maxDelayMs
- [ ] Non-transient errors are never retried
- [ ] Exhausted retries return retry: false
- [ ] Custom policies produce correct delays

---

## Subtask T021: Implement Idempotency Key Generation and Dedup

**Purpose**: Ensure pipeline steps are idempotent by generating deterministic keys and checking for existing outputs.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/engine/idempotency.ts`
2. Implement key generation:
   ```typescript
   import { createHash } from 'node:crypto';

   /**
    * Generate a deterministic idempotency key for a step execution attempt.
    * Key = SHA-256(executionId:stepId:attemptNumber)
    */
   export function computeIdempotencyKey(
     executionId: string,
     stepId: string,
     attemptNumber: number,
   ): string {
     return createHash('sha256')
       .update(`${executionId}:${stepId}:${attemptNumber}`)
       .digest('hex');
   }
   ```
3. Implement dedup check:
   ```typescript
   /**
    * Check if a step execution with this idempotency key already has output.
    * Returns the existing output if found, null otherwise.
    */
   export async function checkIdempotency(
     db: DrizzleClient,
     idempotencyKey: string,
   ): Promise<Record<string, unknown> | null>;
   ```
   - Query `execution_steps` WHERE `idempotencyKey = key` AND `status = 'completed'`
   - If found: return the `outputData`
   - If not found: return null
4. The step runner (T019) uses these functions before executing a step: compute key, check dedup, skip if output exists.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/engine/idempotency.ts` (new, ~40 lines)

**Validation**:
- [ ] Same inputs produce same SHA-256 hash
- [ ] Different attempt numbers produce different keys
- [ ] checkIdempotency returns existing output for completed steps
- [ ] checkIdempotency returns null for pending/failed steps

---

## Subtask T022: Create Engine Barrel Export

**Purpose**: Provide barrel exports for the engine module.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/engine/index.ts`
2. Re-export all public types and classes:
   ```typescript
   export { PipelineExecutor } from './executor.js';
   export { StepRunner, ExecutionContext, StepHandlerRegistry } from './step-runner.js';
   export { computeRetryDelay, shouldRetry, waitForRetry } from './retry.js';
   export { computeIdempotencyKey, checkIdempotency } from './idempotency.js';
   ```
3. Update `src/pipelines/index.ts` to export from engine:
   ```typescript
   export * from './engine/index.js';
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/engine/index.ts` (new, ~10 lines)
- `joyus-ai-mcp-server/src/pipelines/index.ts` (modify — add engine export)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All engine exports accessible from `../pipelines/index.js`

---

## Subtask T023: Unit Tests for Executor, Step Runner, and Retry

**Purpose**: Verify the execution engine's correctness across normal, failure, and edge cases.

**Steps**:
1. Create `joyus-ai-mcp-server/tests/pipelines/engine/executor.test.ts`
2. Executor test cases:
   - **Processes event and creates execution**: Publish event, verify pipeline_execution record created with correct fields
   - **Runs steps sequentially**: Pipeline with 3 steps, verify they execute in position order
   - **Concurrency skip_if_running**: Pipeline already has running execution, new event triggers skip (no new execution)
   - **Concurrency allow_concurrent**: Two events for same pipeline, both create executions
   - **Runtime depth rejection**: Event with triggerChainDepth >= maxPipelineDepth, verify execution rejected
   - **Execution completes successfully**: All steps succeed, execution status = `completed`, completedAt set
   - **Execution pauses on failure**: Step 2 of 3 fails after retries, execution status = `paused_on_failure`, step 3 status = `pending` (not skipped)
   - **Review gate placeholder**: Step with type review_gate, verify execution pauses (placeholder for WP06)
3. Create `joyus-ai-mcp-server/tests/pipelines/engine/step-runner.test.ts`
4. Step runner test cases:
   - **Successful step execution**: Handler returns success, execution_step updated to completed
   - **Transient failure with retry**: Handler fails with transient error, retries succeed on attempt 2
   - **Non-transient failure no retry**: Handler fails with non-transient error, no retries attempted
   - **Retries exhausted**: Handler fails 4 times (transient), retry policy maxRetries=3, step fails after 3 retries
   - **Idempotent replay**: Step already has completed output for this key, handler is NOT called, existing output returned
   - **Unknown step type**: Registry returns undefined, step fails with "Unknown step type"
5. Create `joyus-ai-mcp-server/tests/pipelines/engine/retry.test.ts`
6. Retry test cases:
   - **Default backoff**: Attempts 0,1,2 produce 30000, 60000, 120000 ms delays
   - **Max delay cap**: Very high attempt number, delay does not exceed maxDelayMs
   - **Custom policy**: Custom base delay and multiplier produce correct sequence
   - **shouldRetry non-transient**: Returns retry: false for non-transient errors
   - **shouldRetry exhausted**: Returns retry: false when attempts >= maxRetries
   - **shouldRetry transient with budget**: Returns retry: true with correct delay
7. Use mock step handler registry and mock step handlers for executor and step runner tests

**Files**:
- `joyus-ai-mcp-server/tests/pipelines/engine/executor.test.ts` (new, ~250 lines)
- `joyus-ai-mcp-server/tests/pipelines/engine/step-runner.test.ts` (new, ~200 lines)
- `joyus-ai-mcp-server/tests/pipelines/engine/retry.test.ts` (new, ~100 lines)

**Validation**:
- [ ] All tests pass via `npm run test`
- [ ] Tests cover normal execution, failure handling, concurrency, idempotency, and retry

---

## Definition of Done

- [ ] PipelineExecutor processes events from event bus and creates executions
- [ ] StepRunner executes steps with retry and idempotency
- [ ] Retry policy computes correct exponential backoff delays
- [ ] Idempotency keys prevent duplicate step execution
- [ ] Concurrency policy enforcement works (skip_if_running tested)
- [ ] Runtime depth counter rejects deep trigger chains
- [ ] Review gate step type is handled with a placeholder (pauses execution)
- [ ] Unit tests cover all paths
- [ ] `npm run validate` passes with zero errors

## Risks

- **Graceful shutdown**: The executor must wait for in-progress executions before shutting down. Incomplete executions will have status `running` and need manual recovery on restart.
- **Concurrency policy race condition**: Two events arriving simultaneously for a `skip_if_running` pipeline could both pass the check. Mitigation: use a database-level advisory lock or transaction isolation for the check-and-create.
- **Step handler registry not yet available**: WP05 builds the real step handlers. Use mock handlers in tests and the StepHandlerRegistry interface as the contract.

## Reviewer Guidance

- Verify the executor subscribes to the event bus (not polls trigger_events directly — the bus handles polling)
- Check that concurrency policy check queries for ALL non-terminal statuses (pending, running, paused_at_gate)
- Verify execution_step records are created upfront (all at once) before execution starts, not one at a time
- Confirm retry delay computation matches the spec default: 30s, 60s, 120s
- Verify idempotency key uses SHA-256 of the exact format: `executionId:stepId:attemptNumber`
- Check that the executor catches exceptions per-pipeline (one pipeline's failure doesn't crash others)
- Verify the review_gate step type is handled gracefully (placeholder, not error)

## Activity Log
- 2026-03-16T18:17:36Z – unknown – shell_pid=15023 – lane=done – Implementation complete: PipelineExecutor, StepRunner, retry, idempotency. 28 new tests, 174 total, tsc clean.
