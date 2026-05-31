/**
 * WP01 evaluation spike orchestrator.
 *
 * Real measurement math + honest decision logic. The Headroom and accuracy boundaries
 * are stubs that THROW until wired (lib/headroom-client.ts, lib/accuracy.ts), so this
 * never emits a fabricated go/no-go. Run order:
 *   load corpus → per-payload compress+measure (both modes) → reversibility →
 *   isolation probe → accuracy A/B → aggregate → decide → write + validate report.
 *
 * Usage: npx tsx run-spike.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compress,
  retrieve,
  DeployMode,
  PayloadKind,
  HEADROOM_VERSION,
} from './lib/headroom-client';
import { runSuite, accuracyDelta, Task } from './lib/accuracy';
import { countTokens, savingsRatio, mean, stdDev, p95 } from './lib/tokens';

const HERE = dirname(fileURLToPath(import.meta.url));
const KINDS: PayloadKind[] = ['content_mcp', 'rag_chunk', 'executor_output'];
const MODES: DeployMode[] = ['library', 'proxy'];

// Gate thresholds (from spec.md). Keep in sync with the schema + WP01.
const SAVINGS_BAR = 0.5; // NFR-002
const LATENCY_BUDGET_MS = 150; // NFR-003

interface PerKind {
  savingsMean: number;
  savingsStdDev: number;
  accuracyDelta: number;
  sampleSize: number;
}

interface SpikeReport {
  headroomVersion: string;
  perType: Partial<Record<PayloadKind, PerKind>>;
  reversibilityRate: number;
  tenantIsolationFit: 'supported' | 'unsupported';
  addedLatencyP95Ms: number;
  recommendedMode: DeployMode;
  decision: 'go' | 'no_go';
  primaryTarget?: PayloadKind;
  rationale: string;
}

function loadCorpus(kind: PayloadKind): { id: string; content: string }[] {
  const dir = join(HERE, 'corpus', kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      // payload content is the serialized "content" field; fall back to whole file
      const content =
        typeof raw.content === 'string' ? raw.content : JSON.stringify(raw);
      return { id: raw.id ?? f, content };
    });
}

function loadTasks(kind: PayloadKind): Task[] {
  const file = join(HERE, 'task-suite', `${kind}.json`);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).tasks ?? [];
}

async function measureKind(
  kind: PayloadKind,
  mode: DeployMode,
): Promise<{ savings: number[]; latencies: number[]; reversibleHits: number; total: number }> {
  const corpus = loadCorpus(kind);
  const savings: number[] = [];
  const latencies: number[] = [];
  let reversibleHits = 0;

  for (const payload of corpus) {
    const originalTokens = countTokens(payload.content);
    const t0 = performance.now();
    const result = await compress({
      tenantId: 'tenant-alpha',
      kind,
      content: payload.content,
      mode,
    });
    latencies.push(performance.now() - t0);
    savings.push(savingsRatio(originalTokens, countTokens(result.compressed)));

    const restored = await retrieve('tenant-alpha', result.originalRef);
    if (restored === payload.content) reversibleHits += 1; // byte-identical (NFR-004)
  }
  return { savings, latencies, reversibleHits, total: corpus.length };
}

/** Seed byte-identical content under two tenants; confirm no cross-tenant retrieval. */
async function isolationProbe(): Promise<'supported' | 'unsupported'> {
  const content = 'IDENTICAL-CONTENT-FOR-ISOLATION-PROBE';
  const a = await compress({ tenantId: 'tenant-alpha', kind: 'content_mcp', content, mode: 'library' });
  const b = await compress({ tenantId: 'tenant-beta', kind: 'content_mcp', content, mode: 'library' });
  if (a.originalRef === b.originalRef) return 'unsupported'; // shared ref = dedup crossed tenants
  try {
    // beta must NOT be able to resolve alpha's ref
    const leaked = await retrieve('tenant-beta', a.originalRef);
    return leaked === content ? 'unsupported' : 'supported';
  } catch {
    return 'supported'; // refusal is correct isolation
  }
}

