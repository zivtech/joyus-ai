---
work_package_id: WP05
title: Built-in Step Handlers
lane: "done"
dependencies: []
base_branch: main
base_commit: 3fcac60575d816c1ee481fe80b0df29082a9082a
created_at: '2026-03-16T18:19:02.497164+00:00'
subtasks: [T024, T025, T026, T027, T028, T029]
phase: Phase C - Execution Engine
assignee: ''
agent: ''
shell_pid: "35212"
review_status: "approved"
reviewed_by: "Alex Urevick-Ackelsberg"
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP05: Built-in Step Handlers

## Objective

Implement the `PipelineStepHandler` interface and all 6 built-in step type handlers that integrate with platform capabilities. Each handler encapsulates the logic for one step type (profile generation, fidelity check, content generation, source query, notification) and returns structured results that the step runner can process.

## Implementation Command

```bash
spec-kitty implement WP05 --base WP04
```

## Context

- **Spec**: `kitty-specs/009-automated-pipelines-framework/spec.md` (FR-001, FR-014: idempotent steps)
- **Plan**: `kitty-specs/009-automated-pipelines-framework/plan.md` (WP-07: Built-in step handlers)
- **Research**: `kitty-specs/009-automated-pipelines-framework/research.md` (R3: error classification, R7: idempotency)

Step handlers are the pipeline framework's integration points with the rest of the platform. Each handler knows how to invoke a specific platform capability (profile engine, content infrastructure, etc.) and translate the result into the step runner's `StepResult` format.

**Key design decisions**:
- Step handlers depend on platform services via interfaces (dependency injection), not direct imports
- Handlers classify their own errors as transient or non-transient (the step runner trusts this classification)
- Handlers support idempotency: they check for existing output before performing work
- The `review_gate` step type is NOT a handler — it is handled directly by the executor/review gate module (WP06)

**Platform integration points**:
- `profile_generation`: Spec 008 (Profile Isolation and Scale) — profile engine regeneration
- `fidelity_check`: Spec 005 (Content Intelligence) — attribution scoring
- `content_generation`: Spec 006 (Content Infrastructure) — content-aware generation via mediation
- `source_query`: Spec 006 (Content Infrastructure) — content source querying
- `notification`: Existing `src/scheduler/notifications.ts` — notification delivery

---

## Subtask T024: Define PipelineStepHandler Interface and StepResult Type

