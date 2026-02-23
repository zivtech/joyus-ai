import { randomBytes } from 'crypto';
import { mkdir, stat } from 'fs/promises';
import path from 'path';

import { createId } from '@paralleldrive/cuid2';

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

const exportJobs = new Map<string, ExcelExportJob>();
const downloadTokenToJob = new Map<string, { jobId: string; expiresAtMs: number }>();

function nowIso(): string {
  return new Date().toISOString();
}

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
  const created = nowIso();
  const locationLabel = locations === 'all_accessible' ? 'all_accessible' : 'current';
  const managerNote = 'Manager baseline: $25/hr, 40 hrs/week';

  const sheets: WorkbookSheetDefinition[] = [
    {
      name: 'README',
      headers: ['field', 'value'],
      col_widths: [24, 100],
      rows: [
        ['feature_set', 'joyus fast casual'],
        ['tenant_id', tenantId],
        ['requested_by_user_id', userId],
        ['generated_utc', created],
        ['scope', scope],
        ['locations', locationLabel],
        ['period', period],
        ['scenario_id', req.scenario_id || 'none'],
        ['workbook_style', 'operator-oriented values workbook'],
      ],
    },
    {
      name: 'KPI_Summary',
      headers: [
        'location',
        'period',
        'weekly_revenue',
        'weekly_labor',
        'weekly_gp_72',
        'weekly_labor_pct',
        'monday_revenue',
        'monday_labor',
      ],
      col_widths: [20, 22, 16, 16, 16, 14, 16, 16],
      formats: {
        weekly_revenue: '"$"#,##0.00',
        weekly_labor: '"$"#,##0.00',
        weekly_gp_72: '"$"#,##0.00',
        weekly_labor_pct: '0.00%',
        monday_revenue: '"$"#,##0.00',
        monday_labor: '"$"#,##0.00',
      },
      rows: [['placeholder', period, 0, 0, 0, 0, 0, 0]],
    },
    {
      name: 'Staffing_Plan',
      headers: ['location', 'category', 'rule', 'value', 'detail'],
      col_widths: [20, 16, 26, 18, 72],
      rows: [
        ['all', 'manager', 'manager_hours_weekly', 40, managerNote],
        ['all', 'coverage', 'opening_min_staff', 1, 'One person opening allowed'],
        ['all', 'coverage', 'closing_min_staff', 2, 'Two people required at close'],
        ['all', 'shift_design', 'core_shift_hours', '7-8', 'Full-day blocks for core team'],
      ],
    },
    {
      name: 'Daypart_Hourly',
      headers: ['location', 'period', 'hour_24', 'avg_revenue', 'avg_labor', 'avg_gp_72', 'labor_pct'],
      col_widths: [20, 22, 10, 14, 14, 14, 12],
      formats: {
        avg_revenue: '"$"#,##0.00',
        avg_labor: '"$"#,##0.00',
        avg_gp_72: '"$"#,##0.00',
        labor_pct: '0.00%',
      },
      rows: [['placeholder', period, 18, 0, 0, 0, 0]],
    },
    {
      name: 'Seasonal_Triggers',
      headers: ['location', 'transition', 'metric', 'operator', 'threshold', 'current_value', 'met'],
      col_widths: [20, 24, 22, 10, 12, 14, 8],
      rows: [['placeholder', 'winter_to_spring', 'avg_daily_revenue', '>=', 0, 0, 'NO']],
    },
    {
      name: 'Daily_Raw',
      headers: [
        'location',
        'period',
        'weekday',
        'days_in_month_for_weekday',
        'avg_revenue',
        'avg_labor',
        'avg_gp_72',
        'labor_pct',
      ],
      col_widths: [20, 22, 12, 20, 14, 14, 14, 12],
      formats: {
        avg_revenue: '"$"#,##0.00',
        avg_labor: '"$"#,##0.00',
        avg_gp_72: '"$"#,##0.00',
        labor_pct: '0.00%',
      },
      rows: [['placeholder', period, 'Mon', 0, 0, 0, 0, 0]],
    },
    {
      name: 'Run_Costs',
      headers: ['model', 'profile', 'input_tokens', 'cached_input_tokens', 'output_tokens', 'estimated_cost_usd', 'notes'],
      col_widths: [16, 20, 14, 20, 14, 18, 40],
      formats: {
        estimated_cost_usd: '"$"#,##0.0000',
      },
      rows: [
        ['Deterministic', 'No LLM', 0, 0, 0, 0, 'No model usage required for baseline planning'],
        ['GPT-5 mini', 'Small Narrative', 12000, 0, 3000, 0.009, 'Optional narrative add-on'],
        ['GPT-5 mini', 'Medium Narrative', 40000, 10000, 8000, 0.0265, 'Optional narrative add-on'],
        ['GPT-5 mini', 'Large Narrative', 90000, 25000, 20000, 0.0626, 'Optional narrative add-on'],
      ],
    },
  ];

  if (locations === 'all_accessible') {
    sheets.push({
      name: 'Location_Benchmark',
      headers: ['rank', 'location', 'period', 'revenue', 'labor', 'gp_72', 'labor_pct'],
      col_widths: [8, 20, 22, 14, 14, 14, 12],
      formats: {
        revenue: '"$"#,##0.00',
        labor: '"$"#,##0.00',
        gp_72: '"$"#,##0.00',
        labor_pct: '0.00%',
      },
      rows: [
        [1, 'placeholder_a', period, 0, 0, 0, 0],
        [2, 'placeholder_b', period, 0, 0, 0, 0],
      ],
    });
  }

  return { sheets };
}

