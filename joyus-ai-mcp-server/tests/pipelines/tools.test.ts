/**
 * Tests for Pipeline MCP Tool Definitions and Executor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pipelineTools } from '../../src/tools/pipeline-tools.js';
import { executePipelineTool } from '../../src/tools/executors/pipeline-executor.js';
import type { PipelineExecutorContext } from '../../src/tools/executors/pipeline-executor.js';

// ============================================================
// HELPERS
// ============================================================

function makeMockDb() {
  let selectCallIndex = 0;
  let selectResults: unknown[][] = [[]];

  /**
   * Create a chainable query result object that is also an array.
   * Uses lazy mockImplementation to avoid infinite recursion.
   */
  function makeChainable(results: unknown[]) {
    // Create a real array so spread/iteration works
    const arr = [...results];
    // Attach query chain methods that return the same shape
    const chainMethods = {
      where: vi.fn().mockImplementation(() => makeChainable(results)),
      limit: vi.fn().mockImplementation(() => makeChainable(results)),
      offset: vi.fn().mockImplementation(() => makeChainable(results)),
      orderBy: vi.fn().mockImplementation(() => makeChainable(results)),
    };
    return Object.assign(arr, chainMethods);
  }

  const db = {
    _setSelectResults(results: unknown[][]) {
      selectResults = results;
      selectCallIndex = 0;
    },
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        return {
          returning: vi.fn().mockResolvedValue(arr),
        };
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
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

function makeMockContext(db: ReturnType<typeof makeMockDb>): PipelineExecutorContext {
  return {
    tenantId: 'tenant-a',
    db: db as unknown as PipelineExecutorContext['db'],
    stepRegistry: {
      validateStepConfig: vi.fn().mockReturnValue([]),
      register: vi.fn(),
      getHandler: vi.fn(),
      getRegisteredTypes: vi.fn().mockReturnValue([]),
    } as unknown as PipelineExecutorContext['stepRegistry'],
    decisionRecorder: {
      recordDecision: vi.fn().mockResolvedValue({
        allDecisionsComplete: true,
        executionId: 'exec-1',
      }),
    } as unknown as PipelineExecutorContext['decisionRecorder'],
    eventBus: {
      publish: vi.fn().mockResolvedValue('event-abc'),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      close: vi.fn(),
    } as unknown as PipelineExecutorContext['eventBus'],
  };
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================

describe('Pipeline Tool Definitions', () => {
  it('exports exactly 8 tool definitions', () => {
    expect(pipelineTools).toHaveLength(8);
  });

  it('all tools have required shape', () => {
    for (const tool of pipelineTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('includes expected tool names', () => {
    const names = pipelineTools.map((t) => t.name);
    expect(names).toContain('pipeline_create');
    expect(names).toContain('pipeline_list');
    expect(names).toContain('pipeline_trigger');
    expect(names).toContain('pipeline_status');
    expect(names).toContain('pipeline_history');
    expect(names).toContain('review_decide');
    expect(names).toContain('template_list');
    expect(names).toContain('template_instantiate');
  });
});

// ============================================================
// TOOL EXECUTOR
// ============================================================

describe('Pipeline Tool Executor', () => {
  let db: ReturnType<typeof makeMockDb>;
  let context: PipelineExecutorContext;

  beforeEach(() => {
    db = makeMockDb();
    context = makeMockContext(db);
  });

  describe('pipeline_create', () => {
    it('creates a pipeline with valid input', async () => {
      // Selects: 1) existing pipelines count, 2) all pipelines for cycle, 3) all steps for cycle
      db._setSelectResults([[], [], []]);

      const result = await executePipelineTool(
        'pipeline_create',
        {
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
        context,
      );

      expect(result).toBeDefined();
      const data = result as { pipeline: Record<string, unknown> };
      expect(data.pipeline).toBeDefined();
      expect(data.pipeline.name).toBe('Test Pipeline');
    });

    it('throws on invalid input', async () => {
      await expect(
        executePipelineTool('pipeline_create', { name: '' }, context),
      ).rejects.toThrow();
    });
  });

  describe('pipeline_list', () => {
    it('returns tenant-scoped pipelines', async () => {
      const pipelineRows = [
        { id: 'pipe-1', tenantId: 'tenant-a', name: 'Pipeline A' },
      ];
      db._setSelectResults([pipelineRows]);

      const result = await executePipelineTool('pipeline_list', {}, context);

      const data = result as { pipelines: unknown[] };
      expect(data.pipelines).toBeDefined();
    });
  });

  describe('pipeline_trigger', () => {
    it('publishes a manual_request event', async () => {
      const pipeline = {
        id: 'pipe-1',
        tenantId: 'tenant-a',
        name: 'Test',
        status: 'active',
      };
      db._setSelectResults([[pipeline]]);

      const result = await executePipelineTool(
        'pipeline_trigger',
        { pipelineId: 'pipe-1' },
        context,
      );

      const data = result as { eventId: string; status: string };
      expect(data.eventId).toBe('event-abc');
      expect(data.status).toBe('triggered');
    });
  });

  describe('pipeline_status', () => {
    it('returns pipeline with steps', async () => {
      const pipeline = {
        id: 'pipe-1',
        tenantId: 'tenant-a',
        name: 'Test',
      };
      const steps = [{ id: 'step-1', position: 0 }];
      db._setSelectResults([[pipeline], steps]);

      const result = await executePipelineTool(
        'pipeline_status',
        { pipelineId: 'pipe-1' },
        context,
      );

      const data = result as { pipeline: { steps: unknown[] } };
      expect(data.pipeline).toBeDefined();
    });
  });

  describe('template_list', () => {
    it('returns active templates', async () => {
      const templates = [
        {
          id: 'tmpl-1',
          name: 'Content Pipeline',
          description: 'Standard content pipeline',
          category: 'content',
          parameters: {},
          assumptions: [],
          version: 1,
          tenantId: null,
          isActive: true,
        },
      ];
      db._setSelectResults([templates]);

      const result = await executePipelineTool('template_list', {}, context);

      const data = result as { templates: Array<{ isBuiltIn: boolean }> };
      expect(data.templates).toHaveLength(1);
      expect(data.templates[0].isBuiltIn).toBe(true);
    });
  });

  describe('review_decide', () => {
    it('delegates to DecisionRecorder', async () => {
      const result = await executePipelineTool(
        'review_decide',
        { decisionId: 'dec-1', status: 'approved' },
        context,
      );

      expect(result).toEqual({
        allDecisionsComplete: true,
        executionId: 'exec-1',
      });
      expect(context.decisionRecorder.recordDecision).toHaveBeenCalledWith(
        'dec-1',
        'tenant-a',
        'approved',
        'tenant-a',
        undefined,
      );
    });
  });

  it('throws for unknown tool name', async () => {
    await expect(
      executePipelineTool('pipeline_unknown', {}, context),
    ).rejects.toThrow('Unknown pipeline tool');
  });
});
