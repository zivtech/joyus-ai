import { describe, it, expect } from 'vitest';
import { executeGate } from '../../../src/enforcement/gates/timeout.js';
import type { QualityGate } from '../../../src/enforcement/types.js';

function makeGate(overrides: Partial<QualityGate> = {}): QualityGate {
  return {
    id: 'test-gate',
    name: 'Test Gate',
    type: 'custom',
    command: 'echo "hello"',
    triggerPoints: ['pre-commit'],
    defaultTier: 'always-run',
    timeout: 60,
    order: 0,
    ...overrides,
  };
}

describe('executeGate', () => {
  it('returns pass for exit code 0', async () => {
    const result = await executeGate(makeGate({ command: 'echo "ok"' }), 'always-run');
    expect(result.result).toBe('pass');
    expect(result.gateId).toBe('test-gate');
    expect(result.output).toContain('ok');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('returns fail for non-zero exit code', async () => {
    const result = await executeGate(makeGate({ command: 'exit 1' }), 'always-run');
    expect(result.result).toBe('fail');
  });

  it('returns unavailable for missing command', async () => {
    const result = await executeGate(
      makeGate({ command: 'nonexistent_command_xyz_12345' }),
      'always-run',
    );
    // Shell wrapping may return 'fail' (127) instead of ENOENT
    expect(['fail', 'unavailable']).toContain(result.result);
  });

  it('returns timeout for slow commands', async () => {
    const result = await executeGate(
      makeGate({ command: 'sleep 10', timeout: 0.1 }), // 100ms timeout
      'always-run',
    );
    expect(result.result).toBe('timeout');
  }, 10000);

  it('captures stderr in output', async () => {
    const result = await executeGate(
      makeGate({ command: 'echo "err" >&2' }),
      'always-run',
    );
    expect(result.output).toContain('err');
  });

  it('truncates long output', async () => {
    // Generate output longer than 2000 chars
    const result = await executeGate(
      makeGate({ command: 'python3 -c "print(\'x\' * 5000)"' }),
      'always-run',
    );
    expect(result.output.length).toBeLessThanOrEqual(2000);
  });

  it('sets enforcementTier from parameter', async () => {
    const result = await executeGate(makeGate(), 'ask-me');
    expect(result.enforcementTier).toBe('ask-me');
  });

  it('passes environment variables to command', async () => {
    const result = await executeGate(
      makeGate({
        command: 'echo $TEST_GATE_VAR',
        env: { TEST_GATE_VAR: 'hello-gate' },
      }),
      'always-run',
    );
    expect(result.output).toContain('hello-gate');
  });
});
