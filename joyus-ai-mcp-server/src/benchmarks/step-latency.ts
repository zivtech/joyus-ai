/**
 * Step Latency Benchmark — Feature 010 Performance Comparison (WP05)
 *
 * Measures p50/p95/p99 step execution latency for:
 *   A) Custom executor (StepRunner from spec 009)
 *   B) Inngest adapter (InngestStepHandlerAdapter from spec 010)
 *
 * Run with:
 *   npx tsx src/benchmarks/step-latency.ts
 *
 * Both benchmarks use in-process mocks (no real DB, no real Inngest server)
 * to isolate infrastructure-layer overhead from actual handler work.
 * See research/performance-comparison.md for methodology and interpretation.
 */

import { StepRunner } from '../pipelines/engine/step-runner.js';
import { createInngestAdapter } from '../inngest/adapter.js';
import type {
  PipelineStepHandler,
  StepHandlerRegistry,
  ExecutionContext,
} from '../pipelines/engine/step-runner.js';
import type { StepResult } from '../pipelines/types.js';
import type { PipelineStep } from '../pipelines/schema.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { InngestStep } from '../inngest/adapter.js';

// ============================================================
// BENCHMARK CONFIGURATION
// ============================================================

const ITERATIONS = 50;
const WARMUP_ITERATIONS = 5;

// ============================================================
// MOCK INFRASTRUCTURE
// ============================================================

/**
 * Minimal in-memory DB mock that satisfies the Drizzle ORM call patterns
 * used by StepRunner and idempotency.checkIdempotency().
 * All queries resolve immediately (no I/O) to measure pure overhead.
 */
function makeMockDb(): NodePgDatabase {
  const noOp = (): unknown => noOp;
  const terminal = () => Promise.resolve([]);
  // Build a proxy that handles any Drizzle builder chain ending in a promise
  const chainProxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return undefined; // Not a promise itself
        }
        if (typeof prop === 'symbol') return undefined;
        // Terminal methods that return a promise
        if (['where', 'values', 'returning'].includes(prop as string)) {
          return () => Promise.resolve([]);
        }
        // Builder methods — return the proxy for chaining
        return () => chainProxy;
      },
    },
  );
  return chainProxy as NodePgDatabase;
}

/**
 * No-op handler that returns success immediately.
 * Simulates a fast handler with negligible business logic time.
 */
const noOpHandler: PipelineStepHandler = {
  stepType: 'profile_generation',
  execute: async (_config, _context): Promise<StepResult> => ({
    success: true,
    outputData: { benchmarkRun: true },
  }),
};

/**
 * Mock StepHandlerRegistry that always returns the no-op handler.
 */
const mockRegistry: StepHandlerRegistry = {
  getHandler: () => noOpHandler,
};

/**
 * Minimal PipelineStep fixture matching the Drizzle-inferred type.
 */
const mockPipelineStep = {
  id: 'step-bench-001',
  pipelineId: 'pipeline-bench-001',
  stepType: 'profile_generation' as const,
  position: 0,
  config: { type: 'profile_generation' },
  retryPolicyOverride: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as PipelineStep;

/**
 * Execution context fixture.
 */
function makeContext(i: number): ExecutionContext {
  return {
    tenantId: 'bench-tenant',
    executionId: `exec-bench-${i}`,
    pipelineId: 'pipeline-bench-001',
    triggerPayload: { iteration: i },
    previousStepOutputs: new Map(),
  };
}

/**
 * Mock Inngest step — mirrors test harness in adapter.test.ts.
 * step.run() calls the function directly (no HTTP round-trip).
 */
const mockInngestStep: InngestStep = {
  run: (_name: string, fn: () => Promise<unknown>) => fn(),
};

// ============================================================
// PERCENTILE CALCULATION
// ============================================================

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function stats(samples: number[]): { p50: number; p95: number; p99: number; min: number; max: number; mean: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: Math.round(mean * 100) / 100,
  };
}

// ============================================================
// BENCHMARK RUNNERS
// ============================================================

/**
 * T021: Benchmark custom executor StepRunner.
 * Measures: step routing + idempotency check + DB write ops (all mocked, 0 I/O).
 */
