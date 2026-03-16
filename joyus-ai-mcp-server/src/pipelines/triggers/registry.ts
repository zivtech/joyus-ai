/**
 * Trigger Handler Registry
 *
 * Central map of TriggerEventType → TriggerHandler.
 * defaultTriggerRegistry is pre-populated with corpus_change and manual_request handlers.
 * ScheduleTriggerHandler (WP07) registers itself when that module is initialised.
 */

import type { TriggerEventType } from '../types.js';
import type { TriggerHandler } from './interface.js';
import { CorpusChangeTriggerHandler } from './corpus-change.js';
import { ManualRequestTriggerHandler } from './manual-request.js';

export class TriggerRegistry {
  private readonly handlers = new Map<TriggerEventType, TriggerHandler>();

  register(handler: TriggerHandler): void {
    this.handlers.set(handler.triggerType, handler);
  }

  getHandler(triggerType: TriggerEventType): TriggerHandler | undefined {
    return this.handlers.get(triggerType);
  }

  getAll(): TriggerHandler[] {
    return Array.from(this.handlers.values());
  }
}

export const defaultTriggerRegistry = new TriggerRegistry();
defaultTriggerRegistry.register(new CorpusChangeTriggerHandler());
defaultTriggerRegistry.register(new ManualRequestTriggerHandler());
