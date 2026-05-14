/**
 * Coordination Service — WP04 (T030, T031, T032)
 *
 * Work unit CRUD, coordination group management, completion policy evaluation,
 * and inter-agent messaging via Inngest events.
 *
 * Design principles:
 * - TENANT-SCOPED: every read and write path includes tenantId in WHERE clauses.
 * - STATE MACHINE: work unit transitions are validated against the allowed graph.
 * - CYCLE-FREE: dependencies are validated at creation time via DFS — cycles rejected.
 * - DEPENDENCY-AWARE: work units cannot start until all dependencies are completed.
 * - EVENT-DRIVEN: every status change emits a typed event via EventService.
 * - SIGNAL-BASED MESSAGING: agents communicate via Inngest events (Temporal signal pattern),
 *   no shared mutable state, no locks, no races.
 *
 * Empty group policy:
 *   A group with zero work units stays 'active' — it never auto-completes.
 *   Callers that want to immediately resolve empty groups must handle this case.
 *
 * Inter-agent signals:
 *   Signals are tenant-scoped: the tenantId is baked into the Inngest event.
 *   The receiving agent's session must belong to the same tenant.
 */

import { createId } from '@paralleldrive/cuid2';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';

import {
  coordinationGroups,
  workUnits,
  type CoordinationGroup,
  type CoordinationGroupStatus,
  type CompletionPolicy,
  type WorkUnit,
  type WorkUnitStatus,
} from '../db/schema/coordination.js';
import { inngest } from '../inngest/client.js';

import { registerEventType, type EventService } from './event.service.js';

// ============================================================
// REGISTER COORDINATION EVENT TYPES
// ============================================================
// Called at module init — registration is synchronous and idempotent.
// Extending the EventService registry from WP03.

registerEventType(
  'work_unit.created',
  z.object({
    workUnitId: z.string().min(1),
    tenantId: z.string().min(1),
    type: z.string().min(1),
    coordinationGroupId: z.string().optional(),
  }),
);

registerEventType(
  'work_unit.status_changed',
  z.object({
    workUnitId: z.string().min(1),
    tenantId: z.string().min(1),
    previousStatus: z.string().min(1),
    newStatus: z.string().min(1),
    coordinationGroupId: z.string().optional(),
  }),
);

registerEventType(
  'coordination_group.completed',
  z.object({
    groupId: z.string().min(1),
    tenantId: z.string().min(1),
    completionPolicy: z.string().min(1),
  }),
);

registerEventType(
  'coordination_group.failed',
  z.object({
    groupId: z.string().min(1),
    tenantId: z.string().min(1),
    reason: z.string().min(1),
  }),
);

registerEventType(
  'agent.signal',
  z.object({
    tenantId: z.string().min(1),
    fromSessionId: z.string().min(1),
    toSessionId: z.string().min(1),
    signalType: z.string().min(1),
    payload: z.record(z.unknown()),
  }),
);

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Valid state transitions for work units.
 * Key: current status. Value: allowed next statuses.
 *
 * pending   → assigned | cancelled
 * assigned  → running | cancelled
 * running   → completed | failed | cancelled
 * completed → (terminal)
 * failed    → (terminal)
 * cancelled → (terminal)
 */
