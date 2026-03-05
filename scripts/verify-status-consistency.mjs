#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderFeatureTable,
  renderPhaseSummary,
  writeGeneratedSnippets,
} from './generate-status-snippets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const readinessPath = path.join(repoRoot, 'status', 'feature-readiness.json');
const featureTablePath = path.join(repoRoot, 'status', 'generated', 'feature-table.md');
const phaseSummaryPath = path.join(repoRoot, 'status', 'generated', 'phase-summary.md');
const kittySpecsDir = path.join(repoRoot, 'kitty-specs');

const lifecycleAllowed = new Set([
  'spec-only',
  'planning',
  'execution',
  'done',
  'blocked',
  'deprecated',
]);
const implementationAllowed = new Set(['none', 'scaffolded', 'integrated', 'validated']);
const productionAllowed = new Set(['not_ready', 'pilot_ready', 'production_ready']);
const generationProviderAllowed = new Set(['placeholder', 'configured', 'validated']);
const voiceAnalyzerAllowed = new Set(['stub', 'configured', 'validated']);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertFeatureShape(id, feature, errors) {
  const requiredKeys = [
    'friendly_name',
    'lifecycle_state',
    'implementation_state',
    'production_readiness',
    'provider_readiness',
    'evidence',
  ];
  for (const key of requiredKeys) {
    if (!(key in feature)) {
      errors.push(`features.${id} missing required key: ${key}`);
    }
  }

  if (!lifecycleAllowed.has(feature.lifecycle_state)) {
    errors.push(`features.${id}.lifecycle_state invalid: ${feature.lifecycle_state}`);
  }
  if (!implementationAllowed.has(feature.implementation_state)) {
    errors.push(`features.${id}.implementation_state invalid: ${feature.implementation_state}`);
  }
  if (!productionAllowed.has(feature.production_readiness)) {
    errors.push(`features.${id}.production_readiness invalid: ${feature.production_readiness}`);
  }

  if (!feature.provider_readiness || typeof feature.provider_readiness !== 'object') {
    errors.push(`features.${id}.provider_readiness must be an object`);
  } else {
    if (!generationProviderAllowed.has(feature.provider_readiness.generation_provider)) {
      errors.push(
        `features.${id}.provider_readiness.generation_provider invalid: ${feature.provider_readiness.generation_provider}`,
      );
    }
    if (!voiceAnalyzerAllowed.has(feature.provider_readiness.voice_analyzer)) {
      errors.push(
        `features.${id}.provider_readiness.voice_analyzer invalid: ${feature.provider_readiness.voice_analyzer}`,
      );
    }
  }

  if (!feature.evidence || typeof feature.evidence !== 'object') {
    errors.push(`features.${id}.evidence must be an object`);
  } else {
    for (const key of ['spec_meta', 'runtime_wiring', 'tests']) {
      if (!(key in feature.evidence)) {
        errors.push(`features.${id}.evidence missing required key: ${key}`);
      }
    }
    if (!Array.isArray(feature.evidence.runtime_wiring)) {
      errors.push(`features.${id}.evidence.runtime_wiring must be an array`);
    }
    if (!Array.isArray(feature.evidence.tests)) {
      errors.push(`features.${id}.evidence.tests must be an array`);
    }
  }
}

function findMetaPath(featureId) {
  const prefix = `${featureId}-`;
  const dirs = fs
    .readdirSync(kittySpecsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(prefix))
    .map((d) => d.name);
  if (dirs.length === 0) return null;
  return path.join(kittySpecsDir, dirs[0], 'meta.json');
}

function validateLifecycleSync(readiness, errors) {
  for (const [featureId, feature] of Object.entries(readiness.features)) {
    const metaPath = findMetaPath(featureId);
    if (!metaPath) {
      errors.push(`No meta.json found for feature ${featureId}`);
      continue;
    }
    const meta = loadJson(metaPath);
    if (meta.lifecycle_state !== feature.lifecycle_state) {
      errors.push(
        `Lifecycle mismatch for ${featureId}: readiness=${feature.lifecycle_state}, meta=${meta.lifecycle_state}`,
      );
    }
  }
}

function validateProductionSafety(readiness, errors) {
  for (const [featureId, feature] of Object.entries(readiness.features)) {
    if (feature.production_readiness !== 'production_ready') continue;

    if (feature.provider_readiness.generation_provider === 'placeholder') {
      errors.push(
        `Invalid production_ready for ${featureId}: generation_provider is placeholder`,
      );
    }
    if (feature.provider_readiness.voice_analyzer === 'stub') {
      errors.push(`Invalid production_ready for ${featureId}: voice_analyzer is stub`);
    }
  }
}

function assertGeneratedSnippets(readiness, errors) {
  const expectedTable = renderFeatureTable(readiness);
  const expectedSummary = renderPhaseSummary(readiness);

  if (!fs.existsSync(featureTablePath)) {
    errors.push(`Missing generated snippet: ${path.relative(repoRoot, featureTablePath)}`);
  } else {
    const actual = fs.readFileSync(featureTablePath, 'utf8');
    if (actual !== expectedTable) {
      errors.push('Generated snippet out of date: status/generated/feature-table.md');
    }
  }

  if (!fs.existsSync(phaseSummaryPath)) {
    errors.push(`Missing generated snippet: ${path.relative(repoRoot, phaseSummaryPath)}`);
  } else {
    const actual = fs.readFileSync(phaseSummaryPath, 'utf8');
    if (actual !== expectedSummary) {
      errors.push('Generated snippet out of date: status/generated/phase-summary.md');
    }
  }
}

function main() {
  const writeGenerated = process.argv.includes('--write-generated');
  const errors = [];

  if (!fs.existsSync(readinessPath)) {
    errors.push(`Missing readiness file: ${path.relative(repoRoot, readinessPath)}`);
  } else {
    const readiness = loadJson(readinessPath);

    if (Number.isNaN(Date.parse(readiness.updated_at))) {
      errors.push(`Invalid updated_at datetime: ${readiness.updated_at}`);
    }
    if (!readiness.features || typeof readiness.features !== 'object') {
      errors.push('features must be an object');
    } else {
      for (const [featureId, feature] of Object.entries(readiness.features)) {
        assertFeatureShape(featureId, feature, errors);
      }
    }

    validateLifecycleSync(readiness, errors);
    validateProductionSafety(readiness, errors);

    if (writeGenerated) {
      writeGeneratedSnippets(readiness);
    }
    assertGeneratedSnippets(readiness, errors);
  }

  if (errors.length > 0) {
    process.stderr.write('Status consistency verification failed:\n');
    for (const err of errors) {
      process.stderr.write(`- ${err}\n`);
    }
    process.exit(1);
  }

  process.stdout.write('Status consistency verification passed.\n');
}

main();
