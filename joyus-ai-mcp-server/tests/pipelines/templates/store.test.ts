/**
 * Tests for TemplateStore.
 *
 * Uses a reference-equality stub of NodePgDatabase (same pattern as executor.test.ts)
 * to verify TemplateStore logic without requiring a live database connection.
 *
 * Covers:
 *   - createTemplate inserts and returns a template
 *   - listTemplates with no filter returns stored rows
 *   - listTemplates with category/isActive filter does not throw
 *   - getTemplateByName returns undefined when empty
 *   - getTemplateByName returns first matching row
 *   - instantiate substitutes required parameters into string fields
 *   - instantiate uses defaults for optional parameters
 *   - instantiate rejects missing required parameter with no default
 *   - instantiate throws when template does not exist
 *   - instantiate creates pipeline and step rows
 *   - seedBuiltInTemplates seeds 3 built-in templates
 *   - seedBuiltInTemplates is idempotent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  pipelineTemplates as pipelineTemplatesTable,
  pipelines as pipelinesTable,
  pipelineSteps as pipelineStepsTable,
  pipelineExecutions as pipelineExecutionsTable,
} from '../../../src/pipelines/schema.js';
import { TemplateStore } from '../../../src/pipelines/templates/store.js';
import { seedBuiltInTemplates } from '../../../src/pipelines/templates/index.js';
import type { CreateTemplateInput } from '../../../src/pipelines/templates/store.js';
import type { PipelineTemplate } from '../../../src/pipelines/schema.js';

// ── Drizzle condition value extractor ─────────────────────────────────────────

/**
 * Extracts the right-hand scalar value from a drizzle eq() SQL condition.
 *
 * eq(col, val) produces:
 *   SQL { queryChunks: [StringChunk(""), Column, StringChunk(" = "), Param{value}, StringChunk("")] }
 *
 * Param chunks have a .value that is the user-supplied scalar.
 * StringChunk chunks have .value that is a SQL-syntax string like "" or " = ".
 * Column chunks have a .name property.
 *
 * For and(eq1, eq2) the outer SQL wraps inner SQLs — we recurse until we find a scalar.
 */
