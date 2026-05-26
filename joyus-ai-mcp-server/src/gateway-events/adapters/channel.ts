import type { DeliveryAdapter, DeliveryAdapterContext, DeliveryAdapterResult } from './types.js';
import { failedDelivery, skippedNoChannel } from './types.js';

export interface ChannelConnectionLookup {
  hasConnectedChannel(tenantId: string): Promise<boolean>;
}

export interface ChannelSender {
  send(context: DeliveryAdapterContext): Promise<DeliveryAdapterResult>;
}

export class ChannelDeliveryAdapter implements DeliveryAdapter {
  readonly type = 'channel' as const;

  constructor(
    private readonly connections: ChannelConnectionLookup,
    private readonly sender?: ChannelSender,
  ) {}

  async deliver(context: DeliveryAdapterContext): Promise<DeliveryAdapterResult> {
    const hasChannel = await this.connections.hasConnectedChannel(context.attempt.tenantId);
    if (!hasChannel) {
      return skippedNoChannel({
        backend: this.type,
        reason: 'no_connected_channel',
      });
    }

    if (!this.sender) {
      return failedDelivery('Channel delivery sender is not configured', {
        backend: this.type,
        hasConnectedChannel: true,
      }, false);
    }

    return this.sender.send(context);
  }
}
