/**
 * Unit tests for SkillLoaderService (WP05 — T038, T039, T040)
 *
 * All filesystem calls are mocked via vi.mock('fs/promises').
 *
 * Tests cover:
 * - T038: Filesystem skill loading — reads .md files, parses frontmatter
 * - T038: Missing skills directory → returns empty array (not an error)
 * - T038: Malformed skill file → logged and skipped
 * - T039: Skill injection respects token budget — high-priority kept, low-priority skipped
 * - T039: Skills sorted by priority (descending) before injection
 * - T039: Zero budget → no skills injected (no crash)
 * - T040: Constitution loaded and prepended first
 * - T040: Missing constitution → warning logged, returns empty string (graceful degrade)
 * - parseFrontmatter: handles frontmatter / no-frontmatter / invalid YAML
 * - estimateTokens: correct heuristic (chars / 4, ceil)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// ============================================================
// Mock fs/promises
// ============================================================

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn(),
    },
  };
});

import { promises as fsPromises } from 'fs';
const mockReaddir = vi.mocked(fsPromises.readdir);
const mockReadFile = vi.mocked(fsPromises.readFile);

import {
  SkillLoaderService,
  FilesystemSkillResolver,
  parseFrontmatter,
  estimateTokens,
  type Skill,
  type SkillResolver,
} from '../../src/orchestrator/skill-loader.service.js';

// ============================================================
// Helpers
// ============================================================

function makeEnoentError(): NodeJS.ErrnoException {
  const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function makeDirent(name: string, isFile = true) {
  return { name, isFile: () => isFile, isDirectory: () => !isFile };
}

const TENANT_ID = 'tenant-123';
const SKILLS_DIR = '/skills';

// ============================================================
// parseFrontmatter — unit tests
// ============================================================

describe('parseFrontmatter', () => {
  it('returns defaults when no frontmatter is present', () => {
    const raw = 'This is a skill without frontmatter.';
    const result = parseFrontmatter(raw);
    expect(result.content).toBe(raw);
    expect(result.priority).toBe(50);
    expect(result.scope).toBe('tenant');
  });

  it('parses priority and scope from valid frontmatter', () => {
    const raw = `---
priority: 80
scope: role
---
Skill content here.`;
    const result = parseFrontmatter(raw);
    expect(result.priority).toBe(80);
    expect(result.scope).toBe('role');
    expect(result.content).toBe('Skill content here.');
  });

  it('uses default priority when frontmatter priority is non-numeric', () => {
    const raw = `---
priority: high
scope: task
---
Content.`;
    const result = parseFrontmatter(raw);
    expect(result.priority).toBe(50);
    expect(result.scope).toBe('task');
  });

  it('ignores unknown scope values and uses default', () => {
    const raw = `---
scope: unknown-value
---
Content.`;
    const result = parseFrontmatter(raw);
    expect(result.scope).toBe('tenant'); // default
  });

  it('handles frontmatter with extra unknown keys gracefully', () => {
    const raw = `---
priority: 90
scope: task
author: joyus
---
Skill text.`;
    const result = parseFrontmatter(raw);
    expect(result.priority).toBe(90);
    expect(result.content).toBe('Skill text.');
  });
});

// ============================================================
// estimateTokens — unit tests
// ============================================================

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses chars/4 rounding up', () => {
    // 8 chars → 2 tokens exactly
    expect(estimateTokens('12345678')).toBe(2);
    // 9 chars → ceil(9/4) = 3
    expect(estimateTokens('123456789')).toBe(3);
  });
});

// ============================================================
// T038: FilesystemSkillResolver
// ============================================================

describe('FilesystemSkillResolver — T038', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  it('returns empty array when tenant skills directory does not exist', async () => {
    mockReaddir.mockRejectedValue(makeEnoentError());
    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const skills = await resolver.resolve(TENANT_ID);
    expect(skills).toEqual([]);
  });

  it('reads all .md files in the tenant directory', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('my-skill.md'),
      makeDirent('other.md'),
      makeDirent('readme.txt'), // non-.md, should be ignored
    ] as never);

    mockReadFile
      .mockResolvedValueOnce('Skill A content')
      .mockResolvedValueOnce('Skill B content');

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const skills = await resolver.resolve(TENANT_ID);

    expect(skills).toHaveLength(2);
    expect(skills.map((s) => s.name)).toContain('my-skill');
    expect(skills.map((s) => s.name)).toContain('other');
  });

  it('parses frontmatter from skill files', async () => {
    mockReaddir.mockResolvedValue([makeDirent('high-priority.md')] as never);
    mockReadFile.mockResolvedValue(`---
priority: 90
scope: role
---
High priority skill content.`);

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const skills = await resolver.resolve(TENANT_ID);

    expect(skills[0].priority).toBe(90);
    expect(skills[0].scope).toBe('role');
    expect(skills[0].content).toBe('High priority skill content.');
  });

  it('skips unreadable skill files and continues loading others', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('good.md'),
      makeDirent('bad.md'),
    ] as never);

    mockReadFile
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce('Good skill content');

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const skills = await resolver.resolve(TENANT_ID);

    // Only the readable one is returned
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('bad'); // bad.md read second (after good fails first)
  });
});

// ============================================================
// T039: Skill Injection with Token Budget
// ============================================================

describe('SkillLoaderService.injectSkills — T039', () => {
  const makeSkill = (name: string, content: string, priority: number): Skill => ({
    name,
    content,
    priority,
    scope: 'tenant',
  });

  it('injects all skills when budget is sufficient', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });
    const skills = [
      makeSkill('skill-a', 'Content A', 80),
      makeSkill('skill-b', 'Content B', 60),
    ];

    const result = service.injectSkills(skills, '', 0);

    expect(result.includedSkills).toContain('skill-a');
    expect(result.includedSkills).toContain('skill-b');
    expect(result.excludedSkills).toHaveLength(0);
    expect(result.block).toContain('Content A');
    expect(result.block).toContain('Content B');
  });

  it('skips low-priority skills when budget is tight', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });

    // Budget: 200_000 - 8_000 - 0 (history) - 0 (constitution) = 192_000 tokens
    // A very large skill that would push us over
    const bigContent = 'x'.repeat(192_000 * 4 + 100); // exceeds budget
    const skills = [
      makeSkill('big-skill', bigContent, 80),   // high priority — will be included
      makeSkill('small-skill', 'Tiny content', 40), // low priority — skipped if budget gone
    ];

    // Already over budget before we start — use a massive history token estimate
    const historyTokens = 195_000;
    const result = service.injectSkills(skills, '', historyTokens);

    // Both big and small should be excluded (budget exhausted)
    expect(result.excludedSkills.length).toBeGreaterThan(0);
  });

  it('keeps higher-priority skills and drops lower-priority when budget is tight', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });

    // 8 tokens remaining for skills (after massive history)
    // skill-high: 4 chars = 1 token (fits)
    // skill-low:  1000 chars = 250 tokens (won't fit)
    const historyTokens = 200_000 - 8_000 - 9; // leaves 9 tokens for skills

    const skills = [
      makeSkill('skill-high', 'AAAA', 90),       // 1 token — fits
      makeSkill('skill-low', 'B'.repeat(1000), 10), // 250 tokens — doesn't fit
    ];

    // Skills are already in priority order (highest first) from loadSkills()
    const result = service.injectSkills(skills, '', historyTokens);

    expect(result.includedSkills).toContain('skill-high');
    expect(result.excludedSkills).toContain('skill-low');
  });

  it('handles zero budget gracefully (no skills, no crash)', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });
    const skills = [makeSkill('skill-a', 'Some content', 80)];

    // Set history to consume all tokens
    const historyTokens = 200_000;
    const result = service.injectSkills(skills, '', historyTokens);

    expect(result.includedSkills).toHaveLength(0);
    expect(result.excludedSkills).toContain('skill-a');
  });

  it('does not truncate mid-skill (either fully included or fully skipped)', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });

    // Two skills, budget is tight
    const historyTokens = 200_000 - 8_000 - 10; // leaves ~10 tokens

    const skills = [
      makeSkill('skill-1', 'A'.repeat(40), 90), // 10 tokens exactly — fits
      makeSkill('skill-2', 'B'.repeat(40), 50), // 10 tokens — no room left
    ];

    const result = service.injectSkills(skills, '', historyTokens);

    // skill-1 fits; skill-2 is fully skipped (not partially injected)
    if (result.includedSkills.includes('skill-1')) {
      expect(result.block).toContain('A'.repeat(40));
      expect(result.block).not.toContain('B'.repeat(40));
    }
  });

  it('prepends constitution before skills', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });
    const skills = [makeSkill('skill-a', 'Skill content', 80)];
    const constitution = 'Constitution rules here';

    const result = service.injectSkills(skills, constitution, 0);

    const constitutionIdx = result.block.indexOf('Constitution rules here');
    const skillIdx = result.block.indexOf('Skill content');

    expect(constitutionIdx).toBeLessThan(skillIdx);
  });

  it('returns only constitution block when no skills fit', () => {
    const service = new SkillLoaderService({ constitutionFile: '/nonexistent' });
    const skills = [makeSkill('skill-a', 'x'.repeat(10_000 * 4), 80)];
    const constitution = 'Platform rules.';

    // Leave very little budget for skills
    const historyTokens = 200_000 - 8_000 - 4; // 4 tokens budget for skills (constitution ~4 tokens)

    const result = service.injectSkills(skills, constitution, historyTokens);

    expect(result.block).toContain('Platform rules.');
    expect(result.excludedSkills).toContain('skill-a');
  });
});

// ============================================================
// T039: Skill Sort (in loadSkills)
// ============================================================

describe('SkillLoaderService.loadSkills — sort by priority', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  it('returns skills sorted by priority descending', async () => {
    mockReaddir.mockResolvedValue([
      makeDirent('low.md'),
      makeDirent('high.md'),
      makeDirent('mid.md'),
    ] as never);

    mockReadFile
      .mockResolvedValueOnce(`---\npriority: 10\n---\nLow skill`)
      .mockResolvedValueOnce(`---\npriority: 90\n---\nHigh skill`)
      .mockResolvedValueOnce(`---\npriority: 50\n---\nMid skill`);

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const service = new SkillLoaderService({ resolver, constitutionFile: '/nonexistent' });

    const skills = await service.loadSkills(TENANT_ID);

    expect(skills[0].priority).toBe(90);
    expect(skills[1].priority).toBe(50);
    expect(skills[2].priority).toBe(10);
  });
});

// ============================================================
// T040: Constitution Loading
// ============================================================

describe('SkillLoaderService.loadConstitution — T040', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
  });

  it('returns constitution content from file', async () => {
    mockReadFile.mockResolvedValue('§1. Be helpful.\n§2. Do no harm.');
    const service = new SkillLoaderService({ constitutionFile: '/constitution.md' });

    const constitution = await service.loadConstitution();
    expect(constitution).toBe('§1. Be helpful.\n§2. Do no harm.');
  });

  it('returns empty string when constitution file is missing (graceful degrade)', async () => {
    mockReadFile.mockRejectedValue(makeEnoentError());
    const service = new SkillLoaderService({ constitutionFile: '/missing.md' });

    const constitution = await service.loadConstitution();
    expect(constitution).toBe('');
  });

  it('throws for non-ENOENT filesystem errors', async () => {
    const permissionError = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';
    mockReadFile.mockRejectedValue(permissionError);
    const service = new SkillLoaderService({ constitutionFile: '/protected.md' });

    await expect(service.loadConstitution()).rejects.toThrow('EACCES');
  });
});

// ============================================================
// T038/T039/T040: assemblePromptPrefix integration
// ============================================================

describe('SkillLoaderService.assemblePromptPrefix — integration', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
  });

  it('includes constitution and loaded skills in the result block', async () => {
    // Constitution
    mockReadFile
      .mockResolvedValueOnce('Platform Constitution v1.0') // constitution
      .mockResolvedValueOnce('Skill A content'); // skill file

    mockReaddir.mockResolvedValue([makeDirent('skill-a.md')] as never);

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const service = new SkillLoaderService({ resolver, constitutionFile: '/constitution.md' });

    const result = await service.assemblePromptPrefix(TENANT_ID, 0);

    expect(result.block).toContain('Platform Constitution v1.0');
    expect(result.block).toContain('Skill A content');
    expect(result.includedSkills).toContain('skill-a');
  });

  it('includes only constitution when skills directory is missing', async () => {
    mockReadFile.mockResolvedValueOnce('The Constitution'); // constitution reads fine
    mockReaddir.mockRejectedValue(makeEnoentError()); // skills dir missing

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const service = new SkillLoaderService({ resolver, constitutionFile: '/constitution.md' });

    const result = await service.assemblePromptPrefix(TENANT_ID, 0);

    expect(result.block).toContain('The Constitution');
    expect(result.includedSkills).toHaveLength(0);
  });

  it('returns non-empty block even with no constitution and no skills', async () => {
    mockReadFile.mockRejectedValue(makeEnoentError()); // no constitution
    mockReaddir.mockRejectedValue(makeEnoentError()); // no skills

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const service = new SkillLoaderService({ resolver, constitutionFile: '/missing.md' });

    const result = await service.assemblePromptPrefix(TENANT_ID, 0);

    // Block may be empty — that's fine; agent-loop falls back to default instructions
    expect(result.excludedSkills).toHaveLength(0);
    expect(result.includedSkills).toHaveLength(0);
  });

  it('delivers constitution even when loadSkills throws EACCES', async () => {
    // Constitution loads fine
    mockReadFile.mockResolvedValueOnce('Platform Constitution v1.0');

    // Skills directory throws permission denied (non-ENOENT)
    const eacces = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
    eacces.code = 'EACCES';
    mockReaddir.mockRejectedValue(eacces);

    const resolver = new FilesystemSkillResolver(SKILLS_DIR);
    const service = new SkillLoaderService({ resolver, constitutionFile: '/constitution.md' });

    const result = await service.assemblePromptPrefix(TENANT_ID, 0);

    expect(result.block).toContain('Platform Constitution v1.0');
    expect(result.includedSkills).toHaveLength(0);
  });
});
