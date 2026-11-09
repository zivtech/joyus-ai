import type { Server } from 'node:http';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireBearerToken } from '../src/auth/middleware.js';
import { mcpJsonBodyErrorHandler } from '../src/tools/mcp-body-errors.js';
import { executeTool } from '../src/tools/executor.js';
import * as catalogRuntime from '../src/skills/catalog/runtime.js';

import { assertPolicyConfiguration } from '../src/config.js';
import { HttpSkillDecisionProvider, type SkillDecision } from '../src/policy/skills.js';
import { cursorKey, decodeCursor, encodeCursor } from '../src/skills/catalog/cursor.js';
import { createFakePolicyReader } from '../src/skills/catalog/policy-s3.js';
import { createCatalogService } from '../src/skills/catalog/service.js';
import { createFakeCatalogSourcePort } from '../src/skills/catalog/service-source.js';
import {
  executeProtectedCatalog,
  catalogArguments,
  catalogAuditInput,
  orgSkillsTool,
} from '../src/skills/catalog/tool.js';
import { computeLogicalSourceKey, sourceBindingRevision } from '../src/skills/catalog/types.js';
import { handleMcpToolCall } from '../src/tools/mcp-call.js';

import { buildCandidate, buildPolicy, FakeClock, tenantEntry } from './catalog-fixtures.js';

vi.mock('../src/auth/verify.js', () => ({
  getUserFromToken: vi.fn(async (token: string) => token === 'synthetic-transport-token' ? { id: 'actor-a', connections: [] } : null),
}));

const epoch = '00000000-0000-4000-8000-000000000001';
const nextEpoch = '00000000-0000-4000-8000-000000000002';
const commit = 'a'.repeat(40),
  key = Buffer.alloc(32, 7);
const list = { schemaVersion: 2, workspaceId: 'workspace-a', action: 'list' };
const info = { ...list, action: 'info', name: 'skill-a' };
const services: ReturnType<typeof createCatalogService>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  services.splice(0).forEach(service => service.shutdown());
  await Promise.all(
    servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))
  );
});

async function fixture() {
  const entry = tenantEntry({ epoch, credentialAlias: 'SYNTHETIC_READER' });
  const authority = { policy: buildPolicy({ 'workspace-a': entry, 'workspace-b': entry }) };
  const candidate = buildCandidate(
    ['skill-a', 'skill-b', 'secret-skill'].map(name => ({
      name,
      description: `Synthetic ${name}`,
      priority: 1,
      scope: 'tenant' as const,
      body: `Body ${name}`,
    }))
  );
  const sources = new Map([
    [
      'synthetic-secret',
      { revision: commit, indexRaw: candidate.indexRaw, documents: candidate.documents },
    ],
  ]);
  const policyReader = createFakePolicyReader(authority),
    clock = new FakeClock();
  const service = createCatalogService({
    policyReader,
    sourcePort: createFakeCatalogSourcePort(sources),
    resolveCredential: () => 'synthetic-secret',
    clock,
  });
  services.push(service);
  for (const workspace of ['workspace-a', 'workspace-b']) {
    const attempt = service.refresh(workspace, 'startup');
    await vi.waitFor(() => expect(attempt.state).toBe('activated'));
  }
  let decision: SkillDecision = {
    schemaVersion: 2,
    workspaceId: 'workspace-a',
    userId: 'actor-a',
    policyRevision: epoch,
    sourceId: 'skills',
    sourceBindingRevision: sourceBindingRevision(entry.source),
    allowedSkills: ['skill-a', 'skill-b'].map(name => ({
      resourceId: `resource-${name}`,
      key: name,
    })),
  };
  const decisions = {
    assertToolAllowed: vi.fn(async () => decision.policyRevision!),
    decideSkills: vi.fn(async (workspace: string, actor: string) => ({
      ...decision,
      workspaceId: workspace,
      userId: actor,
      allowedSkills:
        actor !== 'actor-a'
          ? []
          : workspace === 'workspace-b'
            ? [{ resourceId: 'resource-secret', key: 'secret-skill' }]
            : decision.allowedSkills,
    })),
  };
  return {
    service,
    authority,
    sources,
    clock,
    entry,
    decisions,
    deps: { service, policyReader, decisions, cursorKey: key },
    setDecision: (value: Partial<SkillDecision>) => {
      decision = { ...decision, ...value };
    },
  };
}

