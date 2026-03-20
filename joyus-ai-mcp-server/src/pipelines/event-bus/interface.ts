/**
 * Pipeline event bus interfaces.
 */

import type { TriggerEventType } from '../types.js';

export interface EventEnvelope {
  eventId: string;
  tenantId: string;
  eventType: TriggerEventType;
  payload: Record<string, unknown>;
  timestamp: Date;
}
