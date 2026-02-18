/**
 * MCP tool: check_upstream — T039
 *
 * Searches project dependencies before implementing new code.
 * Local search only — no network calls.
 */

import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolContext } from '../types.js';

interface ExistingSolution {
  package: string;
  relevantExport: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function readJsonManifest(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function searchPackageJson(
  projectRoot: string,
  keywords: string[],
): { solutions: ExistingSolution[]; found: boolean } {
  const manifest = readJsonManifest(join(projectRoot, 'package.json'));
  if (!manifest) return { solutions: [], found: false };

  const solutions: ExistingSolution[] = [];
  const deps = {
    ...(manifest.dependencies as Record<string, string> | undefined),
    ...(manifest.devDependencies as Record<string, string> | undefined),
  };

  for (const [pkg] of Object.entries(deps)) {
    const pkgLower = pkg.toLowerCase();
    for (const kw of keywords) {
      if (pkgLower.includes(kw)) {
        const confidence = pkgLower === kw || pkgLower.endsWith(`/${kw}`) ? 'high' : 'medium';
        solutions.push({
          package: pkg,
          relevantExport: pkg,
          confidence,
          reason: `Package name matches keyword "${kw}"`,
        });
        break;
      }
    }
  }

  return { solutions, found: true };
}

function searchComposerJson(
  projectRoot: string,
  keywords: string[],
): { solutions: ExistingSolution[]; found: boolean } {
  const manifest = readJsonManifest(join(projectRoot, 'composer.json'));
  if (!manifest) return { solutions: [], found: false };

  const solutions: ExistingSolution[] = [];
  const deps = {
    ...(manifest.require as Record<string, string> | undefined),
    ...(manifest['require-dev'] as Record<string, string> | undefined),
  };

  for (const [pkg] of Object.entries(deps)) {
    const pkgLower = pkg.toLowerCase();
    for (const kw of keywords) {
      if (pkgLower.includes(kw)) {
        solutions.push({
          package: pkg,
          relevantExport: pkg,
          confidence: 'medium',
          reason: `Composer package matches keyword "${kw}"`,
        });
        break;
      }
    }
  }

  return { solutions, found: true };
}

export function handleCheckUpstream(
  args: { description: string; language?: string },
  ctx: ToolContext,
) {
  const keywords = args.description
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter((w) => w.length > 2);

  const searchedIn: string[] = [];
  const allSolutions: ExistingSolution[] = [];

  const pkgResult = searchPackageJson(ctx.projectRoot, keywords);
  if (pkgResult.found) {
    searchedIn.push('package.json');
    allSolutions.push(...pkgResult.solutions);
  }

  const composerResult = searchComposerJson(ctx.projectRoot, keywords);
  if (composerResult.found) {
    searchedIn.push('composer.json');
    allSolutions.push(...composerResult.solutions);
  }

  // Sort by confidence
  allSolutions.sort((a, b) => {
    const rank = { high: 3, medium: 2, low: 1 };
    return rank[b.confidence] - rank[a.confidence];
  });

  let recommendation: 'use-existing' | 'investigate-further' | 'implement-new';
  if (allSolutions.some((s) => s.confidence === 'high')) {
    recommendation = 'use-existing';
  } else if (allSolutions.length > 0) {
    recommendation = 'investigate-further';
  } else {
    recommendation = 'implement-new';
  }

  return {
    existingSolutions: allSolutions,
    searchedIn,
    recommendation,
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'check_upstream',
    {
      description: z.string(),
      language: z.string().optional(),
    },
    async (args) => {
      const result = handleCheckUpstream(args, ctx);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
