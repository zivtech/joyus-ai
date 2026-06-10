import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from '../db/schema.js';

export const exportDownloadTokens = pgTable(
  'export_download_tokens',
  {
    tokenId: text('token_id').primaryKey(),
    jobId: text('job_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    exportType: text('export_type').notNull(),
    filePath: text('file_path').notNull(),
    fileName: text('file_name'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  table => ({
    tenantUserIdx: index('export_download_tokens_tenant_user_idx').on(table.tenantId, table.userId),
    expiresAtIdx: index('export_download_tokens_expires_at_idx').on(table.expiresAt),
    jobIdIdx: index('export_download_tokens_job_id_idx').on(table.jobId),
  })
);

export type ExportDownloadToken = typeof exportDownloadTokens.$inferSelect;
export type NewExportDownloadToken = typeof exportDownloadTokens.$inferInsert;
