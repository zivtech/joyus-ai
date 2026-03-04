/**
 * Gate execution with timeout — T016
 *
 * Executes a gate command as a child process with configurable timeout.
 * Uses AbortController for clean process termination.
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { QualityGate, AuditResult, GateType, EnforcementTier } from '../types.js';

export interface GateExecutionResult {
  gateId: string;
  name: string;
  type: GateType;
  result: AuditResult;
  duration: number;
  output: string;
  enforcementTier: EnforcementTier;
}

const MAX_OUTPUT_LENGTH = 2000;

export async function executeGate(
  gate: QualityGate,
  enforcementTier: EnforcementTier,
): Promise<GateExecutionResult> {
  const start = performance.now();
  const timeoutMs = (gate.timeout ?? 60) * 1000;

  const makeResult = (result: AuditResult, output: string): GateExecutionResult => ({
    gateId: gate.id,
    name: gate.name,
    type: gate.type,
    result,
    duration: Math.round(performance.now() - start),
    output: output.slice(0, MAX_OUTPUT_LENGTH),
    enforcementTier,
  });

  return new Promise<GateExecutionResult>((resolve) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    let stdout = '';
    let stderr = '';

    try {
      const child = spawn(gate.command, [], {
        shell: true,
        cwd: gate.workingDir,
        env: gate.env ? { ...process.env, ...gate.env } : process.env,
        signal: ac.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const combined = stdout + (stderr ? '\n' + stderr : '');
        resolve(makeResult(code === 0 ? 'pass' : 'fail', combined));
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ABORT_ERR' || ac.signal.aborted) {
          resolve(makeResult('timeout', stdout + '\n' + stderr + '\n[timed out]'));
        } else if (err.code === 'ENOENT') {
          resolve(makeResult('unavailable', `Command not found: ${gate.command}`));
        } else {
          resolve(makeResult('fail', err.message));
        }
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      if (ac.signal.aborted) {
        resolve(makeResult('timeout', message));
      } else {
        resolve(makeResult('fail', message));
      }
    }
  });
}
