/**
 * Tests for Pipeline Express Routes
 *
 * Tests route handler logic directly using mock req/res pattern
 * (matching existing test patterns in this codebase).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPipelineRouter } from '../../src/pipelines/routes.js';
import type { PipelineRouterDeps } from '../../src/pipelines/routes.js';
import type { Request, Response } from 'express';

vi.mock('../../src/inngest/client.js', () => ({
  inngest: { send: vi.fn().mockResolvedValue(undefined) },
}));

// ============================================================
// MOCK FACTORIES
// ============================================================

function makeMockDb() {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  let selectResults: unknown[][] = [[]];
  let selectCallIndex = 0;

  /**
   * Create a chainable query result that is also a real array.
   * Uses lazy mockImplementation to avoid infinite recursion.
   */
  function makeChainable(results: unknown[]) {
    const arr = [...results];
    const chainMethods = {
      where: vi.fn().mockImplementation(() => makeChainable(results)),
      limit: vi.fn().mockImplementation(() => makeChainable(results)),
      offset: vi.fn().mockImplementation(() => makeChainable(results)),
      orderBy: vi.fn().mockImplementation(() => makeChainable(results)),
    };
    return Object.assign(arr, chainMethods);
  }

  const db = {
    _insertedRows: insertedRows,
    _updatedRows: updatedRows,
    _setSelectResults(results: unknown[][]) {
      selectResults = results;
      selectCallIndex = 0;
    },
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        insertedRows.push(...arr);
        return {
          returning: vi.fn().mockResolvedValue(arr),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((data: Record<string, unknown>) => ({
        where: vi.fn().mockImplementation(() => {
          updatedRows.push(data);
          return Promise.resolve();
        }),
      })),
    })),
    select: vi.fn().mockImplementation(() => {
      const callIdx = selectCallIndex++;
      const results = selectResults[callIdx] ?? [];
      return {
        from: vi.fn().mockImplementation(() => makeChainable(results)),
      };
    }),
    delete: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return db;
}

function makeMockStepRegistry() {
  return {
    validateStepConfig: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    getHandler: vi.fn(),
    getRegisteredTypes: vi.fn().mockReturnValue([]),
  };
}

function makeMockDecisionRecorder() {
  return {
    recordDecision: vi.fn().mockResolvedValue({
      allDecisionsComplete: true,
      executionId: 'exec-1',
    }),
    areAllDecisionsComplete: vi.fn().mockResolvedValue(true),
  };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    session: {},
    // Simulate authenticated user set by requireBearerToken middleware
    mcpUser: { id: 'tenant-a' },
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response & { _status: number; _json: unknown; _sent: boolean } {
  const res = {
    _status: 200,
    _json: null as unknown,
    _sent: false,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: unknown) {
      res._json = data;
      res._sent = true;
      return res;
    },
    send() {
      res._sent = true;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown; _sent: boolean };
}

// ============================================================
// ROUTE HANDLER EXTRACTION
// ============================================================

/**
 * Extract route handler from router for testing.
 * Express stores route info in router.stack.
 */
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
  };
}

interface RouterWithStack {
  stack: RouteLayer[];
}

function getHandler(
  router: ReturnType<typeof createPipelineRouter>,
  method: string,
  path: string,
): ((req: Request, res: Response) => Promise<void>) | undefined {
  const stack = (router as unknown as RouterWithStack).stack;
  for (const layer of stack) {
    if (
      layer.route &&
      layer.route.path === path &&
      layer.route.methods[method.toLowerCase()]
    ) {
      return layer.route.stack[0]?.handle;
    }
  }
  return undefined;
}

// ============================================================
// TESTS
// ============================================================

