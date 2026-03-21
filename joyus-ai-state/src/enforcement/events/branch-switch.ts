/**
 * Branch-switch config reload trigger — T044
 *
 * When the developer switches branches, reloads enforcement config
 * (which may differ per branch) and reports what changed.
 */

import { randomUUID, createHash } from 'node:crypto';
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

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function onBranchSwitch(
  newBranch: string,
  previousConfig: MergedEnforcementConfig,
  ctx: { projectRoot: string; sessionId: string; auditDir: string },
): ConfigReloadResult {
  const { config: newConfig } = loadEnforcementConfig(ctx.projectRoot);

  const changes: ConfigChange[] = [];

  const prevGatesHash = contentHash(previousConfig.gates);
  const newGatesHash = contentHash(newConfig.gates);
  if (prevGatesHash !== newGatesHash) {
    changes.push({
      field: 'gates',
      previous: prevGatesHash,
      current: newGatesHash,
    });
  }

  const prevSkillsHash = contentHash(previousConfig.skillMappings);
  const newSkillsHash = contentHash(newConfig.skillMappings);
  if (prevSkillsHash !== newSkillsHash) {
    changes.push({
      field: 'skillMappings',
      previous: prevSkillsHash,
      current: newSkillsHash,
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
