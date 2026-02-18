import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAgainstSkills, validateFile } from '../../../src/enforcement/skills/validator.js';
import type { Skill } from '../../../src/enforcement/types.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'drupal-security',
    name: 'Drupal Security',
    source: 'auto-loaded',
    precedence: 'core',
    constraints: '',
    antiPatterns: ['db_query('],
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('validateAgainstSkills', () => {
  it('returns valid for clean content', () => {
    const result = validateAgainstSkills(
      '\\Drupal::database()->select("users")->execute()',
      [makeSkill()],
    );
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('catches anti-pattern match', () => {
    const result = validateAgainstSkills(
      'db_query("SELECT * FROM users")',
      [makeSkill()],
    );
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].skillId).toBe('drupal-security');
    expect(result.violations[0].matchedText).toBe('db_query(');
    expect(result.violations[0].lineNumber).toBe(1);
  });

  it('reports line numbers', () => {
    const content = 'line1\nline2\ndb_query("bad")\nline4';
    const result = validateAgainstSkills(content, [makeSkill()]);
    expect(result.violations[0].lineNumber).toBe(3);
  });

  it('handles regex anti-patterns', () => {
    const skill = makeSkill({
      antiPatterns: ['/\\beval\\s*\\(/'],
    });
    const result = validateAgainstSkills('let x = eval("code")', [skill]);
    expect(result.valid).toBe(false);
    expect(result.violations[0].matchedText).toContain('eval');
  });

  it('handles multiple skills', () => {
    const skills = [
      makeSkill({ id: 'skill-a', antiPatterns: ['bad_function('] }),
      makeSkill({ id: 'skill-b', antiPatterns: ['unsafe_call('] }),
    ];
    const result = validateAgainstSkills('bad_function() and unsafe_call()', skills);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].skillId).toBe('skill-a');
    expect(result.violations[1].skillId).toBe('skill-b');
  });

  it('skips skills without anti-patterns', () => {
    const skill = makeSkill({ antiPatterns: [] });
    const result = validateAgainstSkills('anything goes', [skill]);
    expect(result.valid).toBe(true);
  });

  it('handles invalid regex gracefully', () => {
    const skill = makeSkill({ antiPatterns: ['/[invalid/'] });
    const result = validateAgainstSkills('some content', [skill]);
    expect(result.valid).toBe(true); // Invalid regex is skipped
  });
});

describe('validateFile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `validator-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('validates file content', () => {
    const filePath = join(testDir, 'test.php');
    writeFileSync(filePath, 'db_query("SELECT * FROM users")');
    const result = validateFile(filePath, [makeSkill()]);
    expect(result.valid).toBe(false);
  });

  it('returns valid for non-existent file', () => {
    const result = validateFile('/nonexistent/file.php', [makeSkill()]);
    expect(result.valid).toBe(true);
  });
});
