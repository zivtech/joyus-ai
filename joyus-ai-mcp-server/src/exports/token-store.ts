import { createHash } from 'crypto';

import { eq, lte } from 'drizzle-orm';

import { db } from '../db/client.js';

import { exportDownloadTokens, type ExportDownloadToken } from './schema.js';

export interface CreateExportDownloadTokenInput {
  token: string;
  jobId: string;
  userId: string;
  tenantId: string;
  exportType: string;
  filePath: string;
  fileName?: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ExportDownloadTokenStore {
  create(input: CreateExportDownloadTokenInput): Promise<ExportDownloadToken>;
  findActiveByToken(token: string, now?: Date): Promise<ExportDownloadToken | null>;
  cleanupExpired(now?: Date): Promise<number>;
}

export function exportDownloadTokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class DrizzleExportDownloadTokenStore implements ExportDownloadTokenStore {
  constructor(private readonly database = db) {}

  async create(input: CreateExportDownloadTokenInput): Promise<ExportDownloadToken> {
    const [record] = await this.database
      .insert(exportDownloadTokens)
      .values({
        tokenId: exportDownloadTokenId(input.token),
        jobId: input.jobId,
        userId: input.userId,
        tenantId: input.tenantId,
        exportType: input.exportType,
        filePath: input.filePath,
        fileName: input.fileName,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
      })
      .returning();

    if (!record) {
      throw new Error('Export download token was not persisted.');
    }

    return record;
  }

  async findActiveByToken(token: string, now = new Date()): Promise<ExportDownloadToken | null> {
    await this.cleanupExpired(now);

    const [record] = await this.database
      .select()
      .from(exportDownloadTokens)
      .where(eq(exportDownloadTokens.tokenId, exportDownloadTokenId(token)))
      .limit(1);

    if (!record) return null;
    if (record.expiresAt <= now) {
      await this.cleanupExpired(now);
      return null;
    }

    return record;
  }

  async cleanupExpired(now = new Date()): Promise<number> {
    const deleted = await this.database
      .delete(exportDownloadTokens)
      .where(lte(exportDownloadTokens.expiresAt, now))
      .returning({ tokenId: exportDownloadTokens.tokenId });

    return deleted.length;
  }
}
