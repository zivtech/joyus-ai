/**
 * Google Tool Definitions
 * Gmail, Drive, and Docs tools
 */

import { ToolDefinition } from './index.js';

export const googleTools: ToolDefinition[] = [
  // Gmail Tools
  {
    name: 'gmail_search',
    description: 'Search Gmail messages. Supports Gmail search operators like "from:user@example.com", "subject:meeting", "is:unread", "after:2024/01/01"',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query (supports Gmail search syntax)'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results (default: 10, max: 50)'
        },
        labelIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by label IDs (e.g., ["INBOX", "UNREAD"])'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'gmail_get_message',
    description: 'Get the full content of a specific email message by ID',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'Gmail message ID'
        },
        format: {
          type: 'string',
          enum: ['full', 'metadata', 'minimal'],
          description: 'Response format (default: full)'
        }
      },
      required: ['messageId']
    }
  },
  {
    name: 'gmail_get_thread',
    description: 'Get all messages in an email thread',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Gmail thread ID'
        }
      },
      required: ['threadId']
    }
  },
  {
    name: 'gmail_send',
    description: 'Send an email message',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address'
        },
        subject: {
          type: 'string',
          description: 'Email subject'
        },
        body: {
          type: 'string',
          description: 'Email body (plain text or HTML)'
        },
        cc: {
          type: 'string',
          description: 'CC recipients (comma-separated)'
        },
        isHtml: {
          type: 'boolean',
          description: 'Whether body is HTML (default: false)'
        }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'gmail_reply',
    description: 'Reply to an existing email thread',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'Thread ID to reply to'
        },
        body: {
          type: 'string',
          description: 'Reply body'
        },
        replyAll: {
          type: 'boolean',
          description: 'Reply to all recipients (default: false)'
        }
      },
      required: ['threadId', 'body']
    }
  },

  // Google Drive Tools
  {
    name: 'drive_search',
    description: 'Search for files in Google Drive. Supports Drive search syntax like "name contains \'report\'", "mimeType=\'application/pdf\'", "modifiedTime > \'2024-01-01\'"',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (name, content, or Drive search syntax)'
        },
        mimeType: {
          type: 'string',
          description: 'Filter by MIME type (e.g., "application/pdf", "application/vnd.google-apps.document")'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results (default: 10, max: 100)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'drive_get_file',
    description: 'Get metadata about a file in Google Drive',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'Google Drive file ID'
        }
      },
      required: ['fileId']
    }
  },
  {
    name: 'drive_list_folder',
    description: 'List files in a Google Drive folder',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: {
          type: 'string',
          description: 'Folder ID (use "root" for My Drive root)'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results (default: 50)'
        }
      },
      required: ['folderId']
    }
  },

  // Google Docs Tools
  {
    name: 'docs_get_content',
    description: 'Get the full text content of a Google Doc',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'Google Doc ID (from the URL)'
        }
      },
      required: ['documentId']
    }
  },
  {
    name: 'docs_get_document',
    description: 'Get a Google Doc with full structure (headings, lists, tables)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'Google Doc ID'
        }
      },
      required: ['documentId']
    }
  }
];
