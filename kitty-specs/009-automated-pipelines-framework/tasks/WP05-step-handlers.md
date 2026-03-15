---
work_package_id: "WP05"
title: "Built-in Step Handlers"
lane: "planned"
dependencies: ["WP04"]
subtasks: ["T024", "T025", "T026", "T027", "T028", "T029"]
history:
  - date: "2026-03-14"
    action: "created"
    agent: "claude-opus"
---

# WP05: Built-in Step Handlers

**Implementation command**: `spec-kitty implement WP05 --base WP04`
**Target repo**: `joyus-ai`
**Dependencies**: WP04 (Pipeline Executor)
**Priority**: P1 | T025-T028 are independent and can be written in parallel

## Objective

Define the `PipelineStepHandler` interface and implement all 6 built-in step type handlers: profile-generation, fidelity-check, content-generation, source-query, notification, and the review-gate handler. Each handler integrates with a platform capability from Spec 005 (Profile Engine), Spec 006 (Content Infrastructure), or Spec 008.

## Context

The `StepRunner` (WP04, T019) delegates each step to a handler registered in the `StepHandlerRegistry`. Handlers implement a single `execute()` method and return a `StepResult`. They do not manage retry — that is `RetryExecutor`'s job.

**Integration dependencies**: Some handlers depend on platform services (profile engine, content infrastructure) that may not be fully available at the time this WP is implemented. The approach: use interface-based dependency injection. Each handler accepts a service client interface in its constructor. Where the real client is unavailable, ship a `NullServiceClient` stub that logs a warning and returns a no-op result. This keeps the step handlers testable and shippable.

**Error classification**: Handlers must throw `NonTransientError` (from `src/pipelines/engine/retry.ts`) for business logic failures (invalid config, resource not found) and plain `Error` for transient failures (network timeout, service unavailable). The `RetryExecutor` distinguishes these.

---

## Subtasks

### T024: Define PipelineStepHandler interface and StepResult type (`src/pipelines/steps/interface.ts`)

**Purpose**: Establish the contract all step handlers must implement, including the execution context and result shape.

**Steps**:
1. Create `src/pipelines/steps/interface.ts`
2. Define `StepExecutionContext` — inputs available to every handler
3. Define `StepResult` — what every handler must return
4. Define `PipelineStepHandler` interface with `stepType` and `execute`

```typescript
// src/pipelines/steps/interface.ts
import type { StepConfig, StepType } from '../types';

export interface StepExecutionContext {
  executionId: string;      // UUID of the parent pipeline_execution
  stepIndex: number;        // 0-based position in the pipeline
  stepConfig: StepConfig;   // the config from the pipeline definition
  tenantId: string;         // for scoping calls to platform services
}

export interface StepResult {
  /**
   * Arbitrary output data stored in step_executions.output_data (jsonb).
   * Passed as input to the next step via execution context.
   */
  outputData: Record<string, unknown>;

  /**
   * Optional: artifact paths created by this step (e.g., generated content IDs).
   * Used by review gates (WP06) to route specific artifacts for review.
   */
  artifactPaths?: string[];

  /**
   * If true, the executor should surface this as a quality signal.
   * Used by fidelity-check to flag low-quality outputs.
   */
  flagForReview?: boolean;
}

export interface PipelineStepHandler {
  /**
   * The step type this handler is responsible for.
   */
  readonly stepType: StepType;

  /**
   * Execute the step. Must be idempotent — may be called more than once
   * on retry or recovery. Use `context.executionId + context.stepIndex`
   * as an idempotency key when calling external services.
   *
   * Throw `NonTransientError` for business logic failures (no retry).
   * Throw plain `Error` for transient failures (will be retried).
   */
  execute(context: StepExecutionContext): Promise<StepResult>;
}
```

**Files**:
- `src/pipelines/steps/interface.ts` (new, ~45 lines)

**Validation**:
- [ ] `tsc --noEmit` passes on `interface.ts`
- [ ] `StepExecutionContext` includes `tenantId` — handlers must scope all platform calls to the tenant
- [ ] `PipelineStepHandler.execute` returns `Promise<StepResult>`, not `void`

**Edge Cases**:
- Handlers must be idempotent. Document this requirement in the interface comment so future handler authors are aware. The `executionId + stepIndex` combination is the natural idempotency key to pass to external services.

---

