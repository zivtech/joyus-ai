import { describe, it, expect, vi } from 'vitest';

import { createIntrospectHandler } from '../../src/auth/introspect.js';

function call(handler: ReturnType<typeof createIntrospectHandler>, headers: Record<string, string>, body: unknown) {
  const res = { status: vi.fn(), json: vi.fn(), set: vi.fn() };
  res.status.mockReturnValue(res);
  return handler({ headers, body } as never, res as never).then(() => ({
    status: (res.status.mock.calls[0] as [number])[0],
    body: (res.json.mock.calls[0] as [unknown])[0],
  }));
}

describe('POST /auth/introspect', () => {
  const lookup = vi.fn(async (token: string) =>
    token === 'good' ? { active: true, userId: 'u1', email: 'u1@example.test', defaultTenantId: 'ta' } : { active: false },
  );
  const handler = createIntrospectHandler({ serviceToken: 'service-secret', lookup });

  it('404s when not configured, 401s on a wrong service token, 400s on a bad body', async () => {
    const off = createIntrospectHandler({ serviceToken: undefined, lookup });
    expect((await call(off, { authorization: 'Bearer service-secret' }, { token: 'good' })).status).toBe(404);
    expect((await call(handler, {}, { token: 'good' })).status).toBe(401);
    expect((await call(handler, { authorization: 'Bearer nope' }, { token: 'good' })).status).toBe(401);
    expect((await call(handler, { authorization: 'Bearer service-secret' }, {})).status).toBe(400);
    expect((await call(handler, { authorization: 'Bearer service-secret' }, { token: 'x'.repeat(5000) })).status).toBe(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('answers active with identity and default tenant, inactive otherwise, 503 on lookup failure', async () => {
    const active = await call(handler, { authorization: 'Bearer service-secret' }, { token: 'good' });
    expect(active).toEqual({ status: 200, body: { active: true, userId: 'u1', email: 'u1@example.test', defaultTenantId: 'ta' } });
    const inactive = await call(handler, { authorization: 'Bearer service-secret' }, { token: 'revoked' });
    expect(inactive).toEqual({ status: 200, body: { active: false } });
    const broken = createIntrospectHandler({ serviceToken: 'service-secret', lookup: async () => { throw new Error('db'); } });
    expect((await call(broken, { authorization: 'Bearer service-secret' }, { token: 'good' })).status).toBe(503);
  });
});
