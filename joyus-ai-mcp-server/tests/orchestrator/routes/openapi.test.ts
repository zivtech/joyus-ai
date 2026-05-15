/**
 * T047: OpenAPI Schema Drift Detection
 *
 * Generates the OpenAPI spec from the Zod-backed builder and asserts:
 * 1. The spec is a valid JSON object with required OpenAPI 3.1 fields.
 * 2. All expected operation IDs are present in the spec.
 * 3. All expected schema components are defined.
 *
 * Note: contracts/api.yaml does not exist in this repository. Per the WP06
 * spec (T047 Alternative): "If the project generates OpenAPI at build time
 * rather than committing it, add a CI step that generates and verifies no drift."
 * This test plays the role of that CI step — it validates the generator
 * produces a complete, consistent spec every time tests run. If the builder
 * in routes/openapi.ts is modified, this test catches missing operations or schemas.
 *
 * To enforce no-drift in CI: run `npm test` in the CI pipeline. This file runs
 * as part of the standard Vitest suite.
 */

import { describe, it, expect } from 'vitest';
import { buildOrchestratorOpenApiSpec } from '../../../src/orchestrator/routes/openapi.js';

// ── Expected operation IDs ───────────────────────────────────────────────────

const EXPECTED_OPERATION_IDS = [
  // Sessions
  'createSession',
  'listSessions',
  'getSession',
  'updateSession',
  // Messages
  'sendMessage',
  // Events
  'subscribeSessionEvents',
  'subscribeTenantEvents',
  'listTurns',
  // Work units
  'createWorkUnit',
  'listWorkUnits',
  'getWorkUnit',
  'updateWorkUnit',
  // Coordination groups
  'createCoordinationGroup',
  'getCoordinationGroup',
];

// ── Expected schema components ───────────────────────────────────────────────

const EXPECTED_SCHEMAS = [
  'ApiError',
  'SessionStatus',
  'Session',
  'CreateSessionRequest',
  'UpdateSessionRequest',
  'PaginatedSessions',
  'SendMessageRequest',
  'MessageResponse',
  'WorkUnitStatus',
  'WorkUnit',
  'CreateWorkUnitRequest',
  'UpdateWorkUnitRequest',
  'WorkUnitList',
  'CompletionPolicy',
  'CoordinationGroupStatus',
  'CoordinationGroup',
  'CoordinationGroupWithUnits',
  'CreateCoordinationGroupRequest',
  'Turn',
  'TurnList',
];

// ── Helper: collect all operationIds from the spec ──────────────────────────

function collectOperationIds(spec: Record<string, unknown>): string[] {
  const paths = spec.paths as Record<string, Record<string, { operationId?: string }>> | undefined;
  if (!paths) return [];

  const ids: string[] = [];
  for (const pathItem of Object.values(paths)) {
    for (const operation of Object.values(pathItem)) {
      if (typeof operation === 'object' && operation !== null && 'operationId' in operation) {
        if (typeof operation.operationId === 'string') {
          ids.push(operation.operationId);
        }
      }
    }
  }
  return ids;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildOrchestratorOpenApiSpec (T047 drift detection)', () => {
  let spec: Record<string, unknown>;

  // Build once — it's pure and deterministic
  spec = buildOrchestratorOpenApiSpec();

  it('is a non-null object', () => {
    expect(spec).toBeDefined();
    expect(typeof spec).toBe('object');
    expect(spec).not.toBeNull();
  });

  it('declares OpenAPI version 3.1.0', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('has required top-level fields: info, paths, components', () => {
    expect(spec).toHaveProperty('info');
    expect(spec).toHaveProperty('paths');
    expect(spec).toHaveProperty('components');
  });

  it('info has title and version', () => {
    const info = spec.info as Record<string, unknown>;
    expect(typeof info.title).toBe('string');
    expect(info.title).toMatch(/orchestrator/i);
    expect(typeof info.version).toBe('string');
  });

  it('has a servers array', () => {
    const servers = spec.servers as unknown[];
    expect(Array.isArray(servers)).toBe(true);
    expect(servers.length).toBeGreaterThan(0);
  });

  it('components.securitySchemes defines bearerAuth', () => {
    const components = spec.components as Record<string, unknown>;
    const schemes = components.securitySchemes as Record<string, { type: string; scheme: string }>;
    expect(schemes).toHaveProperty('bearerAuth');
    expect(schemes.bearerAuth.type).toBe('http');
    expect(schemes.bearerAuth.scheme).toBe('bearer');
  });

  it('contains all expected operation IDs', () => {
    const actualIds = collectOperationIds(spec);
    for (const expectedId of EXPECTED_OPERATION_IDS) {
      expect(actualIds, `Missing operationId: ${expectedId}`).toContain(expectedId);
    }
  });

  it('has no duplicate operation IDs', () => {
    const actualIds = collectOperationIds(spec);
    const unique = new Set(actualIds);
    expect(actualIds.length).toBe(unique.size);
  });

  it('defines all expected schema components', () => {
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;
    for (const expectedSchema of EXPECTED_SCHEMAS) {
      expect(schemas, `Missing schema: ${expectedSchema}`).toHaveProperty(expectedSchema);
    }
  });

  it('all $ref targets exist in components.schemas', () => {
    const specStr = JSON.stringify(spec);
    // Find all $ref values
    const refMatches = [...specStr.matchAll(/"\\$ref":"#\/components\/schemas\/([^"]+)"/g)];
    const components = spec.components as Record<string, unknown>;
    const schemas = components.schemas as Record<string, unknown>;

    for (const match of refMatches) {
      const schemaName = match[1];
      expect(schemas, `$ref target not found: ${schemaName}`).toHaveProperty(schemaName);
    }
  });

  it('is serializable to JSON without error', () => {
    expect(() => JSON.stringify(spec)).not.toThrow();
    const json = JSON.stringify(spec);
    expect(JSON.parse(json)).toEqual(spec);
  });

  it('documents message streaming as standard SSE without provider token-delta guarantees', () => {
    const specJson = JSON.stringify(spec);
    expect(specJson).toContain('standard Server-Sent Events (SSE)');
    expect(specJson).toContain('not guaranteed to correspond to provider token deltas');
  });

  it('paths contain only objects (not arrays or primitives)', () => {
    const paths = spec.paths as Record<string, unknown>;
    for (const [path, pathItem] of Object.entries(paths)) {
      expect(typeof pathItem, `Path ${path} is not an object`).toBe('object');
    }
  });
});
