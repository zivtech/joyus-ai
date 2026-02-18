/**
 * Configuration loading — T004
 *
 * Loads and merges global + project configuration with sensible defaults.
 * Global: ~/.joyus-ai/global-config.json
 * Project: <projectRoot>/.joyus-ai/config.json
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { GlobalConfigSchema, ProjectConfigSchema } from './schema.js';
import type { GlobalConfig, ProjectConfig } from './types.js';

// --- Defaults ---

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = GlobalConfigSchema.parse({});
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = ProjectConfigSchema.parse({});

// --- Loaders ---

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const configPath = join(homedir(), '.joyus-ai', 'global-config.json');
  const raw = readJsonFile(configPath);
  if (raw === null) return DEFAULT_GLOBAL_CONFIG;

  const result = GlobalConfigSchema.safeParse(raw);
  if (result.success) return result.data;

  console.warn('[joyus-ai] Global config invalid, using defaults:', formatErrors(result.error));
  return DEFAULT_GLOBAL_CONFIG;
}

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const configPath = join(projectRoot, '.joyus-ai', 'config.json');
  const raw = readJsonFile(configPath);
  if (raw === null) return DEFAULT_PROJECT_CONFIG;

  const result = ProjectConfigSchema.safeParse(raw);
  if (result.success) return result.data;

  console.warn('[joyus-ai] Project config invalid, using defaults:', formatErrors(result.error));
  return DEFAULT_PROJECT_CONFIG;
}

export async function loadConfig(projectRoot: string): Promise<{
  global: GlobalConfig;
  project: ProjectConfig;
}> {
  const [global, project] = await Promise.all([
    loadGlobalConfig(),
    loadProjectConfig(projectRoot),
  ]);
  return { global, project };
}

// --- Helpers ---

function readJsonFile(filePath: string): unknown | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function formatErrors(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
}
