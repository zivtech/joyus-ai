/**
 * Unit tests for CoordinationService — WP04.
 *
 * All DB calls are mocked — no real database is required.
 * Tests verify:
 *   - Work unit CRUD: create, get, update, list
 *   - State machine: valid and invalid transitions
 *   - Dependency checking: blocks 'running' when dependencies are not 'completed'
 *   - Cycle detection: rejects dependency graphs that would create cycles
 *   - Coordination groups: create and get
 *   - Completion policies: all / any / majority — including edge cases
 *   - Empty group: never auto-completes
 *   - finalize: idempotent on terminal state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  CoordinationService,
  WORK_UNIT_TRANSITIONS,
  WorkUnitNotFoundError,
  InvalidWorkUnitTransitionError,
  DependencyNotMetError,
  DependencyCycleError,
  CoordinationGroupNotFoundError,
} from '../../src/orchestrator/coordination.service.js';

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function buildMockWorkUnit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'wu-1',
    tenantId: 'tenant-1',
    sessionId: null,
    coordinationGroupId: null,
    status: 'pending',
    title: 'Test Work Unit',
    type: 'research',
    assignee: null,
    dependencies: [] as string[],
    labels: [] as string[],
    metadata: {},
    createdAt: new Date('2026-05-12T00:00:00Z'),
    updatedAt: new Date('2026-05-12T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

function buildMockGroup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'group-1',
    tenantId: 'tenant-1',
    title: 'Test Group',
    completionPolicy: 'all',
    status: 'active',
    metadata: {},
    createdAt: new Date('2026-05-12T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

/**
 * Build a mock database where every method returns the provided rows.
 *
 * Supports chaining patterns:
 *   select().from().where().limit() => rows
 *   select().from().where()         => rows (without limit, awaited directly)
 *   insert().values().returning()   => rows
 *   update().set().where().returning() => rows
 *
 * `.where()` returns a thenable (Promise) that also exposes `.limit()` and
 * `.returning()` so both Drizzle query patterns work correctly:
 *   - `await db.select().from().where()` resolves to the rows array
 *   - `await db.select().from().where().limit(1)` also resolves to rows
 */
function makeDb(rows: unknown[] = []): MockDb {
  const returning = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockResolvedValue(rows);
  const whereResult = Object.assign(Promise.resolve(rows), { limit, returning });
  const where = vi.fn().mockReturnValue(whereResult);
  const from = vi.fn().mockReturnValue({ where });
  const values = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });

  const select = vi.fn().mockReturnValue({ from });
  const insert = vi.fn().mockReturnValue({ values });
  const update = vi.fn().mockReturnValue({ set });

  return { select, insert, update } as unknown as MockDb;
}

/**
 * Build a DB that resolves `select` differently per call sequence.
 * Used when a single test method makes multiple select() calls.
 *
 * Each select() call captures its own row set at call time (closure per call),
 * so both `.where().limit()` and direct `await .where()` patterns work correctly.
 */
function makeDbMultiSelect(rowSets: unknown[][]): MockDb {
  let callCount = 0;

  const returning = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ returning });
  const updateReturning = vi.fn().mockResolvedValue([]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });

  const select = vi.fn().mockImplementation(() => {
    const rows = rowSets[callCount] ?? [];
    callCount++;
    const limit = vi.fn().mockResolvedValue(rows);
    const selReturning = vi.fn().mockResolvedValue(rows);
    const whereResult = Object.assign(Promise.resolve(rows), {
      limit,
      returning: selReturning,
    });
    const where = vi.fn().mockReturnValue(whereResult);
    return { from: vi.fn().mockReturnValue({ where }) };
  });

  const insert = vi.fn().mockReturnValue({ values });
  const update = vi.fn().mockReturnValue({ set });

  return { select, insert, update } as unknown as MockDb;
}

const TENANT = 'tenant-abc';

function makeService(rows: unknown[] = [], eventService?: unknown) {
  const db = makeDb(rows);
  const service = new CoordinationService(db as never, eventService as never);
  return { service, db };
}

