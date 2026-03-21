/**
 * Unit tests for profiles/generation/engine-bridge.ts
 *
 * Mocks child_process.execFile to avoid spawning real processes.
 * EngineBridge wraps execFile with a callback internally so mocks receive
 * the standard Node.js callback signature: (err, stdout, stderr).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock child_process ─────────────────────────────────────────────────────
// Must be hoisted before the import of engine-bridge (vi.mock is hoisted).

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Import AFTER the mock is in place
import { execFile } from 'child_process';
import {
  EngineBridge,
  EngineTimeoutError,
  EngineExecutionError,
  EngineOutputError,
} from '../../../src/profiles/generation/engine-bridge.js';

const mockExecFile = vi.mocked(execFile);

// ── Mock helpers ───────────────────────────────────────────────────────────

/** Valid engine JSON output for the given authorId. */
function validEngineOutput(authorId: string, version = '1.0.0'): string {
  return JSON.stringify({
    authorId,
    stylometricFeatures: { avg_sentence_length: 0.42, type_token_ratio: 0.78 },
    markers: [{ name: 'formal register', threshold: 0.6, frequency: 0.7, context: 'example' }],
    fidelityScore: 0.91,
    engineVersion: version,
  });
}

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void;

/** Make execFile call the callback with success (stdout). */
function mockSuccess(stdout: string): void {
  mockExecFile.mockImplementation(
    (_file: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as ExecFileCallback)(null, stdout, '');
      return undefined as never;
    },
  );
}

/** Make execFile call the callback with a non-zero exit error. */
function mockFailure(exitCode: number, stderr: string): void {
  mockExecFile.mockImplementation(
    (_file: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error('Command failed'), {
        code: exitCode,
        stderr,
      });
      (cb as ExecFileCallback)(err, '', stderr);
      return undefined as never;
    },
  );
}

/** Make execFile call the callback with a timeout/kill error. */
function mockTimeout(): void {
  mockExecFile.mockImplementation(
    (_file: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error('Process killed (ETIMEDOUT)'), {
        code: 'ETIMEDOUT',
      });
      (cb as ExecFileCallback)(err, '', '');
      return undefined as never;
    },
  );
}

// ── Fixture ────────────────────────────────────────────────────────────────

function makeBridge(): EngineBridge {
  return new EngineBridge({ engineScriptPath: '/opt/engine/run.py' });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EngineBridge.generateProfile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns parsed EngineResult on successful engine output', async () => {
    mockSuccess(validEngineOutput('author-001'));
    const bridge = makeBridge();
    const result = await bridge.generateProfile('/corpus', 'author-001');

    expect(result.authorId).toBe('author-001');
    expect(result.engineVersion).toBe('1.0.0');
    expect(result.fidelityScore).toBe(0.91);
    expect(result.stylometricFeatures['avg_sentence_length']).toBe(0.42);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws EngineOutputError when stdout is empty', async () => {
    mockSuccess('');
    const bridge = makeBridge();
    await expect(bridge.generateProfile('/corpus', 'author-001')).rejects.toThrow(
      EngineOutputError,
    );
  });

  it('throws EngineOutputError when stdout is not valid JSON', async () => {
    mockSuccess('not json {{{');
    const bridge = makeBridge();
    await expect(bridge.generateProfile('/corpus', 'author-001')).rejects.toThrow(
      EngineOutputError,
    );
  });

  it('throws EngineOutputError when JSON lacks required fields', async () => {
    mockSuccess(JSON.stringify({ someOtherField: true }));
    const bridge = makeBridge();
    await expect(bridge.generateProfile('/corpus', 'author-001')).rejects.toThrow(
      EngineOutputError,
    );
  });

  it('throws EngineExecutionError on non-zero exit', async () => {
    mockFailure(1, 'ImportError: no module named joyus_profile');
    const bridge = makeBridge();
    await expect(bridge.generateProfile('/corpus', 'author-001')).rejects.toThrow(
      EngineExecutionError,
    );
  });

  it('throws EngineTimeoutError when process times out', async () => {
    mockTimeout();
    const bridge = makeBridge();
    await expect(bridge.generateProfile('/corpus', 'author-001')).rejects.toThrow(
      EngineTimeoutError,
    );
  });

  it('fidelityScore is null when engine omits it', async () => {
    const output = JSON.stringify({
      authorId: 'author-002',
      stylometricFeatures: {},
      markers: [],
      engineVersion: '1.0.0',
    });
    mockSuccess(output);
    const bridge = makeBridge();
    const result = await bridge.generateProfile('/corpus', 'author-002');
    expect(result.fidelityScore).toBeNull();
  });
});

describe('EngineBridge.generateBatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns results for all successful authors', async () => {
    // Each call returns the authorId passed as the 5th arg (index 4)
    mockExecFile.mockImplementation(
      (_file: unknown, args: unknown, _opts: unknown, cb: unknown) => {
        const authorId = (args as string[])[4] ?? 'author-unknown';
        (cb as ExecFileCallback)(null, validEngineOutput(authorId), '');
        return undefined as never;
      },
    );

    const bridge = makeBridge();
    const batch = await bridge.generateBatch('/corpus', ['author-001', 'author-002']);

    expect(batch.results).toHaveLength(2);
    expect(batch.failedAuthorIds).toHaveLength(0);
  });

  it('captures failed authors without aborting the batch', async () => {
    let calls = 0;
    mockExecFile.mockImplementation(
      (_file: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        calls++;
        if (calls === 1) {
          (cb as ExecFileCallback)(null, validEngineOutput('author-001'), '');
        } else {
          const err = Object.assign(new Error('fail'), { code: 1, stderr: 'error' });
          (cb as ExecFileCallback)(err, '', 'error');
        }
        return undefined as never;
      },
    );

    const bridge = makeBridge();
    const batch = await bridge.generateBatch('/corpus', ['author-001', 'author-002']);

    expect(batch.results).toHaveLength(1);
    expect(batch.failedAuthorIds).toContain('author-002');
  });
});

describe('EngineBridge.healthCheck', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns true when engine responds successfully', async () => {
    mockSuccess('OK');
    const bridge = makeBridge();
    expect(await bridge.healthCheck()).toBe(true);
  });

  it('returns false when engine errors', async () => {
    mockFailure(127, 'not found');
    const bridge = makeBridge();
    expect(await bridge.healthCheck()).toBe(false);
  });
});
