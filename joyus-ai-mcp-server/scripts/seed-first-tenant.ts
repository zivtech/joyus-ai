import crypto from 'node:crypto';

import { createId } from '@paralleldrive/cuid2';
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { contentApiKeys, contentTenants } from '../src/content/schema.js';
import { hashApiKey } from '../src/content/mediation/auth.js';

config();

const TENANT_NAME = 'Zivtech Internal';
const TENANT_SLUG = 'zivtech-internal';
const DEV_JWKS_URI = 'https://dev.local/.well-known/jwks.json';
const DEV_ISSUER = 'joyus-dev';
const DEV_AUDIENCE = 'joyus-mediation-dev';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema: { contentTenants, contentApiKeys } });

  try {
    const existingTenantRows = await db
      .select({
        id: contentTenants.id,
      })
      .from(contentTenants)
      .where(eq(contentTenants.slug, TENANT_SLUG))
      .limit(1);

    const existingTenant = existingTenantRows[0];
    if (existingTenant) {
      const existingKeyRows = await db
        .select({
          keyPrefix: contentApiKeys.keyPrefix,
        })
        .from(contentApiKeys)
        .where(eq(contentApiKeys.tenantId, existingTenant.id))
        .limit(1);

      console.log(`TENANT_ID=${existingTenant.id}`);
      console.log(`API_KEY_PREFIX=${existingKeyRows[0]?.keyPrefix ?? '<missing>'}`);
      return;
    }

    const tenantId = createId();
    const apiKey = crypto.randomBytes(32).toString('hex');
    const jwtDevToken = crypto.randomBytes(32).toString('hex');

    await db.insert(contentTenants).values({
      id: tenantId,
      name: TENANT_NAME,
      slug: TENANT_SLUG,
    });

    await db.insert(contentApiKeys).values({
      id: createId(),
      tenantId,
      keyHash: hashApiKey(apiKey),
      keyPrefix: apiKey.slice(0, 8),
      integrationName: 'Zivtech Internal Dev',
      jwksUri: DEV_JWKS_URI,
      issuer: DEV_ISSUER,
      audience: DEV_AUDIENCE,
      isActive: true,
    });

    console.log(`TENANT_ID=${tenantId}`);
    console.log(`API_KEY=${apiKey}`);
    console.log(`JWT_DEV_TOKEN=${jwtDevToken}`);
    console.log('');
    console.log('Put these in your .env:');
    console.log('  JOYUS_INTERNAL_API_KEY=<API_KEY>');
    console.log('  JOYUS_DEV_SKIP_JWT=true');
    console.log('  JOYUS_DEV_JWT_TOKEN=<JWT_DEV_TOKEN>');
    console.log('  JOYUS_DEV_ENTITLEMENT_MODE=all-tenant-sources');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
