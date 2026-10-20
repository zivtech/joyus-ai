import { describe, it, expect, vi } from 'vitest';

import {
  assertAllowedInTenant,
  assertAllowedOnDefaultTenant,
  filterToolsByPolicy,
  filterToolsByTenantCeiling,
  ToolPolicyError,
} from '../../src/policy/enforce.js';
import { AllowAllPolicyProvider, type PolicyProvider, PolicyUnavailableError } from '../../src/policy/provider.js';

const TOOLS = [{ name: 'jira_search' }, { name: 'slack_post' }, { name: 'gh_pr' }];

function provider(map: Record<string, string[] | 'down'>): PolicyProvider {
  return {
    async decide({ tenantId, userId }) {
      const key = userId === undefined ? tenantId : `${tenantId}/${userId}`;
      const denied = map[key] ?? map[tenantId] ?? [];
      if (denied === 'down') throw new PolicyUnavailableError('down');
      return { epoch: 'e', deniedTools: denied };
    },
  };
}
const lookup = (tenant: string | null) => ({ defaultTenantFor: vi.fn(async () => tenant) });

describe('filterToolsByPolicy (getAllTools)', () => {
  it('passes everything through with AllowAll and never looks up the membership', async () => {
    const l = lookup(null);
    expect(await filterToolsByPolicy({ provider: new AllowAllPolicyProvider(), lookup: l }, 'u', TOOLS)).toBe(TOOLS);
    expect(l.defaultTenantFor).not.toHaveBeenCalled();
  });

  it('filters by the default-tenant decision; no default membership or outage yields an empty list', async () => {
    const p = provider({ 'ta/u': ['slack_post'], tb: 'down' });
    expect((await filterToolsByPolicy({ provider: p, lookup: lookup('ta') }, 'u', TOOLS)).map((t) => t.name)).toEqual(['jira_search', 'gh_pr']);
    expect(await filterToolsByPolicy({ provider: p, lookup: lookup(null) }, 'u', TOOLS)).toEqual([]);
    expect(await filterToolsByPolicy({ provider: p, lookup: lookup('tb') }, 'u', TOOLS)).toEqual([]);
  });
});

describe('assertAllowedOnDefaultTenant and assertAllowedInTenant (executeTool)', () => {
  it('returns the default tenant when allowed and throws the named refusals otherwise', async () => {
    const p = provider({ 'ta/u': ['jira_search'], tb: 'down' });
    expect(await assertAllowedOnDefaultTenant({ provider: p, lookup: lookup('ta') }, 'u', 'gh_pr')).toBe('ta');
    await expect(assertAllowedOnDefaultTenant({ provider: p, lookup: lookup('ta') }, 'u', 'jira_search')).rejects.toMatchObject({ code: 'policy_denied', tenantId: 'ta' });
    await expect(assertAllowedOnDefaultTenant({ provider: p, lookup: lookup(null) }, 'u', 'gh_pr')).rejects.toMatchObject({ code: 'no_default_membership' });
    await expect(assertAllowedOnDefaultTenant({ provider: p, lookup: lookup('tb') }, 'u', 'gh_pr')).rejects.toMatchObject({ code: 'policy_unavailable' });
    expect(await assertAllowedOnDefaultTenant({ provider: new AllowAllPolicyProvider(), lookup: lookup(null) }, 'u', 'gh_pr')).toBeNull();
  });

  it('the second decision on a resolved tenant refuses independently', async () => {
    const p = provider({ 'tc/u': ['gh_pr'] });
    await expect(assertAllowedInTenant({ provider: p, lookup: lookup('ta') }, 'tc', 'u', 'gh_pr')).rejects.toBeInstanceOf(ToolPolicyError);
    await assertAllowedInTenant({ provider: p, lookup: lookup('ta') }, 'tc', 'u', 'slack_post');
    await assertAllowedInTenant({ provider: new AllowAllPolicyProvider(), lookup: lookup('ta') }, 'tc', 'u', 'gh_pr');
    const err = new ToolPolicyError('policy_denied', 'gh_pr', 'tc');
    expect(err.message).toContain('denied by policy');
    expect(new ToolPolicyError('no_default_membership', 'x', null).message).toContain('no default tenant membership');
    expect(new ToolPolicyError('policy_unavailable', 'x', 't').message).toContain('unavailable');
  });
});

describe('filterToolsByTenantCeiling (getAuthorizedTools)', () => {
  it('applies the tenant ceiling only, and empties the list on outage', async () => {
    const p = provider({ ta: ['slack_post'], tb: 'down' });
    expect((await filterToolsByTenantCeiling(p, 'ta', TOOLS)).map((t) => t.name)).toEqual(['jira_search', 'gh_pr']);
    expect(await filterToolsByTenantCeiling(p, 'tb', TOOLS)).toEqual([]);
    expect(await filterToolsByTenantCeiling(new AllowAllPolicyProvider(), 'tb', TOOLS)).toBe(TOOLS);
  });
});
