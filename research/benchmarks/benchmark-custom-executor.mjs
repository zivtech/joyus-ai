/**
 * Benchmark: Custom Executor Adapter Pattern
 *
 * Measures the overhead of the InngestStepHandlerAdapter pattern:
 * wrapping an async handler call inside a step.run() checkpoint function.
 *
 * This is the baseline the Inngest pipeline adds overhead on top of.
 * Each "execution" simulates a realistic async step (small I/O: ~1-10ms).
 *
 * Run: node research/benchmarks/benchmark-custom-executor.mjs
 */

const N = 50;

// ---------------------------------------------------------------------------
// Mock step handler (mirrors PipelineStepHandler.execute)
// Simulates a lightweight async operation (e.g., DB read + write for a step).
// ---------------------------------------------------------------------------
async function mockHandlerExecute(_config, _context) {
  // Simulate realistic step work: 1–10ms async I/O (e.g., cache lookup + write)
  const delay = 1 + Math.random() * 9;
  await new Promise((resolve) => setTimeout(resolve, delay));
  return { success: true, outputData: { processed: true } };
}

// ---------------------------------------------------------------------------
// Mock InngestStep (mirrors the adapter's step.run() call)
// In production, step.run() adds Redis checkpoint overhead.
// Here it's a direct call — measures adapter pattern overhead only.
// ---------------------------------------------------------------------------
const mockStep = {
  async run(name, fn) {
    return fn();
  },
};

// ---------------------------------------------------------------------------
// Adapter function (mirrors createInngestAdapter logic)
// ---------------------------------------------------------------------------
async function adapterRun(step, stepName, config, context) {
  return step.run(stepName, () => mockHandlerExecute(config, context));
}

// ---------------------------------------------------------------------------
// Warm-up: 5 runs to stabilise JIT before recording
// ---------------------------------------------------------------------------
for (let i = 0; i < 5; i++) {
  await adapterRun(mockStep, 'warm-up', {}, { tenantId: 'warmup', executionId: `w${i}` });
}

// ---------------------------------------------------------------------------
// Benchmark: N sequential executions
// ---------------------------------------------------------------------------
const timings = [];
const coldStartStart = performance.now();

for (let i = 0; i < N; i++) {
  const start = performance.now();
  await adapterRun(
    mockStep,
    `profile-generation-${i}`,
    { type: 'profile_generation', profileIds: [`p${i}`] },
    { tenantId: 'tenant-bench', executionId: `exec-${i}`, pipelineId: 'pipeline-bench' },
  );
  timings.push(performance.now() - start);
}

const totalMs = performance.now() - coldStartStart;

// ---------------------------------------------------------------------------
// Compute percentiles
// ---------------------------------------------------------------------------
const sorted = [...timings].sort((a, b) => a - b);
const p50 = sorted[Math.floor(N * 0.50)];
const p95 = sorted[Math.floor(N * 0.95)];
const p99 = sorted[Math.floor(N * 0.99)];
const min = sorted[0];
const max = sorted[N - 1];
const avg = timings.reduce((s, v) => s + v, 0) / N;

// Cold start = first execution latency (before warm-up effect stabilises further)
// We re-measure by recording timing[0] from fresh state, but our warm-up already
// captured that. Report the first recorded timing as indicative cold-path cost.
const firstRun = timings[0];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
console.log(`\nCustom Executor Benchmark (${N} sequential executions)`);
console.log('='.repeat(50));
console.log(`  min:        ${min.toFixed(2)}ms`);
console.log(`  avg:        ${avg.toFixed(2)}ms`);
console.log(`  p50:        ${p50.toFixed(2)}ms`);
console.log(`  p95:        ${p95.toFixed(2)}ms`);
console.log(`  p99:        ${p99.toFixed(2)}ms`);
console.log(`  max:        ${max.toFixed(2)}ms`);
console.log(`  first run:  ${firstRun.toFixed(2)}ms  (post-JIT warm-up, pre-steady-state)`);
console.log(`  total:      ${totalMs.toFixed(0)}ms for ${N} runs`);
console.log('');
console.log('Adapter pattern overhead (step.run wrapper):');
console.log('  Direct async call — no Redis, no HTTP, no checkpoint.');
console.log('  All latency above is mock handler work (1-10ms simulated I/O).');
console.log('  Inngest step.run() adds: Redis poll (~5-100ms) + state write on top.');
