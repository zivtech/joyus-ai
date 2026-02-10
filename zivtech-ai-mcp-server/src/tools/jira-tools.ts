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
          description: 'Maximum results to return (default: 20, max: 50)'
        },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to include (default: summary, status, assignee, priority)'
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
