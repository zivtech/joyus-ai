import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  matchSkillsForFile,
  matchSkillsForFiles,
  loadSkillFromRepo,
  loadSkill,
  parseSkillMarkdown,
  writeSkillAuditEntry,
  writeSkillBypassEntry,
} from '../../../src/enforcement/skills/loader.js';
import { SkillCache } from '../../../src/enforcement/skills/cache.js';
import { AuditWriter } from '../../../src/enforcement/audit/writer.js';
import { listAuditFiles, readEntries } from '../../../src/enforcement/audit/writer.js';
import type { SkillMapping } from '../../../src/enforcement/types.js';

const mappings: SkillMapping[] = [
  { id: 'map-drupal', filePatterns: ['*.module', '*.install'], skills: ['drupal-coding-standards', 'drupal-security'], precedence: 'core' },
  { id: 'map-php', filePatterns: ['*.php'], skills: ['drupal-coding-standards'], precedence: 'platform-default' },
  { id: 'map-js', filePatterns: ['*.js', '*.ts'], skills: ['js-best-practices'], precedence: 'platform-default' },
];

describe('matchSkillsForFile', () => {
  it('matches .module files to drupal skills', () => {
    const result = matchSkillsForFile('mymodule.module', mappings);
    expect(result.skillIds).toContain('drupal-coding-standards');
    expect(result.skillIds).toContain('drupal-security');
    expect(result.matchedMappings).toHaveLength(1);
  });

  it('matches .php files', () => {
    const result = matchSkillsForFile('src/Controller.php', mappings);
    expect(result.skillIds).toContain('drupal-coding-standards');
  });

  it('matches .ts files', () => {
    const result = matchSkillsForFile('app.ts', mappings);
    expect(result.skillIds).toContain('js-best-practices');
  });

  it('returns empty for unmatched files', () => {
    const result = matchSkillsForFile('README.md', mappings);
    expect(result.skillIds).toHaveLength(0);
    expect(result.matchedMappings).toHaveLength(0);
  });

  it('deduplicates skill IDs', () => {
    // .module matches map-drupal only, no duplicates expected
    const result = matchSkillsForFile('test.module', mappings);
    const unique = new Set(result.skillIds);
    expect(unique.size).toBe(result.skillIds.length);
  });
});

describe('matchSkillsForFiles', () => {
  it('unions matches across multiple files', () => {
    const result = matchSkillsForFiles(['mymodule.module', 'app.ts'], mappings);
    expect(result.skillIds).toContain('drupal-coding-standards');
    expect(result.skillIds).toContain('drupal-security');
    expect(result.skillIds).toContain('js-best-practices');
  });

  it('deduplicates mappings', () => {
    const result = matchSkillsForFiles(['a.module', 'b.module'], mappings);
    expect(result.matchedMappings).toHaveLength(1);
  });
});

describe('parseSkillMarkdown', () => {
  it('parses skill with frontmatter and anti-patterns', () => {
    const content = `---
name: Drupal Security
precedence: core
---
Use parameterized queries for all database access.

## Anti-Patterns
- db_query(
- \\Drupal::database()->query(
`;
    const skill = parseSkillMarkdown('drupal-security', content);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('Drupal Security');
    expect(skill!.constraints).toContain('parameterized queries');
    expect(skill!.antiPatterns).toHaveLength(2);
    expect(skill!.antiPatterns[0]).toBe('db_query(');
  });

  it('parses skill without frontmatter', () => {
    const content = 'Always use strict mode.\n\n## Anti-Patterns\n- eval(';
    const skill = parseSkillMarkdown('js-strict', content);
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe('js-strict');
    expect(skill!.constraints).toContain('strict mode');
    expect(skill!.antiPatterns).toContain('eval(');
  });

  it('handles skill without anti-patterns section', () => {
    const skill = parseSkillMarkdown('basic', 'Just follow best practices.');
    expect(skill).not.toBeNull();
    expect(skill!.antiPatterns).toHaveLength(0);
  });
});

describe('loadSkillFromRepo', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `skill-repo-test-${Date.now()}`);
    mkdirSync(join(repoDir, 'skills'), { recursive: true });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('loads skill from repo', () => {
    writeFileSync(
      join(repoDir, 'skills', 'drupal-security.md'),
      '---\nname: Drupal Security\n---\nUse parameterized queries.',
    );
    const result = loadSkillFromRepo('drupal-security', repoDir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Drupal Security');
  });

  it('returns null for missing skill', () => {
    const result = loadSkillFromRepo('nonexistent', repoDir);
    expect(result).toBeNull();
  });
});

describe('loadSkill', () => {
  let repoDir: string;
  let cacheDir: string;
  let cache: SkillCache;

  beforeEach(() => {
    repoDir = join(tmpdir(), `skill-repo-test-${Date.now()}`);
    cacheDir = join(tmpdir(), `skill-cache-test-${Date.now()}`);
    mkdirSync(join(repoDir, 'skills'), { recursive: true });
    cache = new SkillCache(cacheDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('loads from repo and updates cache', () => {
    writeFileSync(
      join(repoDir, 'skills', 'drupal-security.md'),
      '---\nname: Drupal Security\n---\nUse safe queries.',
    );
    const result = loadSkill('drupal-security', repoDir, cache);
    expect(result.source).toBe('repo');
    expect(result.stale).toBe(false);
    expect(result.skill).not.toBeNull();

    // Verify cache was updated
    const cached = cache.getCachedSkill('drupal-security');
    expect(cached).not.toBeNull();
  });

  it('falls back to cache when repo unavailable', () => {
    cache.cacheSkill('drupal-security', {
      id: 'drupal-security',
      name: 'Drupal Security',
      constraints: 'Use safe queries.',
      antiPatterns: [],
      cachedAt: new Date().toISOString(),
    });

    const result = loadSkill('drupal-security', '/nonexistent/repo', cache);
    expect(result.source).toBe('cache');
    expect(result.stale).toBe(true);
    expect(result.warning).toContain('cached version');
  });

  it('returns none when repo and cache unavailable', () => {
    const result = loadSkill('drupal-security', '/nonexistent/repo', cache);
    expect(result.source).toBe('none');
    expect(result.skill).toBeNull();
    expect(result.error).toContain('not available');
  });
});

describe('audit integration', () => {
  let auditDir: string;

  beforeEach(() => {
    auditDir = join(tmpdir(), `skill-audit-test-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('writes skill-load audit entry', () => {
    const writer = new AuditWriter(auditDir);
    const id = writeSkillAuditEntry(writer, 'drupal-security', {
      skill: { id: 'drupal-security', name: 'Drupal Security', constraints: '', antiPatterns: [], cachedAt: '' },
      source: 'repo',
      stale: false,
    }, {
      sessionId: 'test-session',
      userTier: 'tier-2',
      activeSkills: ['drupal-security'],
    });
    expect(id).toBeTruthy();

    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('skill-load');
    expect(entries[0].skillId).toBe('drupal-security');
  });

  it('writes skill-bypass audit entry', () => {
    const writer = new AuditWriter(auditDir);
    const id = writeSkillBypassEntry(writer, 'drupal-security', 'Power user override', {
      sessionId: 'test-session',
      userTier: 'tier-2',
      activeSkills: [],
    });
    expect(id).toBeTruthy();

    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('skill-bypass');
    expect(entries[0].overrideReason).toBe('Power user override');
  });
});
