export interface TriggerEvent {
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type TriggerEventHandler = (event: TriggerEvent) => Promise<void> | void;

export interface TriggerAdapter {
  name: string;
  start(handler: TriggerEventHandler): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Minimal in-memory trigger adapter for pilot workflows and integration tests.
 * Production adapters can wrap webhooks, queues, or schedulers.
 */
export class InMemoryTriggerAdapter implements TriggerAdapter {
  public readonly name = 'in-memory-trigger';
  private handler: TriggerEventHandler | null = null;

  async start(handler: TriggerEventHandler): Promise<void> {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  async emit(event: Omit<TriggerEvent, 'occurredAt'>): Promise<void> {
    if (!this.handler) {
      throw new Error('Trigger adapter has not been started');
    }
    await this.handler({
      ...event,
      occurredAt: new Date().toISOString(),
    });
  }
}
