import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../../../src/pipelines/event-bus/index.js';
import type { EventEnvelope } from '../../../src/pipelines/event-bus/index.js';

describe('InMemoryEventBus', () => {
  it('publish returns a non-empty string ID', async () => {
    const bus = new InMemoryEventBus();
    const id = await bus.publish('tenant-1', 'corpus_change', { doc: 'a' });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('subscribed handler receives correct EventEnvelope on publish', async () => {
    const bus = new InMemoryEventBus();
    const received: EventEnvelope[] = [];

    bus.subscribe('corpus_change', async (event) => {
      received.push(event);
    });

    const id = await bus.publish('tenant-1', 'corpus_change', { doc: 'b' });

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(id);
    expect(received[0].tenantId).toBe('tenant-1');
    expect(received[0].eventType).toBe('corpus_change');
    expect(received[0].payload).toEqual({ doc: 'b' });
    expect(received[0].createdAt).toBeInstanceOf(Date);
  });

  it('handler is not called for a different event type', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.subscribe('schedule_tick', async (event) => handler(event));
    await bus.publish('tenant-1', 'corpus_change', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple handlers for the same event type are all called', async () => {
    const bus = new InMemoryEventBus();
    const calls: string[] = [];

    bus.subscribe('manual_request', async () => { calls.push('h1'); });
    bus.subscribe('manual_request', async () => { calls.push('h2'); });

    await bus.publish('tenant-2', 'manual_request', {});

    expect(calls).toContain('h1');
    expect(calls).toContain('h2');
    expect(calls).toHaveLength(2);
  });

  it('unsubscribe removes the handler so it is no longer called', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    const subId = bus.subscribe('corpus_change', async (event) => handler(event));
    bus.unsubscribe(subId);

    await bus.publish('tenant-1', 'corpus_change', {});

    expect(handler).not.toHaveBeenCalled();
  });

  it('close clears all subscriptions', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.subscribe('corpus_change', async (event) => handler(event));
    await bus.close();

    await bus.publish('tenant-1', 'corpus_change', {});

    expect(handler).not.toHaveBeenCalled();
  });
});
