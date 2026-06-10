import { Router } from 'express';

import { getTenantId } from '../../orchestrator/middleware/tenant.js';
import type { GatewayEventService } from '../event.service.js';

export function createGatewayDeliveriesRouter(eventService: GatewayEventService): Router {
  const router = Router();

  router.get('/events/:eventId/deliveries', async (req, res, next) => {
    try {
      const deliveries = await eventService.listDeliveryAttempts(getTenantId(req), req.params.eventId);
      return res.json({ deliveries });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
