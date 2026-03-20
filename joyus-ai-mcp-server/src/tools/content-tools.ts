/**
 * Content Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const contentTools: ToolDefinition[] = [
  // ── Source Management ──────────────────────────────────────────────────────

  {
    name: 'content_list_sources',
    description: 'List data sources (websites, document libraries, knowledge bases) connected to this tenant. Use when setting up a pipeline, checking what content is available for search or generation, or auditing connected sources.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'syncing', 'error', 'disconnected'],
          description: 'Filter sources by status (optional)'
        }
      }
    }
  },

  {
    name: 'content_get_source',
    description: 'Get configuration and sync history for a specific content source. Use when diagnosing sync failures, checking when content was last updated, or verifying source connectivity.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Content source ID'
        }
      },
      required: ['sourceId']
    }
  },

  {
    name: 'content_sync_source',
    description: 'Force a content source to re-sync immediately, pulling the latest documents into the content corpus. Use when content has been updated externally and you need it available for search or generation before the next scheduled sync.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'Content source ID to sync'
        }
      },
      required: ['sourceId']
    }
  },

  {
    name: 'content_get_sync_status',
    description: 'Check whether a content sync has completed and see what was ingested, updated, or failed. Use to poll progress after triggering a manual sync.',
    inputSchema: {
      type: 'object',
      properties: {
        syncRunId: {
          type: 'string',
          description: 'Sync run ID to check'
        }
      },
      required: ['syncRunId']
    }
  },

  // ── Search ─────────────────────────────────────────────────────────────────

  {
    name: 'content_search',
    description: 'Search the content corpus for documents, articles, or knowledge items matching a query. Use when finding source material to ground a response, locating relevant documents for a pipeline, or retrieving information from connected knowledge bases.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        sourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict search to specific source IDs (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 10)'
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)'
        }
      },
      required: ['query']
    }
  },

  {
    name: 'content_get_item',
    description: 'Retrieve the full content of a specific document or item from the corpus by ID. Use after a search to read the complete text of a result, or to fetch a known document for use in generation.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'string',
          description: 'Content item ID'
        }
      },
      required: ['itemId']
    }
  },

  // ── Entitlements ───────────────────────────────────────────────────────────

  {
    name: 'content_resolve_entitlements',
    description: 'Determine which content collections and knowledge bases the current user is authorized to access. Use when checking permissions before searching or generating content, or when a user reports missing or inaccessible content.',
    inputSchema: {
      type: 'object',
      properties: {
        forceRefresh: {
          type: 'boolean',
          description: 'Force re-evaluation even if cached entitlements exist (optional)'
        }
      }
    }
  },

  {
    name: 'content_list_products',
    description: 'List the content collections and knowledge base packages available to this tenant. Use to understand what data is licensed or configured for use in search and generation.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // ── Generation ─────────────────────────────────────────────────────────────

  {
    name: 'content_generate',
    description: 'Generate an AI-written response, summary, or document grounded in the tenant\'s content corpus with citations to source materials. Use when producing content that must be based on specific organizational knowledge rather than general AI knowledge. Supports voice profile application for brand-consistent, attribution-accurate output.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'User query to answer'
        },
        profileId: {
          type: 'string',
          description: 'Profile ID to apply voice/style (optional)'
        },
        sourceIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Restrict generation to specific source IDs (optional)'
        },
        maxSources: {
          type: 'number',
          description: 'Maximum number of source items to include (default: 5)'
        }
      },
      required: ['query']
    }
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────

  {
    name: 'content_state_dashboard',
    description: 'Get a health-check overview of the content corpus: source counts by sync status, total items, stale content, and recent sync activity. Use for monitoring content freshness or diagnosing why search results seem outdated.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // ── Drift ──────────────────────────────────────────────────────────────────

  {
    name: 'content_drift_report',
    description: 'Get a quality drift report showing whether AI-generated content is diverging from a voice profile over time. Use when monitoring content fidelity, diagnosing output quality degradation, or auditing whether generated content still matches the intended author voice.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: {
          type: 'string',
          description: 'Profile ID to retrieve drift reports for'
        },
        windowDays: {
          type: 'number',
          description: 'Number of days to look back (default: 7)'
        }
      },
      required: ['profileId']
    }
  },

  {
    name: 'content_drift_summary',
    description: 'Get a summary of voice and quality drift across all profiles for this tenant. Use for a high-level fidelity health check — surfaces which profiles are degrading and need attention.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
