/**
 * Filesystem utilities — shared helpers for directory management.
 */

import { mkdirSync } from 'node:fs';

/**
 * Ensures a directory exists, creating it (and any parents) if needed.
 * Synchronous — safe to call before any file I/O in a hot path.
 */
export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