describe('protected catalog contract', () => {
  it('shares the canonical source digest fixture', () => {
    expect(
      sourceBindingRevision({
        provider: 'github',
        owner: 'example-org',
        repository: 'example-skills',
        ref: 'v1.0.0',
        credentialAlias: 'EXAMPLE_SKILLS_READER',
      })
    ).toBe('87d1fabafd3e705971b7a012d46fea67ace20ba558644285b44d1be17f2d7f19');
  });
  it.each([
    null,
    [],
    {},
    { ...list, userId: 'forged' },
    { ...list, groups: [] },
    { ...list, path: '../x' },
    { ...list, pageSize: '1' },
    { ...list, pageSize: 1.1 },
    { ...list, name: 'secret-skill' },
    { ...info, cursor: 'x' },
    { ...list, schemaVersion: 1 },
    { ...list, workspaceId: '' },
    { ...list, action: 'enable' },
  ])('rejects strict malicious schema %j', async args => {
    expect(catalogArguments.safeParse(args).success).toBe(false);
    expect(JSON.stringify(catalogAuditInput(args))).not.toContain('forged');
  });
  it('selects nondefault workspace independently; filters names and uniformly denies known IDs', async () => {
    const f = await fixture();
    const a = (await executeProtectedCatalog('actor-a', list, f.deps)) as {
      skills: { name: string }[];
    };
    const b = (await executeProtectedCatalog(
      'actor-a',
      { ...list, workspaceId: 'workspace-b' },
      f.deps
    )) as typeof a;
    expect(a.skills.map(skill => skill.name)).toEqual(['skill-a', 'skill-b']);
    expect(b.skills.map(skill => skill.name)).toEqual(['secret-skill']);
    for (const name of ['secret-skill', 'missing-skill'])
      await expect(executeProtectedCatalog('actor-a', { ...info, name }, f.deps)).rejects.toThrow(
        'not_found: Skill not found'
      );
    const doc = (await executeProtectedCatalog('actor-a', info, f.deps)) as {
      document: string;
      revision: string;
      policyRevision: string;
    };
    expect(doc.document).toContain('Body skill-a');
    expect(doc.revision).toBe(commit);
    expect(doc.policyRevision).toBe(epoch);
    await expect(
      executeProtectedCatalog('actor-a', { ...info, expectedRevision: 'wrong' }, f.deps)
    ).rejects.toThrow('catalog_changed');
    await expect(
      executeProtectedCatalog('actor-a', { ...list, workspaceId: 'unrelated' }, f.deps)
    ).rejects.toThrow('unavailable');
  });
  it('uses fresh policy on a warm generation, including final in-flight grant removal and outage', async () => {
    const f = await fixture();
    await executeProtectedCatalog('actor-a', info, f.deps);
    f.setDecision({ allowedSkills: [], policyRevision: nextEpoch });
    expect(
      ((await executeProtectedCatalog('actor-a', list, f.deps)) as { skills: unknown[] }).skills
    ).toEqual([]);
    await expect(executeProtectedCatalog('actor-a', info, f.deps)).rejects.toThrow('not_found');
    f.decisions.decideSkills.mockRejectedValue(new Error('private upstream details'));
    await expect(executeProtectedCatalog('actor-a', list, f.deps)).rejects.toThrow(
      'unavailable: Catalog unavailable'
    );
    const g = await fixture();
    let count = 0;
    const original = g.decisions.decideSkills.getMockImplementation()!;
    g.decisions.decideSkills.mockImplementation(async (...args) => {
      count++;
      if (count === 2) g.setDecision({ allowedSkills: [], policyRevision: nextEpoch });
      return original(...args);
    });
    await expect(executeProtectedCatalog('actor-a', info, g.deps)).rejects.toThrow('not_found');
    expect(count).toBe(3);
    const h = await fixture();
    h.decisions.assertToolAllowed.mockRejectedValue(new Error('selected tool deny'));
    await expect(executeProtectedCatalog('actor-a', info, h.deps)).rejects.toThrow('unavailable');
  });
  it('reuses source generations after access-only publication, blocks changed bindings, retains last-good after failed validation', async () => {
    const f = await fixture();
    const before = f.service.getActiveGeneration(
      computeLogicalSourceKey('workspace-a'),
      sourceBindingRevision(f.entry.source)
    );
    f.setDecision({ policyRevision: nextEpoch });
    expect(
      ((await executeProtectedCatalog('actor-a', info, f.deps)) as { policyRevision: string })
        .policyRevision
    ).toBe(nextEpoch);
    expect(
      f.service.getActiveGeneration(
        computeLogicalSourceKey('workspace-a'),
        sourceBindingRevision(f.entry.source)
      )
    ).toBe(before);
    f.sources.set('synthetic-secret', {
      revision: 'b'.repeat(40),
      indexRaw: new TextEncoder().encode('{}'),
      documents: new Map(),
    });
    const attempt = f.service.refresh('workspace-a', 'manual');
    await vi.waitFor(() => expect(attempt.state).toBe('rejected'));
    expect(
      ((await executeProtectedCatalog('actor-a', info, f.deps)) as { revision: string }).revision
    ).toBe(commit);
    f.authority.policy = buildPolicy({
      'workspace-a': { ...f.entry, source: { ...f.entry.source, ref: 'other' } },
    });
    f.setDecision({
      sourceBindingRevision: sourceBindingRevision(
        f.authority.policy.tenants['workspace-a'].source
      ),
    });
    await expect(executeProtectedCatalog('actor-a', info, f.deps)).rejects.toThrow('unavailable');
    expect(
      f.service.getActiveGeneration(computeLogicalSourceKey('workspace-a'), 'legacy-epoch')
    ).toBeUndefined();
  });
  it('binds opaque AEAD cursors to actor, workspace, policy and commit', async () => {
    const f = await fixture();
    const first = (await executeProtectedCatalog('actor-a', { ...list, pageSize: 1 }, f.deps)) as {
      nextCursor: string;
    };
    expect(first.nextCursor).not.toContain('workspace-a');
    const second = (await executeProtectedCatalog(
      'actor-a',
      { ...list, cursor: first.nextCursor },
      f.deps
    )) as { skills: { name: string }[]; nextCursor: null };
    expect(second.skills.map(skill => skill.name)).toEqual(['skill-b']);
    expect(second.nextCursor).toBeNull();
    await expect(
      executeProtectedCatalog('other-actor', { ...list, cursor: first.nextCursor }, f.deps)
    ).rejects.toThrow('invalid_cursor');
    await expect(
      executeProtectedCatalog(
        'actor-a',
        { ...list, workspaceId: 'workspace-b', cursor: first.nextCursor },
        f.deps
      )
    ).rejects.toThrow('invalid_cursor');
    await expect(
      executeProtectedCatalog('actor-a', { ...list, cursor: `${first.nextCursor}x` }, f.deps)
    ).rejects.toThrow('invalid_cursor');
    f.setDecision({ policyRevision: nextEpoch });
    await expect(
      executeProtectedCatalog('actor-a', { ...list, cursor: first.nextCursor }, f.deps)
    ).rejects.toThrow('catalog_changed');
    expect(() => cursorKey('short')).toThrow();
    const payload = decodeCursor(first.nextCursor, key);
    expect(() => decodeCursor(encodeCursor(payload, key), Buffer.alloc(32, 8))).toThrow();
  });
});