### T025: Implement profile-generation step handler (`src/pipelines/steps/profile-generation.ts`)

**Purpose**: Trigger profile generation for a target entity (person, organization) using Spec 005's Profile Engine. This is the most common step in outreach pipelines.

**Steps**:
1. Create `src/pipelines/steps/profile-generation.ts`
2. Define `ProfileServiceClient` interface (what the handler needs from Spec 005)
3. Implement `ProfileGenerationStepHandler` using the client
4. Export `NullProfileServiceClient` for environments where Spec 005 is unavailable

```typescript
// src/pipelines/steps/profile-generation.ts
import { NonTransientError } from '../engine/retry';
import type { PipelineStepHandler, StepExecutionContext, StepResult } from './interface';

export interface ProfileServiceClient {
  generateProfile(params: {
    tenantId: string;
    targetId: string;
    targetType: 'person' | 'organization';
    idempotencyKey: string;
  }): Promise<{ profileId: string; status: 'created' | 'updated' | 'skipped' }>;
}

export class NullProfileServiceClient implements ProfileServiceClient {
  async generateProfile(params: Parameters<ProfileServiceClient['generateProfile']>[0]) {
    console.warn('[NullProfileServiceClient] Profile Engine not available. Returning stub result.');
    return { profileId: `stub-${params.targetId}`, status: 'skipped' as const };
  }
}

export class ProfileGenerationStepHandler implements PipelineStepHandler {
  readonly stepType = 'profile_generation' as const;

  constructor(private readonly profileService: ProfileServiceClient) {}

  async execute(context: StepExecutionContext): Promise<StepResult> {
    const { targetId, targetType } = context.stepConfig.config as {
      targetId?: string;
      targetType?: 'person' | 'organization';
    };

    if (!targetId) throw new NonTransientError('profile_generation step requires config.targetId');
    if (!targetType) throw new NonTransientError('profile_generation step requires config.targetType');

    const idempotencyKey = `profile-gen-${context.executionId}-${context.stepIndex}`;

    const result = await this.profileService.generateProfile({
      tenantId: context.tenantId,
      targetId,
      targetType,
      idempotencyKey,
    });

    return {
      outputData: { profileId: result.profileId, status: result.status },
      artifactPaths: result.status !== 'skipped' ? [`profiles/${result.profileId}`] : [],
    };
  }
}
```

**Files**:
- `src/pipelines/steps/profile-generation.ts` (new, ~50 lines)

**Validation**:
- [ ] Missing `targetId` throws `NonTransientError` (no retry)
- [ ] Successful profile generation returns `artifactPaths` with the profile path
- [ ] `NullProfileServiceClient.generateProfile` returns a valid stub result
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `targetId` may be provided statically in `stepConfig.config` (pipeline definition) or dynamically from the previous step's `outputData`. For this implementation, only static config is supported. Dynamic wiring between steps is a future enhancement.

---

### T026: Implement fidelity-check step handler (`src/pipelines/steps/fidelity-check.ts`)

**Purpose**: Evaluate the quality of a previously generated profile or content artifact using Spec 008's fidelity scoring. Flags low-quality outputs for human review.

**Steps**:
1. Create `src/pipelines/steps/fidelity-check.ts`
2. Define `FidelityServiceClient` interface
3. Implement `FidelityCheckStepHandler` — calls fidelity service, sets `flagForReview` if score is below threshold

```typescript
// src/pipelines/steps/fidelity-check.ts
import { NonTransientError } from '../engine/retry';
import type { PipelineStepHandler, StepExecutionContext, StepResult } from './interface';

export interface FidelityServiceClient {
  checkFidelity(params: {
    tenantId: string;
    artifactPath: string;
    idempotencyKey: string;
  }): Promise<{ score: number; issues: string[] }>;
}

export class NullFidelityServiceClient implements FidelityServiceClient {
  async checkFidelity() {
    console.warn('[NullFidelityServiceClient] Fidelity service not available. Returning passing stub.');
    return { score: 1.0, issues: [] };
  }
}

export class FidelityCheckStepHandler implements PipelineStepHandler {
  readonly stepType = 'fidelity_check' as const;

  // Score below this threshold triggers flagForReview
  private static readonly REVIEW_THRESHOLD = 0.7;

  constructor(private readonly fidelityService: FidelityServiceClient) {}

  async execute(context: StepExecutionContext): Promise<StepResult> {
    const { artifactPath, reviewThreshold } = context.stepConfig.config as {
      artifactPath?: string;
      reviewThreshold?: number;
    };

    if (!artifactPath) throw new NonTransientError('fidelity_check step requires config.artifactPath');

    const idempotencyKey = `fidelity-${context.executionId}-${context.stepIndex}`;
    const threshold = reviewThreshold ?? FidelityCheckStepHandler.REVIEW_THRESHOLD;

    const result = await this.fidelityService.checkFidelity({
      tenantId: context.tenantId,
      artifactPath,
      idempotencyKey,
    });

    const flagForReview = result.score < threshold;

    return {
      outputData: { score: result.score, issues: result.issues, flagForReview },
      flagForReview,
    };
  }
}
```

