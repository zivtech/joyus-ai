/**
 * Pipeline Tool Definitions
 *
 * MCP tool definitions for pipeline management, execution, review,
 * and template operations. Follows the same pattern as content-tools.ts.
 */

import { ToolDefinition } from './index.js';

export const pipelineTools: ToolDefinition[] = [
  // ── Pipeline Management ────────────────────────────────────────────────────

  {
    name: 'pipeline_create',
    description:
      'Create a new automated pipeline with trigger configuration and step definitions.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Pipeline name (1-200 chars)',
        },
        description: {
          type: 'string',
          description: 'Pipeline description (optional, max 2000 chars)',
        },
        triggerType: {
          type: 'string',
          enum: ['corpus_change', 'schedule_tick', 'manual_request'],
          description: 'Event type that triggers this pipeline',
        },
        triggerConfig: {
          type: 'object',
          description:
            'Trigger configuration. For schedule_tick: { type, cronExpression, timezone? }. For corpus_change: { type, corpusFilter? }. For manual_request: { type }.',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              stepType: {
                type: 'string',
                enum: [
                  'profile_generation',
                  'fidelity_check',
                  'content_generation',
                  'source_query',
                  'review_gate',
                  'notification',
                ],
              },
              config: { type: 'object' },
            },
            required: ['name', 'stepType', 'config'],
          },
          description: 'Ordered list of pipeline steps',
        },
        concurrencyPolicy: {
          type: 'string',
          enum: ['skip_if_running', 'queue', 'allow_concurrent'],
          description: 'Concurrency policy (default: skip_if_running)',
        },
      },
      required: ['name', 'triggerType', 'triggerConfig', 'steps'],
    },
  },

  {
    name: 'pipeline_list',
    description:
      'List automated pipelines for this tenant. Optionally filter by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'paused', 'disabled'],
          description: 'Filter by pipeline status (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 20, max: 100)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
      },
    },
  },

  {
    name: 'pipeline_trigger',
    description:
      'Manually trigger an active pipeline. Returns an event ID to track the execution.',
    inputSchema: {
      type: 'object',
      properties: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID to trigger',
        },
        payload: {
          type: 'object',
          description: 'Optional payload to pass to the pipeline trigger',
        },
      },
      required: ['pipelineId'],
    },
  },

  {
    name: 'pipeline_status',
    description:
      'Get details for a specific pipeline, including its step definitions.',
    inputSchema: {
      type: 'object',
      properties: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID',
        },
      },
      required: ['pipelineId'],
    },
  },

  {
    name: 'pipeline_history',
    description:
      'Get execution history for a pipeline. Optionally filter by execution status.',
    inputSchema: {
      type: 'object',
      properties: {
        pipelineId: {
          type: 'string',
          description: 'Pipeline ID',
        },
        status: {
          type: 'string',
          enum: [
            'pending',
            'running',
            'paused_at_gate',
            'paused_on_failure',
            'completed',
            'failed',
            'cancelled',
          ],
          description: 'Filter by execution status (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20, max: 100)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
      },
      required: ['pipelineId'],
    },
  },

  // ── Review ─────────────────────────────────────────────────────────────────

  {
    name: 'review_decide',
    description:
      'Approve or reject a pending review decision for a pipeline gate step.',
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: {
          type: 'string',
          description: 'Review decision ID',
        },
        status: {
          type: 'string',
          enum: ['approved', 'rejected'],
          description: 'Decision outcome',
        },
        feedback: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Reason for the decision' },
            category: {
              type: 'string',
              description: 'Feedback category (e.g., quality, accuracy)',
            },
            details: { type: 'string', description: 'Additional details' },
            suggestedAction: {
              type: 'string',
              description: 'Suggested follow-up action',
            },
          },
          required: ['reason', 'category'],
          description: 'Feedback details (required for rejections)',
        },
      },
      required: ['decisionId', 'status'],
    },
  },

  // ── Templates ──────────────────────────────────────────────────────────────

  {
    name: 'template_list',
    description:
      'List available pipeline templates. Includes built-in templates and tenant-specific templates.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by template category (optional)',
        },
      },
    },
  },

  {
    name: 'template_instantiate',
    description:
      'Create a new pipeline from a template, optionally overriding parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: {
          type: 'string',
          description: 'Template ID to instantiate',
        },
        name: {
          type: 'string',
          description: 'Name for the new pipeline',
        },
        parameterOverrides: {
          type: 'object',
          description:
            'Key-value overrides for template parameters (optional)',
        },
      },
      required: ['templateId', 'name'],
    },
  },
];
