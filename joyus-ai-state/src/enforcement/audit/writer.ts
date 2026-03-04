/**
 * JSONL audit writer — T007
 *
 * Crash-safe, append-only audit log with daily file rotation.
 * Each line is a complete JSON object. Partial writes from crashes
 * are detectable and skipped on read.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AuditEntrySchema } from './schema.js';
import type { AuditEntry } from '../types.js';

export class AuditWriter {
  private readonly auditDir: string;
  private initialized = false;

  constructor(auditDir: string) {
    this.auditDir = auditDir;
  }

  write(entry: AuditEntry): void {
    this.ensureDir();
    const fileName = `audit-${this.todayStamp()}.jsonl`;
    const filePath = join(this.auditDir, fileName);
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(filePath, line, 'utf-8');
  }

  private ensureDir(): void {
    if (this.initialized) return;
    mkdirSync(this.auditDir, { recursive: true });
    this.initialized = true;
  }

  private todayStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

export function readEntries(filePath: string): { entries: AuditEntry[]; skipped: number } {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return { entries: [], skipped: 0 };
  }

  const entries: AuditEntry[] = [];
  let skipped = 0;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      const validated = AuditEntrySchema.parse(parsed);
      entries.push(validated);
    } catch {
      skipped++;
    }
  }

  return { entries, skipped };
}

export function listAuditFiles(auditDir: string): string[] {
  try {
    const files = readdirSync(auditDir);
    return files
      .filter((f) => f.startsWith('audit-') && f.endsWith('.jsonl'))
      .sort()
      .map((f) => join(auditDir, f));
  } catch {
    return [];
  }
}
