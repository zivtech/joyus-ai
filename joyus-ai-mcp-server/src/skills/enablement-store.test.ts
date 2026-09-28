import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { skillEnablements, users } from '../db/schema.js';

import {
  DEFAULT_SKILL_ENABLEMENT_TTL_MS,
  SkillEnablementStore,
} from './enablement-store.js';

const TEST_SCHEMA = { skillEnablements, users };
const START = new Date('2026-09-13T12:00:00.000Z');
const SKILL_ENABLEMENT_MIGRATION = readFileSync(
  new URL('../../drizzle/migrations/0014_skill_enablement.sql', import.meta.url),
  'utf8',
);

describe('SkillEnablementStore', () => {
  let client: PGlite;
  let database: PgliteDatabase<typeof TEST_SCHEMA>;
  let now: Date;
  let store: SkillEnablementStore;

  beforeEach(async () => {
    client = new PGlite();

    await client.exec(`
      CREATE TABLE users (
        id text PRIMARY KEY
      );
      INSERT INTO users (id) VALUES ('user-a'), ('user-b');
    `);
    await client.exec(SKILL_ENABLEMENT_MIGRATION);

    database = drizzle(client, { schema: TEST_SCHEMA });
    now = new Date(START);
    store = new SkillEnablementStore(database, { clock: () => new Date(now) });
  });

  afterEach(async () => {
    await client.close();
  });

  it('isolates enabled skills by both user and session', async () => {
    await store.enable('user-a', 'session-1', 'alpha');
    await store.enable('user-a', 'session-2', 'beta');
    await store.enable('user-b', 'session-1', 'gamma');

    expect((await store.list('user-a', 'session-1')).map((row) => row.skillName))
      .toEqual(['alpha']);
    expect(await store.isEnabled('user-a', 'session-1', 'alpha')).toBe(true);
    expect(await store.isEnabled('user-a', 'session-2', 'alpha')).toBe(false);
    expect(await store.isEnabled('user-b', 'session-1', 'alpha')).toBe(false);

    expect(await store.disable('user-a', 'session-1', 'alpha')).toBe(true);
    expect(await store.disable('user-a', 'session-1', 'alpha')).toBe(false);
    expect(await store.list('user-a', 'session-1')).toEqual([]);
    expect((await store.list('user-a', 'session-2')).map((row) => row.skillName))
      .toEqual(['beta']);
  });

  it('enforces one row per user, session, and skill', async () => {
    const expiresAt = new Date(START.getTime() + DEFAULT_SKILL_ENABLEMENT_TTL_MS);

    await database.insert(skillEnablements).values({
      userId: 'user-a',
      sessionId: 'session-1',
      skillName: 'alpha',
      enabledAt: START,
      expiresAt,
    });

    await expect(database.insert(skillEnablements).values({
      userId: 'user-a',
      sessionId: 'session-1',
      skillName: 'alpha',
      enabledAt: START,
      expiresAt,
    })).rejects.toThrow();
  });

  it('uses a 24-hour default TTL and excludes expired rows', async () => {
    const row = await store.enable('user-a', 'session-1', 'alpha');

    expect(row.enabledAt).toEqual(START);
    expect(row.expiresAt).toEqual(
      new Date(START.getTime() + DEFAULT_SKILL_ENABLEMENT_TTL_MS),
    );

    now = new Date(row.expiresAt);
    expect(await store.list('user-a', 'session-1')).toEqual([]);
    expect(await store.isEnabled('user-a', 'session-1', 'alpha')).toBe(false);
  });

  it('renews timestamps without adding a duplicate row', async () => {
    const first = await store.enable('user-a', 'session-1', 'alpha');
    now = new Date(START.getTime() + 60_000);

    const renewed = await store.enable('user-a', 'session-1', 'alpha');
    const rows = await database.select().from(skillEnablements);

    expect(rows).toHaveLength(1);
    expect(renewed.enabledAt).toEqual(now);
    expect(renewed.expiresAt).toEqual(
      new Date(now.getTime() + DEFAULT_SKILL_ENABLEMENT_TTL_MS),
    );
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(first.expiresAt.getTime());
  });

  it('honors an injected TTL and purges expired rows', async () => {
    store = new SkillEnablementStore(database, {
      clock: () => new Date(now),
      ttlMs: 1_000,
    });

    await store.enable('user-a', 'session-1', 'expired');
    now = new Date(START.getTime() + 1_001);
    await store.enable('user-a', 'session-1', 'current');

    expect(await store.purgeExpired()).toBe(1);
    expect((await store.list('user-a', 'session-1')).map((row) => row.skillName))
      .toEqual(['current']);
  });

  it('cascades user deletion to skill enablements', async () => {
    await store.enable('user-a', 'session-1', 'alpha');

    await client.query("DELETE FROM users WHERE id = 'user-a'");

    expect(await database.select().from(skillEnablements)).toEqual([]);
  });

  it.each([
    ['enable userId', () => store.enable('   ', 'session-1', 'alpha')],
    ['enable sessionId', () => store.enable('user-a', '\t', 'alpha')],
    ['enable skillName', () => store.enable('user-a', 'session-1', '')],
    ['disable userId', () => store.disable('', 'session-1', 'alpha')],
    ['disable sessionId', () => store.disable('user-a', ' ', 'alpha')],
    ['disable skillName', () => store.disable('user-a', 'session-1', '\n')],
    ['list userId', () => store.list(' ', 'session-1')],
    ['list sessionId', () => store.list('user-a', '')],
    ['isEnabled userId', () => store.isEnabled('\t', 'session-1', 'alpha')],
    ['isEnabled sessionId', () => store.isEnabled('user-a', '\n', 'alpha')],
    ['isEnabled skillName', () => store.isEnabled('user-a', 'session-1', ' ')],
  ])('rejects a blank identifier for %s', async (_label, operation) => {
    await expect(operation()).rejects.toThrow(/must not be blank/);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid TTL %s',
    (ttlMs) => {
      expect(() => new SkillEnablementStore(database, { ttlMs })).toThrow(
        /ttlMs must be a positive finite number/,
      );
    },
  );
});
