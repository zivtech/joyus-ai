/**
 * GitHub Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const githubTools: ToolDefinition[] = [
  {
    name: 'github_search_code',
    description: 'Search for code across GitHub repositories. Supports GitHub search qualifiers like "org:example-org", "language:python", "filename:package.json"',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Code search query (supports GitHub search syntax)'
        },
        org: {
          type: 'string',
          description: 'Limit to organization (e.g., "example-org")'
        },
        per_page: {
          type: 'number',
          description: 'Results per page (default: 30, max: 100)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'github_list_prs',
    description: 'List pull requests for a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format (e.g., "example-org/website")'
        },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by state (default: open)'
        },
        per_page: {
          type: 'number',
          description: 'Results per page (default: 30)'
        }
      },
      required: ['repo']
    }
  },
  {
    name: 'github_get_pr',
    description: 'Get detailed information about a specific pull request, including diff stats and review status',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format'
        },
        prNumber: {
          type: 'number',
          description: 'Pull request number'
        }
      },
      required: ['repo', 'prNumber']
    }
  },
  {
    name: 'github_create_pr',
    description: 'Create a pull request from an existing branch',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format (e.g., "example-org/example-app")'
        },
        head: {
          type: 'string',
          description: 'Head branch or owner:branch ref for the proposed changes'
        },
        base: {
          type: 'string',
          description: 'Base branch that the pull request targets'
        },
        title: {
          type: 'string',
          description: 'Pull request title'
        },
        body: {
          type: 'string',
          description: 'Pull request body in GitHub markdown'
        },
        draft: {
          type: 'boolean',
          description: 'Create the pull request as a draft'
        },
        maintainer_can_modify: {
          type: 'boolean',
          description: 'Allow maintainers with push access to modify the pull request branch'
        }
      },
      required: ['repo', 'head', 'base', 'title']
    }
  },
  {
    name: 'github_request_reviewers',
    description: 'Request user and team reviewers for a pull request',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format (e.g., "example-org/example-app")'
        },
        prNumber: {
          type: 'number',
          description: 'Pull request number'
        },
        reviewers: {
          type: 'array',
          description: 'GitHub usernames to request as reviewers',
          items: {
            type: 'string'
          }
        },
        teamReviewers: {
          type: 'array',
          description: 'GitHub team slugs to request as reviewers',
          items: {
            type: 'string'
          }
        }
      },
      required: ['repo', 'prNumber']
    }
  },
  {
    name: 'github_get_pr_checks',
    description: 'Get commit statuses and check runs for a pull request head commit',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format (e.g., "example-org/example-app")'
        },
        prNumber: {
          type: 'number',
          description: 'Pull request number'
        }
      },
      required: ['repo', 'prNumber']
    }
  },
  {
    name: 'github_list_issues',
    description: 'List issues for a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format'
        },
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Filter by state (default: open)'
        },
        labels: {
          type: 'string',
          description: 'Comma-separated list of labels to filter by'
        },
        per_page: {
          type: 'number',
          description: 'Results per page (default: 30)'
        }
      },
      required: ['repo']
    }
  },
  {
    name: 'github_get_issue',
    description: 'Get detailed information about a specific issue',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format'
        },
        issueNumber: {
          type: 'number',
          description: 'Issue number'
        }
      },
      required: ['repo', 'issueNumber']
    }
  },
  {
    name: 'github_list_repos',
    description: 'List repositories for an organization or user',
    inputSchema: {
      type: 'object',
      properties: {
        org: {
          type: 'string',
          description: 'Organization name (e.g., "example-org")'
        },
        type: {
          type: 'string',
          enum: ['all', 'public', 'private', 'forks', 'sources'],
          description: 'Repository type filter (default: all)'
        },
        per_page: {
          type: 'number',
          description: 'Results per page (default: 30)'
        }
      },
      required: ['org']
    }
  },
  {
    name: 'github_get_file',
    description: 'Get contents of a file from a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format'
        },
        path: {
          type: 'string',
          description: 'Path to the file (e.g., "src/index.js")'
        },
        ref: {
          type: 'string',
          description: 'Branch, tag, or commit SHA (default: default branch)'
        }
      },
      required: ['repo', 'path']
    }
  },
  {
    name: 'github_create_issue_comment',
    description: 'Add a comment to a GitHub issue or pull request',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format'
        },
        issueNumber: {
          type: 'number',
          description: 'Issue or PR number'
        },
        body: {
          type: 'string',
          description: 'Comment text (supports GitHub markdown)'
        }
      },
      required: ['repo', 'issueNumber', 'body']
    }
  }
];
