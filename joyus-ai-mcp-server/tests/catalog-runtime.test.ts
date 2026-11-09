import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCatalogRuntime, resetCatalogRuntimeForTests } from '../src/skills/catalog/runtime.js';
import { tenantEntry, buildPolicy } from './catalog-fixtures.js';
import { catalogAuditInput } from '../src/skills/catalog/tool.js';
import { handleMcpToolCall } from '../src/tools/mcp-call.js';

afterEach(() => resetCatalogRuntimeForTests());
const base = () => ({
  CATALOG_REFRESH_AUTH_SECRET_ALIAS: 'REFRESH_SECRET', CATALOG_CURSOR_KEY_ALIAS: 'CURSOR_SECRET',
  CATALOG_POLICY_BUCKET: 'synthetic-bucket', CATALOG_POLICY_REGION: 'us-east-1', CATALOG_POLICY_KEY: 'synthetic.json',
  CURSOR_SECRET: 'a'.repeat(64), REFRESH_SECRET: 'synthetic-refresh-secret',
  POLICY_SERVICE_URL: 'http://policy.example', POLICY_SERVICE_TOKEN: 'synthetic-policy-secret',
});
describe('catalog runtime startup gates', () => {
  it('requires a separate valid cursor key and complete service configuration when enabled', () => {
    expect(() => getCatalogRuntime({ ...base(), CURSOR_SECRET: 'invalid' })).toThrow('cursor key');
    resetCatalogRuntimeForTests();
    expect(() => getCatalogRuntime({ ...base(), POLICY_SERVICE_TOKEN: '' })).toThrow('policy configuration');
    resetCatalogRuntimeForTests();
    expect(() => getCatalogRuntime({ ...base(), REFRESH_SECRET: 'a'.repeat(64) })).toThrow('separate');
    resetCatalogRuntimeForTests();
    expect(() => getCatalogRuntime({ ...base(), POLICY_SERVICE_TOKEN: 'a'.repeat(64) })).toThrow('separate');
    resetCatalogRuntimeForTests();
    expect(() => getCatalogRuntime({ ...base(), CURSOR_SECRET: 'A'.repeat(64), REFRESH_SECRET: 'A'.repeat(64) })).toThrow('separate');
  });
  it('rejects uppercase cursor-key reuse as a source credential before source fetch', async () => {
    const runtime = getCatalogRuntime({ ...base(), CURSOR_SECRET: 'A'.repeat(64), CATALOG_SOURCE_CREDENTIAL_ALIAS_PREFIX: 'SOURCE_', SOURCE_READER: 'A'.repeat(64) })!;
    vi.spyOn(runtime.policyReader, 'readPolicy').mockResolvedValue({ ok: true, policy: buildPolicy({ 'workspace-a': tenantEntry({ epoch: '00000000-0000-4000-8000-000000000001', credentialAlias: 'READER' }) }) });
    const attempt = runtime.service.refresh('workspace-a', 'manual');
    await vi.waitFor(() => expect(attempt.state).toBe('rejected'));
    expect(attempt.category).toBe('policy');
    runtime.service.shutdown();
  });
  it('memoizes a configured runtime and an unavailable optional runtime', () => {
    const runtime = getCatalogRuntime(base());
    expect(runtime).toBeDefined(); expect(getCatalogRuntime({})).toBe(runtime);
    runtime?.service.shutdown(); resetCatalogRuntimeForTests();
    expect(getCatalogRuntime({})).toBeUndefined(); expect(getCatalogRuntime(base())).toBeUndefined();
  });
});
describe('exact-name MCP audit isolation', () => {
  it('preserves unrelated tool argument/error behavior', async () => {
    const input = { name: 'retained-noncatalog-value' }, audit = vi.fn(async () => {});
    const result = await handleMcpToolCall('actor', 'other_tool', input, { execute: async () => ({ ok: true }), audit });
    expect(result.isError).toBeUndefined(); expect(audit.mock.calls[0][0].input).toBe(input);
    const failure = await handleMcpToolCall('actor', 'other_tool', input, { execute: async () => { throw new Error('retained-error'); }, audit });
    expect(failure.content[0].text).toContain('retained-error');
    expect((await handleMcpToolCall('actor', 'other_tool', null, { execute: async () => { throw 'unknown'; }, audit })).content[0].text).toContain('Unknown error');
  });
  it('sanitizes unexpected catalog failure details and argument shape', async () => {
    const audit = vi.fn(async () => {});
    const result = await handleMcpToolCall('actor', 'org_skills', { private: 'secret' }, { execute: async () => { throw new Error('upstream-secret'); }, audit });
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain('upstream-secret');
    expect(JSON.stringify(audit.mock.calls)).not.toContain('secret');
    expect(catalogAuditInput(null)).toEqual({ action: 'invalid', hasCursor: false, hasName: false, hasExpectedRevision: false });
  });
});
