/**
 * Branch-switch config reload trigger — T044
 *
 * When the developer switches branches, reloads enforcement config
 * (which may differ per branch) and reports what changed.
 */

import { randomUUID } from 'node:crypto';
import { loadEnforcementConfig } from '../config.js';
import { checkBranchNaming } from '../git/branch-hygiene.js';
import { AuditWriter } from '../audit/writer.js';
import type { MergedEnforcementConfig, AuditEntry } from '../types.js';

export interface ConfigChange {
  field: string;
  previous: string | number;
  current: string | number;
}

export interface ConfigReloadResult {
  reloaded: boolean;
  newBranch: string;
  namingValid: boolean;
  suggestedName?: string;
  changes: ConfigChange[];
  auditEntryId: string;
}

export function onBranchSwitch(
  newBranch: string,
  previousConfig: MergedEnforcementConfig,
  ctx: { projectRoot: string; sessionId: string; auditDir: string },
): ConfigReloadResult {
  const { config: newConfig } = loadEnforcementConfig(ctx.projectRoot);

  const changes: ConfigChange[] = [];

  if (previousConfig.gates.length !== newConfig.gates.length) {
    changes.push({
      field: 'gates',
      previous: previousConfig.gates.length,
      current: newConfig.gates.length,
    });
  }

  if (previousConfig.skillMappings.length !== newConfig.skillMappings.length) {
    changes.push({
      field: 'skillMappings',
      previous: previousConfig.skillMappings.length,
      current: newConfig.skillMappings.length,
    });
  }

  if (previousConfig.resolvedTier !== newConfig.resolvedTier) {
    changes.push({
      field: 'resolvedTier',
      previous: previousConfig.resolvedTier,
      current: newConfig.resolvedTier,
    });
  }

  const namingResult = newConfig.branchRules.namingConvention
    ? checkBranchNaming(newBranch, newConfig.branchRules)
    : { valid: true, branchName: newBranch };

  const writer = new AuditWriter(ctx.auditDir);
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    actionType: 'config-reload',
    result: 'pass',
    userTier: newConfig.resolvedTier,
    activeSkills: [],
    branchName: newBranch,
    details: {
      trigger: 'branch-switch',
      changesDetected: changes.length,
      changes,
      namingValid: namingResult.valid,
    },
  };
  writer.write(entry);

  return {
    reloaded: changes.length > 0,
    newBranch,
    namingValid: namingResult.valid,
    suggestedName: namingResult.suggestedName,
    changes,
    auditEntryId: id,
  };
}
