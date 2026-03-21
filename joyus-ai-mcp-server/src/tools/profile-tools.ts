/**
 * Profile Tool Definitions
 *
 * MCP tool definitions for the profiles module.
 * All 13 tools use the `profile_` prefix.
 * tenantId is NEVER accepted as input — it is always injected from the auth context.
 */

import { ToolDefinition } from './index.js';

export const profileTools: ToolDefinition[] = [
  // ── Profile Queries ────────────────────────────────────────────────────────

  {
    name: 'profile_list_profiles',
    description:
      'List active voice profiles for this tenant. Use to browse available profiles for generation, check which authors have profiles, or audit the profile inventory. Supports filtering by tier and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        tier: {
          type: 'string',
          enum: ['base', 'domain', 'specialized', 'contextual'],
          description: 'Filter profiles by tier (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum profiles to return (default: 50)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
      },
    },
  },

  {
    name: 'profile_get_profile',
    description:
      'Get a specific voice profile by identity string (e.g. "individual::author-001"). Optionally fetch a specific historical version. Use when inspecting profile details, checking fidelity scores, or verifying stylometric features.',
    inputSchema: {
      type: 'object',
      properties: {
        profileIdentity: {
          type: 'string',
          description: 'Profile identity string in {tier}::{name} format',
        },
        version: {
          type: 'number',
          description: 'Specific version number to fetch (omit for active version)',
        },
      },
      required: ['profileIdentity'],
    },
  },

  {
    name: 'profile_get_resolved',
    description:
      'Get the inheritance-merged (resolved) profile for a profile identity. Applies nearest-ancestor-wins merging across the full hierarchy. Use when you need the effective feature vector for generation or comparison. Results are cached; use forceRefresh to bypass the cache.',
    inputSchema: {
      type: 'object',
      properties: {
        profileIdentity: {
          type: 'string',
          description: 'Profile identity string to resolve',
        },
        forceRefresh: {
          type: 'boolean',
          description: 'Bypass the resolved profile cache and re-resolve from scratch (optional)',
        },
      },
      required: ['profileIdentity'],
    },
  },

  // ── Generation ─────────────────────────────────────────────────────────────

  {
    name: 'profile_generate',
    description:
      'Trigger profile generation from a corpus snapshot. Runs the stylometric engine for the specified authors and stores the resulting profile versions. Use when new corpus documents have been ingested and profiles need to be updated.',
    inputSchema: {
      type: 'object',
      properties: {
        corpusSnapshotId: {
          type: 'string',
          description: 'ID of the corpus snapshot to generate profiles from',
        },
        authorIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific author IDs to generate profiles for (omit for all authors)',
        },
        tier: {
          type: 'string',
          enum: ['base', 'domain', 'specialized', 'contextual'],
          description: 'Profile tier to assign to generated profiles (optional)',
        },
        parentProfileIdentity: {
          type: 'string',
          description: 'Parent profile identity for inheritance (optional)',
        },
      },
      required: ['corpusSnapshotId'],
    },
  },

  {
    name: 'profile_get_generation_status',
    description:
      'Check the status of a profile generation run. Use to poll progress after triggering generation via profile_generate. Returns run status, profiles completed, profiles failed, and any error message.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Generation run ID returned by profile_generate',
        },
      },
      required: ['runId'],
    },
  },

  // ── Versioning ─────────────────────────────────────────────────────────────

  {
    name: 'profile_version_history',
    description:
      'List all versions of a profile identity, ordered newest-first. Use when auditing profile evolution, identifying which version to roll back to, or understanding when a profile was last regenerated.',
    inputSchema: {
      type: 'object',
      properties: {
        profileIdentity: {
          type: 'string',
          description: 'Profile identity string',
        },
        limit: {
          type: 'number',
          description: 'Maximum versions to return (default: 20)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
      },
      required: ['profileIdentity'],
    },
  },

  {
    name: 'profile_rollback',
    description:
      'Roll back a profile to a specific previous version. The target version must be in rolled_back or archived status. The current active version becomes rolled_back. Use to revert a bad profile update.',
    inputSchema: {
      type: 'object',
      properties: {
        profileIdentity: {
          type: 'string',
          description: 'Profile identity string to roll back',
        },
        targetVersion: {
          type: 'number',
          description: 'Version number to restore as the active version',
        },
      },
      required: ['profileIdentity', 'targetVersion'],
    },
  },

  {
    name: 'profile_compare_versions',
    description:
      'Compare stylometric features between two versions of the same profile. Returns a delta report sorted by absolute change, showing which features shifted most between versions. Use for quality auditing or diagnosing drift after regeneration.',
    inputSchema: {
      type: 'object',
      properties: {
        profileIdentity: {
          type: 'string',
          description: 'Profile identity string',
        },
        versionA: {
          type: 'number',
          description: 'First (older) version number',
        },
        versionB: {
          type: 'number',
          description: 'Second (newer) version number',
        },
      },
      required: ['profileIdentity', 'versionA', 'versionB'],
    },
  },

  // ── Corpus ─────────────────────────────────────────────────────────────────

  {
    name: 'profile_list_documents',
    description:
      'List corpus documents available for profile generation. Optionally filter by author ID. Use to verify that documents were ingested successfully, check corpus coverage, or find documents attributed to a specific author.',
    inputSchema: {
      type: 'object',
      properties: {
        authorId: {
          type: 'string',
          description: 'Filter documents by author ID (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum documents to return (default: 20)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
      },
    },
  },

  {
    name: 'profile_list_snapshots',
    description:
      'List corpus snapshots for this tenant, ordered newest-first. Snapshots are immutable captures of the corpus at a point in time. Use to find the snapshot ID needed for profile_generate, or to audit when corpus captures were taken.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum snapshots to return (default: 20)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
      },
    },
  },

  {
    name: 'profile_intake_status',
    description:
      'Get recent intake operation logs for this tenant. Shows document ingestion history including stored, duplicate, and rejected document counts. Use to verify a recent ingest succeeded or to diagnose why documents are missing.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ── Hierarchy ──────────────────────────────────────────────────────────────

  {
    name: 'profile_get_hierarchy',
    description:
      'Get the full profile inheritance hierarchy for this tenant as a tree structure. Shows parent-child relationships between profile identities. Use to understand how profiles inherit from each other, or to visualize the organizational structure of voice profiles.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'profile_set_parent',
    description:
      'Set a parent-child inheritance relationship between two profile identities. The child profile will inherit stylometric features from the parent (nearest-ancestor-wins). Enforces acyclicity and maximum hierarchy depth. Use to build a profile hierarchy where organizational or domain profiles inform more specific ones.',
    inputSchema: {
      type: 'object',
      properties: {
        childIdentity: {
          type: 'string',
          description: 'Profile identity that will inherit from the parent',
        },
        parentIdentity: {
          type: 'string',
          description: 'Profile identity to inherit from',
        },
      },
      required: ['childIdentity', 'parentIdentity'],
    },
  },
];