describe('HTTP MCP wrapper', () => {
  it('uses transport actor; sanitizes success/failure audit, rejects direct resource fetches', async () => {
    const f = await fixture(),
      audit = vi.fn(async () => {}),
      app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/mcp', mcpJsonBodyErrorHandler);
    vi.spyOn(catalogRuntime, 'getCatalogRuntime').mockReturnValue({ ...f.deps, config: {} } as catalogRuntime.CatalogRuntime);
    app.post('/mcp', requireBearerToken, async (req, res) => {

      if (req.body.method === 'tools/list') return res.json({ tools: [orgSkillsTool] });
      if (req.body.method !== 'tools/call') return res.sendStatus(400);
      const { name, arguments: args } = req.body.params;
      res.json(
        await handleMcpToolCall(req.mcpUser!.id, name, args, {
          execute: executeTool,
          audit,
        })
      );
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error('Unhandled error:', error); res.sendStatus(500); });
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number },
      url = `http://127.0.0.1:${address.port}`;
    const beforeAudit = audit.mock.calls.length;
    const marker = 'synthetic-private-cursor';
    const depthBody = `cursor=${marker}&credential=synthetic-private-secret&x${'[a]'.repeat(34)}=nested`;
    const parameterBody = `cursor=${marker}&credential=synthetic-private-secret&${Array.from({ length: 1001 }, (_, i) => `x${i}=value`).join('&')}`;
    const cases = [
      { type: 'application/json', status: 400, body: '{"method":"tools/call","params":{"name":"org_skills","arguments":{"cursor":"synthetic-private-cursor","credential":"synthetic-private-secret"' },
      { type: 'application/json', status: 413, body: JSON.stringify({ cursor: marker, credential: 'synthetic-private-secret', padding: 'x'.repeat(110000) }) },
      { type: 'application/x-www-form-urlencoded', status: 400, body: depthBody },
      { type: 'application/x-www-form-urlencoded', status: 413, body: parameterBody },
    ];
    for (const authenticated of [false, true]) {
      for (const item of cases) {
        const headers: Record<string, string> = { 'content-type': item.type };
        if (authenticated) headers.authorization = 'Bearer synthetic-transport-token';
        const response = await fetch(`${url}/mcp`, { method: 'POST', headers, body: item.body });
        expect(response.status).toBe(item.status);
        const text = await response.text(); expect(text).not.toContain('synthetic-private');
      }
    }
    expect(errorLog).not.toHaveBeenCalled(); expect(audit.mock.calls.length).toBe(beforeAudit);
    const post = (args: unknown) =>
      fetch(`${url}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer synthetic-transport-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          method: 'tools/call',
          params: { name: 'org_skills', arguments: args },
        }),
      });
    expect((await (await post(info)).json()).isError).toBeUndefined();
    const malicious = {
      ...info,
      name: 'private-skill-name',
      cursor: 'private-cursor',
      credential: 'private-secret',
    };
    expect((await (await post(malicious)).json()).isError).toBe(true);
    const logged = JSON.stringify(audit.mock.calls);
    for (const value of ['private-skill-name', 'private-cursor', 'private-secret', 'Body skill-a'])
      expect(logged).not.toContain(value);
    expect(await fetch(`${url}/skills/skill-a/SKILL.md`).then(response => response.status)).toBe(
      404
    );
    expect(
      await fetch(`${url}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }).then(response => response.status)
    ).toBe(401);
  });
});