function decide(report: Omit<SpikeReport, 'decision' | 'primaryTarget' | 'rationale'>): SpikeReport {
  // go iff some kind clears savings + zero accuracy degradation + perfect reversibility,
  // and isolation is supported.
  const candidates = (Object.entries(report.perType) as [PayloadKind, PerKind][])
    .filter(
      ([, m]) =>
        m.savingsMean >= SAVINGS_BAR &&
        m.accuracyDelta === 0 &&
        report.reversibilityRate === 1.0 &&
        report.tenantIsolationFit === 'supported',
    )
    .sort((a, b) => b[1].savingsMean - a[1].savingsMean);

  if (candidates.length === 0) {
    return {
      ...report,
      decision: 'no_go',
      rationale:
        'No payload kind cleared all gates (savings ≥ 0.50, accuracyDelta = 0, ' +
        'reversibility = 1.0, isolation supported). Mission stops cheaply, by design.',
    };
  }
  const [primaryTarget, m] = candidates[0];
  return {
    ...report,
    decision: 'go',
    primaryTarget,
    rationale:
      `${primaryTarget} cleared all gates (savingsMean=${m.savingsMean.toFixed(3)}, ` +
      `accuracyDelta=0, reversibility=1.0, isolation supported). Recommend ` +
      `${report.recommendedMode} mode at p95 latency ${report.addedLatencyP95Ms.toFixed(1)}ms.`,
  };
}

async function main(): Promise<void> {
  const perType: Partial<Record<PayloadKind, PerKind>> = {};
  const allLatencies: number[] = [];
  let reversibleHits = 0;
  let reversibleTotal = 0;

  // Pick the mode with better savings as recommendedMode (real comparison once wired).
  const modeSavings: Record<DeployMode, number[]> = { library: [], proxy: [] };

  for (const kind of KINDS) {
    // Measure both modes; use library for the per-kind accuracy + reversibility numbers.
    for (const mode of MODES) {
      const r = await measureKind(kind, mode);
      modeSavings[mode].push(...r.savings);
      if (mode === 'library') {
        allLatencies.push(...r.latencies);
        reversibleHits += r.reversibleHits;
        reversibleTotal += r.total;
        const suite = await runSuite(kind, loadTasks(kind));
        perType[kind] = {
          savingsMean: mean(r.savings),
          savingsStdDev: stdDev(r.savings),
          accuracyDelta: accuracyDelta(suite),
          sampleSize: r.total,
        };
      }
    }
  }

  const recommendedMode: DeployMode =
    mean(modeSavings.library) >= mean(modeSavings.proxy) ? 'library' : 'proxy';

  const base = {
    headroomVersion: HEADROOM_VERSION,
    perType,
    reversibilityRate: reversibleTotal === 0 ? 0 : reversibleHits / reversibleTotal,
    tenantIsolationFit: await isolationProbe(),
    addedLatencyP95Ms: p95(allLatencies),
    recommendedMode,
  };
  void LATENCY_BUDGET_MS; // reported, not gated here; surfaced in the markdown report

  const report = decide(base);

  writeFileSync(join(HERE, 'spike-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(HERE, 'spike-report.md'), renderMarkdown(report));
  console.log(`Decision: ${report.decision}. Wrote spike-report.json + spike-report.md`);
}

function renderMarkdown(r: SpikeReport): string {
  const rows = (Object.entries(r.perType) as [PayloadKind, PerKind][])
    .map(
      ([k, m]) =>
        `| ${k} | ${(m.savingsMean * 100).toFixed(1)}% | ${m.savingsStdDev.toFixed(3)} | ${m.accuracyDelta} | ${m.sampleSize} |`,
    )
    .join('\n');
  return `# WP01 Spike Report

**Headroom version:** ${r.headroomVersion}
**Decision:** ${r.decision.toUpperCase()}${r.primaryTarget ? ` (primary target: ${r.primaryTarget})` : ''}
**Recommended mode:** ${r.recommendedMode}
**Reversibility rate:** ${r.reversibilityRate}
**Tenant isolation:** ${r.tenantIsolationFit}
**Added p95 latency:** ${r.addedLatencyP95Ms.toFixed(1)} ms (budget ${LATENCY_BUDGET_MS} ms)

| kind | savings mean | savings sd | accuracyDelta | sampleSize |
|------|-------------|-----------|---------------|------------|
${rows}

**Rationale:** ${r.rationale}
`;
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
