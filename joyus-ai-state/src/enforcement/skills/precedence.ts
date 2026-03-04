/**
 * Skill precedence resolver — T022
 *
 * Deterministic resolution of conflicting skills based on
 * precedence levels: client-override > client-brand > core > platform-default.
 */

import type { Skill, PrecedenceLevel } from '../types.js';

const PRECEDENCE_RANK: Record<PrecedenceLevel, number> = {
  'client-override': 4,
  'client-brand': 3,
  'core': 2,
  'platform-default': 1,
};

export interface ConflictResolution {
  winner: string;
  loser: string;
  reason: string;
}

export interface PrecedenceResult {
  resolvedSkills: Skill[];
  conflicts: ConflictResolution[];
}

export function resolveSkillPrecedence(skills: Skill[]): PrecedenceResult {
  if (skills.length <= 1) {
    return { resolvedSkills: [...skills], conflicts: [] };
  }

  // Sort by precedence (highest first), then by ID for determinism
  const sorted = [...skills].sort((a, b) => {
    const rankDiff = PRECEDENCE_RANK[b.precedence] - PRECEDENCE_RANK[a.precedence];
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });

  const conflicts: ConflictResolution[] = [];
  const resolved: Skill[] = [];
  const seenConstraintDomains = new Map<string, Skill>();

  for (const skill of sorted) {
    // Simple domain detection: use skill ID prefix as domain
    // e.g., "drupal-security" and "drupal-coding-standards" share "drupal" domain
    const domain = skill.id.split('-')[0];
    const existing = seenConstraintDomains.get(domain);

    if (existing && existing.id !== skill.id) {
      // Conflict: existing skill already covers this domain with higher precedence
      conflicts.push({
        winner: existing.id,
        loser: skill.id,
        reason: `${existing.id} (${existing.precedence}) takes precedence over ${skill.id} (${skill.precedence}) in '${domain}' domain`,
      });
    }

    // All skills are included in resolved list (constraints are additive)
    // Conflicts are logged for transparency but don't remove skills
    resolved.push(skill);

    if (!seenConstraintDomains.has(domain)) {
      seenConstraintDomains.set(domain, skill);
    }
  }

  return { resolvedSkills: resolved, conflicts };
}

export function getPrecedenceRank(level: PrecedenceLevel): number {
  return PRECEDENCE_RANK[level];
}
