import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProjectConfig, loadConfig, DEFAULT_GLOBAL_CONFIG, DEFAULT_PROJECT_CONFIG } from '../../../src/core/config.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('loadProjectConfig', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = tmpDir('config-test');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadProjectConfig(projectRoot);
    expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
  });

  it('loads valid config from disk', async () => {
    const configDir = join(projectRoot, '.joyus-ai');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      eventTriggers: { commit: false },
      customTriggers: [{ pattern: '**/Dockerfile', event: 'docker-build' }],
      periodicIntervalMinutes: 30,
    }));

    const config = await loadProjectConfig(projectRoot);
    expect(config.eventTriggers.commit).toBe(false);
    expect(config.eventTriggers.branchSwitch).toBe(true);
    expect(config.customTriggers).toEqual([{ pattern: '**/Dockerfile', event: 'docker-build' }]);
    expect(config.periodicIntervalMinutes).toBe(30);
  });

  it('returns defaults for corrupted JSON', async () => {
    const configDir = join(projectRoot, '.joyus-ai');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), '{broken json!!!');

    const config = await loadProjectConfig(projectRoot);
    expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
  });

  it('returns defaults for invalid config shape', async () => {
    const configDir = join(projectRoot, '.joyus-ai');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      periodicIntervalMinutes: -5,
    }));

    const config = await loadProjectConfig(projectRoot);
    expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
  });
});

describe('loadConfig', () => {
  it('returns both global and project configs', async () => {
    const projectRoot = tmpDir('config-both');
    try {
      const result = await loadConfig(projectRoot);
      expect(result.global).toEqual(DEFAULT_GLOBAL_CONFIG);
      expect(result.project).toEqual(DEFAULT_PROJECT_CONFIG);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
