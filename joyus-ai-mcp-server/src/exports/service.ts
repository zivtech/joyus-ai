import { randomBytes } from 'crypto';
import { mkdir, stat } from 'fs/promises';
import path from 'path';

import { createId } from '@paralleldrive/cuid2';
import { and, eq, gt, isNotNull, lt, sql } from 'drizzle-orm';

import { db, exportJobs as exportJobsTable } from '../db/client.js';
import type { ExportJob } from '../db/schema.js';

import { buildWorkbookFile } from './excel-builder.js';
import {
  CreateExportJobParams,
  ExcelExportJob,
  ExcelExportLocations,
  ExcelExportRequest,
  ExcelExportScope,
  WorkbookPayload,
  WorkbookSheetDefinition,
} from './types.js';

function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function signedUrlTtlSeconds(): number {
  const parsed = Number(process.env.EXPORT_SIGNED_URL_TTL_SECONDS || '900');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 900;
}

function exportRootDir(): string {
  return path.resolve(process.cwd(), 'tmp', 'exports');
}

function isWorkbookPayload(value: unknown): value is WorkbookPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { sheets?: unknown };
  return Array.isArray(candidate.sheets) && candidate.sheets.length > 0;
}

export function normalizeExportScope(value: string | undefined): ExcelExportScope {
  return value === 'full_period' ? 'full_period' : 'current_view';
}

export function normalizeExportLocations(value: string | undefined): ExcelExportLocations {
  return value === 'all_accessible' ? 'all_accessible' : 'current';
}

function parseTenantAllowlist(raw: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [userId, tenantId] = entry.split(':').map((part) => part.trim());
      if (!userId || !tenantId) return;
      const existing = result.get(userId) || new Set<string>();
      existing.add(tenantId);
      result.set(userId, existing);
    });
  return result;
}

export function canAccessTenant(userId: string, tenantId: string): boolean {
  if (process.env.EXPORT_ALLOW_ANY_TENANT === 'true') return true;
  if (tenantId === userId) return true;

  const allowlist = parseTenantAllowlist(process.env.EXPORT_TENANT_ALLOWLIST || '');
  const allowedTenants = allowlist.get(userId);
  return Boolean(allowedTenants && allowedTenants.has(tenantId));
}

function assertTenantAccess(userId: string, tenantId: string): void {
  if (!canAccessTenant(userId, tenantId)) {
    throw new Error(`User ${userId} is not authorized for tenant ${tenantId}`);
  }
}

function monthlyPeriodLabel(req: ExcelExportRequest, scope: ExcelExportScope): string {
  if (scope === 'full_period') return req.date_start && req.date_end ? `${req.date_start}..${req.date_end}` : 'full_period';
  if (req.date_start && req.date_end) return `${req.date_start}..${req.date_end}`;
  return req.date_start || req.date_end || 'current_view';
}

function defaultWorkbookPayload(
  tenantId: string,
  userId: string,
  scope: ExcelExportScope,
  locations: ExcelExportLocations,
  req: ExcelExportRequest
): WorkbookPayload {
  const period = monthlyPeriodLabel(req, scope);
  const created = new Date().toISOString();
  const locationLabel = locations === 'all_accessible' ? 'all_accessible' : 'current';

  const sheets: WorkbookSheetDefinition[] = [
    {
      name: 'README',
      headers: ['field', 'value'],
      col_widths: [24, 100],
      rows: [
        ['tenant_id', tenantId],
        ['requested_by_user_id', userId],
        ['generated_utc', created],
        ['scope', scope],
        ['locations', locationLabel],
        ['period', period],
        ['scenario_id', req.scenario_id || 'none'],
        ['workbook_style', 'standard-export'],
      ],
    },
    {
      name: 'Summary',
      headers: ['category', 'label', 'value', 'notes'],
      col_widths: [20, 28, 18, 60],
      rows: [
        ['example', 'placeholder label', 0, 'Replace with real summary rows'],
      ],
    },
    {
      name: 'Detail',
      headers: ['id', 'category', 'label', 'period', 'value', 'notes'],
      col_widths: [12, 20, 28, 22, 18, 60],
      rows: [
        ['1', 'example', 'placeholder label', period, 0, 'Replace with real detail rows'],
      ],
    },
  ];

  if (locations === 'all_accessible') {
    sheets.push({
      name: 'Location_Comparison',
      headers: ['rank', 'location', 'period', 'category', 'value', 'notes'],
      col_widths: [8, 24, 22, 20, 18, 60],
      rows: [
        [1, 'location_a', period, 'example', 0, 'Replace with real location rows'],
        [2, 'location_b', period, 'example', 0, 'Replace with real location rows'],
      ],
    });
  }

  return { sheets };
}

