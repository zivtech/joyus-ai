/**
 * Skill validation tool framework — T024
 *
 * Post-generation validation: checks Claude's output against
 * skill anti-patterns before commit/push.
 */

import { readFileSync } from 'node:fs';
import type { Skill } from '../types.js';

export interface Violation {
  skillId: string;
  pattern: string;
  matchedText: string;
  lineNumber?: number;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

export function validateAgainstSkills(content: string, skills: Skill[]): ValidationResult {
  const violations: Violation[] = [];
  const lines = content.split('\n');

  for (const skill of skills) {
    if (!skill.antiPatterns || skill.antiPatterns.length === 0) continue;

    for (const pattern of skill.antiPatterns) {
      const regex = toRegex(pattern);
      if (!regex) continue;

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(regex);
        if (match) {
          violations.push({
            skillId: skill.id,
            pattern,
            matchedText: match[0],
            lineNumber: i + 1,
          });
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function validateFile(filePath: string, skills: Skill[]): ValidationResult {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return validateAgainstSkills(content, skills);
  } catch {
    return { valid: true, violations: [] };
  }
}

function toRegex(pattern: string): RegExp | null {
  try {
    // Patterns prefixed with / are treated as regex
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      const lastSlash = pattern.lastIndexOf('/');
      const body = pattern.slice(1, lastSlash);
      const flags = pattern.slice(lastSlash + 1);
      return new RegExp(body, flags);
    }
    // Otherwise treat as literal string match (case-insensitive)
    return new RegExp(escapeRegex(pattern), 'i');
  } catch {
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
