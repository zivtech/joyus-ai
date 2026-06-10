/**
 * Profile Generation — Engine Bridge
 *
 * Subprocess bridge to the configured profile engine CLI.
 * Invokes the engine via execFile (not exec) to avoid shell injection,
 * parses JSON from stdout, and surfaces structured errors.
 */

import { execFile } from 'child_process';

/**
 * Promisify execFile lazily at call time so that test mocks on
 * `child_process.execFile` are always picked up. Module-level
 * `promisify(execFile)` would capture the original before vi.mock replaces it.
 */
function execFileAsync(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv | undefined },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) {
        reject(Object.assign(err, { stderr: stderr ?? '' }));
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      }
    });
  });
}

// ============================================================
// CONFIG & RESULT TYPES
// ============================================================

export interface EngineBridgeConfig {
  /** Executable profile engine command, e.g. "joyus-profile". */
  engineCommand: string;
  /** Fixed arguments before per-request generation flags, e.g. ["generate"]. */
  engineArgs: string[];
  /** Arguments for the health-check command, e.g. ["health-check"]. */
  healthCheckArgs: string[];
  /** Maximum milliseconds to wait for the engine. Defaults to 360000 (6 min). */
  timeoutMs: number;
  /** Maximum stdout/stderr buffer in bytes. Defaults to 50 MB. */
  maxBuffer: number;
}

export interface EngineResult {
  authorId: string;
  stylometricFeatures: Record<string, number>;
  markers: unknown;
  fidelityScore: number | null;
  engineVersion: string;
  durationMs: number;
}

export interface EngineBatchResult {
  results: EngineResult[];
  failedAuthorIds: string[];
}

export interface EngineOptions {
  /** Override the default engine version to use. */
  engineVersion?: string;
}

// ============================================================
// CUSTOM ERRORS
// ============================================================

export class EngineTimeoutError extends Error {
  constructor(authorId: string, timeoutMs: number) {
    super(`Engine timed out after ${timeoutMs}ms for author "${authorId}"`);
    this.name = 'EngineTimeoutError';
  }
}

export class EngineExecutionError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(authorId: string, exitCode: number | null, stderr: string) {
    super(`Engine execution failed for author "${authorId}" (exit ${exitCode ?? 'unknown'})`);
    this.name = 'EngineExecutionError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class EngineOutputError extends Error {
  readonly raw: string;

  constructor(authorId: string, raw: string, cause?: unknown) {
    super(
      `Engine produced unparseable output for author "${authorId}": ${raw.slice(0, 200)}`,
    );
    this.name = 'EngineOutputError';
    this.raw = raw;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}

export class EngineNotConfiguredError extends Error {
  constructor() {
    super(
      'Profile engine is not configured. Set PROFILE_ENGINE_COMMAND to the profile engine executable.',
    );
    this.name = 'EngineNotConfiguredError';
  }
}

// ============================================================
// ENGINE BRIDGE
// ============================================================

const DEFAULT_CONFIG: EngineBridgeConfig = {
  engineCommand: '',
  engineArgs: ['generate'],
  healthCheckArgs: ['health-check'],
  timeoutMs: 360_000,
  maxBuffer: 50 * 1024 * 1024,
};

export class EngineBridge {
  private readonly config: EngineBridgeConfig;

  constructor(config: Partial<EngineBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ----------------------------------------------------------
  // PUBLIC API
  // ----------------------------------------------------------

  isConfigured(): boolean {
    return this.config.engineCommand.trim().length > 0;
  }

  /**
   * Invoke the configured profile engine for a single author.
   * Returns a structured EngineResult parsed from engine JSON stdout.
   */
  async generateProfile(
    corpusPath: string,
    authorId: string,
    options?: EngineOptions,
  ): Promise<EngineResult> {
    if (!this.isConfigured()) {
      throw new EngineNotConfiguredError();
    }

    const args = this.buildArgs(corpusPath, authorId, options);
    const startMs = Date.now();

    let stdout: string;
    try {
      const result = await execFileAsync(this.config.engineCommand, args, {
        timeout: this.config.timeoutMs,
        maxBuffer: this.config.maxBuffer,
        env: process.env,
      });
      stdout = result.stdout;
    } catch (err) {
      if (this.isTimeoutError(err)) {
        throw new EngineTimeoutError(authorId, this.config.timeoutMs);
      }
      const execErr = err as NodeJS.ErrnoException & { code?: number | string; stderr?: string };
      throw new EngineExecutionError(
        authorId,
        typeof execErr.code === 'number' ? execErr.code : null,
        execErr.stderr ?? String(err),
      );
    }

    return this.parseOutput(authorId, stdout, Date.now() - startMs);
  }

  /**
   * Generate profiles for multiple authors serially.
   * Failed authors are captured in `failedAuthorIds` rather than aborting the batch.
   */
  async generateBatch(
    corpusPath: string,
    authorIds: string[],
  ): Promise<EngineBatchResult> {
    const results: EngineResult[] = [];
    const failedAuthorIds: string[] = [];

    for (const authorId of authorIds) {
      try {
        const result = await this.generateProfile(corpusPath, authorId);
        results.push(result);
      } catch {
        failedAuthorIds.push(authorId);
      }
    }

    return { results, failedAuthorIds };
  }

  /**
   * Verify the configured profile engine is reachable.
   * Returns true on success, false if the engine is unreachable.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      await execFileAsync(
        this.config.engineCommand,
        this.config.healthCheckArgs,
        { timeout: 10_000, maxBuffer: 1024 * 1024, env: process.env },
      );
      return true;
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  // PRIVATE HELPERS
  // ----------------------------------------------------------

  private buildArgs(
    corpusPath: string,
    authorId: string,
    options?: EngineOptions,
  ): string[] {
    const args = [
      ...this.config.engineArgs,
      '--corpus-path', corpusPath,
      '--author-id', authorId,
      '--output-format', 'json',
    ];

    if (options?.engineVersion) {
      args.push('--engine-version', options.engineVersion);
    }

    return args;
  }

  private parseOutput(authorId: string, stdout: string, durationMs: number): EngineResult {
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new EngineOutputError(authorId, stdout);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new EngineOutputError(authorId, trimmed, err);
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('authorId' in parsed) ||
      !('stylometricFeatures' in parsed) ||
      !('markers' in parsed) ||
      !('fidelityScore' in parsed) ||
      !('engineVersion' in parsed)
    ) {
      throw new EngineOutputError(authorId, trimmed);
    }

    const raw = parsed as Record<string, unknown>;
    if (
      raw['authorId'] !== authorId ||
      !this.isNumberRecord(raw['stylometricFeatures']) ||
      !Array.isArray(raw['markers']) ||
      (
        raw['fidelityScore'] !== null &&
        typeof raw['fidelityScore'] !== 'number'
      ) ||
      typeof raw['engineVersion'] !== 'string'
    ) {
      throw new EngineOutputError(authorId, trimmed);
    }

    return {
      authorId: raw['authorId'],
      stylometricFeatures: raw['stylometricFeatures'],
      markers: raw['markers'],
      fidelityScore: raw['fidelityScore'],
      engineVersion: raw['engineVersion'],
      durationMs,
    };
  }

  private isTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
      // Node's child_process timeout surfaces as ETIMEDOUT or 'killed'
      const msg = err.message.toLowerCase();
      return msg.includes('etimedout') || msg.includes('timed out') || msg.includes('killed');
    }
    return false;
  }

  private isNumberRecord(value: unknown): value is Record<string, number> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every((entry) => typeof entry === 'number')
    );
  }
}
