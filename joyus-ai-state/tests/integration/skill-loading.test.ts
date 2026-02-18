import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { matchSkillsForFile, loadSkill } from '../../src/enforcement/skills/loader.js';
import { SkillCache } from '../../src/enforcement/skills/cache.js';
import { resolveSkillPrecedence } from '../../src/enforcement/skills/precedence.js';
import { buildSkillContext, buildSkillSummary } from '../../src/enforcement/skills/context-builder.js';
import { validateAgainstSkills } from '../../src/enforcement/skills/validator.js';
import type { SkillMapping, Skill } from '../../src/enforcement/types.js';

function tmpDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillRepo(repoPath: string, skills: Record<string, string>): void {
  const skillsDir = join(repoPath, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const [id, content] of Object.entries(skills)) {
    writeFileSync(join(skillsDir, `${id}.md`), content, 'utf-8');
  }
}

const DRUPAL_SKILL = `---
name: Drupal Security
---
Use Drupal's sanitization API for all user input.

## Anti-Patterns
- db_query with unsanitized input
- /\\$_GET\\[/
`;

const PHP_SKILL = `---
name: PHP Standards
---
Follow PSR-12 coding standards.

## Anti-Patterns
- var_dump(
`;

describe('Integration: Skill Loading Flow', () => {
  let repoDir: string;
  let cacheDir: string;

  beforeEach(() => {
    repoDir = tmpDir('skill-repo');
    cacheDir = tmpDir('skill-cache');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('pattern match: *.module file matches drupal mapping', () => {
    const mappings: SkillMapping[] = [
      { id: 'drupal-map', filePatterns: ['*.module'], skills: ['drupal-security'], precedence: 'core' },
    ];

    const result = matchSkillsForFile('mymodule.module', mappings);
    expect(result.matchedMappings).toHaveLength(1);
    expect(result.skillIds).toContain('drupal-security');
  });

  it('no match: .txt file matches nothing', () => {
    const mappings: SkillMapping[] = [
      { id: 'drupal-map', filePatterns: ['*.module'], skills: ['drupal-security'], precedence: 'core' },
    ];

    const result = matchSkillsForFile('readme.txt', mappings);
    expect(result.matchedMappings).toHaveLength(0);
    expect(result.skillIds).toHaveLength(0);
  });

  it('multiple matches: file matches two skill mappings', () => {
    const mappings: SkillMapping[] = [
      { id: 'drupal-map', filePatterns: ['*.module'], skills: ['drupal-security'], precedence: 'core' },
      { id: 'php-map', filePatterns: ['*.module', '*.php'], skills: ['php-standards'], precedence: 'platform-default' },
    ];

    const result = matchSkillsForFile('test.module', mappings);
    expect(result.matchedMappings).toHaveLength(2);
    expect(result.skillIds).toContain('drupal-security');
    expect(result.skillIds).toContain('php-standards');
  });

  it('precedence: higher precedence skill noted in conflicts', () => {
    const skills: Skill[] = [
      {
        id: 'drupal-security', name: 'Drupal Security', source: 'auto-loaded',
        precedence: 'client-override', constraints: 'Use sanitization', antiPatterns: [],
        loadedAt: new Date().toISOString(),
      },
      {
        id: 'drupal-coding', name: 'Drupal Coding', source: 'auto-loaded',
        precedence: 'platform-default', constraints: 'Follow standards', antiPatterns: [],
        loadedAt: new Date().toISOString(),
      },
    ];

    const result = resolveSkillPrecedence(skills);
    expect(result.resolvedSkills).toHaveLength(2);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].winner).toBe('drupal-security');
    expect(result.conflicts[0].loser).toBe('drupal-coding');
  });

  it('cache fallback: skill repo missing -> cached skill used', () => {
    const cache = new SkillCache(cacheDir);
    cache.cacheSkill('drupal-security', {
      id: 'drupal-security', name: 'Drupal Security',
      constraints: 'cached constraints', antiPatterns: [],
      cachedAt: new Date().toISOString(),
    });

    const result = loadSkill('drupal-security', '/nonexistent/repo', cache);
    expect(result.source).toBe('cache');
    expect(result.stale).toBe(true);
    expect(result.warning).toContain('cached version');
    expect(result.skill).not.toBeNull();
  });

  it('no cache: repo and cache both missing -> error', () => {
    const cache = new SkillCache(cacheDir);

    const result = loadSkill('drupal-security', '/nonexistent/repo', cache);
    expect(result.source).toBe('none');
    expect(result.skill).toBeNull();
    expect(result.error).toContain('not available');
  });

  it('context building: loaded skills produce combined constraint string', () => {
    createSkillRepo(repoDir, { 'drupal-security': DRUPAL_SKILL, 'php-standards': PHP_SKILL });
    const cache = new SkillCache(cacheDir);

    const drupal = loadSkill('drupal-security', repoDir, cache);
    const php = loadSkill('php-standards', repoDir, cache);
    expect(drupal.skill).not.toBeNull();
    expect(php.skill).not.toBeNull();

    const skills: Skill[] = [
      { ...drupal.skill!, source: 'auto-loaded', precedence: 'core', loadedAt: new Date().toISOString() },
      { ...php.skill!, source: 'auto-loaded', precedence: 'platform-default', loadedAt: new Date().toISOString() },
    ];

    const context = buildSkillContext(skills);
    expect(context).toContain('Drupal Security');
    expect(context).toContain('PHP Standards');
    expect(context).toContain('sanitization');

    const summary = buildSkillSummary(skills);
    expect(summary).toHaveLength(2);
    expect(summary[0].id).toBe('drupal-security');
  });

  it('validation: anti-pattern in content is detected', () => {
    createSkillRepo(repoDir, { 'drupal-security': DRUPAL_SKILL });
    const cache = new SkillCache(cacheDir);
    const drupal = loadSkill('drupal-security', repoDir, cache);
    expect(drupal.skill).not.toBeNull();

    const skill: Skill = {
      ...drupal.skill!, source: 'auto-loaded', precedence: 'core',
      loadedAt: new Date().toISOString(),
    };

    const badContent = 'const val = $_GET["user_id"];\necho val;';
    const result = validateAgainstSkills(badContent, [skill]);
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].skillId).toBe('drupal-security');
  });
});
