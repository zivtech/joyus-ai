#!/usr/bin/env node

/**
 * Playwright MCP Server
 *
 * Exposes Playwright browser automation and Backstop.js visual regression
 * testing via the MCP protocol over HTTP.
 */

import http from 'node:http';
import { chromium } from 'playwright';

const PORT = parseInt(process.env.PORT || '3002', 10);

/**
 * Bearer token for authenticating incoming requests.
 * Set PLAYWRIGHT_AUTH_TOKEN in the environment before starting the server.
 */
const AUTH_TOKEN = process.env.PLAYWRIGHT_AUTH_TOKEN;

/** @type {import('playwright').Browser | null} */
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      // TODO: Remove --no-sandbox once the container runs as a non-root user.
      // The flag is required when Chromium is launched as root (default in many
      // base images) but should not be used in production deployments that run
      // as an unprivileged user.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

/**
 * Validate a file path argument to prevent command injection.
 * Rejects any path containing shell metacharacters.
 *
 * @param {string} value - The path value to validate.
 * @returns {string} The validated path.
 * @throws {Error} If the path contains disallowed characters.
 */
function validateConfigPath(value) {
  // Reject shell metacharacters that could enable command injection
  if (/[;|&$`\\'"<>(){}[\]!#~]/.test(value)) {
    throw new Error(`Invalid config path: contains disallowed characters`);
  }
  return value;
}

/**
 * Handle incoming tool requests
 */
async function handleToolCall(toolName, args) {
  switch (toolName) {
    case 'playwright_navigate': {
      const b = await getBrowser();
      const page = await b.newPage();
      try {
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const title = await page.title();
        const content = await page.content();
        return { title, url: args.url, contentLength: content.length };
      } finally {
        await page.close();
      }
    }

    case 'playwright_screenshot': {
      const b = await getBrowser();
      const page = await b.newPage();
      try {
        await page.goto(args.url, { waitUntil: 'networkidle', timeout: 60000 });
        const screenshot = await page.screenshot({
          fullPage: args.fullPage ?? true,
          type: 'png',
        });
        return {
          url: args.url,
          format: 'png',
          data: screenshot.toString('base64'),
          size: screenshot.length,
        };
      } finally {
        await page.close();
      }
    }

    case 'backstop_reference': {
      const { execFileSync } = await import('node:child_process');
      const configPath = validateConfigPath(args.config || '/app/backstop.json');
      const output = execFileSync('npx', ['backstop', 'reference', `--config=${configPath}`], {
        encoding: 'utf-8',
        timeout: 120000,
        cwd: '/app',
      });
      return { success: true, output };
    }

    case 'backstop_test': {
      const { execFileSync } = await import('node:child_process');
      const configPath = validateConfigPath(args.config || '/app/backstop.json');
      try {
        const output = execFileSync('npx', ['backstop', 'test', `--config=${configPath}`], {
          encoding: 'utf-8',
          timeout: 120000,
          cwd: '/app',
        });
        return { passed: true, output };
      } catch (err) {
        return { passed: false, output: err.stdout || err.message };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Authenticate a request using a Bearer token.
 * Returns true if the request is authorized, false otherwise.
 * The /health endpoint is intentionally exempt so orchestration infrastructure
 * can monitor liveness without credentials.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function isAuthorized(req) {
  if (!AUTH_TOKEN) {
    // No token configured — log a warning and allow the request so the server
    // remains functional during local development, but operators should always
    // set PLAYWRIGHT_AUTH_TOKEN in deployed environments.
    console.error('[playwright-server] WARNING: PLAYWRIGHT_AUTH_TOKEN is not set. All requests are accepted.');
    return true;
  }
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer (.+)$/i);
  return match !== null && match[1] === AUTH_TOKEN;
}

/**
 * HTTP server for MCP tool calls and health checks
 */
const server = http.createServer(async (req, res) => {
  // Health endpoint — exempt from auth so infrastructure probes work without credentials
  if (req.method === 'GET' && req.url === '/health') {
    const connected = browser?.isConnected() ?? false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'playwright',
      browserConnected: connected,
      uptime: process.uptime(),
    }));
    return;
  }

  // All non-health endpoints require a valid Bearer token
  if (!isAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  // Tool call endpoint
  if (req.method === 'POST' && req.url === '/tool') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const { tool, args } = JSON.parse(body);
        const result = await handleToolCall(tool, args || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // MCP tools list
  if (req.method === 'GET' && req.url === '/tools') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tools: [
        {
          name: 'playwright_navigate',
          description: 'Navigate to a URL and return page title and content length',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to navigate to' },
            },
            required: ['url'],
          },
        },
        {
          name: 'playwright_screenshot',
          description: 'Capture a screenshot of a web page',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to screenshot' },
              fullPage: { type: 'boolean', description: 'Capture full page', default: true },
            },
            required: ['url'],
          },
        },
        {
          name: 'backstop_reference',
          description: 'Capture Backstop.js reference screenshots',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'string', description: 'Path to backstop.json config' },
            },
          },
        },
        {
          name: 'backstop_test',
          description: 'Run Backstop.js visual regression test against reference',
          inputSchema: {
            type: 'object',
            properties: {
              config: { type: 'string', description: 'Path to backstop.json config' },
            },
          },
        },
      ],
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Graceful shutdown
async function shutdown() {
  console.error('[playwright-server] Shutting down...');
  if (browser) {
    await browser.close().catch(() => {});
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => {
  console.error(`[playwright-server] Listening on port ${PORT}`);
});
