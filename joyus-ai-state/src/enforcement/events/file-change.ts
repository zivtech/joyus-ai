/**
 * File-change skill auto-load trigger — T043
 *
 * When files change that match skill mapping patterns, triggers
 * skill reload. Includes debouncing to batch rapid saves.
 */

import { randomUUID } from 'node:crypto';
import { matchSkillsForFiles } from '../skills/loader.js';
import { loadSkill } from '../skills/loader.js';
import { SkillCache } from '../skills/cache.js';
import { resolveSkillPrecedence } from '../skills/precedence.js';
import { buildSkillContext } from '../skills/context-builder.js';
import { AuditWriter } from '../audit/writer.js';
import type { MergedEnforcementConfig, Skill, AuditEntry } from '../types.js';

export interface SkillReloadResult {
  reloaded: boolean;
  newSkillIds: string[];
  skillContext: string;
  auditEntryIds: string[];
}

// --- Debounce state ---

let pendingFiles: string[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2000;

export function resetDebounceState(): void {
  pendingFiles = [];
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function onFileChange(
  changedFiles: string[],
  config: MergedEnforcementConfig,
  ctx: { sessionId: string; auditDir: string; repoPath: string; previousSkillIds?: string[] },
): Promise<SkillReloadResult> {
  return new Promise((resolve) => {
    pendingFiles.push(...changedFiles);

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      const files = [...pendingFiles];
      pendingFiles = [];
      debounceTimer = null;
      resolve(processFileChange(files, config, ctx));
    }, DEBOUNCE_MS);
  });
}

export function processFileChange(
  changedFiles: string[],
  config: MergedEnforcementConfig,
  ctx: { sessionId: string; auditDir: string; repoPath: string; previousSkillIds?: string[] },
): SkillReloadResult {
  const match = matchSkillsForFiles(changedFiles, config.skillMappings);

  if (match.skillIds.length === 0) {
    return { reloaded: false, newSkillIds: [], skillContext: '', auditEntryIds: [] };
  }

  const previousSet = new Set(ctx.previousSkillIds ?? []);
  const newSkillIds = match.skillIds.filter((id) => !previousSet.has(id));

  if (newSkillIds.length === 0 && match.skillIds.length === (ctx.previousSkillIds?.length ?? 0)) {
    return { reloaded: false, newSkillIds: [], skillContext: '', auditEntryIds: [] };
  }

  const cache = new SkillCache(ctx.auditDir);
  const writer = new AuditWriter(ctx.auditDir);
  const skills: Skill[] = [];
  const auditEntryIds: string[] = [];

  for (const skillId of match.skillIds) {
    const result = loadSkill(skillId, ctx.repoPath, cache);
    if (result.skill) {
      skills.push({
        id: result.skill.id,
        name: result.skill.name,
        source: 'auto-loaded',
        precedence: 'platform-default',
        constraints: result.skill.constraints,
        antiPatterns: result.skill.antiPatterns,
        loadedAt: new Date().toISOString(),
        cachedFrom: result.source === 'cache' ? result.skill.cachedAt : undefined,
      });

      if (newSkillIds.includes(skillId)) {
        const id = randomUUID();
        const entry: AuditEntry = {
          id,
          timestamp: new Date().toISOString(),
          sessionId: ctx.sessionId,
          actionType: 'skill-load',
          result: 'pass',
          userTier: config.resolvedTier,
          activeSkills: match.skillIds,
          skillId,
          details: { source: result.source, trigger: 'file-change' },
        };
        writer.write(entry);
        auditEntryIds.push(id);
      }
    }
  }

  const { resolvedSkills } = resolveSkillPrecedence(skills);
  const skillContext = buildSkillContext(resolvedSkills);

  return {
    reloaded: true,
    newSkillIds,
    skillContext,
    auditEntryIds,
  };
}