export const WORK_UNIT_TRANSITIONS: Record<WorkUnitStatus, WorkUnitStatus[]> = {
  pending: ['assigned', 'cancelled'],
  assigned: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// ============================================================
// ERRORS
// ============================================================

export class WorkUnitNotFoundError extends Error {
  constructor(workUnitId: string, tenantId: string) {
    super(`Work unit not found: ${workUnitId} (tenant: ${tenantId})`);
    this.name = 'WorkUnitNotFoundError';
  }
}

export class InvalidWorkUnitTransitionError extends Error {
  constructor(from: WorkUnitStatus, to: WorkUnitStatus) {
    super(`Invalid work unit status transition: ${from} → ${to}`);
    this.name = 'InvalidWorkUnitTransitionError';
  }
}

export class DependencyNotMetError extends Error {
  constructor(workUnitId: string, unmetDependencyIds: string[]) {
    super(
      `Work unit ${workUnitId} cannot start: dependencies not completed: ${unmetDependencyIds.join(', ')}`,
    );
    this.name = 'DependencyNotMetError';
  }
}

export class DependencyCycleError extends Error {
  constructor(nodeId: string) {
    super(`Dependency cycle detected involving work unit ${nodeId}`);
    this.name = 'DependencyCycleError';
  }
}

export class DependencyNotFoundError extends Error {
  constructor(missingIds: string[]) {
    super(`Dependencies not found: ${missingIds.join(', ')}`);
    this.name = 'DependencyNotFoundError';
  }
}

export class CoordinationGroupNotFoundError extends Error {
  constructor(groupId: string, tenantId: string) {
    super(`Coordination group not found: ${groupId} (tenant: ${tenantId})`);
    this.name = 'CoordinationGroupNotFoundError';
  }
}

// ============================================================
// INPUT TYPES
// ============================================================

export interface CreateWorkUnitInput {
  title: string;
  type: string;
  sessionId?: string;
  coordinationGroupId?: string;
  assignee?: string;
  dependencies?: string[];
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateWorkUnitInput {
  status?: WorkUnitStatus;
  assignee?: string;
  metadata?: Record<string, unknown>;
}

export interface ListWorkUnitsFilters {
  sessionId?: string;
  coordinationGroupId?: string;
  status?: WorkUnitStatus;
}

export interface CreateCoordinationGroupInput {
  title: string;
  completionPolicy?: CompletionPolicy;
  metadata?: Record<string, unknown>;
}

export interface CompletionEvaluation {
  isComplete: boolean;
  isFailed: boolean;
  policy: CompletionPolicy;
  summary: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    pending: number;
  };
}

// ============================================================
// COORDINATION SERVICE
// ============================================================

export class CoordinationService {
  constructor(
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly eventService?: EventService,
  ) {}

  // ---------------------------------------------------------------------------
  // WORK UNIT CRUD (T030)
  // ---------------------------------------------------------------------------

  /**
   * Create a new work unit in 'pending' status.
   *
   * Validates the dependencies array for cycles at creation time (DFS over
   * existing units in this tenant). Rejects immediately if a cycle is detected.
   */
  async createWorkUnit(tenantId: string, input: CreateWorkUnitInput): Promise<WorkUnit> {
    const {
      title,
      type,
      sessionId,
      coordinationGroupId,
      assignee,
      dependencies = [],
      labels = [],
      metadata = {},
    } = input;

    // Validate dependency cycle before any DB write
    if (dependencies.length > 0) {
      await this.assertNoCycle(tenantId, dependencies);

      // Verify all declared dependency IDs actually exist for this tenant
      const existingDeps = await this.db
        .select({ id: workUnits.id })
        .from(workUnits)
        .where(and(eq(workUnits.tenantId, tenantId), inArray(workUnits.id, dependencies)));
      const foundIds = new Set(existingDeps.map((r) => r.id));
      const missingIds = dependencies.filter((depId) => !foundIds.has(depId));
      if (missingIds.length > 0) {
        throw new DependencyNotFoundError(missingIds);
      }
    }

    const id = createId();
    const now = new Date();

    const [unit] = await this.db
      .insert(workUnits)
      .values({
        id,
        tenantId,
        sessionId: sessionId ?? null,
        coordinationGroupId: coordinationGroupId ?? null,
        status: 'pending',
        title,
        type,
        assignee: assignee ?? null,
        dependencies,
        labels,
        metadata,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (this.eventService) {
      await this.eventService.emitEvent(
        tenantId,
        'work_unit.created',
        {
          workUnitId: unit.id,
          tenantId,
          type,
          ...(coordinationGroupId ? { coordinationGroupId } : {}),
        },
        sessionId,
      );
    }

    return unit;
  }

  /**
   * Get a work unit by ID, scoped to the tenant.
   * Returns null if the work unit doesn't exist OR belongs to a different tenant.
   * This prevents cross-tenant information leakage.
   */
  async getWorkUnit(tenantId: string, workUnitId: string): Promise<WorkUnit | null> {
    const [unit] = await this.db
      .select()
      .from(workUnits)
      .where(
        and(
          eq(workUnits.id, workUnitId),
          eq(workUnits.tenantId, tenantId),
        ),
      )
      .limit(1);

    return unit ?? null;
  }

  /**
   * Update a work unit's status, assignee, and/or metadata.
   *
   * Status transitions are validated against the state machine.
   * If transitioning to 'running', verifies all dependencies are completed.
   * Emits a typed event on every status change.
   */
  async updateWorkUnit(
    tenantId: string,
    workUnitId: string,
    input: UpdateWorkUnitInput,
  ): Promise<WorkUnit> {
    const current = await this.getWorkUnit(tenantId, workUnitId);
    if (!current) {
      throw new WorkUnitNotFoundError(workUnitId, tenantId);
    }

    if (input.status !== undefined) {
      this.assertValidTransition(current.status as WorkUnitStatus, input.status);

      // Dependency check: only block when transitioning TO running
      if (input.status === 'running' && current.dependencies.length > 0) {
        await this.assertDependenciesCompleted(tenantId, workUnitId, current.dependencies);
      }
    }

    const now = new Date();
    const updates: Partial<typeof workUnits.$inferInsert> = { updatedAt: now };

    if (input.status !== undefined) updates.status = input.status;
    if (input.assignee !== undefined) updates.assignee = input.assignee;
    if (input.metadata !== undefined) updates.metadata = input.metadata;

    if (input.status === 'completed' || input.status === 'failed') {
      updates.completedAt = now;
    }

    const [updated] = await this.db
      .update(workUnits)
      .set(updates)
      .where(
        and(
          eq(workUnits.id, workUnitId),
          eq(workUnits.tenantId, tenantId),
        ),
      )
      .returning();

    if (input.status !== undefined && this.eventService) {
      await this.eventService.emitEvent(
        tenantId,
        'work_unit.status_changed',
        {
          workUnitId: updated.id,
          tenantId,
          previousStatus: current.status,
          newStatus: updated.status,
          ...(updated.coordinationGroupId
            ? { coordinationGroupId: updated.coordinationGroupId }
            : {}),
        },
        updated.sessionId ?? undefined,
      );
    }

    if (input.status !== undefined) {
      try {
        await inngest.send({
          name: 'orchestrator/work_unit.status_changed',
          data: {
            workUnitId: updated.id,
            tenantId,
            previousStatus: current.status,
            newStatus: updated.status as string,
            ...(updated.coordinationGroupId
              ? { coordinationGroupId: updated.coordinationGroupId }
              : {}),
          },
        });
      } catch (err) {
        console.error('[CoordinationService] Failed to emit work_unit.status_changed Inngest event:', err);
      }
    }

    return updated;
  }

  /**
   * List work units for a tenant with optional filters.
   * Always tenant-scoped.
   */
  async listWorkUnits(
    tenantId: string,
    filters: ListWorkUnitsFilters = {},
  ): Promise<WorkUnit[]> {
    const { sessionId, coordinationGroupId, status } = filters;

    const conditions = [eq(workUnits.tenantId, tenantId)];

    if (sessionId !== undefined) {
      conditions.push(eq(workUnits.sessionId, sessionId));
    }

    if (coordinationGroupId !== undefined) {
      conditions.push(eq(workUnits.coordinationGroupId, coordinationGroupId));
    }

    if (status !== undefined) {
      conditions.push(eq(workUnits.status, status));
    }

    return this.db
      .select()
      .from(workUnits)
      .where(and(...conditions));
  }

  // ---------------------------------------------------------------------------
  // COORDINATION GROUP CRUD (T031)
  // ---------------------------------------------------------------------------

  /**
   * Create a new coordination group in 'active' status.
   */
  async createCoordinationGroup(
    tenantId: string,
    input: CreateCoordinationGroupInput,
  ): Promise<CoordinationGroup> {
    const { title, completionPolicy = 'all', metadata = {} } = input;

    const id = createId();

    const [group] = await this.db
      .insert(coordinationGroups)
      .values({
        id,
        tenantId,
        title,
        completionPolicy,
        status: 'active',
        metadata,
        createdAt: new Date(),
      })
      .returning();

    return group;
  }

  /**
   * Get a coordination group by ID, scoped to the tenant.
   * Returns null if the group doesn't exist OR belongs to a different tenant.
   */
  async getCoordinationGroup(
    tenantId: string,
    groupId: string,
  ): Promise<CoordinationGroup | null> {
    const [group] = await this.db
      .select()
      .from(coordinationGroups)
      .where(
        and(
          eq(coordinationGroups.id, groupId),
          eq(coordinationGroups.tenantId, tenantId),
        ),
      )
      .limit(1);

    return group ?? null;
  }

  /**
   * Evaluate whether a coordination group's completion policy is satisfied.
   *
   * Completion policies:
   *   all      — all work units must be 'completed'. Group fails if any unit fails.
   *   any      — first unit to complete triggers group completion.
   *   majority — more than 50% of units must be 'completed'.
   *
   * Empty group: returns { isComplete: false, isFailed: false, ... } — groups
   * with no work units stay 'active' and never auto-complete.
   */
  async evaluateCompletion(
    tenantId: string,
    groupId: string,
  ): Promise<CompletionEvaluation> {
    const group = await this.getCoordinationGroup(tenantId, groupId);
    if (!group) {
      throw new CoordinationGroupNotFoundError(groupId, tenantId);
    }

    const units = await this.listWorkUnits(tenantId, { coordinationGroupId: groupId });

    const total = units.length;
    const completed = units.filter((u) => u.status === 'completed').length;
    const failed = units.filter((u) => u.status === 'failed').length;
    const cancelled = units.filter((u) => u.status === 'cancelled').length;
    const pending = total - completed - failed - cancelled;

    const summary = { total, completed, failed, cancelled, pending };

    // Empty group: never completes automatically
    if (total === 0) {
      return {
        isComplete: false,
        isFailed: false,
        policy: group.completionPolicy as CompletionPolicy,
        summary,
      };
    }

    const policy = group.completionPolicy as CompletionPolicy;
    let isComplete = false;
    let isFailed = false;

    switch (policy) {
      case 'all':
        // Completes when ALL units are 'completed'. Fails if ANY unit fails.
        if (failed > 0) {
          isFailed = true;
        } else {
          isComplete = completed === total;
        }
        break;

      case 'any':
        // Completes when the first unit completes.
        // Fails only when all non-cancelled units have failed.
        if (completed >= 1) {
          isComplete = true;
        } else if (failed + cancelled === total) {
          isFailed = true;
        }
        break;

      case 'majority': {
        // Completes when >50% of units complete.
        // Fails when it becomes impossible to reach majority.
        const majority = Math.floor(total / 2) + 1;
        if (completed >= majority) {
          isComplete = true;
        } else if (failed + cancelled > total - majority) {
          // Remaining active units cannot push completed over the majority threshold
          isFailed = true;
        }
        break;
      }
    }

    return { isComplete, isFailed, policy, summary };
  }

  /**
   * Mark a coordination group as completed or failed and emit the appropriate event.
   * Idempotent: if the group is already in a terminal state, returns the existing record.
   */
  async finalizeCoordinationGroup(
    tenantId: string,
    groupId: string,
    newStatus: Extract<CoordinationGroupStatus, 'completed' | 'failed'>,
    reason?: string,
  ): Promise<CoordinationGroup> {
    const group = await this.getCoordinationGroup(tenantId, groupId);
    if (!group) {
      throw new CoordinationGroupNotFoundError(groupId, tenantId);
    }

    // Idempotent: already in terminal state
    if (group.status !== 'active') {
      return group;
    }

    const now = new Date();
    const [updated] = await this.db
      .update(coordinationGroups)
      .set({ status: newStatus, completedAt: now })
      .where(
        and(
          eq(coordinationGroups.id, groupId),
          eq(coordinationGroups.tenantId, tenantId),
        ),
      )
      .returning();

    if (this.eventService) {
      if (newStatus === 'completed') {
        await this.eventService.emitEvent(
          tenantId,
          'coordination_group.completed',
          {
            groupId,
            tenantId,
            completionPolicy: group.completionPolicy,
          },
        );
      } else {
        await this.eventService.emitEvent(
          tenantId,
          'coordination_group.failed',
          {
            groupId,
            tenantId,
            reason: reason ?? 'One or more work units failed',
          },
        );
      }
    }

    return updated;
  }

  // ---------------------------------------------------------------------------
  // INTER-AGENT MESSAGING (T032)
  // ---------------------------------------------------------------------------

  /**
   * Send a typed signal from one agent session to another.
   *
   * Mirrors Temporal's signal pattern: fire-and-forget messages between
   * agent workflows. No shared mutable state, no locks, no races.
   *
   * The signal is emitted as an Inngest event. The target session's Inngest
   * function can wait for it via step.waitForEvent(). The signalType field
   * determines what the receiving agent does with the payload.
   *
   * All signals are tenant-scoped — tenantId is part of the event data so the
   * receiving function can verify isolation before processing.
   */
  async sendSignal(
    tenantId: string,
    fromSessionId: string,
    toSessionId: string,
    signalType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Emit via Inngest — durable delivery, no shared state
    await inngest.send({
      name: 'orchestrator/agent.signal',
      data: {
        tenantId,
        fromSessionId,
        toSessionId,
        signalType,
        payload,
      },
    });

    // Also record in the typed event log for observability
    if (this.eventService) {
      await this.eventService.emitEvent(
        tenantId,
        'agent.signal',
        { tenantId, fromSessionId, toSessionId, signalType, payload },
        fromSessionId,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Assert that creating a work unit with the given dependencies does not
   * introduce a cycle into the dependency DAG.
   *
   * Builds a directed graph from all existing work units in this tenant,
   * then runs DFS with white/gray/black coloring from each provided dependency
   * to detect back-edges (cycles).
   *
   * The new unit's ID is not in the DB yet, so we verify the existing sub-graph
   * reachable from the provided dependency set is acyclic. If it is, the new
   * unit's outgoing edges (its dependencies) cannot create a cycle — no existing
   * node can reach the not-yet-created unit.
   *
   * Time complexity: O(V+E) where V = existing units, E = total dependency edges.
   */
  private async assertNoCycle(tenantId: string, dependencies: string[]): Promise<void> {
    if (dependencies.length === 0) return;

    const allUnits: Array<{ id: string; deps: string[] }> = await this.db
      .select({ id: workUnits.id, deps: workUnits.dependencies })
      .from(workUnits)
      .where(eq(workUnits.tenantId, tenantId));

    // Build adjacency map: workUnitId → [dep1, dep2, ...]
    const graph = new Map<string, string[]>();
    for (const unit of allUnits) {
      graph.set(unit.id, unit.deps);
    }

    // DFS with white/gray/black coloring
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) return true; // back-edge → cycle
      if (visited.has(nodeId)) return false; // already fully explored

      visited.add(nodeId);
      inStack.add(nodeId);

      for (const dep of graph.get(nodeId) ?? []) {
        if (hasCycle(dep)) return true;
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const depId of dependencies) {
      if (hasCycle(depId)) {
        throw new DependencyCycleError(depId);
      }
    }
  }

  /**
   * Assert that all listed dependencies are in 'completed' status.
   * Throws DependencyNotMetError listing the IDs that are not completed.
   */
  private async assertDependenciesCompleted(
    tenantId: string,
    workUnitId: string,
    dependencyIds: string[],
  ): Promise<void> {
    if (dependencyIds.length === 0) return;

    const deps: Array<{ id: string; status: string }> = await this.db
      .select({ id: workUnits.id, status: workUnits.status })
      .from(workUnits)
      .where(
        and(
          eq(workUnits.tenantId, tenantId),
          inArray(workUnits.id, dependencyIds),
        ),
      );

    // Check for dependency IDs that don't exist in the DB at all
    if (deps.length < dependencyIds.length) {
      const foundIds = new Set(deps.map((d) => d.id));
      const missingIds = dependencyIds.filter((id) => !foundIds.has(id));
      throw new DependencyNotFoundError(missingIds);
    }

    const unmet = deps.filter((d) => d.status !== 'completed').map((d) => d.id);

    if (unmet.length > 0) {
      throw new DependencyNotMetError(workUnitId, unmet);
    }
  }

  /**
   * Assert that a work unit status transition is valid.
   */
  private assertValidTransition(from: WorkUnitStatus, to: WorkUnitStatus): void {
    const allowed = WORK_UNIT_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new InvalidWorkUnitTransitionError(from, to);
    }
  }
}
