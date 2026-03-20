/**
 * Enforcement config loader — T003, T004, T005
 *
 * Loads enforcement configuration from project-level and developer-level
 * config files, validates with Zod, merges with policy constraints, and
 * falls back to safe defaults on invalid config.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { type ZodType, type ZodTypeDef, ZodError } from 'zod';
import { EnforcementConfigSchema, DeveloperConfigSchema } from './schemas.js';
import type {
  EnforcementConfig,
  DeveloperConfig,
  MergedEnforcementConfig,
  OverrideLogEntry,
  ValidatedResult,
} from './types.js';

// --- Config path utilities (stub for 002 compatibility) ---

function getProjectHash(projectRoot: string): string {
  return createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
}

function getProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, '.joyus-ai', 'config.json');
}

function getDeveloperConfigPath(projectHash: string): string {
  return join(homedir(), '.joyus-ai', 'projects', projectHash, 'config.json');
}

// --- T005: Validation with safe defaults fallback (FR-029) ---

export function validateAndFallback<T>(
  rawConfig: unknown,
  schema: ZodType<T, ZodTypeDef, unknown>,
  label: string,
): ValidatedResult<T> {
  try {
    const config = schema.parse(rawConfig);
    return { valid: true, config, warnings: [] };
  } catch (err) {
    const warnings: string[] = [];
    if (err instanceof ZodError) {
      for (const issue of err.issues) {
        const path = issue.path.join('.');
        warnings.push(`${label}: ${path ? path + ' — ' : ''}${issue.message}`);
      }
    } else {
      warnings.push(`${label}: unexpected validation error`);
    }

    // Fall back to safe defaults. Use safeParse so a schema that cannot
    // parse {} does not throw inside this catch block and mask the original
    // validation warnings collected above.
    const fallback = schema.safeParse({});
    if (!fallback.success) {
      // Schema has no usable defaults — surface original warnings and rethrow.
      throw new Error(
        `Config validation failed and no safe defaults available for ${label}: ${warnings.join('; ')}`,
      );
    }
    return { valid: false, config: fallback.data, warnings };
  }
}

// --- T003: Config loaders ---

export function loadProjectConfig(projectRoot: string): ValidatedResult<EnforcementConfig> {
  const configPath = getProjectConfigPath(projectRoot);
  const raw = readJsonFile(configPath);
  if (raw === null) {
    return {
      valid: true,
      config: EnforcementConfigSchema.parse({}),
      warnings: [],
    };
  }

  const enforcement = (raw as Record<string, unknown>).enforcement ?? {};
  return validateAndFallback(enforcement, EnforcementConfigSchema, 'Project config');
}

export function loadDeveloperConfig(projectRoot: string): ValidatedResult<DeveloperConfig> {
  const projectHash = getProjectHash(projectRoot);
  const configPath = getDeveloperConfigPath(projectHash);
  const raw = readJsonFile(configPath);
  if (raw === null) {
    return {
      valid: true,
      config: DeveloperConfigSchema.parse({}),
      warnings: [],
    };
  }

  const enforcement = (raw as Record<string, unknown>).enforcement ?? {};
  return validateAndFallback(enforcement, DeveloperConfigSchema, 'Developer config');
}

function readJsonFile(filePath: string): unknown | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    // File not found or invalid JSON — return null for graceful fallback
    return null;
  }
}

// --- T004: Config merging with policy constraints ---

export function mergeConfig(
  project: EnforcementConfig,
  developer: DeveloperConfig,
): MergedEnforcementConfig {
  const overridesApplied: OverrideLogEntry[] = [];
  const policy = project.enforcementPolicy;

  // Resolve tier
  let resolvedTier = developer.tier;
  if (!policy.tierOverridable && developer.tier !== 'tier-2') {
    overridesApplied.push({
      field: 'tier',
      requested: developer.tier,
      applied: false,
      reason: 'Tier override not permitted by enforcement policy',
    });
    resolvedTier = 'tier-2';
  } else if (developer.tier !== 'tier-2') {
    overridesApplied.push({
      field: 'tier',
      requested: developer.tier,
      applied: true,
      reason: 'Tier override permitted by policy',
    });
  }

  // Apply gate overrides (skip mandatory gates)
  const gates = project.gates.map((gate) => {
    const override = developer.gateOverrides[gate.id];
    if (override === undefined) return gate;

    if (policy.mandatoryGates.includes(gate.id)) {
      overridesApplied.push({
        field: `gate:${gate.id}`,
        requested: override,
        applied: false,
        reason: `Gate "${gate.id}" is mandatory and cannot be overridden`,
      });
      return gate;
    }

    overridesApplied.push({
      field: `gate:${gate.id}`,
      requested: override,
      applied: true,
      reason: 'Gate override applied',
    });
    return { ...gate, defaultTier: override };
  });

  // Apply skill overrides (skip mandatory skills)
  const skillMappings = project.skillMappings.map((mapping) => {
    const disabledSkills = mapping.skills.filter((skillId) => {
      const override = developer.skillOverrides[skillId];
      if (override !== 'disabled') return false;

      if (policy.mandatorySkills.includes(skillId)) {
        overridesApplied.push({
          field: `skill:${skillId}`,
          requested: 'disabled',
          applied: false,
          reason: `Skill "${skillId}" is mandatory and cannot be disabled`,
        });
        return false;
      }

      overridesApplied.push({
        field: `skill:${skillId}`,
        requested: 'disabled',
        applied: true,
        reason: 'Skill override applied',
      });
      return true;
    });

    if (disabledSkills.length === 0) return mapping;
    return {
      ...mapping,
      skills: mapping.skills.filter((s) => !disabledSkills.includes(s)),
    };
  });

  return {
    gates,
    skillMappings,
    branchRules: project.branchRules,
    enforcementPolicy: project.enforcementPolicy,
    resolvedTier,
    overridesApplied,
  };
}

// --- Convenience: load and merge in one call ---

export function loadEnforcementConfig(projectRoot: string): {
  config: MergedEnforcementConfig;
  warnings: string[];
} {
  const projectResult = loadProjectConfig(projectRoot);
  const developerResult = loadDeveloperConfig(projectRoot);

  const warnings = [...projectResult.warnings, ...developerResult.warnings];
  const config = mergeConfig(projectResult.config, developerResult.config);

  return { config, warnings };
}
