import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createId } from '@paralleldrive/cuid2';
import { config } from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { contentItems, contentSources, contentTenants } from '../src/content/schema.js';

config();

const TENANT_SLUG = 'zivtech-internal';
const SOURCE_NAME = 'zivtech-seed-content';
const SEED_CONTENT_TYPE = 'markdown';
const SEED_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed-data');

function extractTitle(filename: string, markdown: string): string {
  const heading = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  return filename
    .replace(/\.md$/i, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

async function listSeedDocuments(): Promise<
  Array<{ filename: string; body: string; title: string }>
> {
  const entries = await readdir(SEED_DATA_DIR, { withFileTypes: true });
  const markdownFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    markdownFiles.map(async filename => {
      const filePath = path.join(SEED_DATA_DIR, filename);
      const body = await readFile(filePath, 'utf8');

      return {
        filename,
        body,
        title: extractTitle(filename, body),
      };
    })
  );
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema: { contentTenants, contentSources, contentItems } });

  try {
    const [tenant] = await db
      .select({ id: contentTenants.id })
      .from(contentTenants)
      .where(eq(contentTenants.slug, TENANT_SLUG))
      .limit(1);

    if (!tenant) {
      throw new Error(
        `Tenant '${TENANT_SLUG}' not found. Run \`npm run seed:first-tenant\` first.`
      );
    }

    const [existingSource] = await db
      .select({ id: contentSources.id })
      .from(contentSources)
      .where(and(eq(contentSources.tenantId, tenant.id), eq(contentSources.name, SOURCE_NAME)))
      .limit(1);

    const sourceId = existingSource?.id ?? createId();

    if (!existingSource) {
      await db.insert(contentSources).values({
        id: sourceId,
        tenantId: tenant.id,
        name: SOURCE_NAME,
        type: 'rest-api',
        syncStrategy: 'pass-through',
        connectionConfig: {
          kind: 'manual-seed',
          note: 'Seed content for first-user validation',
        },
      });
    }

    const documents = await listSeedDocuments();
    let insertedCount = 0;
    let skippedCount = 0;
    const syncedAt = new Date();

    for (const document of documents) {
      const [existingItem] = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(
          and(eq(contentItems.sourceId, sourceId), eq(contentItems.sourceRef, document.filename))
        )
        .limit(1);

      if (existingItem) {
        skippedCount++;
        continue;
      }

      await db.insert(contentItems).values({
        id: createId(),
        sourceId,
        sourceRef: document.filename,
        title: document.title,
        body: document.body,
        contentType: SEED_CONTENT_TYPE,
        metadata: {
          kind: 'seed-markdown',
          filename: document.filename,
        },
        lastSyncedAt: syncedAt,
      });

      insertedCount++;
    }

    const [itemTotals] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentItems)
      .where(eq(contentItems.sourceId, sourceId));

    await db
      .update(contentSources)
      .set({
        itemCount: itemTotals?.count ?? 0,
        lastSyncAt: syncedAt,
        updatedAt: new Date(),
      })
      .where(eq(contentSources.id, sourceId));

    if (insertedCount === 0) {
      console.log('Seed content already seeded for source zivtech-seed-content.');
    }

    console.log('Seed content summary:');
    console.log(`  tenantId: ${tenant.id}`);
    console.log(`  sourceId: ${sourceId}`);
    console.log(`  inserted: ${insertedCount}`);
    console.log(`  skipped: ${skippedCount}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
