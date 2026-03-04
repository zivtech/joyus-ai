import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnforcementEventRouter } from '../../../src/enforcement/events/router.js';
import { resetDebounceState } from '../../../src/enforcement/events/file-change.js';
import { EnforcementConfigSchema } from '../../../src/enforcement/schemas.js';
import { mergeConfig } from '../../../src/enforcement/config.js';
import type { DeveloperConfig, MergedEnforcementConfig } from '../../../src/enforcement/types.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeConfig(): MergedEnforcementConfig {
  const project = EnforcementConfigSchema.parse({});
  const dev: DeveloperConfig = { tier: 'tier-2', gateOverrides: {}, skillOverrides: {} };
  return mergeConfig(project, dev);
}

describe('EnforcementEventRouter', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = join(tmpdir(), `event-router-test-${Date.now()}`);
    resetDebounceState();
  });

  afterEach(() => {
    resetDebounceState();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('handles session-start event', async () => {
    const router = new EnforcementEventRouter(makeConfig(), {
      sessionId: 'test',
      auditDir,
      projectRoot: '/tmp/nonexistent',
    });
    const result = await router.handleEvent({ type: 'session-start' });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('staleBranches');
    expect(result).toHaveProperty('suggestions');
  });

  it('handles branch-switch event', async () => {
    const router = new EnforcementEventRouter(makeConfig(), {
      sessionId: 'test',
      auditDir,
      projectRoot: '/tmp/nonexistent',
    });
    const result = await router.handleEvent({ type: 'branch-switch', branch: 'feature/test' });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('newBranch');
  });

  it('returns null for unknown event type', async () => {
    const router = new EnforcementEventRouter(makeConfig(), {
      sessionId: 'test',
      auditDir,
      projectRoot: '/tmp/nonexistent',
    });
    const result = await router.handleEvent({ type: 'unknown' } as never);
    expect(result).toBeNull();
  });

  it('can update config', () => {
    const router = new EnforcementEventRouter(makeConfig(), {
      sessionId: 'test',
      auditDir,
      projectRoot: '/tmp/nonexistent',
    });
    const newConfig = makeConfig();
    router.updateConfig(newConfig);
    // No error thrown
  });
});
