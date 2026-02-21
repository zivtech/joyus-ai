/**
 * Content Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const contentTools: ToolDefinition[] = [
  // ── Source Management ──────────────────────────────────────────────────────

  {
    name: 'content_list_sources',
    description: 'List content sources configured for this tenant. Optionally filter by status.',
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
    description: 'Get details for a specific content source, including recent sync runs.',
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
    description: 'Trigger a manual sync for a content source. Returns a sync run ID to track progress.',
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
    description: 'Get the status and details of a specific sync run.',
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
    description: 'Search content items across accessible sources using full-text search.',
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
    description: 'Get a specific content item by ID.',
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
    description: 'Resolve which content products the current user is entitled to access.',
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
    description: 'List content products accessible to this tenant.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // ── Generation ─────────────────────────────────────────────────────────────

  {
    name: 'content_generate',
    description: 'Generate a response to a query grounded in content sources, with citations.',
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
    description: 'Get an overview of content state: source counts by status, item totals, stale items, and recent sync activity.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // ── Drift ──────────────────────────────────────────────────────────────────

  {
    name: 'content_drift_report',
    description: 'Get drift report(s) for a specific profile showing how generated content deviates from the profile voice.',
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
    description: 'Get an aggregated drift overview across all profiles for this tenant.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
