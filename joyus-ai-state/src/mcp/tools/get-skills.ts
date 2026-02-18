/**
 * MCP tool: get_skills — T038
 *
 * Returns active skills, conflict resolutions, and combined skill context
 * string for Claude's context injection.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';
import type { Skill } from '../../enforcement/types.js';
import { loadEnforcementConfig } from '../../enforcement/config.js';
import { matchSkillsForFile, loadSkill } from '../../enforcement/skills/loader.js';
import { SkillCache } from '../../enforcement/skills/cache.js';
import { resolveSkillPrecedence } from '../../enforcement/skills/precedence.js';
import { buildSkillContext, buildSkillSummary } from '../../enforcement/skills/context-builder.js';

export function handleGetSkills(
  args: { filePath?: string },
  ctx: ToolContext,
) {
  const { config } = loadEnforcementConfig(ctx.projectRoot);
  const cache = new SkillCache(ctx.auditDir);

  let skillIds: string[];
  if (args.filePath) {
    const match = matchSkillsForFile(args.filePath, config.skillMappings);
    skillIds = match.skillIds;
  } else {
    const allSkillIds = new Set<string>();
    for (const mapping of config.skillMappings) {
      for (const id of mapping.skills) {
        allSkillIds.add(id);
      }
    }
    skillIds = Array.from(allSkillIds);
  }

  const repoPath = ctx.projectRoot;
  const skills: Skill[] = [];
  for (const skillId of skillIds) {
    const result = loadSkill(skillId, repoPath, cache);
    if (result.skill) {
      skills.push({
        id: result.skill.id,
        name: result.skill.name,
        source: result.source === 'cache' ? 'auto-loaded' : 'auto-loaded',
        precedence: 'platform-default',
        constraints: result.skill.constraints,
        antiPatterns: result.skill.antiPatterns,
        loadedAt: new Date().toISOString(),
        cachedFrom: result.source === 'cache' ? result.skill.cachedAt : undefined,
      });
    }
  }

  const { resolvedSkills, conflicts } = resolveSkillPrecedence(skills);
  const skillContext = buildSkillContext(resolvedSkills);
  const summaries = buildSkillSummary(resolvedSkills);

  return {
    activeSkills: summaries.map((s) => ({
      id: s.id,
      name: s.name,
      source: s.source,
      precedence: s.precedence,
      cachedFrom: s.cachedFrom ?? null,
      constraints: resolvedSkills.find((sk) => sk.id === s.id)?.constraints ?? '',
    })),
    conflictsResolved: conflicts,
    skillContext,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'get_skills',
    {
      filePath: z.string().optional(),
    },
    async (args) => {
      const result = handleGetSkills(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
