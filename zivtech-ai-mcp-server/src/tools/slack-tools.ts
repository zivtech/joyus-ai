/**
 * Slack Tool Definitions
 */

import { ToolDefinition } from './index.js';

export const slackTools: ToolDefinition[] = [
  {
    name: 'slack_search_messages',
    description: 'Search for messages across Slack. Supports Slack search modifiers like "from:@user", "in:#channel", "has:link"',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (supports Slack search syntax)'
        },
        count: {
          type: 'number',
          description: 'Number of results (default: 20, max: 100)'
        },
        sort: {
          type: 'string',
          enum: ['score', 'timestamp'],
          description: 'Sort order (default: score)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'slack_get_channel_history',
    description: 'Get recent messages from a specific Slack channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name (e.g., "general") or channel ID'
        },
        limit: {
          type: 'number',
          description: 'Number of messages (default: 50, max: 100)'
        },
        oldest: {
          type: 'string',
          description: 'Only messages after this timestamp (Unix timestamp)'
        }
      },
      required: ['channel']
    }
  },
  {
    name: 'slack_post_message',
    description: 'Send a message to a Slack channel',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name (e.g., "general") or channel ID'
        },
        text: {
          type: 'string',
          description: 'Message text (supports Slack mrkdwn formatting)'
        },
        thread_ts: {
          type: 'string',
          description: 'Thread timestamp to reply in thread (optional)'
        }
      },
      required: ['channel', 'text']
    }
  },
  {
    name: 'slack_list_channels',
    description: 'List public channels the user has access to',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum channels to return (default: 100)'
        },
        types: {
          type: 'string',
          description: 'Channel types: public_channel, private_channel, mpim, im (default: public_channel)'
        }
      }
    }
  },
  {
    name: 'slack_get_user_info',
    description: 'Get information about a Slack user',
    inputSchema: {
      type: 'object',
      properties: {
        user: {
          type: 'string',
          description: 'User ID or @mention (e.g., "@john")'
        }
      },
      required: ['user']
    }
  },
  {
    name: 'slack_get_thread',
    description: 'Get all replies in a Slack thread',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel containing the thread'
        },
        thread_ts: {
          type: 'string',
          description: 'Thread parent message timestamp'
        }
      },
      required: ['channel', 'thread_ts']
    }
  }
];
