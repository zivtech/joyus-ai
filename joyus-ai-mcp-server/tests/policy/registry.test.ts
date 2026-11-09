import { describe, it, expect, vi } from 'vitest';

import { postToolRegistry } from '../../src/policy/registry.js';

describe('postToolRegistry', () => {
  it('posts the sorted, deduplicated tool names with the service token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ created: 2 }) });
    const result = await postToolRegistry({ baseUrl: 'https://policy.test/', serviceToken: 'svc', toolNames: ['b', 'a', 'b'], fetchImpl });
    expect(result).toEqual({ created: 2 });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://policy.test/policy/registry');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ tools: [{ name: 'a' }, { name: 'b' }] });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer svc');
  });

  it('throws on a non-200 and tolerates a body without created', async () => {
    const bad = vi.fn().mockResolvedValue({ status: 401, json: async () => ({}) });
    await expect(postToolRegistry({ baseUrl: 'x', serviceToken: 's', toolNames: [], fetchImpl: bad })).rejects.toThrow(/401/);
    const odd = vi.fn().mockResolvedValue({ status: 200, json: async () => ({}) });
    expect(await postToolRegistry({ baseUrl: 'x', serviceToken: 's', toolNames: [], fetchImpl: odd })).toEqual({ created: 0 });
  });
});
