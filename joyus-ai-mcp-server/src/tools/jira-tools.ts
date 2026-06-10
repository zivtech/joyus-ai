/**
 * Jira Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const jiraTools: ToolDefinition[] = [
  {
    name: 'jira_search_issues',
    description: 'Search Jira issues using JQL (Jira Query Language). Examples: "project = PROJ", "assignee = currentUser()", "status = \'In Progress\'"',
    inputSchema: {
      type: 'object',
      properties: {
        jql: {
          type: 'string',
          description: 'JQL query string'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results to return (default: 20, max: 100)'
        },
        startAt: {
          type: 'number',
          description: 'Zero-based result offset for pagination'
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to include (default: summary, status, assignee, priority)'
        },
        includeRawFields: {
          type: 'boolean',
          description: 'Return raw Jira issue fields for importer clients such as Docket'
        }
      },
      required: ['jql']
    }
  },
  {
    name: 'jira_get_issue',
    description: 'Get detailed information about a specific Jira issue by key (e.g., PROJ-123)',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'Issue key like PROJ-123'
        },
        expand: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional fields to expand (changelog, comments, etc.)'
        }
      },
      required: ['issueKey']
    }
  },
  {
    name: 'jira_get_my_issues',
    description: 'Get issues assigned to the current user, optionally filtered by status',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status (e.g., "In Progress", "To Do")'
        },
        project: {
          type: 'string',
          description: 'Filter by project key'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results (default: 20)'
        }
      }
    }
  },
  {
    name: 'jira_add_comment',
    description: 'Add a comment to a Jira issue',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'Issue key like PROJ-123'
        },
        comment: {
          type: 'string',
          description: 'Comment text (supports Jira markdown)'
        }
      },
      required: ['issueKey', 'comment']
    }
  },
  {
    name: 'jira_resolve_reviewers',
    description: 'Resolve remediation proposal reviewers from Jira issue metadata such as custom reviewer fields, assignee, and reporter',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'Issue key like PROJ-123'
        },
        reviewerFieldIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional Jira field IDs to check first, such as customfield_10010'
        },
        fallbackOrder: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reviewer source order using customFields, assignee, and reporter'
        }
      },
      required: ['issueKey']
    }
  },
  {
    name: 'jira_post_proposal_comment',
    description: 'Post a structured remediation proposal comment to a Jira issue for reviewer approval',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'Issue key like PROJ-123'
        },
        summary: {
          type: 'string',
          description: 'Short summary of the remediation proposal'
        },
        affectedComponents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Components or areas affected by the proposal'
        },
        proposedChanges: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific proposed remediation changes'
        },
        riskLevel: {
          type: 'string',
          description: 'Risk level for the proposed change'
        },
        approvalPrompt: {
          type: 'string',
          description: 'Question or instruction asking the reviewer for approval'
        },
        details: {
          type: 'string',
          description: 'Optional supporting details to include after the required sections'
        }
      },
      required: ['issueKey', 'summary', 'affectedComponents', 'proposedChanges', 'riskLevel', 'approvalPrompt']
    }
  },
  {
    name: 'jira_transition_issue',
    description: 'Move a Jira issue to a different status (e.g., "In Progress", "Done")',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: {
          type: 'string',
          description: 'Issue key like PROJ-123'
        },
        transitionName: {
          type: 'string',
          description: 'Target status name (e.g., "In Progress", "Done")'
        }
      },
      required: ['issueKey', 'transitionName']
    }
  },
  {
    name: 'jira_get_fields',
    description: 'List Jira field metadata available to the current OAuth connection',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'jira_list_projects',
    description: 'List all Jira projects accessible to the user',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: {
          type: 'number',
          description: 'Maximum results (default: 50)'
        }
      }
    }
  }
];
