/**
 * MCP ↔ Service IPC — T032
 *
 * Simple HTTP server on localhost for health checks and capture requests.
 * Port written to file so MCP server can discover it.
 */

import http from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getStateDir } from '../state/store.js';
import type { EventHandler } from './event-handler.js';
import type { EventType } from '../core/types.js';

export interface IpcServer {
  start(): Promise<number>;
  stop(): Promise<void>;
}

function getPortFilePath(stateDir: string): string {
  return path.join(stateDir, 'service.port');
}

export function createIpcServer(
  projectRoot: string,
  eventHandler: EventHandler,
): IpcServer {
  const stateDir = getStateDir(projectRoot);
  const startedAt = new Date().toISOString();
  let server: http.Server | null = null;

  return {
    async start(): Promise<number> {
      await mkdir(stateDir, { recursive: true });

      return new Promise((resolve, reject) => {
        server = http.createServer(async (req, res) => {
          try {
            if (req.method === 'GET' && req.url === '/health') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                status: 'running',
                pid: process.pid,
                startedAt,
                uptime: process.uptime(),
                lastCapture: eventHandler.lastCaptureTime,
              }));
              return;
            }

            if (req.method === 'POST' && req.url === '/capture') {
              let body = '';
              for await (const chunk of req) body += chunk;
              const parsed = body ? JSON.parse(body) : {};
              const event = parsed.event ?? 'manual';

              // Fire and forget — don't block the response
              eventHandler.handleEvent(event).catch(() => {});

              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ accepted: true, event }));
              return;
            }

            res.writeHead(404);
            res.end('Not Found');
          } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        });

        server.listen(0, '127.0.0.1', async () => {
          const addr = server!.address();
          if (!addr || typeof addr === 'string') {
            reject(new Error('Failed to get server address'));
            return;
          }
          const port = addr.port;
          await writeFile(getPortFilePath(stateDir), String(port), 'utf8');
          resolve(port);
        });

        server.on('error', reject);
      });
    },

    async stop(): Promise<void> {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      try {
        await unlink(getPortFilePath(stateDir));
      } catch {
        // Already removed
      }
    },
  };
}

// --- Client functions (used by MCP server) ---

export async function checkServiceHealth(stateDir: string): Promise<{ running: boolean; status?: Record<string, unknown> }> {
  try {
    const port = parseInt(await readFile(getPortFilePath(stateDir), 'utf8'), 10);
    if (isNaN(port)) return { running: false };

    const data = await httpGet(`http://127.0.0.1:${port}/health`, 2000);
    return { running: true, status: JSON.parse(data) };
  } catch {
    return { running: false };
  }
}

export async function requestCapture(stateDir: string, event?: EventType): Promise<boolean> {
  try {
    const port = parseInt(await readFile(getPortFilePath(stateDir), 'utf8'), 10);
    if (isNaN(port)) return false;

    await httpPost(`http://127.0.0.1:${port}/capture`, { event: event ?? 'manual' }, 2000);
    return true;
  } catch {
    return false;
  }
}

function httpGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpPost(url: string, body: unknown, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}
