/**
 * Zivtech AI MCP Server
 *
 * A remote MCP server that provides Claude Desktop with tools for:
 * - Jira (search, view, comment, transition)
 * - Slack (search, read, post)
 * - GitHub (search code, PRs, issues)
 * - Google (Gmail, Drive, Docs)
 *
 * Authentication: Bearer token (issued during Auth Portal onboarding)
 * Transport: Streamable HTTP (recommended for remote MCP servers)
 */

import cors from 'cors';
import { config } from 'dotenv';
import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';

import { authRouter } from './auth/routes.js';
import { getUserFromToken } from './auth/verify.js';
import { db, auditLogs } from './db/client.js';
import { initializeScheduler } from './scheduler/index.js';
import { taskRouter } from './scheduler/routes.js';
import { executeTool } from './tools/executor.js';
import { getAllTools } from './tools/index.js';

config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable for API
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For form submissions
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// Auth routes (OAuth callbacks, token management)
app.use('/auth', authRouter);

// Task management routes (scheduled tasks)
app.use('/tasks', taskRouter);

// MCP endpoint with Bearer token auth
app.post('/mcp', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);
  const user = await getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Handle MCP request
  const { method, params, id } = req.body;

  try {
    let result;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'zivtech-ai-mcp-server',
            version: '0.1.0'
          }
        };
        break;

      case 'tools/list': {
        const tools = await getAllTools(user.id);
        result = { tools };
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params;
        const startTime = Date.now();

        try {
          const toolResult = await executeTool(user.id, name, args || {});

          // Audit log
          await db.insert(auditLogs).values({
            userId: user.id,
            tool: name,
            input: args || {},
            success: true,
            duration: Date.now() - startTime
          });

          result = {
            content: [{ type: 'text', text: JSON.stringify(toolResult, null, 2) }]
          };
        } catch (toolError: unknown) {
          const errorMessage = toolError instanceof Error ? toolError.message : 'Unknown error';

          // Audit log failure
          await db.insert(auditLogs).values({
            userId: user.id,
            tool: name,
            input: args || {},
            success: false,
            error: errorMessage,
            duration: Date.now() - startTime
          });

          result = {
            content: [{ type: 'text', text: `Error: ${errorMessage}` }],
            isError: true
          };
        }
        break;
      }

      default:
        return res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }

    res.json({
      jsonrpc: '2.0',
      id,
      result
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('MCP error:', error);
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: errorMessage }
    });
  }
});

// SSE endpoint for streaming (optional, for future use)
app.get('/mcp/sse', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial connected event
  res.write(`event: connected\ndata: {"status": "ok"}\n\n`);

  // Keep connection alive
  const keepAlive = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
  });
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Zivtech AI MCP Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   MCP:    http://localhost:${PORT}/mcp`);
  console.log(`   Auth:   http://localhost:${PORT}/auth`);
  console.log(`   Tasks:  http://localhost:${PORT}/tasks`);

  // Initialize task scheduler
  try {
    await initializeScheduler();
  } catch (error) {
    console.error('Failed to initialize scheduler:', error);
  }
});

export { app };
