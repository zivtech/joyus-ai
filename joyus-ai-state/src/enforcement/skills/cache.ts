/**
 * Skill cache — T020
 *
 * Local JSON file cache for skills. Falls back to cached versions
 * when the skill repository is unreachable.
 */

import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillContent {
  id: string;
  name: string;
  constraints: string;
  antiPatterns: string[];
  validationCommand?: string;
  cachedAt: string;
  sourceCommit?: string;
}

export class SkillCache {
  private readonly cachePath: string;
  private initialized = false;

  constructor(cachePath: string) {
    this.cachePath = cachePath;
  }

  cacheSkill(skillId: string, content: SkillContent): void {
    this.ensureDir();
    const filePath = join(this.cachePath, `${skillId}.json`);
    writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  }

  getCachedSkill(skillId: string): SkillContent | null {
    const filePath = join(this.cachePath, `${skillId}.json`);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as SkillContent;
    } catch {
      return null;
    }
  }

  getCacheAge(skillId: string): number {
    const filePath = join(this.cachePath, `${skillId}.json`);
    try {
      const stat = statSync(filePath);
      return Date.now() - stat.mtimeMs;
    } catch {
      return Infinity;
    }
  }

  isFresh(skillId: string, maxAgeMs: number): boolean {
    return this.getCacheAge(skillId) < maxAgeMs;
  }

  private ensureDir(): void {
    if (this.initialized) return;
    mkdirSync(this.cachePath, { recursive: true });
    this.initialized = true;
  }
}
