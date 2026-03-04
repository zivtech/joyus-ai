/**
 * Canonical document management — T013, T014, T015, T016
 *
 * CRUD operations for canonical document declarations,
 * path checking with branch override resolution,
 * warning generation, and snapshot status integration.
 */

import { readFile, writeFile, rename, mkdir, access, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CanonicalStatus } from '../core/types.js';

// --- Types ---

export interface CanonicalDeclarations {
  documents: Record<string, {
    default: string;
    branches?: Record<string, string>;
  }>;
}

export interface CheckResult {
  isCanonical: boolean;
  canonicalName: string | null;
  canonicalPath: string | null;
  suggestion: string | null;
}

// --- T013: CRUD ---

const CANONICAL_PATH = '.joyus-ai/canonical.json';

function canonicalFilePath(projectRoot: string): string {
  return path.join(projectRoot, CANONICAL_PATH);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
}

export async function loadCanonical(projectRoot: string): Promise<CanonicalDeclarations> {
  try {
    const raw = await readFile(canonicalFilePath(projectRoot), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.documents) {
      return parsed as CanonicalDeclarations;
    }
    return { documents: {} };
  } catch {
    return { documents: {} };
  }
}

export async function saveCanonical(projectRoot: string, declarations: CanonicalDeclarations): Promise<void> {
  const filePath = canonicalFilePath(projectRoot);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(declarations, null, 2) + '\n', 'utf-8');
  await rename(tmpPath, filePath);
}

export function addDeclaration(
  declarations: CanonicalDeclarations,
  name: string,
  docPath: string,
  branch?: string,
): CanonicalDeclarations {
  const result: CanonicalDeclarations = {
    documents: { ...declarations.documents },
  };

  if (branch) {
    const existing = result.documents[name] ?? { default: docPath };
    result.documents[name] = {
      ...existing,
      branches: { ...existing.branches, [branch]: docPath },
    };
  } else {
    const existing = result.documents[name];
    result.documents[name] = existing
      ? { ...existing, default: docPath }
      : { default: docPath };
  }

  return result;
}

export function removeDeclaration(
  declarations: CanonicalDeclarations,
  name: string,
): CanonicalDeclarations {
  if (!(name in declarations.documents)) return declarations;
  const { [name]: _, ...rest } = declarations.documents;
  return { documents: rest };
}

export function listDeclarations(
  declarations: CanonicalDeclarations,
): Array<{ name: string; defaultPath: string; branchOverrides: string[] }> {
  return Object.entries(declarations.documents).map(([name, doc]) => ({
    name,
    defaultPath: doc.default,
    branchOverrides: doc.branches ? Object.keys(doc.branches) : [],
  }));
}

// --- T014: checkPath ---

function resolveCanonicalPath(
  doc: { default: string; branches?: Record<string, string> },
  currentBranch: string,
): string {
  if (doc.branches && currentBranch in doc.branches) {
    return normalizePath(doc.branches[currentBranch]);
  }
  return normalizePath(doc.default);
}

export function checkPath(
  declarations: CanonicalDeclarations,
  filePath: string,
  currentBranch: string,
): CheckResult {
  const normalizedInput = normalizePath(filePath);
  const inputBasename = path.basename(normalizedInput);

  for (const [name, doc] of Object.entries(declarations.documents)) {
    const canonicalResolved = resolveCanonicalPath(doc, currentBranch);

    // Exact match
    if (normalizedInput === canonicalResolved) {
      return {
        isCanonical: true,
        canonicalName: name,
        canonicalPath: canonicalResolved,
        suggestion: null,
      };
    }

    // Basename match (same filename, different directory)
    const canonicalBasename = path.basename(canonicalResolved);
    if (inputBasename === canonicalBasename && normalizedInput !== canonicalResolved) {
      return {
        isCanonical: false,
        canonicalName: name,
        canonicalPath: canonicalResolved,
        suggestion: `Use canonical source at ${canonicalResolved}`,
      };
    }
  }

  return {
    isCanonical: false,
    canonicalName: null,
    canonicalPath: null,
    suggestion: null,
  };
}

// --- T015: Warning generation ---

export function generateWarning(checkResult: CheckResult, accessedPath?: string): string | null {
  if (checkResult.isCanonical || !checkResult.canonicalName) return null;

  const accessed = accessedPath ?? 'unknown';
  return [
    `WARNING: "${accessed}" is NOT the canonical source.`,
    `  Canonical: ${checkResult.canonicalPath} (declared as "${checkResult.canonicalName}")`,
    `  Suggestion: ${checkResult.suggestion}`,
  ].join('\n');
}

// --- T016: Snapshot status integration ---

export async function getCanonicalStatuses(
  projectRoot: string,
  declarations: CanonicalDeclarations,
  currentBranch: string,
): Promise<CanonicalStatus[]> {
  const statuses: CanonicalStatus[] = [];

  for (const [name, doc] of Object.entries(declarations.documents)) {
    const resolvedPath = resolveCanonicalPath(doc, currentBranch);
    const fullPath = path.join(projectRoot, resolvedPath);
    const branchOverride = doc.branches && currentBranch in doc.branches
      ? currentBranch
      : null;

    let exists = false;
    let lastModified: string | null = null;

    try {
      await access(fullPath);
      exists = true;
      const stats = await stat(fullPath);
      lastModified = stats.mtime.toISOString();
    } catch {
      // File doesn't exist or can't be accessed
    }

    statuses.push({
      name,
      canonicalPath: resolvedPath,
      exists,
      lastModified,
      branchOverride,
    });
  }

  return statuses;
}
