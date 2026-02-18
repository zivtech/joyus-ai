/**
 * Storage monitor — T012
 *
 * Warns when audit storage exceeds a configurable threshold.
 * No auto-pruning per clarification decision.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface StorageStatus {
  totalBytes: number;
  humanReadable: string;
  warningThreshold: number;
  isOverThreshold: boolean;
}

const DEFAULT_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB

export function checkStorageUsage(
  auditDir: string,
  thresholdBytes: number = DEFAULT_THRESHOLD_BYTES,
): StorageStatus {
  let totalBytes = 0;

  try {
    const files = readdirSync(auditDir);
    for (const file of files) {
      try {
        const stat = statSync(join(auditDir, file));
        if (stat.isFile()) {
          totalBytes += stat.size;
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory doesn't exist yet — 0 bytes
  }

  return {
    totalBytes,
    humanReadable: formatBytes(totalBytes),
    warningThreshold: thresholdBytes,
    isOverThreshold: totalBytes > thresholdBytes,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
