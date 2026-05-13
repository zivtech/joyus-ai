/**
 * Unit tests for SseStream (WP02 — T018)
 *
 * Tests the SSE response helper:
 *   - send() writes correct event format
 *   - sendToken(), sendToolCall(), sendToolResult() format events correctly
 *   - done() sends done event and closes stream
 *   - error() sends error event and closes stream
 *   - close() prevents further writes
 *   - heartbeat timer is cleared on close
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SseStream, openSseStream } from '../../src/orchestrator/streaming.js';

// ---------------------------------------------------------------------------
// Mock Express Response
// ---------------------------------------------------------------------------

function makeRes() {
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    writableEnded: false,
    on: vi.fn(),
  };
  return res;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEvents(writesCalls: string[][]): Array<{ type: string; data: unknown }> {
  const allWritten = writesCalls.map((call) => call[0]).join('');
  const events: Array<{ type: string; data: unknown }> = [];

  for (const block of allWritten.split('\n\n').filter(Boolean)) {
    const lines = block.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event:'));
    const dataLine = lines.find((l) => l.startsWith('data:'));
    if (eventLine && dataLine) {
      events.push({
        type: eventLine.replace('event: ', ''),
        data: JSON.parse(dataLine.replace('data: ', '')),
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// SseStream tests
// ---------------------------------------------------------------------------

describe('SseStream.open', () => {
  it('sets SSE headers when opened', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalledOnce();
  });

  it('registers a close listener for client disconnect handling', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();

    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function));
  });
});

describe('SseStream.send', () => {
  it('writes correctly formatted SSE event', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();

    stream.send('token', { text: 'Hello' });

    const written = res.write.mock.calls.map((c: string[]) => c[0]).join('');
    expect(written).toContain('event: token\n');
    expect(written).toContain('data: {"text":"Hello"}\n');
  });

  it('does not write after stream is closed', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.close();

    const writesBefore = res.write.mock.calls.length;
    stream.send('token', { text: 'Should not appear' });
    const writesAfter = res.write.mock.calls.length;

    expect(writesAfter).toBe(writesBefore);
  });
});

describe('SseStream.sendToken', () => {
  it('sends a token event with the text', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.sendToken('world');

    const events = parseEvents(res.write.mock.calls as string[][]);
    const tokenEvent = events.find((e) => e.type === 'token');
    expect(tokenEvent).toBeDefined();
    expect(tokenEvent!.data).toEqual({ text: 'world' });
  });
});

describe('SseStream.sendToolCall', () => {
  it('sends a tool_call event with correct shape', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.sendToolCall('search', 'tc-001', { query: 'climate data' });

    const events = parseEvents(res.write.mock.calls as string[][]);
    const toolCallEvent = events.find((e) => e.type === 'tool_call');
    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent!.data).toMatchObject({
      toolName: 'search',
      toolUseId: 'tc-001',
      input: { query: 'climate data' },
    });
  });
});

describe('SseStream.sendToolResult', () => {
  it('sends a tool_result event', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.sendToolResult('search', 'tc-001', 'Climate change is...', false);

    const events = parseEvents(res.write.mock.calls as string[][]);
    const toolResultEvent = events.find((e) => e.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    expect(toolResultEvent!.data).toMatchObject({
      toolName: 'search',
      toolUseId: 'tc-001',
      output: 'Climate change is...',
      isError: false,
    });
  });
});

describe('SseStream.done', () => {
  it('sends a done event and closes the stream', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.done('session-1', 5);

    const events = parseEvents(res.write.mock.calls as string[][]);
    const doneEvent = events.find((e) => e.type === 'done');
    expect(doneEvent).toBeDefined();
    expect(doneEvent!.data).toEqual({ sessionId: 'session-1', turnSequence: 5 });

    expect(stream.isClosed).toBe(true);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('does not allow further sends after done', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.done('session-1', 1);

    const writesBefore = res.write.mock.calls.length;
    stream.sendToken('should not appear');
    expect(res.write.mock.calls.length).toBe(writesBefore);
  });
});

describe('SseStream.error', () => {
  it('sends an error event and closes the stream', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();
    stream.error('Something went wrong', 'AGENT_FAILED');

    const events = parseEvents(res.write.mock.calls as string[][]);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data).toEqual({ message: 'Something went wrong', code: 'AGENT_FAILED' });

    expect(stream.isClosed).toBe(true);
  });
});

describe('SseStream — client disconnect', () => {
  it('marks stream as closed when client disconnects', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();

    expect(stream.isClosed).toBe(false);

    // Simulate client disconnect by firing the 'close' event
    const closeHandler = res.on.mock.calls.find((c: string[]) => c[0] === 'close')?.[1];
    expect(closeHandler).toBeDefined();
    closeHandler!();

    expect(stream.isClosed).toBe(true);
  });

  it('no-ops send() after client disconnect', () => {
    const res = makeRes();
    const stream = new SseStream(res as never);
    stream.open();

    const closeHandler = res.on.mock.calls.find((c: string[]) => c[0] === 'close')?.[1];
    closeHandler!();

    const writesBefore = res.write.mock.calls.length;
    stream.sendToken('ghost message');
    expect(res.write.mock.calls.length).toBe(writesBefore);
  });
});

describe('openSseStream helper', () => {
  it('creates and opens a stream in one call', () => {
    const res = makeRes();
    const stream = openSseStream(res as never);

    expect(res.flushHeaders).toHaveBeenCalledOnce();
    expect(stream.isClosed).toBe(false);
  });
});
