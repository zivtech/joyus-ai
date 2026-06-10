import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { pipelines } from '../../src/pipelines/schema.js';

describe('Pipeline schema', () => {
  it('indexes tenant and name without treating name as a natural key', () => {
    const config = getTableConfig(pipelines);
    const indexes = config.indexes.map((index) => index.config);

    expect(indexes.some((index) => index.name === 'pipelines_tenant_name_unique')).toBe(false);

    const tenantNameIndex = indexes.find((index) => index.name === 'pipelines_tenant_name_idx');
    expect(tenantNameIndex).toBeDefined();
    expect(tenantNameIndex?.unique).toBe(false);
    expect(tenantNameIndex?.columns.map((column) => column.name)).toEqual([
      'tenant_id',
      'name',
    ]);
  });
});
