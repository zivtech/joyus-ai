import type { DeliveryAdapter, DeliveryAdapterContext, DeliveryAdapterResult } from './types.js';
import { failedDelivery } from './types.js';

export class SlackDeliveryAdapter implements DeliveryAdapter {
  readonly type = 'slack' as const;

  async deliver(_context: DeliveryAdapterContext): Promise<DeliveryAdapterResult> {
    return failedDelivery('Slack delivery adapter is not configured', {
      backend: this.type,
      implemented: false,
    }, false);
  }
}
