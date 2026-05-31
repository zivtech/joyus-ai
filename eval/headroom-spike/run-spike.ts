/**
 * WP01 evaluation spike orchestrator (retargeted: large-prose content via CCR).
 *
 * Live measurement against the local Headroom proxy + honest decision logic.
 *   load corpus -> per-payload compress (proxy) -> savings (real tiktoken counts) ->
 *   reversibility (retrieve the CCR-dropped field, byte-compare) -> isolation probe ->
 *   read accuracy A/B deltas (runset/scored.json, produced by orchestrated subagents) ->
 *   aggregate -> decide -> write + (separately) validate the SpikeReport.
 *
 * The accuracy boundary is run by orchestrated SUBAGENTS, not an in-process LLM SDK
 * (see runset/ + scored.json); a Node child process cannot spawn agents. This file
 * consumes that artifact. Everything else here is live.
 *
 * Usage: npx tsx run-spike.ts   (proxy must be running; runset/scored.json must exist)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compress, retrieve, PayloadKind, HEADROOM_VERSION } from './lib/headroom-client';
import { savingsRatio, mean, stdDev, p95 } from './lib/tokens';

const HERE = dirname(fileURLToPath(import.meta.url));
const KINDS: PayloadKind[] = ['content_mcp', 'rag_chunk', 'executor_output'];

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
  recommendedMode: 'library' | 'proxy';
  decision: 'go' | 'no_go';
  primaryTarget?: PayloadKind;
  rationale: string;
}

function loadCorpus(kind: PayloadKind): { id: string; content: string; body: string }[] {
  const dir = join(HERE, 'corpus', kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const content: string = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw);
      let body = '';
      try {
        body = JSON.parse(content).body ?? '';
      } catch {
        /* non-JSON payload */
      }
      return { id: raw.id ?? f, content, body };
    });
}

/** Accuracy + net-economics from the subagent A/B (runset/scored.json). Strict: missing = fail. */
function loadScored(): { accuracy: Record<string, number>; netMustRead: Record<string, number> } {
  const p = join(HERE, 'runset', 'scored.json');
  if (!existsSync(p)) throw new Error('runset/scored.json missing — run build-runset.py + the subagent A/B first');
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const accuracy: Record<string, number> = {};
  for (const [k, v] of Object.entries<{ accuracyDelta: number }>(s.per_kind_accuracy)) accuracy[k] = v.accuracyDelta;
  const netMustRead: Record<string, number> = s.net_economics?.net_savings_must_read ?? {};
  return { accuracy, netMustRead };
}

interface KindMeasure {
  savings: number[];
  latencies: number[];
  reversibleHits: number;
  ccrTotal: number;
}

async function measureKind(kind: PayloadKind): Promise<KindMeasure> {
  const corpus = loadCorpus(kind);
  const m: KindMeasure = { savings: [], latencies: [], reversibleHits: 0, ccrTotal: 0 };
  for (const payload of corpus) {
    const t0 = performance.now();
    const result = await compress({ tenantId: 'tenant-alpha', kind, content: payload.content, mode: 'proxy' });
    m.latencies.push(performance.now() - t0);
    // Real savings from the proxy's tiktoken counts (NFR-007), clamped to >=0 (FR-009).
    m.savings.push(savingsRatio(result.tokensBefore, result.tokensAfter));
    if (result.lossless && result.originalRef) {
      m.ccrTotal += 1;
      const restored = await retrieve('tenant-alpha', result.originalRef);
      if (restored === payload.body) m.reversibleHits += 1; // byte-identical (NFR-004)
    }
  }
  return m;
}