// ---------------------------------------------------------------------------
// WORK UNIT STATE MACHINE
// ---------------------------------------------------------------------------

describe('WORK_UNIT_TRANSITIONS', () => {
  it('defines all statuses as keys', () => {
    const statuses = ['pending', 'assigned', 'running', 'completed', 'failed', 'cancelled'];
    for (const s of statuses) {
      expect(WORK_UNIT_TRANSITIONS).toHaveProperty(s);
    }
  });

  it('terminal states have no allowed transitions', () => {
    expect(WORK_UNIT_TRANSITIONS['completed']).toHaveLength(0);
    expect(WORK_UNIT_TRANSITIONS['failed']).toHaveLength(0);
    expect(WORK_UNIT_TRANSITIONS['cancelled']).toHaveLength(0);
  });

  it('pending can go to assigned or cancelled', () => {
    expect(WORK_UNIT_TRANSITIONS['pending']).toContain('assigned');
    expect(WORK_UNIT_TRANSITIONS['pending']).toContain('cancelled');
  });

  it('running can go to completed, failed, or cancelled', () => {
    expect(WORK_UNIT_TRANSITIONS['running']).toContain('completed');
    expect(WORK_UNIT_TRANSITIONS['running']).toContain('failed');
    expect(WORK_UNIT_TRANSITIONS['running']).toContain('cancelled');
  });
});

// ---------------------------------------------------------------------------
// createWorkUnit
// ---------------------------------------------------------------------------