async function benchmarkCustomExecutor(): Promise<{
  coldStart: number;
  warmSamples: number[];
}> {
  const db = makeMockDb();
  const runner = new StepRunner(db, mockRegistry);

  // Cold-start: first execution (pre-JIT, no warmup)
  const coldStart0 = performance.now();
  await runner.runStep('exec-step-cold', mockPipelineStep, makeContext(0));
  const coldStart = performance.now() - coldStart0;

  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await runner.runStep(`exec-step-warmup-${i}`, mockPipelineStep, makeContext(i));
  }

  // T021: 50 sequential executions
  const warmSamples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await runner.runStep(`exec-step-${i}`, mockPipelineStep, makeContext(i));
    warmSamples.push(performance.now() - t0);
  }

  return { coldStart, warmSamples };
}

/**
 * T022: Benchmark Inngest adapter.
 * Measures: adapter.run() overhead (step.run wrapping + handler.execute call).
 * In this mock, step.run() calls fn() directly — no HTTP round-trip.
 */
async function benchmarkInngestAdapter(): Promise<{
  coldStart: number;
  warmSamples: number[];
}> {
  const adapter = createInngestAdapter(noOpHandler);

  // Cold-start: first execution
  const coldStart0 = performance.now();
  await adapter.run(mockInngestStep, 'profile-generation', { type: 'profile_generation' }, makeContext(0));
  const coldStart = performance.now() - coldStart0;

  // Warmup
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await adapter.run(mockInngestStep, 'profile-generation', { type: 'profile_generation' }, makeContext(i));
  }

  // T022: 50 sequential executions
  const warmSamples: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await adapter.run(mockInngestStep, 'profile-generation', { type: 'profile_generation' }, makeContext(i));
    warmSamples.push(performance.now() - t0);
  }

  return { coldStart, warmSamples };
}

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Feature 010 — Step Latency Benchmark');
  console.log(`Iterations: ${ITERATIONS} (+ ${WARMUP_ITERATIONS} warmup)`);
  console.log('Mock mode: no real DB or Inngest server');
  console.log('='.repeat(60));
  console.log();

  // ── Custom Executor ──────────────────────────────────────
  console.log('Running custom executor benchmark (T021)...');
  const customResult = await benchmarkCustomExecutor();
  const customStats = stats(customResult.warmSamples);

  console.log('\n[Custom Executor — StepRunner]');
  console.log(`  Cold-start (first exec):  ${customResult.coldStart.toFixed(3)} ms`);
  console.log(`  Warm runs (${ITERATIONS} iters):`);
  console.log(`    min:  ${customStats.min.toFixed(3)} ms`);
  console.log(`    mean: ${customStats.mean} ms`);
  console.log(`    p50:  ${customStats.p50.toFixed(3)} ms`);
  console.log(`    p95:  ${customStats.p95.toFixed(3)} ms`);
  console.log(`    p99:  ${customStats.p99.toFixed(3)} ms`);
  console.log(`    max:  ${customStats.max.toFixed(3)} ms`);

  // ── Inngest Adapter ──────────────────────────────────────
  console.log('\nRunning Inngest adapter benchmark (T022)...');
  const inngestResult = await benchmarkInngestAdapter();
  const inngestStats = stats(inngestResult.warmSamples);

  console.log('\n[Inngest Adapter — createInngestAdapter]');
  console.log(`  Cold-start (first exec):  ${inngestResult.coldStart.toFixed(3)} ms`);
  console.log(`  Warm runs (${ITERATIONS} iters):`);
  console.log(`    min:  ${inngestStats.min.toFixed(3)} ms`);
  console.log(`    mean: ${inngestStats.mean} ms`);
  console.log(`    p50:  ${inngestStats.p50.toFixed(3)} ms`);
  console.log(`    p95:  ${inngestStats.p95.toFixed(3)} ms`);
  console.log(`    p99:  ${inngestStats.p99.toFixed(3)} ms`);
  console.log(`    max:  ${inngestStats.max.toFixed(3)} ms`);

  // ── Comparison ───────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON (mock layer only — excludes real I/O)');
  console.log('='.repeat(60));
  const coldRatio = (customResult.coldStart / inngestResult.coldStart).toFixed(1);
  const p50Ratio = (customStats.p50 / inngestStats.p50).toFixed(1);
  console.log(`  Cold-start ratio (custom/inngest): ${coldRatio}x`);
  console.log(`  p50 overhead ratio (custom/inngest): ${p50Ratio}x`);
  console.log();
  console.log('NOTE: Real-world production overhead differs significantly:');
  console.log('  Custom executor:  +2-8ms per step (PostgreSQL round-trips)');
  console.log('  Inngest (local):  +5-20ms per step (HTTP callback round-trip)');
  console.log('  Inngest (cloud):  +100-500ms per step (network latency)');
  console.log();
  console.log('See research/performance-comparison.md for full analysis.');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
