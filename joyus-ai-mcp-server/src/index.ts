/**
 * Joyus AI MCP Server
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

import { sql } from 'drizzle-orm';

import { authRouter } from './auth/routes.js';
import { requireBearerToken } from './auth/middleware.js';
import { db, auditLogs } from './db/client.js';
import { initializeContentModule } from './content/index.js';
import { createPipelineRouter } from './pipelines/routes.js';
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

// --- Health check endpoints ---

const startTime = Date.now();

// Platform self-check
app.get('/health/platform', (req, res) => {
  res.json({
    status: 'ok',
    service: 'platform',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    version: '0.1.0',
  });
});

// Database check
app.get('/health/db', async (req, res) => {
  try {
    const result = await db.execute(sql`SELECT 1 AS ok`);
    res.json({
      status: 'ok',
      service: 'database',
      connections_active: result ? 1 : 0,
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      service: 'database',
      error: err instanceof Error ? err.message : 'Connection failed',
    });
  }
});

// Playwright container check
app.get('/health/playwright', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('http://playwright:3002/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      const payload = typeof data === 'object' && data !== null ? data : {};
      res.json({ status: 'ok', service: 'playwright', ...payload });
    } else {
      res.status(503).json({ status: 'degraded', service: 'playwright', error: `HTTP ${response.status}` });
    }
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      service: 'playwright',
      error: err instanceof Error ? err.message : 'Unreachable',
    });
  }
});

// Aggregated health (returns 200 if all healthy, 503 if any degraded)
app.get('/health', async (req, res) => {
  const services: Record<string, { status: string; [key: string]: unknown }> = {};
  let allHealthy = true;

  // Platform
  services.platform = {
    status: 'ok',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  };

  // Database
  try {
    await db.execute(sql`SELECT 1`);
    services.database = { status: 'ok' };
  } catch {
    services.database = { status: 'degraded' };
    allHealthy = false;
  }

  // Playwright
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch('http://playwright:3002/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    services.playwright = { status: response.ok ? 'ok' : 'degraded' };
    if (!response.ok) allHealthy = false;
  } catch {
    services.playwright = { status: 'degraded' };
    allHealthy = false;
  }

  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json({
    status: allHealthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    services,
  });
});

// Auth routes (OAuth callbacks, token management)
app.use('/auth', authRouter);

// Task management routes (scheduled tasks)
app.use('/tasks', taskRouter);

// Automated pipeline pilot routes (auth required)
app.use('/pipelines', requireBearerToken, createPipelineRouter());

// MCP endpoint with Bearer token auth
app.post('/mcp', requireBearerToken, async (req: Request, res: Response) => {
  const user = req.mcpUser!;

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
            name: 'jawn-ai-mcp-server',
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
app.get('/mcp/sse', requireBearerToken, async (req: Request, res: Response) => {
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
  console.log(`🚀 Joyus AI MCP Server running on port ${PORT}`);
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

  // Initialize content module (failure is isolated — won't crash the server)
  try {
    await initializeContentModule(app, { db });
  } catch (error) {
    console.error('Failed to initialize content module:', error);
  }
});

export { app };