describe('Pipeline Routes', () => {
  let db: ReturnType<typeof makeMockDb>;
  let stepRegistry: ReturnType<typeof makeMockStepRegistry>;
  let decisionRecorder: ReturnType<typeof makeMockDecisionRecorder>;
  let router: ReturnType<typeof createPipelineRouter>;

  beforeEach(() => {
    db = makeMockDb();
    stepRegistry = makeMockStepRegistry();
    decisionRecorder = makeMockDecisionRecorder();

    const deps: PipelineRouterDeps = {
      db: db as unknown as PipelineRouterDeps['db'],
      stepRegistry: stepRegistry as unknown as PipelineRouterDeps['stepRegistry'],
      decisionRecorder: decisionRecorder as unknown as PipelineRouterDeps['decisionRecorder'],
    };

    router = createPipelineRouter(deps);
  });

  describe('POST /pipelines', () => {
    it('creates a pipeline with valid input', async () => {
      const handler = getHandler(router, 'post', '/pipelines');
      expect(handler).toBeDefined();

      // First select: existing pipelines count (empty)
      // Second select: existing pipelines for cycle check
      // Third select: existing steps for cycle check
      db._setSelectResults([[], [], []]);

      const req = makeReq({
        body: {
          name: 'Test Pipeline',
          triggerType: 'manual_request',
          triggerConfig: { type: 'manual_request' },
          steps: [
            {
              name: 'Notify',
              stepType: 'notification',
              config: {
                type: 'notification',
                channel: 'email',
                message: 'Pipeline complete',
              },
            },
          ],
        },
      });

      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(201);
      expect(res._json).toBeDefined();
      const data = res._json as { pipeline: Record<string, unknown> };
      expect(data.pipeline).toBeDefined();
      expect(data.pipeline.name).toBe('Test Pipeline');
    });

    it('returns 400 for invalid input', async () => {
      const handler = getHandler(router, 'post', '/pipelines');
      expect(handler).toBeDefined();

      const req = makeReq({
        body: { name: '' }, // missing required fields
      });

      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(400);
    });

    it('returns 409 when tenant limit reached', async () => {
      const handler = getHandler(router, 'post', '/pipelines');
      expect(handler).toBeDefined();

      // Return 20 existing pipelines (MAX_PIPELINES_PER_TENANT)
      const existingPipelines = Array.from({ length: 20 }, (_, i) => ({
        id: `pipe-${i}`,
      }));
      db._setSelectResults([existingPipelines]);

      const req = makeReq({
        body: {
          name: 'Test Pipeline',
          triggerType: 'manual_request',
          triggerConfig: { type: 'manual_request' },
          steps: [
            {
              name: 'Notify',
              stepType: 'notification',
              config: {
                type: 'notification',
                channel: 'email',
                message: 'Done',
              },
            },
          ],
        },
      });

      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(409);
      expect((res._json as { error: string }).error).toContain('limit');
    });

    it('returns 401 when no tenant context', async () => {
      const handler = getHandler(router, 'post', '/pipelines');
      expect(handler).toBeDefined();

      // Simulate unauthenticated request: no mcpUser, no session
      const req = makeReq({ headers: {}, mcpUser: undefined } as unknown as Partial<Request>);
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(401);
    });
  });

  describe('GET /pipelines', () => {
    it('returns tenant-scoped pipelines', async () => {
      const handler = getHandler(router, 'get', '/pipelines');
      expect(handler).toBeDefined();

      const pipelineRows = [
        { id: 'pipe-1', tenantId: 'tenant-a', name: 'Pipeline A', status: 'active' },
      ];
      db._setSelectResults([pipelineRows]);

      const req = makeReq({ query: {} });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(200);
      const data = res._json as { pipelines: unknown[] };
      expect(data.pipelines).toBeDefined();
    });
  });

  describe('GET /pipelines/:id', () => {
    it('returns 404 for wrong tenant', async () => {
      const handler = getHandler(router, 'get', '/pipelines/:id');
      expect(handler).toBeDefined();

      // Pipeline not found for this tenant
      db._setSelectResults([[]]);

      const req = makeReq({ params: { id: 'pipe-999' } });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(404);
    });

    it('returns pipeline with steps', async () => {
      const handler = getHandler(router, 'get', '/pipelines/:id');
      expect(handler).toBeDefined();

      const pipeline = {
        id: 'pipe-1',
        tenantId: 'tenant-a',
        name: 'Test Pipeline',
        status: 'active',
      };
      const steps = [
        { id: 'step-1', pipelineId: 'pipe-1', position: 0, name: 'Step 1' },
      ];
      db._setSelectResults([[pipeline], steps]);

      const req = makeReq({ params: { id: 'pipe-1' } });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(200);
      const data = res._json as { pipeline: { steps: unknown[] } };
      expect(data.pipeline.steps).toBeDefined();
    });
  });

  describe('POST /pipelines/:id/trigger', () => {
    it('returns 202 with event ID for active pipeline', async () => {
      const handler = getHandler(router, 'post', '/pipelines/:id/trigger');
      expect(handler).toBeDefined();

      const pipeline = {
        id: 'pipe-1',
        tenantId: 'tenant-a',
        name: 'Test',
        status: 'active',
      };
      db._setSelectResults([[pipeline]]);

      const req = makeReq({ params: { id: 'pipe-1' }, body: {} });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(202);
      const data = res._json as { eventId: string; pipelineId: string };
      expect(typeof data.eventId).toBe('string');
      expect(data.eventId.length).toBeGreaterThan(0);
      expect(data.pipelineId).toBe('pipe-1');

      const { inngest } = await import('../../src/inngest/client.js');
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'pipeline/manual.triggered',
          data: expect.objectContaining({ tenantId: 'tenant-a', pipelineId: 'pipe-1' }),
        }),
      );
    });

    it('returns 400 for paused pipeline', async () => {
      const handler = getHandler(router, 'post', '/pipelines/:id/trigger');
      expect(handler).toBeDefined();

      const pipeline = {
        id: 'pipe-1',
        tenantId: 'tenant-a',
        name: 'Test',
        status: 'paused',
      };
      db._setSelectResults([[pipeline]]);

      const req = makeReq({ params: { id: 'pipe-1' } });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(400);
    });
  });

  describe('POST /executions/:id/cancel', () => {
    it('cancels a paused_at_gate execution', async () => {
      const handler = getHandler(router, 'post', '/executions/:id/cancel');
      expect(handler).toBeDefined();

      const execution = {
        id: 'exec-1',
        tenantId: 'tenant-a',
        status: 'paused_at_gate',
      };
      db._setSelectResults([[execution]]);

      const req = makeReq({ params: { id: 'exec-1' } });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(200);
      const data = res._json as { status: string };
      expect(data.status).toBe('cancelled');
    });

    it('returns 400 for non-cancellable execution', async () => {
      const handler = getHandler(router, 'post', '/executions/:id/cancel');
      expect(handler).toBeDefined();

      const execution = {
        id: 'exec-1',
        tenantId: 'tenant-a',
        status: 'completed',
      };
      db._setSelectResults([[execution]]);

      const req = makeReq({ params: { id: 'exec-1' } });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(400);
    });
  });

  describe('POST /review-decisions/:id/decide', () => {
    it('delegates to DecisionRecorder', async () => {
      const handler = getHandler(router, 'post', '/review-decisions/:id/decide');
      expect(handler).toBeDefined();

      const req = makeReq({
        params: { id: 'dec-1' },
        body: { status: 'approved' },
      });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(200);
      expect(decisionRecorder.recordDecision).toHaveBeenCalledWith(
        'dec-1',
        'tenant-a',
        'approved',
        'tenant-a',
        undefined,
      );
    });

    it('returns 404 for cross-tenant decision', async () => {
      const handler = getHandler(router, 'post', '/review-decisions/:id/decide');
      expect(handler).toBeDefined();

      decisionRecorder.recordDecision.mockRejectedValueOnce(
        new Error('Cross-tenant access denied for decision: dec-1'),
      );

      const req = makeReq({
        params: { id: 'dec-1' },
        body: { status: 'approved' },
      });
      const res = makeRes();
      await handler!(req, res);

      expect(res._status).toBe(404);
    });
  });
});
