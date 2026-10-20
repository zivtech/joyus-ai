import { describe, it, expect, afterEach } from 'vitest';

import { AllowAllPolicyProvider, HttpPolicyProvider } from '../../src/policy/provider.js';
import { getPolicyProvider, providerFromEnv, setPolicyProvider } from '../../src/policy/index.js';
import { allToolDefinitionNames } from '../../src/tools/index.js';

describe('provider selection', () => {
  afterEach(() => setPolicyProvider(null));

  it('selects Http only when both URL and token are set, else AllowAll', () => {
    expect(providerFromEnv({})).toBeInstanceOf(AllowAllPolicyProvider);
    expect(providerFromEnv({ POLICY_SERVICE_URL: 'https://p' })).toBeInstanceOf(AllowAllPolicyProvider);
    expect(providerFromEnv({ POLICY_SERVICE_URL: 'https://p', POLICY_SERVICE_TOKEN: 't'.repeat(16) })).toBeInstanceOf(HttpPolicyProvider);
  });

  it('setPolicyProvider overrides the env-selected provider', () => {
    const custom = new AllowAllPolicyProvider();
    setPolicyProvider(custom);
    expect(getPolicyProvider()).toBe(custom);
    setPolicyProvider(null);
    expect(getPolicyProvider()).not.toBe(custom);
  });

  it('allToolDefinitionNames lists approval tools and every family, sorted and unique', () => {
    const names = allToolDefinitionNames();
    expect(names.some((n) => n.startsWith('approval_'))).toBe(true);
    expect(names.some((n) => n.startsWith('jira_'))).toBe(true);
    expect(names).toEqual([...new Set(names)].sort());
  });
});
