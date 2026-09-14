#!/usr/bin/env node
/**
 * Migration chain replay verifier (#96).
 *
 * Verifies the committed Drizzle migration chain stays honest:
 *   1. journal lint   — idx contiguity, strictly increasing `when`,
 *                       tag <-> file parity, unique tags
 *   2. fresh replay   — full chain against an empty scratch database
 *   3. idempotency    — a second migrate run applies nothing
 *   4. stale catch-up — seed a database to journal position 0007, remove the
 *                       pipelines schema (the production divergence behind
 *                       #96, including the empty schema left by triage), then
 *                       run the full chain and assert the converged state
 *
 * Requires a reachable Postgres superuser URL in PG_ADMIN_URL
 * (default: postgres://postgres:postgres@localhost:5432/postgres).
 * Scratch databases migration_replay_fresh / migration_replay_catchup are
 * dropped and recreated on every run. Never point PG_ADMIN_URL at a real
 * environment.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'drizzle', 'migrations');
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const FRESH_DB = 'migration_replay_fresh';
const CATCHUP_DB = 'migration_replay_catchup';
// Last journal entry production had recorded before the divergence (#96).
const SEED_MAX_IDX = 7;

const PIPELINES_TABLES = [
  'pipeline_templates',
  'pipelines',
  'pipeline_steps',
  'trigger_events',
  'pipeline_executions',
  'execution_steps',
  'review_decisions',
  'pipeline_metrics',
  'quality_signals',
];

let failures = 0;

function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

function dbUrl(name) {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

async function query(url, sql) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function recreate(name) {
  await query(ADMIN_URL, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await query(ADMIN_URL, `CREATE DATABASE ${name}`);
}

function runMigrate(url, configPath) {
  const args = ['drizzle-kit', 'migrate'];
  if (configPath) args.push('--config', configPath);
  const res = spawnSync('npx', args, {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

function readJournal() {
  return JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'));
}

function lintJournal() {
  const { entries } = readJournal();
  check(
    entries.every((e, i) => e.idx === i),
    'journal: idx values are contiguous from 0',
  );
  check(
    entries.every((e, i) => i === 0 || entries[i - 1].when < e.when),
    'journal: `when` strictly increasing (apply order matches watermark order)',
  );
  const tags = new Set(entries.map((e) => e.tag));
  check(tags.size === entries.length, 'journal: tags are unique');
  const missing = entries.filter((e) => !fs.existsSync(path.join(MIGRATIONS_DIR, `${e.tag}.sql`)));
  check(
    missing.length === 0,
    `journal: every entry has a .sql file${missing.length ? ` (missing: ${missing.map((e) => e.tag).join(', ')})` : ''}`,
  );
  const orphans = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !tags.has(f.replace(/\.sql$/, '')));
  check(
    orphans.length === 0,
    `migrations dir: every .sql file is journaled${orphans.length ? ` (orphaned: ${orphans.join(', ')})` : ''}`,
  );
  return entries.length;
}

async function migrationCount(url) {
  const res = await query(url, 'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
  return res.rows[0].n;
}

async function assertConverged(url, label) {
  for (const table of PIPELINES_TABLES) {
    const res = await query(url, `SELECT to_regclass('pipelines.${table}') AS reg`);
    check(res.rows[0].reg !== null, `${label}: pipelines.${table} exists`);
  }
  const idx = await query(
    url,
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'pipelines' AND tablename = 'pipelines'",
  );
  const names = idx.rows.map((r) => r.indexname);
  check(
    names.includes('pipelines_tenant_name_idx'),
    `${label}: final-state index pipelines_tenant_name_idx exists`,
  );
  check(
    !names.includes('pipelines_tenant_name_unique'),
    `${label}: pre-0008 unique index is absent`,
  );
  const enumRow = await query(
    url,
    "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'task_type' AND e.enumlabel = 'JIRA_A11Y_TRIAGE'",
  );
  check(enumRow.rowCount === 1, `${label}: task_type contains JIRA_A11Y_TRIAGE (0012 applied)`);
}

function makeSeedConfig(tmpDir) {
  const seedMigrations = path.join(tmpDir, 'migrations');
  fs.cpSync(MIGRATIONS_DIR, seedMigrations, { recursive: true });
  const journalPath = path.join(seedMigrations, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.idx <= SEED_MAX_IDX);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  const configPath = path.join(tmpDir, 'seed.config.mjs');
  fs.writeFileSync(
    configPath,
    `export default { dialect: 'postgresql', out: ${JSON.stringify(seedMigrations)}, dbCredentials: { url: process.env.DATABASE_URL } };\n`,
  );
  return configPath;
}

async function phaseFreshReplay(entryCount) {
  await recreate(FRESH_DB);
  const fresh = runMigrate(dbUrl(FRESH_DB));
  check(fresh.ok, 'fresh replay: full chain applies to an empty database');
  if (!fresh.ok) {
    console.log(fresh.output);
    return false;
  }
  check(
    (await migrationCount(dbUrl(FRESH_DB))) === entryCount,
    `fresh replay: ${entryCount} journal rows recorded`,
  );
  await assertConverged(dbUrl(FRESH_DB), 'fresh replay');
  return true;
}

async function phaseIdempotency() {
  const before = await migrationCount(dbUrl(FRESH_DB));
  const second = runMigrate(dbUrl(FRESH_DB));
  check(second.ok, 'idempotency: second migrate run succeeds');
  if (!second.ok) {
    console.log(second.output);
    return;
  }
  check(
    (await migrationCount(dbUrl(FRESH_DB))) === before,
    'idempotency: second run applies nothing',
  );
}

async function phaseCatchup(entryCount) {
  await recreate(CATCHUP_DB);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-replay-'));
  try {
    const seed = runMigrate(dbUrl(CATCHUP_DB), makeSeedConfig(tmpDir));
    check(seed.ok, `catch-up: seeded to journal idx ${SEED_MAX_IDX}`);
    if (!seed.ok) {
      console.log(seed.output);
      return;
    }
    await query(dbUrl(CATCHUP_DB), 'DROP SCHEMA pipelines CASCADE');
    // Production triage left an empty pipelines schema behind; model that too.
    await query(dbUrl(CATCHUP_DB), 'CREATE SCHEMA pipelines');
    const catchup = runMigrate(dbUrl(CATCHUP_DB));
    check(catchup.ok, `catch-up: full chain applies from journal position ${SEED_MAX_IDX}`);
    if (!catchup.ok) {
      console.log(catchup.output);
      return;
    }
    check(
      (await migrationCount(dbUrl(CATCHUP_DB))) === entryCount,
      `catch-up: ${entryCount} journal rows recorded`,
    );
    await assertConverged(dbUrl(CATCHUP_DB), 'catch-up');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('--- Phase 1: journal lint');
  const entryCount = lintJournal();

  console.log('--- Phase 2: fresh replay');
  const freshOk = await phaseFreshReplay(entryCount);

  console.log('--- Phase 3: idempotency');
  if (freshOk) {
    await phaseIdempotency();
  } else {
    check(false, 'idempotency: skipped (fresh replay failed)');
  }

  console.log('--- Phase 4: stale-environment catch-up (#96 shape)');
  await phaseCatchup(entryCount);

  console.log(
    failures === 0
      ? '\nAll migration replay checks passed.'
      : `\n${failures} migration replay check(s) FAILED.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
