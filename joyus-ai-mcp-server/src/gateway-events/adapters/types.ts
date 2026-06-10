import type {
  GatewayDeliveryEndpoint,
  GatewayEventDeliveryAttempt,
  GatewayPlatformEvent,
} from '../../db/schema/gateway-events.js';
import type { DeliveryEndpointType, DeliveryStatus } from '../types.js';

export type DeliveryTerminalStatus = Extract<
  DeliveryStatus,
  'sent' | 'failed' | 'skipped_no_channel'
>;

export interface DeliveryAdapterContext {
  event: GatewayPlatformEvent;
  endpoint: GatewayDeliveryEndpoint;
  attempt: GatewayEventDeliveryAttempt;
  now: Date;
}

export interface DeliveryAdapterResult {
  status: DeliveryTerminalStatus;
  deliveredAt?: Date;
  lastError?: string;
  responseSummary?: Record<string, unknown>;
  retryable?: boolean;
}

export interface DeliveryAdapter {
  readonly type: DeliveryEndpointType;
  deliver(context: DeliveryAdapterContext): Promise<DeliveryAdapterResult>;
}

export function sentDelivery(
  responseSummary: Record<string, unknown> = {},
  deliveredAt = new Date(),
): DeliveryAdapterResult {
  return {
    status: 'sent',
    deliveredAt,
    responseSummary,
    retryable: false,
  };
}

export function failedDelivery(
  lastError: string,
  responseSummary: Record<string, unknown> = {},
  retryable = true,
): DeliveryAdapterResult {
  return {
    status: 'failed',
    lastError,
    responseSummary,
    retryable,
  };
}

export function skippedNoChannel(
  responseSummary: Record<string, unknown> = {},
): DeliveryAdapterResult {
  return {
    status: 'skipped_no_channel',
    responseSummary,
    retryable: false,
  };
}
