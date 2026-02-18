/**
 * Sequential fail-fast gate runner — T015, T017, T018
 *
 * Core gate execution engine. Runs gates in configured order,
 * stops at first failure (for always-run and ask-me tiers).
 * Integrates with audit trail for every execution.
 */

import { randomUUID } from 'node:crypto';
import { executeGate } from './timeout.js';
import type { GateExecutionResult } from './timeout.js';
import { AuditWriter } from '../audit/writer.js';
import type {
  QualityGate,
  TriggerPoint,
  UserTier,
  EnforcementTier,
  AuditEntry,
} from '../types.js';

// --- Interfaces ---

export interface GateRunConfig {
  trigger: TriggerPoint;
  gates: QualityGate[];
  userTier: UserTier;
  gateOverrides: Record<string, EnforcementTier>;
  enforcementActive: boolean;
  mandatoryGates: string[];
  sessionId: string;
  activeSkills: string[];
  taskId?: string;
  branchName?: string;
  auditDir?: string;
}

export interface GateRunResult {
  enforcementActive: boolean;
  trigger: TriggerPoint;
  gatesExecuted: GateExecutionResult[];
  overallResult: 'pass' | 'fail' | 'bypassed' | 'disabled';
  failedGate?: string;
  auditEntryIds: string[];
}

// --- T017: Tier resolution ---

export function resolveGateTier(
  gate: QualityGate,
  userTier: UserTier,
  overrides: Record<string, EnforcementTier>,
  mandatoryGates: string[],
): EnforcementTier {
  if (mandatoryGates.includes(gate.id)) {
    return 'always-run';
  }

  if (overrides[gate.id]) {
    return overrides[gate.id];
  }

  switch (userTier) {
    case 'tier-1': // junior — always enforce
      return 'always-run';
    case 'tier-3': // non-technical — always enforce
      return 'always-run';
    case 'tier-2': // power user — use gate default
      return gate.defaultTier;
  }
}

// --- T015 + T018: Gate runner with audit ---

export async function runGates(config: GateRunConfig): Promise<GateRunResult> {
  const result: GateRunResult = {
    enforcementActive: config.enforcementActive,
    trigger: config.trigger,
    gatesExecuted: [],
    overallResult: 'pass',
    auditEntryIds: [],
  };

  if (!config.enforcementActive) {
    result.overallResult = 'disabled';
    return result;
  }

  // Filter gates for the specified trigger point, sort by order
  const applicableGates = config.gates
    .filter((g) => g.triggerPoints.includes(config.trigger))
    .sort((a, b) => a.order - b.order);

  if (applicableGates.length === 0) {
    return result;
  }

  const writer = config.auditDir ? new AuditWriter(config.auditDir) : null;

  for (const gate of applicableGates) {
    const tier = resolveGateTier(gate, config.userTier, config.gateOverrides, config.mandatoryGates);

    // Skip tier: don't execute, log as skipped
    if (tier === 'skip') {
      const skipResult: GateExecutionResult = {
        gateId: gate.id,
        name: gate.name,
        type: gate.type,
        result: 'skip',
        duration: 0,
        output: '',
        enforcementTier: tier,
      };
      result.gatesExecuted.push(skipResult);

      if (writer) {
        const entryId = writeAuditEntry(writer, skipResult, config);
        result.auditEntryIds.push(entryId);
      }
      continue;
    }

    const execResult = await executeGate(gate, tier);
    result.gatesExecuted.push(execResult);

    if (writer) {
      const entryId = writeAuditEntry(writer, execResult, config);
      result.auditEntryIds.push(entryId);
    }

    // Fail-fast: stop at first failure for always-run and ask-me tiers
    if (execResult.result === 'fail' || execResult.result === 'timeout') {
      if (tier === 'always-run' || tier === 'ask-me') {
        result.overallResult = 'fail';
        result.failedGate = gate.id;
        break;
      }
      // For other unexpected tiers, treat as continue
    }
  }

  return result;
}

// --- Audit entry helper ---

function writeAuditEntry(
  writer: AuditWriter,
  execResult: GateExecutionResult,
  config: GateRunConfig,
): string {
  const id = randomUUID();
  const entry: AuditEntry = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: config.sessionId,
    actionType: 'gate-execution',
    result: execResult.result,
    userTier: config.userTier,
    activeSkills: config.activeSkills,
    gateId: execResult.gateId,
    taskId: config.taskId,
    branchName: config.branchName,
    details: {
      command: config.gates.find((g) => g.id === execResult.gateId)?.command,
      output: execResult.output,
      duration: execResult.duration,
      enforcementTier: execResult.enforcementTier,
    },
  };
  writer.write(entry);
  return id;
}
