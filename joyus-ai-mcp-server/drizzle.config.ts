import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/db/schema.ts',
    './src/db/schema/orchestrator.ts',
    './src/db/schema/events.ts',
    './src/db/schema/coordination.ts',
    './src/db/schema/approvals.ts',
    './src/content/schema.ts',
    './src/pipelines/schema.ts',
    './src/event-adapter/schema.ts',
    './src/exports/schema.ts',
    './src/profiles/schema.ts',
  ],
  // push/introspect only inspect `public` by default; include every pgSchema we define
  schemaFilter: ['public', 'content', 'pipelines', 'event_adapter', 'profiles'],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