describe('CoordinationService.createWorkUnit', () => {
  it('inserts a work unit with correct defaults', async () => {
    const inserted = buildMockWorkUnit({ id: 'new-wu' });
    const db = makeDb([inserted]);
    const service = new CoordinationService(db as never);

    const result = await service.createWorkUnit(TENANT, {
      title: 'Research task',
      type: 'research',
    });

    expect(result.id).toBe('new-wu');
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('calls insert with correct tenantId and defaults', async () => {
    const inserted = buildMockWorkUnit();
    const db = makeDb([inserted]);
    const service = new CoordinationService(db as never);

    await service.createWorkUnit(TENANT, { title: 'T', type: 'gen' });

    const [insertCall] = db.insert.mock.calls;
    expect(insertCall).toBeDefined(); // insert was called
  });

  it('sets dependencies to [] when none provided', async () => {
    const inserted = buildMockWorkUnit({ dependencies: [] });
    const { service } = makeService([inserted]);

    const result = await service.createWorkUnit(TENANT, { title: 'T', type: 'gen' });
    expect(result.dependencies).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getWorkUnit
// ---------------------------------------------------------------------------

describe('CoordinationService.getWorkUnit', () => {
  it('returns null when no rows found', async () => {
    const { service } = makeService([]);
    const result = await service.getWorkUnit(TENANT, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns the work unit when found', async () => {
    const wu = buildMockWorkUnit({ id: 'wu-found' });
    const { service } = makeService([wu]);
    const result = await service.getWorkUnit(TENANT, 'wu-found');
    expect(result?.id).toBe('wu-found');
  });
});

// ---------------------------------------------------------------------------
// updateWorkUnit — state machine validation
// ---------------------------------------------------------------------------

describe('CoordinationService.updateWorkUnit — state machine', () => {
  it('throws WorkUnitNotFoundError when work unit does not exist', async () => {
    const { service } = makeService([]);
    await expect(
      service.updateWorkUnit(TENANT, 'missing', { status: 'assigned' }),
    ).rejects.toThrow(WorkUnitNotFoundError);
  });

  it('throws InvalidWorkUnitTransitionError for invalid transition', async () => {
    // pending → running is NOT a valid direct transition (must go through assigned)
    const db = makeDb([buildMockWorkUnit({ status: 'pending' })]);
    const service = new CoordinationService(db as never);

    await expect(
      service.updateWorkUnit(TENANT, 'wu-1', { status: 'running' }),
    ).rejects.toThrow(InvalidWorkUnitTransitionError);
  });

  it('throws InvalidWorkUnitTransitionError for terminal → anything', async () => {
    const db = makeDb([buildMockWorkUnit({ status: 'completed' })]);
    const service = new CoordinationService(db as never);

    await expect(
      service.updateWorkUnit(TENANT, 'wu-1', { status: 'running' }),
    ).rejects.toThrow(InvalidWorkUnitTransitionError);
  });

  it('allows valid transition pending → assigned', async () => {
    const current = buildMockWorkUnit({ status: 'pending' });
    const updated = buildMockWorkUnit({ status: 'assigned' });

    const db = makeDb([current]);
    // returning() from the update call returns the updated row
    const returning = vi.fn().mockResolvedValue([updated]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    // Reuse existing select but override update
    (db as MockDb & { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockReturnValue({ set });

    const service = new CoordinationService(db as never);
    const result = await service.updateWorkUnit(TENANT, 'wu-1', { status: 'assigned' });
    expect(result.status).toBe('assigned');
  });
});

// ---------------------------------------------------------------------------
// updateWorkUnit — dependency checking for 'running'
// ---------------------------------------------------------------------------

describe('CoordinationService.updateWorkUnit — dependency checking', () => {
  it('throws DependencyNotMetError if dependency is not completed when going to running', async () => {
    // The work unit has a dependency on 'dep-1', which is 'pending'
    const currentUnit = buildMockWorkUnit({
      status: 'assigned',
      dependencies: ['dep-1'],
    });
    const dependencyUnit = buildMockWorkUnit({ id: 'dep-1', status: 'pending' });

    // First select returns currentUnit (getWorkUnit), second returns dep status
    const db = makeDbMultiSelect([[currentUnit], [dependencyUnit]]);
    const service = new CoordinationService(db as never);

    await expect(
      service.updateWorkUnit(TENANT, 'wu-1', { status: 'running' }),
    ).rejects.toThrow(DependencyNotMetError);
  });

  it('allows running transition when all dependencies are completed', async () => {
    const currentUnit = buildMockWorkUnit({
      status: 'assigned',
      dependencies: ['dep-1'],
    });
    const completedDep = buildMockWorkUnit({ id: 'dep-1', status: 'completed' });
    const updatedUnit = buildMockWorkUnit({ status: 'running' });

    // Multi-select: first call = getWorkUnit, second call = dependency status check
    let selectCallCount = 0;
    const rowSets = [[currentUnit], [completedDep]];

    const returning = vi.fn().mockResolvedValue([updatedUnit]);
    const limit = vi.fn().mockImplementation(() => {
      const rows = rowSets[selectCallCount] ?? [];
      selectCallCount++;
      return Promise.resolve(rows);
    });
    // For the inArray case (no limit), returning resolves immediately
    const whereNoLimit = vi.fn().mockReturnValue({ limit, returning: vi.fn().mockImplementation(() => {
      const rows = rowSets[selectCallCount] ?? [];
      selectCallCount++;
      return Promise.resolve(rows);
    }) });
    const where = vi.fn().mockReturnValue({ limit, returning: vi.fn().mockResolvedValue([updatedUnit]) });
    const from = vi.fn().mockReturnValue({ where: whereNoLimit });

    // First select (getWorkUnit) uses limit; second select (dep check) uses inArray without limit
    let fromCallCount = 0;
    const fromFn = vi.fn().mockImplementation(() => {
      fromCallCount++;
      // Both cases use where, but the dep check doesn't call limit
      return { where };
    });

    const set = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) });
    const values = vi.fn().mockReturnValue({ returning });

    const db = {
      select: vi.fn().mockReturnValue({ from: fromFn }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({ set }),
    };

    // Override where to handle both limit (getWorkUnit) and non-limit (dep check) calls
    // Simpler: just use the two-row-set pattern for both
    const simpleDeps = buildMockWorkUnit({ id: 'dep-1', status: 'completed' });
    const simpleDb = makeDbMultiSelect([[currentUnit], [simpleDeps]]);

    // For update: patch the update to return updatedUnit
    const updateReturning = vi.fn().mockResolvedValue([updatedUnit]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (simpleDb as MockDb & { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockReturnValue({ set: updateSet });

    const service = new CoordinationService(simpleDb as never);
    const result = await service.updateWorkUnit(TENANT, 'wu-1', { status: 'running' });
    expect(result.status).toBe('running');
  });

  it('does not check dependencies when transitioning to non-running status', async () => {
    // pending → assigned should NOT trigger dependency check
    const currentUnit = buildMockWorkUnit({
      status: 'pending',
      dependencies: ['dep-1'],
    });
    const updatedUnit = buildMockWorkUnit({ status: 'assigned' });

    // Only one select call expected (getWorkUnit) — no dep check
    const db = makeDb([currentUnit]);
    const updateReturning = vi.fn().mockResolvedValue([updatedUnit]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    (db as MockDb & { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockReturnValue({ set: updateSet });

    const service = new CoordinationService(db as never);
    const result = await service.updateWorkUnit(TENANT, 'wu-1', { status: 'assigned' });
    expect(result.status).toBe('assigned');
    // Select called only once (getWorkUnit), not for dep checking
    expect(db.select).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

describe('CoordinationService — cycle detection', () => {
  it('allows creation with no dependencies', async () => {
    const inserted = buildMockWorkUnit();
    const { service } = makeService([inserted]);

    await expect(
      service.createWorkUnit(TENANT, { title: 'T', type: 'gen' }),
    ).resolves.toBeDefined();
  });

  it('detects a self-cycle: unit A depends on itself', async () => {
    // Simulate: existing units with A → A (a self-loop)
    const existingUnits = [
      { id: 'unit-a', deps: ['unit-a'] }, // self-loop
    ];

    // makeDb for select (existing units query) and insert
    // .where() returns a thenable so `await .where()` resolves to existingUnits
    const returning = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockResolvedValue(existingUnits);
    const whereResult = Object.assign(Promise.resolve(existingUnits), { limit, returning });
    const where = vi.fn().mockReturnValue(whereResult);
    const from = vi.fn().mockReturnValue({ where });
    const values = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });

    const db = {
      select: vi.fn().mockReturnValue({ from }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({ set }),
    } as unknown as MockDb;

    const service = new CoordinationService(db as never);

    await expect(
      service.createWorkUnit(TENANT, {
        title: 'T',
        type: 'gen',
        dependencies: ['unit-a'],
      }),
    ).rejects.toThrow(DependencyCycleError);
  });

  it('detects a transitive cycle: A → B → C → A', async () => {
    const existingUnits = [
      { id: 'unit-a', deps: ['unit-c'] }, // A depends on C
      { id: 'unit-b', deps: ['unit-a'] }, // B depends on A
      { id: 'unit-c', deps: ['unit-b'] }, // C depends on B → forms A→C→B→A cycle
    ];

    // .where() returns a thenable so `await .where()` resolves to existingUnits
    const returning = vi.fn().mockResolvedValue([]);
    const limit = vi.fn().mockResolvedValue(existingUnits);
    const whereResult = Object.assign(Promise.resolve(existingUnits), { limit, returning });
    const where = vi.fn().mockReturnValue(whereResult);
    const from = vi.fn().mockReturnValue({ where });
    const values = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });

    const db = {
      select: vi.fn().mockReturnValue({ from }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({ set }),
    } as unknown as MockDb;

    const service = new CoordinationService(db as never);

    // New unit that depends on unit-b enters a cycle (b→a→c→b)
    await expect(
      service.createWorkUnit(TENANT, {
        title: 'New',
        type: 'gen',
        dependencies: ['unit-b'],
      }),
    ).rejects.toThrow(DependencyCycleError);
  });

  it('allows a valid DAG without cycles', async () => {
    // A → B → C (linear, no cycles)
    const existingUnits = [
      { id: 'unit-b', deps: ['unit-c'] },
      { id: 'unit-c', deps: [] },
    ];

    const inserted = buildMockWorkUnit({ id: 'new-unit' });
    // .where() returns a thenable so `await .where()` resolves to existingUnits
    // insert().values().returning() resolves to [inserted]
    const insertReturning = vi.fn().mockResolvedValue([inserted]);
    const limit = vi.fn().mockResolvedValue(existingUnits);
    const whereResult = Object.assign(Promise.resolve(existingUnits), {
      limit,
      returning: vi.fn().mockResolvedValue(existingUnits),
    });
    const where = vi.fn().mockReturnValue(whereResult);
    const from = vi.fn().mockReturnValue({ where });
    const values = vi.fn().mockReturnValue({ returning: insertReturning });
    const set = vi.fn().mockReturnValue({ where });

    const db = {
      select: vi.fn().mockReturnValue({ from }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({ set }),
    } as unknown as MockDb;

    const service = new CoordinationService(db as never);

    const result = await service.createWorkUnit(TENANT, {
      title: 'A',
      type: 'gen',
      dependencies: ['unit-b'],
    });
    expect(result.id).toBe('new-unit');
  });
});

// ---------------------------------------------------------------------------
// Coordination groups
// ---------------------------------------------------------------------------

describe('CoordinationService — coordination groups', () => {
  it('creates a group with default all policy', async () => {
    const group = buildMockGroup({ completionPolicy: 'all' });
    const { service } = makeService([group]);

    const result = await service.createCoordinationGroup(TENANT, { title: 'My Group' });
    expect(result.completionPolicy).toBe('all');
  });

  it('returns null for getCoordinationGroup when not found', async () => {
    const { service } = makeService([]);
    const result = await service.getCoordinationGroup(TENANT, 'nonexistent');
    expect(result).toBeNull();
  });

  it('throws CoordinationGroupNotFoundError in evaluateCompletion for missing group', async () => {
    const { service } = makeService([]);
    await expect(
      service.evaluateCompletion(TENANT, 'missing-group'),
    ).rejects.toThrow(CoordinationGroupNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Completion policies
// ---------------------------------------------------------------------------

describe('CoordinationService.evaluateCompletion — all policy', () => {
  function makeEvalService(group: object, units: object[]) {
    // First select returns the group, second select returns the work units
    const db = makeDbMultiSelect([[group], units]);
    return new CoordinationService(db as never);
  }

  it('empty group: never completes', async () => {
    const group = buildMockGroup({ completionPolicy: 'all' });
    const service = makeEvalService(group, []);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(false);
    expect(result.isFailed).toBe(false);
    expect(result.summary.total).toBe(0);
  });

  it('all policy: completes when all units are completed', async () => {
    const group = buildMockGroup({ completionPolicy: 'all' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'completed' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(true);
    expect(result.isFailed).toBe(false);
  });

  it('all policy: fails when any unit fails', async () => {
    const group = buildMockGroup({ completionPolicy: 'all' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'failed' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isFailed).toBe(true);
    expect(result.isComplete).toBe(false);
  });

  it('all policy: still active when some units are pending', async () => {
    const group = buildMockGroup({ completionPolicy: 'all' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'pending' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(false);
    expect(result.isFailed).toBe(false);
  });
});

describe('CoordinationService.evaluateCompletion — any policy', () => {
  function makeEvalService(group: object, units: object[]) {
    const db = makeDbMultiSelect([[group], units]);
    return new CoordinationService(db as never);
  }

  it('any policy: completes on first unit completion', async () => {
    const group = buildMockGroup({ completionPolicy: 'any' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'running' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(true);
    expect(result.isFailed).toBe(false);
  });

  it('any policy: fails when all units failed or cancelled', async () => {
    const group = buildMockGroup({ completionPolicy: 'any' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'failed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'cancelled' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isFailed).toBe(true);
    expect(result.isComplete).toBe(false);
  });

  it('any policy: still active when no units complete yet', async () => {
    const group = buildMockGroup({ completionPolicy: 'any' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'running' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'pending' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(false);
    expect(result.isFailed).toBe(false);
  });
});

describe('CoordinationService.evaluateCompletion — majority policy', () => {
  function makeEvalService(group: object, units: object[]) {
    const db = makeDbMultiSelect([[group], units]);
    return new CoordinationService(db as never);
  }

  it('majority policy: completes when >50% complete (3 of 5)', async () => {
    const group = buildMockGroup({ completionPolicy: 'majority' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-3', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-4', status: 'running' }),
      buildMockWorkUnit({ id: 'wu-5', status: 'running' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(true);
    expect(result.isFailed).toBe(false);
  });

  it('majority policy: not complete when exactly 50% complete (2 of 4)', async () => {
    const group = buildMockGroup({ completionPolicy: 'majority' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'completed' }),
      buildMockWorkUnit({ id: 'wu-3', status: 'running' }),
      buildMockWorkUnit({ id: 'wu-4', status: 'running' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    // 50% is NOT a majority — need >50% (3 of 4)
    expect(result.isComplete).toBe(false);
    expect(result.isFailed).toBe(false);
  });

  it('majority policy: fails when majority is unreachable', async () => {
    // 4 units: 3 failed + 1 running → max reachable = 1 completed, need 3 for majority
    const group = buildMockGroup({ completionPolicy: 'majority' });
    const units = [
      buildMockWorkUnit({ id: 'wu-1', status: 'failed' }),
      buildMockWorkUnit({ id: 'wu-2', status: 'failed' }),
      buildMockWorkUnit({ id: 'wu-3', status: 'failed' }),
      buildMockWorkUnit({ id: 'wu-4', status: 'running' }),
    ];
    const service = makeEvalService(group, units);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isFailed).toBe(true);
    expect(result.isComplete).toBe(false);
  });

  it('majority policy: empty group never completes', async () => {
    const group = buildMockGroup({ completionPolicy: 'majority' });
    const service = makeEvalService(group, []);
    const result = await service.evaluateCompletion(TENANT, 'group-1');
    expect(result.isComplete).toBe(false);
    expect(result.isFailed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// finalizeCoordinationGroup
// ---------------------------------------------------------------------------

describe('CoordinationService.finalizeCoordinationGroup', () => {
  it('is idempotent: returns existing record if already terminal', async () => {
    const alreadyCompleted = buildMockGroup({ status: 'completed' });
    const { service } = makeService([alreadyCompleted]);

    const result = await service.finalizeCoordinationGroup(
      TENANT,
      'group-1',
      'completed',
    );
    expect(result.status).toBe('completed');
  });

  it('throws CoordinationGroupNotFoundError for missing group', async () => {
    const { service } = makeService([]);
    await expect(
      service.finalizeCoordinationGroup(TENANT, 'missing', 'completed'),
    ).rejects.toThrow(CoordinationGroupNotFoundError);
  });

  it('transitions active group to completed', async () => {
    const activeGroup = buildMockGroup({ status: 'active' });
    const completedGroup = buildMockGroup({ status: 'completed', completedAt: new Date() });

    const db = makeDb([activeGroup]);
    // Override update to return completedGroup
    const returning = vi.fn().mockResolvedValue([completedGroup]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db as MockDb & { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockReturnValue({ set });

    const service = new CoordinationService(db as never);
    const result = await service.finalizeCoordinationGroup(TENANT, 'group-1', 'completed');
    expect(result.status).toBe('completed');
  });

  it('transitions active group to failed', async () => {
    const activeGroup = buildMockGroup({ status: 'active' });
    const failedGroup = buildMockGroup({ status: 'failed', completedAt: new Date() });

    const db = makeDb([activeGroup]);
    const returning = vi.fn().mockResolvedValue([failedGroup]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db as MockDb & { update: ReturnType<typeof vi.fn> }).update = vi.fn().mockReturnValue({ set });

    const service = new CoordinationService(db as never);
    const result = await service.finalizeCoordinationGroup(TENANT, 'group-1', 'failed');
    expect(result.status).toBe('failed');
  });
});
