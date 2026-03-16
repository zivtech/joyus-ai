/**
 * Automated Pipelines Framework — PostgreSQL LISTEN/NOTIFY EventBus
 *
 * Uses a dedicated pg.Client (not pooled) for LISTEN so notifications are
 * received without contention.  publish() inserts into trigger_events and
 * sends NOTIFY with only the event ID to stay within the 8 000-byte limit.
 */

import pg from 'pg';
import { createId } from '@paralleldrive/cuid2';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { triggerEvents } from '../schema.js';
import type { TriggerEventType } from '../types.js';
import type { EventBus, EventEnvelope, EventHandler } from './interface.js';

const CHANNEL = 'pipelines_events';
const RECONNECT_DELAY_MS = 2000;

interface Subscription {
  eventType: TriggerEventType;
  handler: EventHandler;
}

export class PgNotifyBus implements EventBus {
  private readonly db: NodePgDatabase;
  private readonly connectionString: string;
  private listenClient: pg.Client | null = null;
  private closed = false;
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(db: NodePgDatabase, connectionString: string) {
    this.db = db;
    this.connectionString = connectionString;
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async start(): Promise<void> {
    await this.connectListenClient();
  }

  private async connectListenClient(): Promise<void> {
    if (this.closed) return;

    const client = new pg.Client({ connectionString: this.connectionString });

    client.on('error', (err) => {
      console.error('[PgNotifyBus] listen client error:', err.message);
      void this.reconnect();
    });

    client.on('end', () => {
      if (!this.closed) {
        console.warn('[PgNotifyBus] listen client ended unexpectedly — reconnecting');
        void this.reconnect();
      }
    });

    client.on('notification', (msg) => {
      if (msg.channel === CHANNEL && msg.payload) {
        void this.handleNotification(msg.payload);
      }
    });

    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    this.listenClient = client;
  }

  private async reconnect(): Promise<void> {
    if (this.closed) return;
    this.listenClient = null;
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    try {
      await this.connectListenClient();
    } catch (err) {
      console.error('[PgNotifyBus] reconnect failed:', err);
      void this.reconnect();
    }
  }

  // ------------------------------------------------------------------
  // Notification handler
  // ------------------------------------------------------------------

  private async handleNotification(eventId: string): Promise<void> {
    // Atomically claim the event (only first consumer wins in multi-process).
    const rows = await this.db
      .update(triggerEvents)
      .set({ status: 'acknowledged', acknowledgedAt: new Date() })
      .where(and(eq(triggerEvents.id, eventId), eq(triggerEvents.status, 'pending')))
      .returning();

    if (rows.length === 0) return;

    const row = rows[0];
    const envelope: EventEnvelope = {
      id: row.id,
      tenantId: row.tenantId,
      eventType: row.eventType as TriggerEventType,
      payload: row.payload as Record<string, unknown>,
      createdAt: row.receivedAt,
    };

    let anyRan = false;
    let allFailed = true;
    for (const sub of this.subscriptions.values()) {
      if (sub.eventType === envelope.eventType) {
        anyRan = true;
        try {
          await sub.handler(envelope);
          allFailed = false;
        } catch (err) {
          console.error(`[PgNotifyBus] handler error for event ${eventId}:`, err);
        }
      }
    }

    // Transition to final status after handler dispatch.
    const finalStatus = (anyRan && allFailed) ? 'failed' : 'processed';
    await this.db
      .update(triggerEvents)
      .set({ status: finalStatus, processedAt: new Date() })
      .where(eq(triggerEvents.id, eventId));
  }

  // ------------------------------------------------------------------
  // EventBus interface
  // ------------------------------------------------------------------

  async publish(
    tenantId: string,
    eventType: TriggerEventType,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const id = createId();

    await this.db.insert(triggerEvents).values({
      id,
      tenantId,
      eventType,
      payload,
      status: 'pending',
    });

    // NOTIFY payload is only the event ID (well within the 8 000-byte limit).
    await this.db.execute(sql`SELECT pg_notify(${CHANNEL}, ${id})`);

    return id;
  }

  subscribe(eventType: TriggerEventType, handler: EventHandler): string {
    const subscriptionId = createId();
    this.subscriptions.set(subscriptionId, { eventType, handler });
    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscriptions.clear();
    if (this.listenClient) {
      try {
        await this.listenClient.end();
      } catch {
        // ignore errors during shutdown
      }
      this.listenClient = null;
    }
  }
}