describe('fresh HTTP skill provider and startup policy', () => {
  it('fails closed after a previous success and rejects subject mismatch/304', async () => {
    const entry = tenantEntry({ epoch, credentialAlias: 'READER' });
    const decision: SkillDecision = {
      schemaVersion: 2,
      workspaceId: 'workspace-a',
      userId: 'actor-a',
      policyRevision: epoch,
      sourceId: 'skills',
      sourceBindingRevision: sourceBindingRevision(entry.source),
      allowedSkills: [],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(decision)))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...decision, userId: 'forged' })));
    const provider = new HttpSkillDecisionProvider({
      baseUrl: 'http://policy.example',
      serviceToken: 'synthetic-secret',
      fetchImpl,
    });
    await expect(provider.decideSkills('workspace-a', 'actor-a')).resolves.toEqual(decision);
    for (let i = 0; i < 3; i++)
      await expect(provider.decideSkills('workspace-a', 'actor-a')).rejects.toThrow(
        'Skill policy unavailable'
      );
    expect(fetchImpl.mock.calls[0][0]).toContain(
      '/policy/v2/workspaces/workspace-a/users/actor-a/skills'
    );
    expect(fetchImpl.mock.calls[0][1].headers['if-none-match']).toBeUndefined();
  });
  it('required policy rejects missing/partial config and optional mode is explicit', () => {
    expect(() => assertPolicyConfiguration({ POLICY_MODE: 'required' })).toThrow();
    expect(() =>
      assertPolicyConfiguration({ POLICY_SERVICE_URL: 'http://policy.example' })
    ).toThrow();
    expect(() => assertPolicyConfiguration({ POLICY_MODE: 'optional' })).not.toThrow();
    expect(() =>
      assertPolicyConfiguration({
        POLICY_MODE: 'required',
        POLICY_SERVICE_URL: 'http://policy.example',
        POLICY_SERVICE_TOKEN: 'synthetic-secret',
      })
    ).not.toThrow();
  });
});

