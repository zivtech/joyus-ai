import type { DeliveryAdapter, DeliveryAdapterContext, DeliveryAdapterResult } from './types.js';
import { sentDelivery } from './types.js';

export class DashboardDeliveryAdapter implements DeliveryAdapter {
  readonly type = 'dashboard' as const;

  async deliver(context: DeliveryAdapterContext): Promise<DeliveryAdapterResult> {
    return sentDelivery({
      backend: this.type,
      eventId: context.event.id,
      attemptId: context.attempt.id,
      availableInDashboard: true,
    }, context.now);
  }
}
