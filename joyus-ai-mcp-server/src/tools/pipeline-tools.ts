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
      'Define and create a new automated workflow pipeline. Use when setting up recurring content generation, scheduled reports, corpus-change triggers that kick off profile updates, or any multi-step automation. Supports schedule (cron), corpus-change, and manual triggers.',
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
      'List all automated pipelines configured for this tenant. Use to see what workflows are active, find a pipeline ID before triggering or inspecting it, or audit the automation setup.',
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
      'Manually kick off a pipeline run on demand. Use when you want to run an automated workflow immediately rather than waiting for its scheduled or corpus-change trigger. Returns an event ID to poll for execution status.',
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
      'Get the full configuration for a specific pipeline, including trigger setup and step definitions. Use when you need to understand what a pipeline does, verify its setup, or look up details before updating or triggering it.',
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
      'Get the run history for a pipeline showing past executions and their outcomes. Use when diagnosing failures, checking whether a recent trigger fired correctly, or auditing how long executions typically take.',
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
      'Approve or reject AI-generated content paused at a human review gate in a pipeline. Use when a pipeline execution is in paused_at_gate status and requires a reviewer decision to continue or cancel. NOTE: this tool will be renamed pipeline_review_decide in a future release.',
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
      'Browse available pipeline templates to use as starting points for new automated workflows. Use when creating a pipeline and you want to start from a pre-built template rather than configuring from scratch. NOTE: this tool will be renamed pipeline_template_list in a future release.',
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
      'Create a new pipeline by instantiating a template. Use when setting up a standard workflow (weekly content brief, profile refresh, reviewed outreach) using a pre-built starting point rather than configuring from scratch. NOTE: this tool will be renamed pipeline_template_instantiate in a future release.',
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
