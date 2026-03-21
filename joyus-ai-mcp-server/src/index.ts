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
import { eq as eqOp, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { serve } from 'inngest/express';

import { requireBearerToken } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { getUserFromToken } from './auth/verify.js';
import { initializeContentModule } from './content/index.js';
import { db, auditLogs } from './db/client.js';
import { users } from './db/schema.js';
import {
  createEventAdapterRouter,
  createEventAdapterWebhookRouter,
  createTriggerRouter,
  createAdminRouter,
  AutomationForwarder,
  BufferDrainWorker,
  SchedulerService,
  SecretStoreResolver,
  TriggerForwarder,
} from './event-adapter/index.js';
import { createAllFunctions, inngest } from './inngest/index.js';
import { DecisionRecorder } from './pipelines/review/decision.js';
import { createPipelineRouter } from './pipelines/routes.js';
import { createStepRegistry } from './pipelines/steps/registry.js';
import { initializeProfiles } from './profiles/index.js';
import { initializeScheduler } from './scheduler/index.js';
import { taskRouter } from './scheduler/routes.js';
import { executeTool, setPipelineContext } from './tools/executor.js';
import { getAllTools } from './tools/index.js';

config();

const app = express();
const PORT = process.env.PORT || 3000;
const pipelineDb = db as unknown as NodePgDatabase;
const stepRegistry = createStepRegistry({});
const decisionRecorder = new DecisionRecorder(pipelineDb);
const pipelineRouter = createPipelineRouter({
  db: pipelineDb,
  stepRegistry,
  decisionRecorder,
});

setPipelineContext({ stepRegistry, decisionRecorder });

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable for API
}));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Event adapter webhook ingestion: must run before express.json() so the
// route's own raw-body collector can read the request stream for HMAC
// signature verification.
const eventAdapterSecretResolver = new SecretStoreResolver();
const eventAdapterForwarder = new TriggerForwarder();
const eventAdapterAutomationForwarder = new AutomationForwarder(pipelineDb);
const eventAdapterScheduler = new SchedulerService(pipelineDb);
const eventAdapterBufferDrainWorker = new BufferDrainWorker(
  pipelineDb,
  eventAdapterForwarder,
  {},
  eventAdapterAutomationForwarder,
);

