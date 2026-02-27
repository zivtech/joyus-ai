export type ExcelExportScope = 'current_view' | 'full_period';
export type ExcelExportLocations = 'current' | 'all_accessible';
export type ExcelExportStatus = 'pending' | 'completed' | 'failed';

export interface WorkbookSheetDefinition {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null>>;
  col_widths?: number[];
  formats?: Record<string, string>;
}

export interface WorkbookPayload {
  sheets: WorkbookSheetDefinition[];
}

export interface ExcelExportRequest {
  scope?: string;
  locations?: string;
  date_start?: string;
  date_end?: string;
  scenario_id?: string;
  workbook_data?: WorkbookPayload;
}

export interface ExcelExportJob {
  id: string;
  userId: string;
  tenantId: string;
  status: ExcelExportStatus;
  scope: ExcelExportScope;
  locations: ExcelExportLocations;
  dateStart?: string;
  dateEnd?: string;
  scenarioId?: string;
  filePath?: string;
  fileName?: string;
  fileSizeBytes?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  downloadToken?: string;
  downloadExpiresAt?: string;
}

export interface CreateExportJobParams {
  userId: string;
  tenantId: string;
  request: ExcelExportRequest;
  baseUrl: string;
}

