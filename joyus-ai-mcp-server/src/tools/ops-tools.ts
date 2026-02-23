/**
 * Joyus Fast Casual Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const opsTools: ToolDefinition[] = [
  {
    name: 'ops_export_excel',
    description:
      'Generate a Joyus Fast Casual operator workbook (.xlsx) and return a signed download URL. Supports current-view or full-period scope.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant identifier',
        },
        scope: {
          type: 'string',
          enum: ['current_view', 'full_period'],
          description: 'Export scope. Defaults to current_view.',
        },
        locations: {
          type: 'string',
          enum: ['current', 'all_accessible'],
          description: 'Location scope. Defaults to current.',
        },
        date_start: {
          type: 'string',
          description: 'Optional start date in YYYY-MM-DD',
        },
        date_end: {
          type: 'string',
          description: 'Optional end date in YYYY-MM-DD',
        },
        scenario_id: {
          type: 'string',
          description: 'Optional scenario identifier',
        },
      },
      required: ['tenant_id'],
    },
  },
];

