import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/db/schema.ts', './src/content/schema.ts', './src/pipelines/schema.ts'],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