**Purpose**: Define the contract that all step handlers must implement.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/steps/interface.ts`
2. Define the `PipelineStepHandler` interface:
   ```typescript
   export interface PipelineStepHandler {
     /** The step type this handler processes. */
     readonly stepType: StepType;

     /**
      * Execute the step with the given configuration and context.
      * Returns a StepResult indicating success, failure, or no-op.
      */
     execute(
       config: Record<string, unknown>,
       context: ExecutionContext,
     ): Promise<StepResult>;

     /**
      * Validate step configuration at pipeline creation time.
      * Returns validation errors if config is invalid.
      */
     validateConfig(config: Record<string, unknown>): string[];
   }
   ```
3. Re-export `StepResult` and `StepError` from `../types.js` (defined in WP01 T002)
4. Define `StepHandlerDependencies` — services that handlers may need:
   ```typescript
   export interface StepHandlerDependencies {
     db: DrizzleClient;
     profileEngine?: ProfileEngineClient;      // Spec 008 interface
     contentIntelligence?: ContentIntelClient;  // Spec 005 interface
     contentInfrastructure?: ContentInfraClient; // Spec 006 interface
     notificationService?: NotificationService;  // Existing scheduler service
   }
   ```
5. Define lightweight client interfaces for each dependency (these are the contract, not the implementation):
   ```typescript
   export interface ProfileEngineClient {
     regenerateProfile(tenantId: string, profileId: string, options?: Record<string, unknown>): Promise<{ profileId: string; version: string; metadata: Record<string, unknown> }>;
   }

   export interface ContentIntelClient {
     runFidelityCheck(tenantId: string, profileId: string, contentIds: string[]): Promise<{ score: number; details: Record<string, unknown> }>;
   }

   export interface ContentInfraClient {
     generateContent(tenantId: string, prompt: string, profileId?: string, sourceIds?: string[]): Promise<{ text: string; citations: unknown[]; metadata: Record<string, unknown> }>;
     querySource(tenantId: string, query: string, sourceIds?: string[], limit?: number): Promise<{ items: unknown[]; totalCount: number }>;
   }

   export interface NotificationService {
     send(channel: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
   }
   ```

**Files**:
- `joyus-ai-mcp-server/src/pipelines/steps/interface.ts` (new, ~80 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] All interfaces are importable
- [ ] Dependency interfaces are minimal (only what step handlers need)

---

## Subtask T025: Implement Profile Generation Step Handler

**Purpose**: Invoke the profile engine to regenerate profiles when triggered by a pipeline.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/steps/profile-generation.ts`
2. Implement `ProfileGenerationHandler` class implementing `PipelineStepHandler`:
3. **stepType**: `'profile_generation'`
4. **validateConfig(config)**:
   - Must have `profileIds: string[]` (non-empty array) OR `regenerateAll: boolean`
   - Optional: `options: Record<string, unknown>` (passed through to profile engine)
   - Return errors array (empty if valid)
5. **execute(config, context)**:
   - Extract profileIds from config (or load all tenant profiles if `regenerateAll`)
   - For each profileId:
     - Call `profileEngine.regenerateProfile(context.tenantId, profileId, config.options)`
     - Collect results (new version IDs)
   - If profileEngine dependency is not available: return error with `isTransient: false`, message explaining the dependency is not configured
   - Return success with `outputData: { regeneratedProfiles: [{ profileId, version, metadata }] }`
   - On network/timeout error: return error with `isTransient: true`
   - On auth/config error: return error with `isTransient: false`

**Important implementation details**:
- The profile engine client is injected via `StepHandlerDependencies`. If not provided, the handler fails with a clear non-transient error — it does not attempt to import or construct the engine directly.
- Each profile regeneration is independent — if one fails, others can still succeed. Collect partial results and report them in the output.
- The output includes version references that downstream steps (fidelity check) can use via input_refs.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/steps/profile-generation.ts` (new, ~80 lines)

**Validation**:
- [ ] Validates config correctly (profileIds required)
- [ ] Calls profile engine for each profile
- [ ] Returns structured output with version references
- [ ] Classifies errors correctly (network = transient, config = non-transient)
- [ ] Handles missing dependency gracefully

---

## Subtask T026: Implement Fidelity Check Step Handler

**Purpose**: Run attribution scoring against content using the content intelligence service.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/steps/fidelity-check.ts`
2. Implement `FidelityCheckHandler` class implementing `PipelineStepHandler`:
3. **stepType**: `'fidelity_check'`
4. **validateConfig(config)**:
   - Must have `profileId: string`
   - Must have `contentIds: string[]` (non-empty) OR `useUpstreamOutputs: boolean` (resolves from previous step outputs via input_refs)
   - Optional: `threshold: number` (minimum fidelity score, default 0.7)
   - Return errors array
5. **execute(config, context)**:
   - Resolve contentIds from config or from previous step outputs (via `context.previousStepOutputs`)
   - Call `contentIntelligence.runFidelityCheck(context.tenantId, config.profileId, contentIds)`
   - If score >= threshold: return success with `outputData: { score, details, passed: true }`
   - If score < threshold: return success with `outputData: { score, details, passed: false }` (NOT a failure — the check ran successfully, the score was low)
   - If contentIntelligence dependency not available: return non-transient error
   - On network errors: return transient error

**Important implementation details**:
- A low fidelity score is NOT a step failure — the step executed successfully and returned a result. Downstream steps or review gates should use the score to decide next action.
- The `useUpstreamOutputs` pattern resolves content IDs from the `previousStepOutputs` map, using the step's `inputRefs` to identify which upstream step and which field to read.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/steps/fidelity-check.ts` (new, ~70 lines)

**Validation**:
- [ ] Validates config correctly
- [ ] Calls content intelligence service with correct params
- [ ] Low score is success (not failure)
- [ ] Resolves content IDs from upstream outputs when configured
- [ ] Handles missing dependency gracefully

---

## Subtask T027: Implement Content Generation Step Handler

**Purpose**: Generate content using the content infrastructure's mediation layer.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/steps/content-generation.ts`
2. Implement `ContentGenerationHandler` class implementing `PipelineStepHandler`:
3. **stepType**: `'content_generation'`
4. **validateConfig(config)**:
   - Must have `prompt: string` (the generation prompt/template)
   - Optional: `profileId: string` (voice profile to apply)
   - Optional: `sourceIds: string[]` (content sources to draw from)
   - Optional: `maxSources: number` (default 5)
   - Return errors array
5. **execute(config, context)**:
   - Call `contentInfrastructure.generateContent(context.tenantId, config.prompt, config.profileId, config.sourceIds)`
   - Return success with `outputData: { text, citations, metadata, artifactRef: { type: 'generated_content', id: <generated>, metadata } }`
   - The artifactRef enables downstream review gates to reference this output
   - On network errors: return transient error
   - On invalid config: return non-transient error

**Important implementation details**:
- Content generation goes through the platform's mediation layer (Spec 006) — the handler does NOT call AI models directly (Constitution §2.6)
- The prompt field may contain template variables that reference trigger payload or upstream outputs. For MVP, pass the prompt as-is; template variable resolution can be added later.
- Generated content produces an artifact reference that review gates use to identify what needs review.

**Files**:
- `joyus-ai-mcp-server/src/pipelines/steps/content-generation.ts` (new, ~70 lines)

**Validation**:
- [ ] Validates config correctly (prompt required)
- [ ] Calls content infrastructure's generate method
- [ ] Returns artifact reference in output
- [ ] Classifies errors correctly
- [ ] Handles missing dependency gracefully

---

## Subtask T028: Implement Source Query and Notification Step Handlers

**Purpose**: Implement the two remaining built-in step handlers: source querying and notification delivery.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/steps/source-query.ts`
2. Implement `SourceQueryHandler` class:
   - **stepType**: `'source_query'`
   - **validateConfig**: Must have `query: string`. Optional: `sourceIds: string[]`, `limit: number` (default 20)
   - **execute**: Call `contentInfrastructure.querySource(...)`, return items in outputData
   - Query results are used by downstream steps (content generation can reference them)
3. Create `joyus-ai-mcp-server/src/pipelines/steps/notification.ts`
4. Implement `NotificationHandler` class:
   - **stepType**: `'notification'`
   - **validateConfig**: Must have `channel: string` (notification channel identifier) and `message: string` (message template)
   - **execute**: Call `notificationService.send(channel, message, context)` — reuses existing notification infrastructure from `src/scheduler/notifications.ts`
   - The message can include template variables: `{pipelineName}`, `{executionId}`, `{status}` — resolve from context
   - Notification delivery errors: classify network issues as transient, invalid channel as non-transient
   - Notification is naturally idempotent if the service checks for duplicate deliveries by idempotency key

**Files**:
- `joyus-ai-mcp-server/src/pipelines/steps/source-query.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/src/pipelines/steps/notification.ts` (new, ~60 lines)

**Validation**:
- [ ] SourceQueryHandler queries content sources correctly
- [ ] NotificationHandler sends via notification service
- [ ] Both validate config and classify errors
- [ ] Both handle missing dependencies gracefully

---

## Subtask T029: Create Step Type Registry and Barrel Export

**Purpose**: Map step type strings to their handler implementations and provide module exports.

**Steps**:
1. Create `joyus-ai-mcp-server/src/pipelines/steps/registry.ts`
2. Implement `StepRegistry` class that implements `StepHandlerRegistry` (interface from WP04 T019):
   ```typescript
   export class StepRegistry implements StepHandlerRegistry {
     private handlers = new Map<StepType, PipelineStepHandler>();

     register(handler: PipelineStepHandler): void {
       this.handlers.set(handler.stepType, handler);
     }

     getHandler(stepType: StepType): PipelineStepHandler | undefined {
       return this.handlers.get(stepType);
     }

     getRegisteredTypes(): StepType[] {
       return Array.from(this.handlers.keys());
     }

     validateStepConfig(stepType: StepType, config: Record<string, unknown>): string[] {
       const handler = this.getHandler(stepType);
       if (!handler) return [`Unknown step type: ${stepType}`];
       return handler.validateConfig(config);
     }
   }
   ```
3. Export a factory function:
   ```typescript
   export function createStepRegistry(deps: StepHandlerDependencies): StepRegistry {
     const registry = new StepRegistry();
     registry.register(new ProfileGenerationHandler(deps));
     registry.register(new FidelityCheckHandler(deps));
     registry.register(new ContentGenerationHandler(deps));
     registry.register(new SourceQueryHandler(deps));
     registry.register(new NotificationHandler(deps));
     // Note: review_gate is NOT a handler — it's handled by the executor
     return registry;
   }
   ```
4. Create `joyus-ai-mcp-server/src/pipelines/steps/index.ts` — barrel export:
   ```typescript
   export type { PipelineStepHandler, StepHandlerDependencies } from './interface.js';
   export { StepRegistry, createStepRegistry } from './registry.js';
   export { ProfileGenerationHandler } from './profile-generation.js';
   export { FidelityCheckHandler } from './fidelity-check.js';
   export { ContentGenerationHandler } from './content-generation.js';
   export { SourceQueryHandler } from './source-query.js';
   export { NotificationHandler } from './notification.js';
   ```
5. Update `src/pipelines/index.ts` to export from steps module

**Files**:
- `joyus-ai-mcp-server/src/pipelines/steps/registry.ts` (new, ~50 lines)
- `joyus-ai-mcp-server/src/pipelines/steps/index.ts` (new, ~15 lines)
- `joyus-ai-mcp-server/src/pipelines/index.ts` (modify — add steps export)

**Validation**:
- [ ] Registry maps all 5 step types to handlers
- [ ] getHandler returns undefined for unknown types (including 'review_gate')
- [ ] validateStepConfig delegates to correct handler
- [ ] Factory creates registry with all handlers
- [ ] `npm run typecheck` passes

---

## Definition of Done

- [ ] `PipelineStepHandler` interface defined with execute and validateConfig methods
- [ ] All 5 step handlers implemented: profile_generation, fidelity_check, content_generation, source_query, notification
- [ ] All handlers classify errors as transient/non-transient
- [ ] All handlers validate their config at pipeline creation time
- [ ] All handlers handle missing dependencies gracefully (non-transient error)
- [ ] Step registry maps types to handlers
- [ ] Platform service interfaces defined (not implementations — dependency injection)
- [ ] Barrel exports in place
- [ ] `npm run validate` passes with zero errors

## Risks

- **Platform service availability**: Step handlers depend on services from other specs (005, 006, 008) that may not be fully implemented. Mitigation: handlers use injected interfaces. If the dependency is not provided, the handler returns a non-transient error with a clear message.
- **Error classification accuracy**: Incorrectly classifying a non-transient error as transient wastes retry budget. Mitigation: default to non-transient for unknown errors; only classify specific known-transient patterns (network timeout, rate limit, 503) as transient.

## Reviewer Guidance

- Verify all handlers accept dependencies via constructor injection (not direct imports of platform services)
- Check that `review_gate` is NOT registered in the step registry (it is handled by the executor/review module)
- Verify error classification: network/timeout = transient, config/auth = non-transient
- Confirm fidelity_check: a low score is a successful result, not a failure
- Verify notification handler message template variable resolution
- Check that all handlers have meaningful validateConfig implementations (not just empty arrays)
- Verify StepHandlerDependencies interfaces are minimal and match what each handler actually uses

## Activity Log
- 2026-03-16T18:33:50Z – unknown – shell_pid=35212 – lane=done – 5 step handlers, registry, 31 tests, tsc clean.
