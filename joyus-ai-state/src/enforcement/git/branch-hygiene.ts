/**
 * Branch hygiene — T027, T028, T029
 *
 * Naming convention enforcement, stale branch detection,
 * and active branch count warnings.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import type { BranchRule } from '../types.js';

// --- T027: Branch naming convention ---

export interface NamingResult {
  valid: boolean;
  branchName: string;
  convention?: string;
  suggestedName?: string;
}

export function checkBranchNaming(branchName: string, rules: BranchRule): NamingResult {
  // Skip check for protected branches
  if (rules.protectedBranches.includes(branchName)) {
    return { valid: true, branchName };
  }

  if (!rules.namingConvention) {
    return { valid: true, branchName };
  }

  try {
    const regex = new RegExp(rules.namingConvention);
    if (regex.test(branchName)) {
      return { valid: true, branchName, convention: rules.namingConvention };
    }

    return {
      valid: false,
      branchName,
      convention: rules.namingConvention,
      suggestedName: generateSuggestion(branchName),
    };
  } catch {
    // Invalid regex in config — don't block
    return { valid: true, branchName };
  }
}

export function generateSuggestion(name: string): string {
  let suggested = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-/]/g, '');

  if (!suggested.match(/^(feature|fix|hotfix)\//)) {
    suggested = `feature/${suggested}`;
  }

  return suggested;
}

// --- T028: Stale branch detection ---

export interface StaleBranch {
  name: string;
  lastModified: string;
  daysSinceModified: number;
}

export async function detectStaleBranches(rules: BranchRule, cwd?: string): Promise<StaleBranch[]> {
  const branches = await listBranchesWithDates(cwd);
  const now = Date.now();
  const staleDaysMs = rules.staleDays * 24 * 60 * 60 * 1000;

  return branches
    .filter((b) => !rules.protectedBranches.includes(b.name))
    .filter((b) => now - new Date(b.lastModified).getTime() > staleDaysMs)
    .map((b) => ({
      ...b,
      daysSinceModified: Math.floor((now - new Date(b.lastModified).getTime()) / (24 * 60 * 60 * 1000)),
    }))
    .sort((a, b) => b.daysSinceModified - a.daysSinceModified);
}

export async function listBranchesWithDates(cwd?: string): Promise<{ name: string; lastModified: string }[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short) %(committerdate:iso8601)', 'refs/heads/'],
      { cwd, encoding: 'utf-8' },
    );

    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        // Format: "branch-name 2026-02-18 12:00:00 -0500"
        const firstSpace = line.indexOf(' ');
        const name = line.slice(0, firstSpace);
        const lastModified = line.slice(firstSpace + 1).trim();
        return { name, lastModified };
      });
  } catch {
    return [];
  }
}

// --- T029: Active branch count ---

export interface BranchCountResult {
  count: number;
  limit: number;
  overLimit: boolean;
}

export async function checkBranchCount(rules: BranchRule, cwd?: string): Promise<BranchCountResult> {
  const branches = await listBranchesWithDates(cwd);
  const count = branches.length;
  return {
    count,
    limit: rules.maxActiveBranches,
    overLimit: count > rules.maxActiveBranches,
  };
}
