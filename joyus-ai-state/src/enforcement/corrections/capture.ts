/**
 * Correction capture and storage — T013
 *
 * Captures user corrections when Claude's output doesn't meet skill
 * constraints (FR-030/031). Stored locally as JSONL for future aggregation.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CorrectionSchema } from '../audit/schema.js';
import type { Correction } from '../types.js';

export class CorrectionStore {
  private readonly correctionsDir: string;
  private initialized = false;

  constructor(correctionsDir: string) {
    this.correctionsDir = correctionsDir;
  }

  record(correction: Correction): string {
    const validated = CorrectionSchema.parse(correction);
    this.ensureDir();
    const fileName = `corrections-${this.todayStamp()}.jsonl`;
    const filePath = join(this.correctionsDir, fileName);
    const line = JSON.stringify(validated) + '\n';
    appendFileSync(filePath, line, 'utf-8');
    return validated.id;
  }

  list(filters?: { skillId?: string; dateRange?: { from: string; to: string } }): Correction[] {
    const files = this.listFiles();
    const corrections: Correction[] = [];

    for (const filePath of files) {
      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = CorrectionSchema.parse(JSON.parse(trimmed));
          if (filters?.skillId && parsed.skillId !== filters.skillId) continue;
          if (filters?.dateRange) {
            if (parsed.timestamp < filters.dateRange.from) continue;
            if (parsed.timestamp > filters.dateRange.to) continue;
          }
          corrections.push(parsed);
        } catch {
          // Skip malformed lines
        }
      }
    }

    return corrections;
  }

  private listFiles(): string[] {
    try {
      const files = readdirSync(this.correctionsDir);
      return files
        .filter((f) => f.startsWith('corrections-') && f.endsWith('.jsonl'))
        .sort()
        .map((f) => join(this.correctionsDir, f));
    } catch {
      return [];
    }
  }

  private ensureDir(): void {
    if (this.initialized) return;
    mkdirSync(this.correctionsDir, { recursive: true });
    this.initialized = true;
  }

  private todayStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
