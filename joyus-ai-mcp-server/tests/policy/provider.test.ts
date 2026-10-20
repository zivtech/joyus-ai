import { describe, it, expect, vi } from 'vitest';

import {
  AllowAllPolicyProvider,
  HttpPolicyProvider,
  LAST_DECISION_TTL_MS,
  PolicyUnavailableError,
} from '../../src/policy/provider.js';

function response(status: number, body?: unknown, etag?: string) {
  return {
    status,
    headers: { get: (name: string) => (name === 'etag' ? (etag ?? null) : null) },
    json: async () => body,
  } as unknown as Response;
}

const quiet = { warn: vi.fn(), error: vi.fn() };

describe('AllowAllPolicyProvider', () => {
  it('denies nothing', async () => {
    expect(await new AllowAllPolicyProvider().decide({ tenantId: 't' })).toEqual({ epoch: '0', deniedTools: [] });
  });
});

describe('HttpPolicyProvider', () => {
  it('fetches the tenant and user routes with the service token and revalidates with If-None-Match', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { epoch: 'e1', deniedTools: ['jira_search'] }, '"e1:present"'))
      .mockResolvedValueOnce(response(304))
      .mockResolvedValueOnce(response(200, { epoch: 'e1', deniedTools: [] }, '"e1"'));
    const provider = new HttpPolicyProvider({ baseUrl: 'https://policy.test/', serviceToken: 'svc', fetchImpl, logger: quiet });

    const first = await provider.decide({ tenantId: 'ta', userId: 'u/1' });
    expect(first).toEqual({ epoch: 'e1', deniedTools: ['jira_search'] });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://policy.test/policy/decide/ta/u%2F1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer svc');
    expect((init.headers as Record<string, string>)['if-none-match']).toBeUndefined();

    const second = await provider.decide({ tenantId: 'ta', userId: 'u/1' });
    expect(second).toEqual(first);
    expect(((fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers as Record<string, string>)['if-none-match']).toBe('"e1:present"');

    const tenant = await provider.decide({ tenantId: 'ta' });
    expect(tenant.deniedTools).toEqual([]);
    expect((fetchImpl.mock.calls[2] as [string])[0]).toBe('https://policy.test/policy/decide/ta');
  });

  it('serves the last decision for 10 minutes after a failure, then fails closed', async () => {
    let now = 1_000_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { epoch: 'e1', deniedTools: ['x'] }, '"e1"'))
      .mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new HttpPolicyProvider({ baseUrl: 'https://policy.test', serviceToken: 'svc', fetchImpl, now: () => now, logger: quiet });
    await provider.decide({ tenantId: 'ta' });

    now += LAST_DECISION_TTL_MS - 1;
    expect(await provider.decide({ tenantId: 'ta' })).toEqual({ epoch: 'e1', deniedTools: ['x'] });
    expect(quiet.warn).toHaveBeenCalled();

    now += 2;
    await expect(provider.decide({ tenantId: 'ta' })).rejects.toBeInstanceOf(PolicyUnavailableError);
    expect(quiet.error).toHaveBeenCalled();
    // Never fail open: a subject with no prior decision fails closed at once.
    await expect(provider.decide({ tenantId: 'tb' })).rejects.toBeInstanceOf(PolicyUnavailableError);
  });

  it('a 304 refreshes the grace window; a non-200 or malformed body counts as a failure', async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(200, { epoch: 'e1', deniedTools: [] }, '"e1"'))
      .mockResolvedValueOnce(response(304))
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200, { nope: true }));
    const provider = new HttpPolicyProvider({ baseUrl: 'https://policy.test', serviceToken: 'svc', fetchImpl, now: () => now, logger: quiet });
    await provider.decide({ tenantId: 'ta' });
    now = LAST_DECISION_TTL_MS - 10;
    await provider.decide({ tenantId: 'ta' }); // 304 at this time: confirmedAt moves forward
    now += LAST_DECISION_TTL_MS - 20;
    expect(await provider.decide({ tenantId: 'ta' })).toEqual({ epoch: 'e1', deniedTools: [] }); // 500, within window
    expect(await provider.decide({ tenantId: 'ta' })).toEqual({ epoch: 'e1', deniedTools: [] }); // malformed, within window
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