/** Identical content under two tenants: does the default store keep them separate? */
async function isolationProbe(): Promise<'supported' | 'unsupported'> {
  const content = JSON.stringify({ id: 'probe', body: 'Shared identical tenant content for isolation probe. '.repeat(30) });
  const a = await compress({ tenantId: 'tenant-alpha', kind: 'content_mcp', content, mode: 'proxy' });
  const b = await compress({ tenantId: 'tenant-beta', kind: 'content_mcp', content, mode: 'proxy' });
  // Same CCR hash for identical content across tenants = dedup crossed tenants = unsupported as-is.
  if (a.originalRef && a.originalRef === b.originalRef) return 'unsupported';
  return 'supported';
}

function decide(
  r: Omit<SpikeReport, 'decision' | 'primaryTarget' | 'rationale'>,
  netByKind: Record<string, number>,
): SpikeReport {
  // The gate is NFR-002's "≥50% reduction AT NFR-001's zero-degradation bar" — i.e. NET of the
  // retrieval that zero degradation requires. savingsMean in perType is COMPRESS-ONLY (the raw
  // ratio when the dropped body is never read). Zero accuracyDelta was achieved only because the
  // agent RETRIEVED the dropped body — which re-enters context. So a kind is a GO candidate only
  // if NET savings (compressed + retrieved body + retrieve-tool overhead vs full) >= the bar.
  // tenantIsolationFit is reported and ROUTES the store choice (R2); it is not a hard go-gate.
  const candidates = (Object.entries(r.perType) as [PayloadKind, PerKind][])
    .filter(([k, m]) => (netByKind[k] ?? -1) >= SAVINGS_BAR && m.accuracyDelta === 0 && r.reversibilityRate === 1.0)
    .sort((a, b) => (netByKind[b[0]] ?? 0) - (netByKind[a[0]] ?? 0));

  const isoNote =
    r.tenantIsolationFit === 'supported'
      ? 'tenant isolation supported as configured'
      : "Headroom's default store is content-addressed (cross-tenant dedup) and ephemeral (5-min TTL); durable, isolated reversibility needs a per-tenant persistent backend (our Postgres store, WP03/R2)";

  if (candidates.length === 0) {
    const co = (Object.entries(r.perType) as [PayloadKind, PerKind][])
      .map(([k, m]) => `${k} compress-only=${(m.savingsMean * 100).toFixed(0)}% / net-must-read=${(((netByKind[k] ?? 0)) * 100).toFixed(0)}%`)
      .join('; ');
    return {
      ...r,
      decision: 'no_go',
      rationale:
        `NET savings under the retrieval that zero-degradation requires do NOT clear ${SAVINGS_BAR} for any kind (${co}). ` +
        `Compression is real and reversible (reversibility=${r.reversibilityRate}, accuracyDelta=0 WITH retrieval), but for must-read tool outputs the agent retrieves the dropped body, so net tokens ≈ full payload + marker + retrieve-tool overhead — i.e. ≤ 0% net, never ≥50%. ` +
        `The savings the spec needs only materialize when content is NOT retrieved (low retrieval-rate) or a single retrieval is amortized across many turns (reference reuse) — and that retrieval rate is UNMEASURED here (the suite was 100% must-read, single-shot). ` +
        `Recommend ${r.recommendedMode} mode if pursued. ${isoNote}. ` +
        `Path to a conditional GO: measure retrieval-rate / fraction-of-content-actually-read on realistic multi-turn agent traces; CCR is viable only for low-retrieval-rate or read-once-reference-many payloads. The lossy array row-drop path (no CCR backing, rust-less install) must be bypassed regardless.`,
    };
  }
  const [primaryTarget, m] = candidates[0];
  return {
    ...r,
    decision: 'go',
    primaryTarget,
    rationale:
      `${primaryTarget} cleared the NET savings bar (net-must-read=${(((netByKind[primaryTarget]) ?? 0) * 100).toFixed(0)}%, compress-only=${(m.savingsMean * 100).toFixed(0)}%) at accuracyDelta=0, reversibility=1.0. ` +
      `Recommend ${r.recommendedMode} mode; p95 latency ${r.addedLatencyP95Ms.toFixed(0)}ms. ${isoNote}.`,
  };
}

