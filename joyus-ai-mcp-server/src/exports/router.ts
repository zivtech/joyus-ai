import { Router, Request, Response } from 'express';

import { requireBearerToken } from '../auth/middleware.js';
import { db, auditLogs } from '../db/client.js';
import { resolveTenantContext, sendTenantResolutionError, TenantResolutionError } from '../tenancy/resolver.js';

import { createExcelExportJob, getExcelExportJobForUser, resolveDownloadToken } from './service.js';
import { ExcelExportRequest } from './types.js';

function inferredBaseUrl(req: Request): string {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

async function writeAudit(
  userId: string,
  tool: string,
  input: Record<string, unknown>,
  success: boolean,
  duration: number,
  error?: string
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId,
      tool,
      input,
      success,
      duration,
      error,
    });
  } catch (auditError) {
    console.warn('Failed to persist export audit log', auditError);
  }
}

export const exportRouter = Router();

exportRouter.post('/tenants/:tenantId/exports/excel', requireBearerToken, async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const user = req.mcpUser;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as ExcelExportRequest;
  let tenantId = req.params.tenantId;

  try {
    const tenantContext = await resolveTenantContext(req, {
      db,
      requestedTenantId: tenantId,
      // Exports honor the EXPORT_* environment allowlist; the shared resolver
      // only applies it when a caller opts in (see resolver.ts).
      allowEnvironmentAllowlist: true,
    });
    if (!tenantContext.tenantId) {
      res.status(403).json({ error: 'tenant_required', message: 'Tenant-scoped export requests require a tenant' });
      return;
    }
    tenantId = tenantContext.tenantId;

    const { job, downloadUrl } = await createExcelExportJob({
      userId: user.id,
      tenantId,
      request: body,
      baseUrl: inferredBaseUrl(req),
      tenantAccessPreResolved: true,
    });

    await writeAudit(
      user.id,
      'ops_export_excel_api_create',
      {
        tenant_id: tenantId,
        scope: body.scope || 'current_view',
        locations: body.locations || 'current',
        scenario_id: body.scenario_id || null,
      },
      true,
      Date.now() - startedAt
    );

    res.status(201).json({
      export_id: job.id,
      tenant_id: job.tenantId,
      status: job.status,
      scope: job.scope,
      locations: job.locations,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      download_url: downloadUrl,
      expires_at: job.downloadExpiresAt,
      file_name: job.fileName,
      file_size_bytes: job.fileSizeBytes,
    });
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      sendTenantResolutionError(res, error);
      return;
    }

    const message = error instanceof Error ? error.message : 'Export generation failed';

    await writeAudit(
      user.id,
      'ops_export_excel_api_create',
      {
        tenant_id: tenantId,
        scope: body.scope || 'current_view',
        locations: body.locations || 'current',
        scenario_id: body.scenario_id || null,
      },
      false,
      Date.now() - startedAt,
      message
    );

    if (message.includes('not authorized')) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

exportRouter.get('/tenants/:tenantId/exports/:exportId', requireBearerToken, async (req: Request, res: Response) => {
  const user = req.mcpUser;
  const { exportId } = req.params;

  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const tenantContext = await resolveTenantContext(req, {
      db,
      requestedTenantId: req.params.tenantId,
      // Exports honor the EXPORT_* environment allowlist; the shared resolver
      // only applies it when a caller opts in (see resolver.ts).
      allowEnvironmentAllowlist: true,
    });
    if (!tenantContext.tenantId) {
      res.status(403).json({ error: 'tenant_required', message: 'Tenant-scoped export requests require a tenant' });
      return;
    }

    const job = getExcelExportJobForUser(user.id, tenantContext.tenantId, exportId, {
      tenantAccessPreResolved: true,
    });
    if (!job) {
      res.status(404).json({ error: 'Export not found' });
      return;
    }

    res.json({
      export_id: job.id,
      tenant_id: job.tenantId,
      status: job.status,
      scope: job.scope,
      locations: job.locations,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      expires_at: job.downloadExpiresAt,
      file_name: job.fileName,
      file_size_bytes: job.fileSizeBytes,
      error: job.error,
    });
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      sendTenantResolutionError(res, error);
      return;
    }

    const message = error instanceof Error ? error.message : 'Unable to fetch export';
    if (message.includes('not authorized')) {
      res.status(403).json({ error: message });
      return;
    }
    res.status(500).json({ error: message });
  }
});

exportRouter.get('/exports/download/:token', async (req: Request, res: Response) => {
  const token = req.params.token;
  const resolved = await resolveDownloadToken(token);

  if (!resolved) {
    res.status(404).json({ error: 'Download link is invalid or expired' });
    return;
  }

  const { filePath } = resolved;
  const fileName = resolved.fileName || `${resolved.jobId}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.download(filePath, fileName);
});