function buildDownloadUrl(baseUrl: string, token: string): string {
  return `${sanitizeBaseUrl(baseUrl)}/api/v1/exports/download/${token}`;
}

/** Convert a DB row to the ExcelExportJob API shape. */
function toExcelExportJob(row: ExportJob): ExcelExportJob {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    status: row.status,
    scope: row.scope,
    locations: row.locations,
    dateStart: row.dateStart ?? undefined,
    dateEnd: row.dateEnd ?? undefined,
    scenarioId: row.scenarioId ?? undefined,
    filePath: row.filePath ?? undefined,
    fileName: row.fileName ?? undefined,
    fileSizeBytes: row.fileSizeBytes ?? undefined,
    error: row.error ?? undefined,
    downloadToken: row.downloadToken ?? undefined,
    downloadExpiresAt: row.downloadExpiresAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createExcelExportJob(params: CreateExportJobParams): Promise<{ job: ExcelExportJob; downloadUrl: string }> {
  assertTenantAccess(params.userId, params.tenantId);

  const scope = normalizeExportScope(params.request.scope);
  const locations = normalizeExportLocations(params.request.locations);
  const fileId = createId();
  const fileName = `export-${params.tenantId}-${fileId}.xlsx`;
  const outputDir = path.join(exportRootDir(), params.tenantId);
  const outputPath = path.join(outputDir, fileName);

  const [insertedJob] = await db.insert(exportJobsTable).values({
    userId: params.userId,
    tenantId: params.tenantId,
    status: 'pending',
    scope,
    locations,
    dateStart: params.request.date_start,
    dateEnd: params.request.date_end,
    scenarioId: params.request.scenario_id,
    filePath: outputPath,
    fileName,
  }).returning();

  try {
    await mkdir(outputDir, { recursive: true });
    const workbook = isWorkbookPayload(params.request.workbook_data)
      ? params.request.workbook_data
      : defaultWorkbookPayload(params.tenantId, params.userId, scope, locations, params.request);

    await buildWorkbookFile({
      outputPath,
      workbook,
    });

    const fileStats = await stat(outputPath);
    const token = randomBytes(24).toString('hex');
    const ttlMs = signedUrlTtlSeconds() * 1000;
    const downloadExpiresAt = new Date(Date.now() + ttlMs);
    const downloadUrl = buildDownloadUrl(params.baseUrl, token);

    const [completedJob] = await db.update(exportJobsTable)
      .set({
        status: 'completed' as const,
        fileSizeBytes: fileStats.size,
        downloadToken: token,
        downloadExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(exportJobsTable.id, insertedJob.id))
      .returning();

    return { job: toExcelExportJob(completedJob), downloadUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(exportJobsTable)
      .set({
        status: 'failed' as const,
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(exportJobsTable.id, insertedJob.id));
    throw error;
  }
}

export async function getExcelExportJobForUser(userId: string, tenantId: string, exportId: string): Promise<ExcelExportJob | null> {
  assertTenantAccess(userId, tenantId);

  const [row] = await db.select().from(exportJobsTable)
    .where(and(
      eq(exportJobsTable.id, exportId),
      eq(exportJobsTable.userId, userId),
      eq(exportJobsTable.tenantId, tenantId),
    ));

  if (!row) return null;
  return toExcelExportJob(row);
}

export async function resolveDownloadToken(token: string): Promise<{ job: ExcelExportJob; filePath: string } | null> {
  const [row] = await db.select().from(exportJobsTable)
    .where(and(
      eq(exportJobsTable.downloadToken, token),
      eq(exportJobsTable.status, 'completed'),
      gt(exportJobsTable.downloadExpiresAt, sql`now()`),
    ));

  if (!row || !row.filePath) return null;
  return { job: toExcelExportJob(row), filePath: row.filePath };
}

export async function cleanupExpiredExports(): Promise<number> {
  const result = await db.delete(exportJobsTable)
    .where(and(
      isNotNull(exportJobsTable.downloadExpiresAt),
      lt(exportJobsTable.downloadExpiresAt, sql`now()`),
    ))
    .returning({ id: exportJobsTable.id });
  return result.length;
}