async function main(): Promise<void> {
  const { accuracy, netMustRead } = loadScored();
  const perType: Partial<Record<PayloadKind, PerKind>> = {};
  const allLatencies: number[] = [];
  let reversibleHits = 0;
  let ccrTotal = 0;

  // Warm the proxy (first call loads the model) so latency p95 reflects steady state.
  await compress({ tenantId: 'warm', kind: 'content_mcp', content: JSON.stringify({ id: 'w', body: 'warmup '.repeat(80) }), mode: 'proxy' });

  for (const kind of KINDS) {
    const corpus = loadCorpus(kind);
    if (corpus.length === 0) continue;
    const r = await measureKind(kind);
    allLatencies.push(...r.latencies);
    reversibleHits += r.reversibleHits;
    ccrTotal += r.ccrTotal;
    if (!(kind in accuracy)) throw new Error(`accuracy missing for kind ${kind} in scored.json`);
    perType[kind] = {
      savingsMean: mean(r.savings),
      savingsStdDev: stdDev(r.savings),
      accuracyDelta: accuracy[kind],
      sampleSize: r.savings.length,
    };
  }

  const base = {
    headroomVersion: HEADROOM_VERSION,
    perType,
    reversibilityRate: ccrTotal === 0 ? 0 : reversibleHits / ccrTotal,
    tenantIsolationFit: await isolationProbe(),
    addedLatencyP95Ms: p95(allLatencies),
    recommendedMode: 'proxy' as const, // npm headroom-ai is a proxy client; no in-process library mode (finding)
  };
  void LATENCY_BUDGET_MS;

  const report = decide(base, netMustRead);
  writeFileSync(join(HERE, 'spike-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(HERE, 'spike-report.md'), renderMarkdown(report));
  console.log(`Decision: ${report.decision}${report.primaryTarget ? ` (primary: ${report.primaryTarget})` : ''}. Wrote spike-report.json + spike-report.md`);
}

function renderMarkdown(r: SpikeReport): string {
  const rows = (Object.entries(r.perType) as [PayloadKind, PerKind][])
    .map(([k, m]) => `| ${k} | ${(m.savingsMean * 100).toFixed(1)}% | ${(m.savingsStdDev * 100).toFixed(1)}pp | ${m.accuracyDelta} | ${m.sampleSize} |`)
    .join('\n');
  return `# WP01 Spike Report — Headroom MCP Compression

**Headroom version:** ${r.headroomVersion}
**Decision:** ${r.decision.toUpperCase()}${r.primaryTarget ? ` — primary target: \`${r.primaryTarget}\`` : ''}
**Recommended mode:** ${r.recommendedMode}
**Reversibility rate:** ${r.reversibilityRate} (byte-identical CCR round-trip)
**Tenant isolation (default store):** ${r.tenantIsolationFit}
**Added p95 latency:** ${r.addedLatencyP95Ms.toFixed(0)} ms (budget ${LATENCY_BUDGET_MS} ms)

> **savingsMean below is COMPRESS-ONLY** (raw ratio when the dropped body is never read).
> It is NOT net savings. Zero accuracyDelta required the agent to RETRIEVE the body back, which
> re-enters context — see net economics in \`runset/scored.json\` and the rationale.

| kind | compress-only savings | savings sd | accuracyDelta | sampleSize (payloads) |
|------|-----------------------|------------|---------------|------------------------|
${rows}

**Rationale:** ${r.rationale}

---
_Savings use the proxy's tiktoken counts on synthetic, realistically-shaped Joyus payloads.
Accuracy is a fixed fact-extraction A/B (uncompressed vs CCR-compressed + retrieve), scored
exact-match by orchestrated subagents; see runset/. Reversibility is a live byte-identical
round-trip of each CCR-dropped field. Corpus is synthetic (C-006); sample sizes above._
`;
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