**Files**:
- `src/pipelines/steps/fidelity-check.ts` (new, ~50 lines)

**Validation**:
- [ ] Score below `REVIEW_THRESHOLD` sets `flagForReview: true`
- [ ] Score at or above threshold sets `flagForReview: false`
- [ ] Missing `artifactPath` throws `NonTransientError`
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `reviewThreshold` is configurable per-step via `stepConfig.config`. This allows some pipelines to use a strict threshold (0.9) and others a loose one (0.5).

---

### T027: Implement content-generation step handler (`src/pipelines/steps/content-generation.ts`)

**Purpose**: Generate content (emails, summaries, reports) using Spec 006's content infrastructure. Stores the result in the corpus and returns an artifact path.

**Steps**:
1. Create `src/pipelines/steps/content-generation.ts`
2. Define `ContentServiceClient` interface
3. Implement `ContentGenerationStepHandler`

```typescript
// src/pipelines/steps/content-generation.ts
import { NonTransientError } from '../engine/retry';
import type { PipelineStepHandler, StepExecutionContext, StepResult } from './interface';

export interface ContentServiceClient {
  generateContent(params: {
    tenantId: string;
    contentType: string;
    templateId?: string;
    context: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ contentId: string; path: string }>;
}

export class NullContentServiceClient implements ContentServiceClient {
  async generateContent(params: Parameters<ContentServiceClient['generateContent']>[0]) {
    console.warn('[NullContentServiceClient] Content service not available. Returning stub result.');
    return { contentId: `stub-content-${Date.now()}`, path: `content/stub-${params.idempotencyKey}` };
  }
}

export class ContentGenerationStepHandler implements PipelineStepHandler {
  readonly stepType = 'content_generation' as const;

  constructor(private readonly contentService: ContentServiceClient) {}

  async execute(context: StepExecutionContext): Promise<StepResult> {
    const { contentType, templateId, contextData } = context.stepConfig.config as {
      contentType?: string;
      templateId?: string;
      contextData?: Record<string, unknown>;
    };

    if (!contentType) throw new NonTransientError('content_generation step requires config.contentType');

    const idempotencyKey = `content-gen-${context.executionId}-${context.stepIndex}`;

    const result = await this.contentService.generateContent({
      tenantId: context.tenantId,
      contentType,
      templateId,
      context: contextData ?? {},
      idempotencyKey,
    });

    return {
      outputData: { contentId: result.contentId, path: result.path },
      artifactPaths: [result.path],
    };
  }
}
```

**Files**:
- `src/pipelines/steps/content-generation.ts` (new, ~50 lines)

**Validation**:
- [ ] Missing `contentType` throws `NonTransientError`
- [ ] `artifactPaths` includes the generated content path (for review gate routing)
- [ ] `tsc --noEmit` passes

---

### T028: Implement source-query and notification step handlers (`src/pipelines/steps/source-query.ts`, `src/pipelines/steps/notification.ts`)

**Purpose**: Source-query retrieves documents from the content corpus by query. Notification sends alerts via configured channels (Slack, email, webhook).

**Steps**:
1. Create `src/pipelines/steps/source-query.ts`
2. Create `src/pipelines/steps/notification.ts`
3. Both follow the same interface pattern as T025-T027