function extractSqlEqValue(cond: unknown): unknown {
  if (cond === null || typeof cond !== 'object') return undefined;

  const obj = cond as Record<string, unknown>;
  const chunks = obj['queryChunks'];
  if (!Array.isArray(chunks)) return undefined;

  // SQL-syntax strings produced by drizzle tagged templates (not user data)
  const isSqlSyntax = (v: unknown): boolean =>
    typeof v === 'string' && (v === '' || v === ' = ' || v === ' <> ' || v === '(' || v === ')' || /^ (and|or) $/.test(v));

  for (const chunk of chunks as unknown[]) {
    if (chunk === null || typeof chunk !== 'object') continue;
    const c = chunk as Record<string, unknown>;

    // Skip Column objects (they have .name and .table)
    if ('name' in c && 'table' in c) continue;

    // Recurse into nested SQL objects (e.g. from and())
    if ('queryChunks' in c) {
      const nested = extractSqlEqValue(c);
      if (nested !== undefined) return nested;
      continue;
    }

    // Param object: has .value that is a user-supplied scalar
    if ('value' in c) {
      const v = c['value'];
      if (!isSqlSyntax(v) && (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number')) {
        return v;
      }
    }
  }

  return undefined;
}

// ── DB Stub ───────────────────────────────────────────────────────────────────

type AnyRow = Record<string, unknown>;

function createMockDb(options: {
  templateRows?: AnyRow[];
  pipelineRows?: AnyRow[];
  stepRows?: AnyRow[];
  executionRows?: AnyRow[];
} = {}) {
  const templateRows: AnyRow[] = options.templateRows ? [...options.templateRows] : [];
  const pipelineRows: AnyRow[] = options.pipelineRows ? [...options.pipelineRows] : [];
  const stepRows: AnyRow[] = options.stepRows ? [...options.stepRows] : [];

  let idCounter = 0;
  const nextId = () => `stub-${++idCounter}`;

  function rowsFor(table: unknown): AnyRow[] {
    if (table === pipelineTemplatesTable) return templateRows;
    if (table === pipelinesTable) return pipelineRows;
    if (table === pipelineStepsTable) return stepRows;
    if (table === pipelineExecutionsTable) return options.executionRows ?? [];
    return [];
  }

  const db = {
    _templateRows: templateRows,
    _pipelineRows: pipelineRows,
    _stepRows: stepRows,

    select: () => ({
      from: (table: unknown) => {
        const rows = rowsFor(table);
        return {
          where: (cond: unknown) => {
            // Extract the right-hand value from a drizzle eq() / and() condition.
            // eq(col, val) uses sql`${col} = ${Param(val)}` producing queryChunks:
            //   [StringChunk(""), Column, StringChunk(" = "), Param{value}, StringChunk("")]
            // StringChunk.value is a SQL-syntax string like "" or " = ".
            // Param.value is the user-supplied filter value.
            // We find the Param by: it has .value that is a non-empty, non-SQL-operator string
            // (or a boolean/number), and it is NOT a Column (columns have .name).
            // For and(cond1, cond2) the outer SQL wraps inner SQLs — we recurse.
            const rhsValue = extractSqlEqValue(cond);
            const filtered = (rhsValue !== undefined)
              ? rows.filter((r) => Object.values(r).some((v) => v === rhsValue))
              : rows;
            return {
              orderBy: (_field: unknown) => Promise.resolve([...filtered]),
              limit: (n: number) => Promise.resolve(filtered.slice(0, n)),
            };
          },
          orderBy: (_field: unknown) => Promise.resolve([...rows]),
        };
      },
    }),

    insert: (table: unknown) => ({
      values: (vals: AnyRow) => {
        const row: AnyRow = { ...vals, id: (vals['id'] as string | undefined) ?? nextId() };
        rowsFor(table).push(row);
        return {
          returning: () => Promise.resolve([row]),
        };
      },
    }),

    update: (table: unknown) => ({
      set: (vals: AnyRow) => ({
        where: (_cond: unknown) => {
          const rows = rowsFor(table);
          for (let i = 0; i < rows.length; i++) {
            rows[i] = { ...rows[i]!, ...vals };
          }
          return {
            returning: () => Promise.resolve(rows.slice(0, 1)),
          };
        },
      }),
    }),
  };

  return db;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSimpleTemplateInput(): CreateTemplateInput {
  return {
    name: 'Simple Template',
    description: 'Template with params',
    category: 'test',
    definition: {
      triggerType: 'schedule_tick',
      triggerConfig: {
        type: 'schedule_tick',
        cronExpression: '{{cronExpression}}',
        timezone: '{{timezone}}',
      },
      steps: [
        {
          name: 'Step {{stepName}}',
          stepType: 'notification',
          config: {
            type: 'notification',
            channel: 'email',
            message: 'Hello {{recipient}}',
          },
        },
      ],
    },
    parameters: [
      { name: 'cronExpression', type: 'string', required: true },
      { name: 'timezone', type: 'string', required: false, default: 'UTC' },
      { name: 'stepName', type: 'string', required: true },
      { name: 'recipient', type: 'string', required: false, default: 'admin@example.com' },
    ],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TemplateStore', () => {
  let db: ReturnType<typeof createMockDb>;
  let store: TemplateStore;

  beforeEach(() => {
    db = createMockDb();
    store = new TemplateStore(db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase);
  });

  // ── createTemplate ─────────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('inserts and returns a template with version 1 and isActive true', async () => {
      const template = await store.createTemplate({
        name: 'Test Template',
        description: 'A test template',
        category: 'testing',
        definition: {
          triggerType: 'manual_request',
          triggerConfig: { type: 'manual_request' },
          steps: [],
        },
        parameters: [],
        assumptions: ['one assumption'],
      });

      expect(template.name).toBe('Test Template');
      expect(template.version).toBe(1);
      expect(template.isActive).toBe(true);
      expect(typeof template.id).toBe('string');
    });

    it('stores the row in _templateRows', async () => {
      await store.createTemplate({
        name: 'Stored',
        description: 'desc',
        category: 'cat',
        definition: { triggerType: 'manual_request', triggerConfig: { type: 'manual_request' }, steps: [] },
        parameters: [],
      });
      expect(db._templateRows).toHaveLength(1);
      expect(db._templateRows[0]!['name']).toBe('Stored');
    });
  });

  // ── listTemplates ──────────────────────────────────────────────────────────

  describe('listTemplates', () => {
    beforeEach(async () => {
      await store.createTemplate({
        name: 'Alpha',
        description: 'desc',
        category: 'alpha',
        definition: { triggerType: 'manual_request', triggerConfig: { type: 'manual_request' }, steps: [] },
        parameters: [],
      });
      await store.createTemplate({
        name: 'Beta',
        description: 'desc',
        category: 'beta',
        definition: { triggerType: 'manual_request', triggerConfig: { type: 'manual_request' }, steps: [] },
        parameters: [],
      });
    });

    it('returns all stored templates when no filter is given', async () => {
      const results = await store.listTemplates();
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('accepts a category filter without throwing', async () => {
      const results = await store.listTemplates({ category: 'alpha' });
      expect(Array.isArray(results)).toBe(true);
    });

    it('accepts an isActive filter without throwing', async () => {
      const results = await store.listTemplates({ isActive: true });
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ── getTemplateByName ──────────────────────────────────────────────────────

  describe('getTemplateByName', () => {
    it('returns undefined when the table is empty', async () => {
      const result = await store.getTemplateByName('NonExistent');
      expect(result).toBeUndefined();
    });

    it('returns the row when a template has been created', async () => {
      await store.createTemplate({
        name: 'My Template',
        description: 'desc',
        category: 'test',
        definition: { triggerType: 'manual_request', triggerConfig: { type: 'manual_request' }, steps: [] },
        parameters: [],
      });

      // The stub returns the first template row for any getTemplateByName call
      // (limit 1 on the full table). With a single row, this works correctly.
      const result = await store.getTemplateByName('My Template');
      expect(result?.name).toBe('My Template');
    });
  });

  // ── instantiate ───────────────────────────────────────────────────────────

  describe('instantiate', () => {
    it('throws when template does not exist', async () => {
      await expect(
        store.instantiate('nonexistent-id', 'tenant-1', {}),
      ).rejects.toThrow('Template not found');
    });

    it('substitutes required parameters into string fields', async () => {
      const template = await store.createTemplate(makeSimpleTemplateInput());
      const pipeline = await store.instantiate(
        template.id,
        'tenant-1',
        { cronExpression: '0 8 * * *', stepName: 'Alpha' },
      );

      expect(pipeline.id).toBeDefined();
      expect(pipeline.tenantId).toBe('tenant-1');
      expect(pipeline.templateId).toBe(template.id);

      const config = pipeline.triggerConfig as Record<string, unknown>;
      expect(config['cronExpression']).toBe('0 8 * * *');
    });

    it('substitutes default values for optional parameters', async () => {
      const template = await store.createTemplate(makeSimpleTemplateInput());
      const pipeline = await store.instantiate(
        template.id,
        'tenant-1',
        { cronExpression: '0 9 * * *', stepName: 'Beta' },
      );

      const config = pipeline.triggerConfig as Record<string, unknown>;
      // timezone has default 'UTC'
      expect(config['timezone']).toBe('UTC');
    });

    it('rejects when a required parameter with no default is missing', async () => {
      const template = await store.createTemplate(makeSimpleTemplateInput());
      // stepName is required with no default
      await expect(
        store.instantiate(template.id, 'tenant-1', { cronExpression: '0 8 * * *' }),
      ).rejects.toThrow('Missing required parameter: stepName');
    });

    it('creates pipeline and step rows in the db', async () => {
      const template = await store.createTemplate(makeSimpleTemplateInput());
      await store.instantiate(
        template.id,
        'tenant-1',
        { cronExpression: '*/5 * * * *', stepName: 'Gamma' },
      );

      // One pipeline row (the template itself is in templateRows)
      const pipelines = db._pipelineRows;
      expect(pipelines.length).toBeGreaterThanOrEqual(1);

      // One step row (makeSimpleTemplateInput has 1 step)
      const steps = db._stepRows;
      expect(steps.length).toBeGreaterThanOrEqual(1);
    });

    it('deep clones the definition — original template is not mutated', async () => {
      const template = await store.createTemplate(makeSimpleTemplateInput());
      const beforeConfig = JSON.stringify(db._templateRows[0]!['definition']);

      await store.instantiate(
        template.id,
        'tenant-1',
        { cronExpression: '0 1 * * *', stepName: 'Delta' },
      );

      const afterConfig = JSON.stringify(db._templateRows[0]!['definition']);
      expect(afterConfig).toBe(beforeConfig);
    });
  });
});

// ── seedBuiltInTemplates ──────────────────────────────────────────────────────

describe('seedBuiltInTemplates', () => {
  it('seeds all three built-in templates', async () => {
    const db = createMockDb();
    const store = new TemplateStore(db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase);

    await seedBuiltInTemplates(store);

    expect(db._templateRows).toHaveLength(3);
    const names = db._templateRows.map((r) => r['name'] as string);
    expect(names).toContain('Corpus Update → Profile Regeneration');
    expect(names).toContain('Regulatory Change Monitor');
    expect(names).toContain('Scheduled Content Audit');
  });

  it('is idempotent — calling twice does not create duplicates', async () => {
    const db = createMockDb();
    const store = new TemplateStore(db as unknown as import('drizzle-orm/node-postgres').NodePgDatabase);

    await seedBuiltInTemplates(store);
    const countAfterFirst = db._templateRows.length;

    await seedBuiltInTemplates(store);
    const countAfterSecond = db._templateRows.length;

    expect(countAfterFirst).toBe(3);
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

// Avoid TS unused-import warning for PipelineTemplate
type _PipelineTemplateCheck = PipelineTemplate;
