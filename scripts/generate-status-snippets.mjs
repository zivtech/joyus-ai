#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const statusPath = path.join(repoRoot, 'status', 'feature-readiness.json');
const generatedDir = path.join(repoRoot, 'status', 'generated');
const featureTablePath = path.join(generatedDir, 'feature-table.md');
const phaseSummaryPath = path.join(generatedDir, 'phase-summary.md');

function loadReadiness() {
  return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
}

function sortFeatureEntries(featuresObj) {
  return Object.entries(featuresObj).sort(([a], [b]) => Number(a) - Number(b));
}

export function renderFeatureTable(readiness) {
  const rows = sortFeatureEntries(readiness.features).map(([id, feature]) => {
    return `| \`${id}\` | ${feature.friendly_name} | \`${feature.lifecycle_state}\` | \`${feature.implementation_state}\` | \`${feature.production_readiness}\` |`;
  });

  return [
    '<!-- GENERATED: status/feature-readiness.json -->',
    '| Feature | Name | Lifecycle | Implementation | Production |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

export function renderPhaseSummary(readiness) {
  const entries = sortFeatureEntries(readiness.features);
  const lifecycleCounts = {};
  const productionCounts = {};

  for (const [, feature] of entries) {
    lifecycleCounts[feature.lifecycle_state] = (lifecycleCounts[feature.lifecycle_state] ?? 0) + 1;
    productionCounts[feature.production_readiness] = (productionCounts[feature.production_readiness] ?? 0) + 1;
  }

  const lifecycleLines = Object.entries(lifecycleCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, count]) => `- ${state}: ${count}`);
  const productionLines = Object.entries(productionCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, count]) => `- ${state}: ${count}`);

  return [
    '<!-- GENERATED: status/feature-readiness.json -->',
    `Updated: ${readiness.updated_at}`,
    '',
    'Lifecycle counts:',
    ...lifecycleLines,
    '',
    'Production-readiness counts:',
    ...productionLines,
    '',
  ].join('\n');
}

export function writeGeneratedSnippets(readiness) {
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(featureTablePath, renderFeatureTable(readiness), 'utf8');
  fs.writeFileSync(phaseSummaryPath, renderPhaseSummary(readiness), 'utf8');
}

function runCli() {
  const readiness = loadReadiness();
  writeGeneratedSnippets(readiness);
  process.stdout.write(
    [
      'Generated status snippets:',
      `- ${path.relative(repoRoot, featureTablePath)}`,
      `- ${path.relative(repoRoot, phaseSummaryPath)}`,
      '',
    ].join('\n'),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
