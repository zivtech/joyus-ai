/**
 * SSE Streaming Utilities — WP02 (T018)
 *
 * Server-Sent Events (SSE) response helpers for streaming agent output
 * token-by-token to the client.
 *
 * Event types:
 *   token       — text chunk from the agent
 *   tool_call   — agent is invoking a tool
 *   tool_result — tool returned a result
 *   done        — response complete
 *   error       — unrecoverable error in the agent loop
 *
 * SSE format (per spec):
 *   event: <type>\n
 *   data: <JSON>\n
 *   \n
 *
 * Heartbeat: every 15 seconds, a `: heartbeat` comment is sent to keep the
 * connection alive through proxies that close idle connections.
 */

import type { Response } from 'express';

// ============================================================
// EVENT TYPES
// ============================================================

export type SseEventType = 'token' | 'tool_call' | 'tool_result' | 'done' | 'error';

export interface TokenEvent {
  text: string;
}

export interface ToolCallEvent {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  toolName: string;
  toolUseId: string;
  output: string;
  isError?: boolean;
}

export interface DoneEvent {
  sessionId: string;
  turnSequence: number;
}

export interface ErrorEvent {
  message: string;
  code?: string;
}

export type SseEventData = TokenEvent | ToolCallEvent | ToolResultEvent | DoneEvent | ErrorEvent;

// ============================================================
// SSE RESPONSE HELPER
// ============================================================

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * SseStream wraps an Express response for SSE delivery.
 *
 * Usage:
 *   const stream = new SseStream(res);
 *   stream.open();
 *   stream.send('token', { text: 'Hello' });
 *   stream.send('done', { sessionId, turnSequence: 3 });
 *   stream.close();
 */
export class SseStream {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly res: Response) {}

  /**
   * Set SSE headers and start the heartbeat timer.
   * Must be called before any send().
   */
  open(): void {
    if (this.closed) return;

    this.res.setHeader('Content-Type', 'text/event-stream');
    this.res.setHeader('Cache-Control', 'no-cache');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    this.res.flushHeaders();

    // Heartbeat comment every 15s — keeps connection alive through proxies
    this.heartbeatTimer = setInterval(() => {
      if (!this.closed) {
        this.writeRaw(': heartbeat\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Clean up if the client disconnects
    this.res.on('close', () => {
      this.cleanup();
    });
  }

  /**
   * Send an SSE event to the client.
   * No-ops if the stream has been closed (client disconnect or done).
   */
  send(type: SseEventType, data: SseEventData): void {
    if (this.closed) return;

    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    this.writeRaw(payload);
  }

  /**
   * Send a token event (text chunk).
   */
  sendToken(text: string): void {
    this.send('token', { text } satisfies TokenEvent);
  }

  /**
   * Send a tool_call event.
   */
  sendToolCall(toolName: string, toolUseId: string, input: Record<string, unknown>): void {
    this.send('tool_call', { toolName, toolUseId, input } satisfies ToolCallEvent);
  }

  /**
   * Send a tool_result event.
   */
  sendToolResult(toolName: string, toolUseId: string, output: string, isError?: boolean): void {
    this.send('tool_result', { toolName, toolUseId, output, isError } satisfies ToolResultEvent);
  }

  /**
   * Send the done event and close the stream.
   */
  done(sessionId: string, turnSequence: number): void {
    this.send('done', { sessionId, turnSequence } satisfies DoneEvent);
    this.close();
  }

  /**
   * Send an error event and close the stream.
   */
  error(message: string, code?: string): void {
    this.send('error', { message, code } satisfies ErrorEvent);
    this.close();
  }

  /**
   * Close the stream and stop the heartbeat timer.
   */
  close(): void {
    if (this.closed) return;
    this.cleanup();
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }

  /**
   * Whether the stream has been closed (by us or by client disconnect).
   */
  get isClosed(): boolean {
    return this.closed;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private writeRaw(raw: string): void {
    if (!this.res.writableEnded) {
      this.res.write(raw);
    }
  }

  private cleanup(): void {
    this.closed = true;
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ============================================================
// STATIC HELPER — create and open in one call
// ============================================================

/**
 * Create an already-opened SseStream from an Express response.
 * Convenience wrapper for route handlers.
 *
 * @example
 *   const stream = openSseStream(res);
 *   stream.sendToken('Hello');
 *   stream.done(sessionId, 1);
 */
export function openSseStream(res: Response): SseStream {
  const stream = new SseStream(res);
  stream.open();
  return stream;
}
