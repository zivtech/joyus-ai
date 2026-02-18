import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processFileChange, resetDebounceState } from '../../../src/enforcement/events/file-change.js';
import { EnforcementConfigSchema } from '../../../src/enforcement/schemas.js';
import { mergeConfig } from '../../../src/enforcement/config.js';
import type { DeveloperConfig } from '../../../src/enforcement/types.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeConfig() {
  const project = EnforcementConfigSchema.parse({
    skillMappings: [
      { id: 'map-php', filePatterns: ['*.php'], skills: ['drupal-security'], precedence: 'core' },
    ],
  });
  const dev: DeveloperConfig = { tier: 'tier-2', gateOverrides: {}, skillOverrides: {} };
  return mergeConfig(project, dev);
}

describe('processFileChange', () => {
  let auditDir: string;
  const ctx = () => ({
    sessionId: 'test',
    auditDir,
    repoPath: '/tmp/nonexistent',
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `event-filechange-test-${Date.now()}`);
    resetDebounceState();
  });

  afterEach(() => {
    resetDebounceState();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns not reloaded when no skill mappings match', () => {
    const config = makeConfig();
    const result = processFileChange(['src/app.js'], config, ctx());
    expect(result.reloaded).toBe(false);
    expect(result.newSkillIds).toEqual([]);
  });

  it('detects matching skill mappings for PHP files', () => {
    const config = makeConfig();
    const result = processFileChange(['src/Controller.php'], config, ctx());
    // Skills won't load (no repo) but mapping should match
    expect(result.newSkillIds).toContain('drupal-security');
  });

  it('skips reload when skill set unchanged', () => {
    const config = makeConfig();
    const result = processFileChange(['src/Controller.php'], config, {
      ...ctx(),
      previousSkillIds: ['drupal-security'],
    });
    expect(result.reloaded).toBe(false);
  });

  it('returns correct shape', () => {
    const config = makeConfig();
    const result = processFileChange(['src/file.ts'], config, ctx());
    expect(result).toHaveProperty('reloaded');
    expect(result).toHaveProperty('newSkillIds');
    expect(result).toHaveProperty('skillContext');
    expect(result).toHaveProperty('auditEntryIds');
  });
});
