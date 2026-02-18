import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleCheckUpstream } from '../../../src/mcp/tools/check-upstream.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('handleCheckUpstream', () => {
  let projectRoot: string;
  const ctx = () => ({
    projectRoot,
    sessionId: 'test-session',
    auditDir: '/tmp/audit-upstream-test',
  });

  beforeEach(() => {
    projectRoot = join(tmpdir(), `upstream-test-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns implement-new when no manifests found', () => {
    const result = handleCheckUpstream({ description: 'date formatting' }, ctx());
    expect(result.recommendation).toBe('implement-new');
    expect(result.existingSolutions).toEqual([]);
    expect(result.searchedIn).toEqual([]);
  });

  it('searches package.json and finds matching deps', () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: { 'date-fns': '^3.0.0', lodash: '^4.0.0' },
      }),
    );
    const result = handleCheckUpstream({ description: 'date formatting' }, ctx());
    expect(result.searchedIn).toContain('package.json');
    expect(result.existingSolutions.length).toBeGreaterThan(0);
    expect(result.existingSolutions[0].package).toBe('date-fns');
  });

  it('searches composer.json', () => {
    writeFileSync(
      join(projectRoot, 'composer.json'),
      JSON.stringify({
        require: { 'drupal/core': '^10.0' },
      }),
    );
    const result = handleCheckUpstream({ description: 'drupal module' }, ctx());
    expect(result.searchedIn).toContain('composer.json');
    expect(result.existingSolutions.length).toBeGreaterThan(0);
  });

  it('handles missing manifests gracefully', () => {
    const result = handleCheckUpstream({ description: 'anything' }, ctx());
    expect(result.recommendation).toBe('implement-new');
    expect(result.searchedIn).toEqual([]);
  });

  it('returns investigate-further for medium confidence', () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({
        dependencies: { 'my-date-utils': '^1.0.0' },
      }),
    );
    const result = handleCheckUpstream({ description: 'date formatting' }, ctx());
    expect(result.existingSolutions.length).toBeGreaterThan(0);
    expect(['use-existing', 'investigate-further']).toContain(result.recommendation);
  });

  it('returns correct response shape', () => {
    const result = handleCheckUpstream({ description: 'test' }, ctx());
    expect(result).toHaveProperty('existingSolutions');
    expect(result).toHaveProperty('searchedIn');
    expect(result).toHaveProperty('recommendation');
    expect(Array.isArray(result.existingSolutions)).toBe(true);
    expect(Array.isArray(result.searchedIn)).toBe(true);
  });
});