```typescript
// src/pipelines/steps/source-query.ts
import { NonTransientError } from '../engine/retry';
import type { PipelineStepHandler, StepExecutionContext, StepResult } from './interface';

export interface SourceQueryServiceClient {
  query(params: {
    tenantId: string;
    query: string;
    sourceIds?: string[];
    limit?: number;
  }): Promise<{ documents: Array<{ id: string; path: string; snippet: string }> }>;
}

export class NullSourceQueryServiceClient implements SourceQueryServiceClient {
  async query() {
    console.warn('[NullSourceQueryServiceClient] Source query service not available.');
    return { documents: [] };
  }
}

export class SourceQueryStepHandler implements PipelineStepHandler {
  readonly stepType = 'source_query' as const;

  constructor(private readonly sourceQueryService: SourceQueryServiceClient) {}

  async execute(context: StepExecutionContext): Promise<StepResult> {
    const { query, sourceIds, limit } = context.stepConfig.config as {
      query?: string;
      sourceIds?: string[];
      limit?: number;
    };

    if (!query) throw new NonTransientError('source_query step requires config.query');

    const result = await this.sourceQueryService.query({
      tenantId: context.tenantId,
      query,
      sourceIds,
      limit: limit ?? 10,
    });

    return {
      outputData: { documents: result.documents, count: result.documents.length },
    };
  }
}
```

```typescript
// src/pipelines/steps/notification.ts
import { NonTransientError } from '../engine/retry';
import type { PipelineStepHandler, StepExecutionContext, StepResult } from './interface';

export interface NotificationServiceClient {
  send(params: {
    tenantId: string;
    channel: 'slack' | 'email' | 'webhook';
    recipient: string;
    message: string;
    idempotencyKey: string;
  }): Promise<{ messageId: string }>;
}

export class NullNotificationServiceClient implements NotificationServiceClient {
  async send(params: Parameters<NotificationServiceClient['send']>[0]) {
    console.warn(`[NullNotificationServiceClient] Would send to ${params.channel}:${params.recipient}`);
    return { messageId: `stub-msg-${Date.now()}` };
  }
}

export class NotificationStepHandler implements PipelineStepHandler {
  readonly stepType = 'notification' as const;

  constructor(private readonly notificationService: NotificationServiceClient) {}

  async execute(context: StepExecutionContext): Promise<StepResult> {
    const { channel, recipient, message } = context.stepConfig.config as {
      channel?: 'slack' | 'email' | 'webhook';
      recipient?: string;
      message?: string;
    };

    if (!channel) throw new NonTransientError('notification step requires config.channel');
    if (!recipient) throw new NonTransientError('notification step requires config.recipient');
    if (!message) throw new NonTransientError('notification step requires config.message');

    const idempotencyKey = `notification-${context.executionId}-${context.stepIndex}`;

    const result = await this.notificationService.send({
      tenantId: context.tenantId,
      channel,
      recipient,
      message,
      idempotencyKey,
    });

    return {
      outputData: { messageId: result.messageId, channel, recipient },
    };
  }
}
```

**Files**:
- `src/pipelines/steps/source-query.ts` (new, ~50 lines)
- `src/pipelines/steps/notification.ts` (new, ~50 lines)

**Validation**:
- [ ] `source_query` with no `query` throws `NonTransientError`
- [ ] `notification` with missing required config fields throws `NonTransientError`
- [ ] Both null clients log warnings and return stub results
- [ ] `tsc --noEmit` passes on both files

---

### T029: Create step type registry and barrel export (`src/pipelines/steps/registry.ts`, `src/pipelines/steps/index.ts`)

**Purpose**: Central registry mapping step type strings to handler instances, plus the barrel export for the steps module.

**Steps**:
1. Create `src/pipelines/steps/registry.ts`
2. Define `StepHandlerRegistry` class with `register` and `get` methods
3. Export `createDefaultStepHandlerRegistry` factory that wires up all 6 handlers with null clients
4. Create `src/pipelines/steps/index.ts` barrel export