describe('protected failure boundaries', () => {
  it('denies missing binding, subject mismatch, disabled source, expired content and final membership loss', async () => {
    const f = await fixture();
    f.setDecision({ sourceBindingRevision: null, sourceId: null, allowedSkills: [] });
    await expect(executeProtectedCatalog('actor-a', list, f.deps)).rejects.toThrow('unavailable');
    const g = await fixture(); g.clock.advance(60 * 60 * 1000);
    await expect(executeProtectedCatalog('actor-a', list, g.deps)).rejects.toThrow('unavailable');
    const h = await fixture(); h.authority.policy = buildPolicy({ 'workspace-a': { ...h.entry, approved: false } });
    await expect(executeProtectedCatalog('actor-a', info, h.deps)).rejects.toThrow('unavailable');
    const j = await fixture(); let calls = 0;
    const original = j.decisions.decideSkills.getMockImplementation()!;
    j.decisions.decideSkills.mockImplementation(async (...args) => {
      calls++;
      return calls === 1 ? original(...args) : { ...await original(...args), sourceId: null, sourceBindingRevision: null, allowedSkills: [] };
    });
    await expect(executeProtectedCatalog('actor-a', info, j.deps)).rejects.toThrow('unavailable');
    const k = await fixture(); k.decisions.assertToolAllowed.mockResolvedValue(nextEpoch);
    await expect(executeProtectedCatalog('actor-a', info, k.deps)).rejects.toThrow('unavailable');
    expect(k.decisions.decideSkills).toHaveBeenCalledTimes(2);
    await expect(executeProtectedCatalog('actor-a', { ...info, userId: 'forged' }, k.deps)).rejects.toThrow('invalid_arguments');
  });
  it('validates cursor key/token bounds and impossible offsets', async () => {
    const f = await fixture();
    const cursor = encodeCursor({ version: 2, actor: 'actor-a', workspace: 'workspace-a', source: 'skills', binding: sourceBindingRevision(f.entry.source), policy: epoch, commit, offset: 900 }, key);
    await expect(executeProtectedCatalog('actor-a', { ...list, cursor }, f.deps)).rejects.toThrow('invalid_cursor');
    for (const value of ['', '!', 'a'.repeat(2050), 'Ag']) expect(() => decodeCursor(value, key)).toThrow();
  });
  it('requires a complete valid fresh response and bounds provider bodies', async () => {
    const entry = tenantEntry({ epoch, credentialAlias: 'READER' });
    const valid: SkillDecision = { schemaVersion: 2, workspaceId: 'workspace-a', userId: 'actor-a', policyRevision: epoch, sourceId: 'skills', sourceBindingRevision: sourceBindingRevision(entry.source), allowedSkills: [{ resourceId: 'resource-a', key: 'skill-a' }] };
    const malformed = [
      { ...valid, schemaVersion: 1 }, { ...valid, sourceBindingRevision: null },
      { ...valid, sourceId: null }, { ...valid, policyRevision: null }, { ...valid, workspaceId: 'other' },
      { ...valid, allowedSkills: [valid.allowedSkills[0], valid.allowedSkills[0]] },
      { ...valid, unknown: 'private' },
    ];
    for (const body of malformed) {
      const provider = new HttpSkillDecisionProvider({ baseUrl: 'http://policy.example', serviceToken: 'synthetic', fetchImpl: vi.fn(async () => new Response(JSON.stringify(body))) });
      await expect(provider.decideSkills('workspace-a', 'actor-a')).rejects.toThrow('Skill policy unavailable');
    }
    for (const response of [new Response('x'.repeat(1024 * 1024 + 1)), new Response(null), new Response('bad-json'), new Response('{}', { status: 503 }), new Response(new Uint8Array([255]))]) {
      const provider = new HttpSkillDecisionProvider({ baseUrl: 'http://policy.example', serviceToken: 'synthetic', fetchImpl: vi.fn(async () => response) });
      await expect(provider.decideSkills('workspace-a', 'actor-a')).rejects.toThrow('Skill policy unavailable');
    }
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ epoch, deniedTools: [] }))).mockResolvedValueOnce(new Response(JSON.stringify({ epoch, deniedTools: ['org_skills'] })));
    const provider = new HttpSkillDecisionProvider({ baseUrl: 'http://policy.example', serviceToken: 'synthetic', fetchImpl });
    await expect(provider.assertToolAllowed('workspace-a', 'actor-a')).resolves.toBe(epoch);
    await expect(provider.assertToolAllowed('workspace-a', 'actor-a')).rejects.toThrow('Skill policy unavailable');
  });
});
