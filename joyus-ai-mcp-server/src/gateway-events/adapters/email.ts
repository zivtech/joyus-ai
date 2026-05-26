import type { DeliveryAdapter, DeliveryAdapterContext, DeliveryAdapterResult } from './types.js';
import { failedDelivery } from './types.js';

export class EmailDeliveryAdapter implements DeliveryAdapter {
  readonly type = 'email' as const;

  async deliver(_context: DeliveryAdapterContext): Promise<DeliveryAdapterResult> {
    return failedDelivery('Email delivery adapter is not configured', {
      backend: this.type,
      implemented: false,
    }, false);
  }
}