```typescript
// src/pipelines/steps/registry.ts
import type { PipelineStepHandler } from './interface';
import type { StepType } from '../types';
import { ProfileGenerationStepHandler, NullProfileServiceClient } from './profile-generation';
import { FidelityCheckStepHandler, NullFidelityServiceClient } from './fidelity-check';
import { ContentGenerationStepHandler, NullContentServiceClient } from './content-generation';
import { SourceQueryStepHandler, NullSourceQueryServiceClient } from './source-query';
import { NotificationStepHandler, NullNotificationServiceClient } from './notification';

export class StepHandlerRegistry {
  private handlers = new Map<StepType, PipelineStepHandler>();

  register(handler: PipelineStepHandler): void {
    this.handlers.set(handler.stepType, handler);
  }

  get(stepType: StepType): PipelineStepHandler | undefined {
    return this.handlers.get(stepType);
  }

  getAll(): PipelineStepHandler[] {
    return Array.from(this.handlers.values());
  }
}

export interface StepHandlerDependencies {
  profileService?: ConstructorParameters<typeof ProfileGenerationStepHandler>[0];
  fidelityService?: ConstructorParameters<typeof FidelityCheckStepHandler>[0];
  contentService?: ConstructorParameters<typeof ContentGenerationStepHandler>[0];
  sourceQueryService?: ConstructorParameters<typeof SourceQueryStepHandler>[0];
  notificationService?: ConstructorParameters<typeof NotificationStepHandler>[0];
}

/**
 * Creates a registry with all 6 built-in handlers.
 * Pass real service clients for production; omit for null-client stubs.
 */
export function createDefaultStepHandlerRegistry(
  deps: StepHandlerDependencies = {},
): StepHandlerRegistry {
  const registry = new StepHandlerRegistry();
  registry.register(new ProfileGenerationStepHandler(deps.profileService ?? new NullProfileServiceClient()));
  registry.register(new FidelityCheckStepHandler(deps.fidelityService ?? new NullFidelityServiceClient()));
  registry.register(new ContentGenerationStepHandler(deps.contentService ?? new NullContentServiceClient()));
  registry.register(new SourceQueryStepHandler(deps.sourceQueryService ?? new NullSourceQueryServiceClient()));
  registry.register(new NotificationStepHandler(deps.notificationService ?? new NullNotificationServiceClient()));
  return registry;
}
```

**Files**:
- `src/pipelines/steps/registry.ts` (new, ~50 lines)
- `src/pipelines/steps/index.ts` (new, ~15 lines — barrel export)

**Validation**:
- [ ] `createDefaultStepHandlerRegistry()` (no args) returns a registry with 5 handlers (review_gate is WP06)
- [ ] `registry.get('profile_generation')` returns a `ProfileGenerationStepHandler` instance
- [ ] `registry.get('review_gate')` returns `undefined` until WP06 registers it
- [ ] `tsc --noEmit` passes

**Edge Cases**:
- `review_gate` is a special step type handled directly by `StepRunner` (it pauses execution rather than calling an external service). It does not need a registry entry. Document this in the registry comment.

---

## Definition of Done

- [ ] `src/pipelines/steps/interface.ts` — `PipelineStepHandler`, `StepExecutionContext`, `StepResult`
- [ ] `src/pipelines/steps/profile-generation.ts` — handler + client interface + null client
- [ ] `src/pipelines/steps/fidelity-check.ts` — handler + client interface + null client
- [ ] `src/pipelines/steps/content-generation.ts` — handler + client interface + null client
- [ ] `src/pipelines/steps/source-query.ts` — handler + client interface + null client
- [ ] `src/pipelines/steps/notification.ts` — handler + client interface + null client
- [ ] `src/pipelines/steps/registry.ts` — `StepHandlerRegistry`, `createDefaultStepHandlerRegistry`
- [ ] `src/pipelines/steps/index.ts` — barrel export
- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no regressions

## Risks

- **Null client silent failures**: `NullServiceClient` stubs log warnings and return empty/stub results. If a pipeline runs in production with null clients (because the real service wasn't wired up), it will appear to succeed but produce no real output. Add a startup check that logs an error if null clients are in use in non-test environments.
- **Step output chaining**: The current interface does not pass the previous step's `outputData` as input to the next step. This is a known limitation. The `executionId` can be used to fetch previous step outputs from the DB, but this is not built-in. Track this as a future enhancement.
- **review_gate step type**: The enum in WP01 includes `review_gate` as a step type, but it is handled by `StepRunner` directly (not via a registry handler). If someone configures a pipeline with `stepType: 'review_gate'` expecting the registry to handle it, it will get a "no handler" error. The `StepRunner` should intercept `review_gate` steps before dispatching to the registry.

## Reviewer Guidance

- Verify all 6 handler constructors accept a service client interface (not a concrete class) — this is the dependency injection requirement that enables testing.
- Check that all `NonTransientError` throws use descriptive messages that include the step type and the missing field name — these messages appear in `step_executions.error_message` and must be actionable.
- Confirm null clients produce `console.warn` (not `console.error` or silent) — they are expected in development but not in production.
