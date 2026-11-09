import type { Server } from 'node:http';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import type { CatalogEnvConfig } from '../src/skills/catalog/config.js';
import { createFakePolicyReader, type FakePolicyAuthority } from '../src/skills/catalog/policy-s3.js';
import { createRefreshRoutes } from '../src/skills/catalog/refresh-routes.js';
import { createFakeCatalogSourcePort, type FakeSourceFixture } from '../src/skills/catalog/service-source.js';
import { createCatalogService } from '../src/skills/catalog/service.js';
import { buildCandidate, buildPolicy, immediateSleep, tenantEntry } from './catalog-fixtures.js';

const CONFIG: CatalogEnvConfig = {
  refreshAuthSecretAlias: 'TEST_REFRESH_SECRET_ALIAS',
  cursorKeyAlias: 'TEST_CURSOR_KEY_ALIAS',
  sourceCredentialAliasPrefix: '',
  policyBucket: 'example-bucket',
  policyRegion: 'us-east-1',
  policyKey: 'example-policy-key.json',
};

const REFRESH_SECRET = 'example-refresh-secret-value';

function makeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    TEST_REFRESH_SECRET_ALIAS: REFRESH_SECRET,
    CATALOG_REFRESH_TENANT_ID: 'tenant-a',
    ...overrides,
  };
}

let activeServer: Server | undefined;

afterEach(async () => {
  if (activeServer) {
    await new Promise<void>((resolve) => activeServer!.close(() => resolve()));
    activeServer = undefined;
  }
});

async function startServer(env: NodeJS.ProcessEnv, fixtures: Map<string, FakeSourceFixture>, policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'e1', credentialAlias: 'alias-a' }) })): Promise<string> {
  const authority: FakePolicyAuthority = { policy };
  const service = createCatalogService({
    policyReader: createFakePolicyReader(authority),
    sourcePort: createFakeCatalogSourcePort(fixtures),
    resolveCredential: (alias) => `secret-for-${alias}`,
    sleep: immediateSleep(),
  });

  const app = express();
  app.use('/internal/org-skills/refresh', createRefreshRoutes({ service, config: CONFIG, env }));

  return new Promise<string>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      activeServer = server;
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}/internal/org-skills/refresh`);
    });
  });
}

const candidate = buildCandidate([{ name: 'example-skill', description: 'Example knowledge.', priority: 10, scope: 'tenant', body: 'Body.' }]);

describe('POST /internal/org-skills/refresh — auth before parse', () => {
  it('returns 401 for a missing bearer token even with an oversized body, without reading it as JSON', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);
    const oversized = 'x'.repeat(5000);
    const response = await fetch(url, { method: 'POST', body: oversized, headers: { 'content-type': 'application/json' } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });

  it('returns 401 for a wrong bearer token', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);
    const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer not-the-secret' } });
    expect(response.status).toBe(401);
  });

  it('returns 503 when authenticated but no tenant mapping is configured', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv({ CATALOG_REFRESH_TENANT_ID: undefined }), fixtures);
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable' });
  });
});

describe('POST /internal/org-skills/refresh — body handling', () => {
  it('accepts an empty body and returns 202 accepted with an operationId', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 25 }]]);
    const url = await startServer(makeEnv(), fixtures);
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.status).toBe('accepted');
    expect(typeof body.operationId).toBe('string');
  });

  it('rejects a body over 1 KiB with 413', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);
    const oversized = JSON.stringify({ ref: 'x'.repeat(2000) });
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${REFRESH_SECRET}`, 'content-type': 'application/json' },
      body: oversized,
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ status: 'rejected', category: 'request_too_large' });
  });

  it('rejects unknown fields with 400 invalid_request', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${REFRESH_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: 'not-allowed' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'rejected', category: 'invalid_request' });
  });

  it('rejects an oversized ref field with 400 invalid_request', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${REFRESH_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'x'.repeat(300) }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts an informational ref within bounds and never echoes it in the response', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 10 }]]);
    const url = await startServer(makeEnv(), fixtures);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${REFRESH_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'v1.2.3' }),
    });
    expect(response.status).toBe(202);
    const text = await response.text();
    expect(text).not.toContain('v1.2.3');
  });
});

describe('POST /internal/org-skills/refresh — coalescing and rate limiting', () => {
  it('returns the existing operationId for a duplicate while the job runs (no new attempt)', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 50 }]]);
    const url = await startServer(makeEnv(), fixtures);

    const first = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    const firstBody = await first.json();
    expect(first.status).toBe(202);
    expect(firstBody.status).toBe('accepted');

    const second = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    const secondBody = await second.json();
    expect(second.status).toBe(202);
    expect(secondBody.status).toBe('in_progress');
    expect(secondBody.operationId).toBe(firstBody.operationId);
  });

  it('rate-limits a second manual attempt within the same minute once the prior one has finished', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);

    const first = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    expect(first.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the (undelayed) first attempt finish

    const second = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ status: 'rejected', category: 'rate_limited' });
  });
});

describe('GET /internal/org-skills/refresh/:operationId', () => {
  it('returns the full status table and hides cross-scope/unknown operation ids as 404 unavailable', async () => {
    const fixtures = new Map<string, FakeSourceFixture>([['secret-for-alias-a', { revision: 'r1', indexRaw: candidate.indexRaw, documents: candidate.documents }]]);
    const url = await startServer(makeEnv(), fixtures);

    const post = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    const { operationId } = await post.json();

    const unauthenticated = await fetch(`${url}/${operationId}`);
    expect(unauthenticated.status).toBe(401);

    const unknown = await fetch(`${url}/does-not-exist`, { headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ status: 'unavailable' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const known = await fetch(`${url}/${operationId}`, { headers: { authorization: `Bearer ${REFRESH_SECRET}` } });
    expect(known.status).toBe(200);
    const body = await known.json();
    expect(body.status).toBe('activated');
    expect(body.revision).toBe('r1');
    expect(typeof body.startedAt).toBe('string');
    expect(typeof body.durationMs).toBe('number');
  });
});