function cleanupExpiredDownloadTokens(): void {
  const now = Date.now();
  for (const [token, value] of downloadTokenToJob.entries()) {
    if (value.expiresAtMs <= now) {
      downloadTokenToJob.delete(token);
      const job = exportJobs.get(value.jobId);
      if (job) {
        job.downloadToken = undefined;
      }
    }
  }
}

function buildDownloadUrl(baseUrl: string, token: string): string {
  return `${sanitizeBaseUrl(baseUrl)}/api/v1/exports/download/${token}`;
}

export async function createExcelExportJob(params: CreateExportJobParams): Promise<{ job: ExcelExportJob; downloadUrl: string }> {
  assertTenantAccess(params.userId, params.tenantId);

  const scope = normalizeExportScope(params.request.scope);
  const locations = normalizeExportLocations(params.request.locations);
  const now = nowIso();
  const jobId = createId();
  const fileName = `joyus-fast-casual-export-${params.tenantId}-${jobId}.xlsx`;
  const outputDir = path.join(exportRootDir(), params.tenantId);
  const outputPath = path.join(outputDir, fileName);

  const initialJob: ExcelExportJob = {
    id: jobId,
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
    createdAt: now,
    updatedAt: now,
  };
  exportJobs.set(jobId, initialJob);

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
    const expiresAtMs = Date.now() + signedUrlTtlSeconds() * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const downloadUrl = buildDownloadUrl(params.baseUrl, token);

    downloadTokenToJob.set(token, { jobId, expiresAtMs });
    exportJobs.set(jobId, {
      ...initialJob,
      status: 'completed',
      fileSizeBytes: fileStats.size,
      downloadToken: token,
      downloadExpiresAt: expiresAtIso,
      updatedAt: nowIso(),
    });

    const completedJob = exportJobs.get(jobId);
    if (!completedJob) {
      throw new Error('Export job was not persisted.');
    }

    return { job: completedJob, downloadUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exportJobs.set(jobId, {
      ...initialJob,
      status: 'failed',
      error: message,
      updatedAt: nowIso(),
    });
    throw error;
  }
}

export function getExcelExportJobForUser(userId: string, tenantId: string, exportId: string): ExcelExportJob | null {
  assertTenantAccess(userId, tenantId);
  const job = exportJobs.get(exportId);
  if (!job) return null;
  if (job.userId !== userId || job.tenantId !== tenantId) return null;
  return job;
}

export function resolveDownloadToken(token: string): { job: ExcelExportJob; filePath: string } | null {
  cleanupExpiredDownloadTokens();

  const tokenRecord = downloadTokenToJob.get(token);
  if (!tokenRecord) return null;

  const job = exportJobs.get(tokenRecord.jobId);
  if (!job || !job.filePath || job.status !== 'completed') return null;
  return { job, filePath: job.filePath };
}

