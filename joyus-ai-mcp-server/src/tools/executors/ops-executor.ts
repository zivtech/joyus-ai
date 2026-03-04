import { createExcelExportJob } from '../../exports/service.js';

interface OpsExecutorContext {
  userId: string;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(`Missing required parameter: ${key}`);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

export async function executeOpsTool(
  toolName: string,
  input: Record<string, unknown>,
  context: OpsExecutorContext
): Promise<unknown> {
  if (toolName !== 'ops_export_excel') {
    throw new Error(`Unsupported ops tool: ${toolName}`);
  }

  const tenantId = requireString(input, 'tenant_id');
  const scope = optionalString(input, 'scope');
  const locations = optionalString(input, 'locations');
  const dateStart = optionalString(input, 'date_start');
  const dateEnd = optionalString(input, 'date_end');
  const scenarioId = optionalString(input, 'scenario_id');

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  const { job, downloadUrl } = await createExcelExportJob({
    userId: context.userId,
    tenantId,
    baseUrl,
    request: {
      scope,
      locations,
      date_start: dateStart,
      date_end: dateEnd,
      scenario_id: scenarioId,
    },
  });

  return {
    export_id: job.id,
    tenant_id: job.tenantId,
    status: job.status,
    scope: job.scope,
    locations: job.locations,
    created_at: job.createdAt,
    expires_at: job.downloadExpiresAt,
    file_name: job.fileName,
    file_size_bytes: job.fileSizeBytes,
    download_url: downloadUrl,
  };
}