app.use('/v1/events', createEventAdapterWebhookRouter({
  db: pipelineDb,
  secretResolver: eventAdapterSecretResolver,
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
const PLAYWRIGHT_MCP_BASE_URL = process.env.PLAYWRIGHT_MCP_BASE_URL ?? 'http://playwright:3002';
const PLAYWRIGHT_MCP_PROBE_TIMEOUT_MS = 2000;

interface PlaywrightMcpHealth {
  ok: boolean;
  status: number;
  endpoint: string;
  baseUrl: string;
  check: string;
  payload: Record<string, unknown>;
}

function describeFetchError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return {
      error: 'Playwright service is not reachable',
    };
  }

  const cause = err.cause as { code?: string; message?: string } | undefined;
  const causeCode = cause?.code;
  if (causeCode === 'ENOTFOUND') {
    return {
      error: 'Playwright service is not running or not resolvable',
      cause: causeCode,
    };
  }
  if (causeCode === 'ECONNREFUSED') {
    return {
      error: 'Playwright service is not accepting connections',
      cause: causeCode,
    };
  }
  if (err.name === 'AbortError') {
    return {
      error: 'Playwright service is not responding',
      cause: 'TIMEOUT',
    };
  }

  return {
    error: 'Playwright service is not reachable',
    cause: causeCode ?? err.message,
  };
}

async function checkPlaywrightMcp(): Promise<PlaywrightMcpHealth> {
  const endpoint = '/sse';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLAYWRIGHT_MCP_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(`${PLAYWRIGHT_MCP_BASE_URL}${endpoint}`, {
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      endpoint,
      baseUrl: PLAYWRIGHT_MCP_BASE_URL,
      check: 'mcp_sse_transport',
      payload: response.ok ? {} : { error: `${endpoint} returned HTTP ${response.status}` },
    };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      endpoint,
      baseUrl: PLAYWRIGHT_MCP_BASE_URL,
      check: 'mcp_sse_transport',
      payload: {
        ...describeFetchError(err),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

// Downstream Playwright MCP dependency check
app.get('/health/playwright', async (req, res) => {
  try {
    const health = await checkPlaywrightMcp();
    if (health.ok) {
      res.json({
        status: 'ok',
        service: 'playwright',
        check: health.check,
        baseUrl: health.baseUrl,
        endpoint: health.endpoint,
        ...health.payload,
      });
    } else {
      res.status(503).json({
        status: 'degraded',
        service: 'playwright',
        check: health.check,
        baseUrl: health.baseUrl,
        endpoint: health.endpoint,
        ...health.payload,
      });
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
    const health = await checkPlaywrightMcp();
    services.playwright = {
      status: health.ok ? 'ok' : 'degraded',
      check: health.check,
      baseUrl: health.baseUrl,
      endpoint: health.endpoint,
      ...health.payload,
    };
    if (!health.ok) allHealthy = false;
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

// Inngest event handler — Feature 010 evaluation spike
// No auth middleware: Inngest server signs requests via INNGEST_SIGNING_KEY
app.use('/api/inngest', serve({
  client: inngest,
  functions: createAllFunctions(stepRegistry, { db: pipelineDb }),
}));

// Content routes must be mounted before the generic /api bearer-token router.
// /api/mediation has its own two-layer API key + JWT auth.
try {
  await initializeContentModule(app, { db });
} catch (error) {
  console.error('Failed to initialize content module:', error);
}

// Pipeline routes (behind auth — spec WP08 T042: "relies on existing auth middleware")
app.use('/api', requireBearerToken, pipelineRouter);

// Trigger callback — no MCP bearer token; auth is via shared secret validated
// against automationDestinations.authSecretRef inside the route handler.
app.use('/v1/events', createTriggerRouter({ db: pipelineDb }));

// Admin UI — accepts any authenticated org user (Google OAuth session) or
// a one-time ?token= exchange for CLI/API access.
// TODO(#37): tighten to tenant-scoped view once multi-tenant identity is unified.
app.use('/event-adapter/admin', async (req: Request, res: Response, next: NextFunction) => {
  const session = req.session as { userId?: string; adminUserId?: string };

  // Primary: Google OAuth session (set by /auth after login)
  if (session.userId) {
    const [user] = await db.select().from(users).where(eqOp(users.id, session.userId)).limit(1);
    if (user) {
      req.mcpUser = { ...user, connections: [] };
      return next();
    }
  }

  // Fallback: one-time ?token= exchange → stored in session cookie
  if (req.query['token']) {
    const user = await getUserFromToken(String(req.query['token']));
    if (!user) { res.status(401).json({ error: 'Invalid token' }); return; }
    session.adminUserId = user.id;
    req.mcpUser = user;
    const url = new URL(req.originalUrl, 'http://localhost');
    url.searchParams.delete('token');
    res.redirect(url.pathname + (url.search || ''));
    return;
  }

  if (session.adminUserId) {
    const [user] = await db.select().from(users).where(eqOp(users.id, session.adminUserId)).limit(1);
    if (!user) { res.status(401).send('Session expired. <a href="/event-adapter/admin">Log in again</a>.'); return; }
    req.mcpUser = { ...user, connections: [] };
    return next();
  }

  res.status(401).send('Please <a href="/auth">sign in</a> first, or append <code>?token=&lt;your MCP token&gt;</code>.');
}, createAdminRouter({ db: pipelineDb }));

// Event adapter management routes (sources, schedules, events, health,
// automation, subscriptions, admin). Webhook ingestion is mounted
// earlier (before express.json) so HMAC verification gets raw bytes.
// requireBearerToken protects all management routes.
app.use('/v1/events', requireBearerToken, createEventAdapterRouter({
  db: pipelineDb,
  secretResolver: eventAdapterSecretResolver,
  forwarder: eventAdapterForwarder,
  scheduler: eventAdapterScheduler,
  bufferDrainWorker: eventAdapterBufferDrainWorker,
  automationForwarder: eventAdapterAutomationForwarder,
}));

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
const server = app.listen(PORT, async () => {
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

  // Event adapter background workers
  try {
    eventAdapterScheduler.start();
    await eventAdapterBufferDrainWorker.start();
  } catch (error) {
    console.error('Failed to initialize event adapter workers:', error);
  }

  // Initialize profiles module (failure is isolated — won't crash the server)
  try {
    const profilesModule = initializeProfiles(db);
    void profilesModule; // module reference retained; services are stateless
    console.log('   Profiles: initialized');
  } catch (error) {
    console.error('Failed to initialize profiles module:', error);
  }

  console.log(`   Mediation: http://localhost:${PORT}/api/mediation`);
  console.log(`   Pipelines: http://localhost:${PORT}/api/pipelines`);
  console.log(`   Inngest:   http://localhost:${PORT}/api/inngest`);
  console.log(`   Events:    http://localhost:${PORT}/v1/events`);

  // Graceful shutdown
  const shutdown = async () => {
    try {
      eventAdapterScheduler.stop();
      eventAdapterBufferDrainWorker.stop();
    } catch (error) {
      console.error('Error during event adapter shutdown:', error);
    }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error('Stop the existing local server, run `docker compose down`, or start this server with a different PORT.');
    console.error(`Example: PORT=3001 npm run dev`);
    process.exit(1);
  }

  throw error;
});

export { app };
