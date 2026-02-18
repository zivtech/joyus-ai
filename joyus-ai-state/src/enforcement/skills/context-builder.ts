/**
 * Skill context builder — T023
 *
 * Aggregates plain-language constraints from active skills
 * into a single string for injection into Claude's context.
 */

import type { Skill, PrecedenceLevel } from '../types.js';

export interface SkillSummary {
  id: string;
  name: string;
  source: string;
  precedence: PrecedenceLevel;
  cachedFrom?: string;
}

const PRECEDENCE_RANK: Record<PrecedenceLevel, number> = {
  'client-override': 4,
  'client-brand': 3,
  'core': 2,
  'platform-default': 1,
};

export function buildSkillContext(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const sorted = [...skills].sort((a, b) => {
    const rankDiff = PRECEDENCE_RANK[b.precedence] - PRECEDENCE_RANK[a.precedence];
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });

  const sections = sorted.map(
    (skill) =>
      `## ${skill.name} (precedence: ${skill.precedence})\n${skill.constraints}`,
  );

  return sections.join('\n\n');
}

export function buildSkillSummary(skills: Skill[]): SkillSummary[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    source: skill.source,
    precedence: skill.precedence,
    cachedFrom: skill.cachedFrom,
  }));
}
