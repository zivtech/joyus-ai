import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/db/schema.ts',
    './src/db/schema/orchestrator.ts',
    './src/content/schema.ts',
    './src/pipelines/schema.ts',
    './src/event-adapter/schema.ts',
    './src/exports/schema.ts',
    './src/profiles/schema.ts',
  ],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
