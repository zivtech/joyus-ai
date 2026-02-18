/**
 * File-pattern-to-skill mapper and skill loader — T019, T021, T025
 *
 * Maps file paths to skills via glob patterns, loads skills from
 * repo with cache fallback, and integrates with audit trail.
 */

import picomatch from 'picomatch';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SkillCache } from './cache.js';
import { AuditWriter } from '../audit/writer.js';
import type { SkillContent } from './cache.js';
import type { SkillMapping, AuditEntry, UserTier } from '../types.js';

// --- T019: File pattern matching ---

export interface MatchResult {
  matchedMappings: SkillMapping[];
  skillIds: string[];
}

export function matchSkillsForFile(filePath: string, mappings: SkillMapping[]): MatchResult {
  const matchedMappings: SkillMapping[] = [];
  const skillSet = new Set<string>();

  for (const mapping of mappings) {
    const isMatch = picomatch(mapping.filePatterns, { matchBase: true });
    if (isMatch(filePath)) {
      matchedMappings.push(mapping);
      for (const skillId of mapping.skills) {
        skillSet.add(skillId);
      }
    }
  }

  return {
    matchedMappings,
    skillIds: Array.from(skillSet),
  };
}

export function matchSkillsForFiles(filePaths: string[], mappings: SkillMapping[]): MatchResult {
  const allMappings: SkillMapping[] = [];
  const skillSet = new Set<string>();
  const seenMappingIds = new Set<string>();

  for (const filePath of filePaths) {
    const result = matchSkillsForFile(filePath, mappings);
    for (const mapping of result.matchedMappings) {
      if (!seenMappingIds.has(mapping.id)) {
        seenMappingIds.add(mapping.id);
        allMappings.push(mapping);
      }
    }
    for (const id of result.skillIds) {
      skillSet.add(id);
    }
  }

  return {
    matchedMappings: allMappings,
    skillIds: Array.from(skillSet),
  };
}

// --- T021: Skill repo loading with fallback ---

export interface LoadResult {
  skill: SkillContent | null;
  source: 'repo' | 'cache' | 'none';
  stale: boolean;
  warning?: string;
  error?: string;
}

export function loadSkillFromRepo(skillId: string, repoPath: string): SkillContent | null {
  const filePath = join(repoPath, 'skills', `${skillId}.md`);
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  return parseSkillMarkdown(skillId, content);
}

export function parseSkillMarkdown(skillId: string, content: string): SkillContent | null {
  try {
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length).trim() : content.trim();

    let name = skillId;
    if (frontmatterMatch) {
      const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim();
    }

    // Extract anti-patterns section
    const antiPatterns: string[] = [];
    const antiPatternsMatch = body.match(/## Anti-Patterns\n([\s\S]*?)(?=\n##|\n*$)/);
    if (antiPatternsMatch) {
      const lines = antiPatternsMatch[1].split('\n');
      for (const line of lines) {
        const pattern = line.replace(/^[-*]\s*/, '').trim();
        if (pattern && !pattern.startsWith('#')) {
          antiPatterns.push(pattern);
        }
      }
    }

    // Constraints = body minus anti-patterns section
    const constraints = body.replace(/## Anti-Patterns\n[\s\S]*?(?=\n##|\n*$)/, '').trim();

    return {
      id: skillId,
      name,
      constraints,
      antiPatterns,
      cachedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function loadSkill(
  skillId: string,
  repoPath: string,
  cache: SkillCache,
): LoadResult {
  // Try repo first
  const repoSkill = loadSkillFromRepo(skillId, repoPath);
  if (repoSkill) {
    cache.cacheSkill(skillId, repoSkill);
    return { skill: repoSkill, source: 'repo', stale: false };
  }

  // Fall back to cache
  const cached = cache.getCachedSkill(skillId);
  if (cached) {
    return {
      skill: cached,
      source: 'cache',
      stale: true,
      warning: `Skill repo unreachable for '${skillId}', using cached version`,
    };
  }

  return {
    skill: null,
    source: 'none',
    stale: false,
    error: `Skill '${skillId}' not available (repo unreachable, no cache)`,
  };
}

// --- T025: Audit integration ---

export function writeSkillAuditEntry(
  writer: AuditWriter,
  skillId: string,
  loadResult: LoadResult,
  config: {
    sessionId: string;
    userTier: UserTier;
    activeSkills: string[];
    taskId?: string;
    branchName?: string;
  },
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'skill-load',
    result: loadResult.skill ? 'pass' : 'unavailable',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    skillId,
    taskId: config.taskId,
    branchName: config.branchName,
    details: {
      source: loadResult.source,
      stale: loadResult.stale,
      warning: loadResult.warning,
      error: loadResult.error,
    },
  };
  writer.write(entry);
  return id;
}

export function writeSkillBypassEntry(
  writer: AuditWriter,
  skillId: string,
  overrideReason: string,
  config: {
    sessionId: string;
    userTier: UserTier;
    activeSkills: string[];
    taskId?: string;
    branchName?: string;
  },
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'skill-bypass',
    result: 'bypassed',
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    skillId,
    overrideReason,
    taskId: config.taskId,
    branchName: config.branchName,
    details: {},
  };
  writer.write(entry);
  return id;
}
