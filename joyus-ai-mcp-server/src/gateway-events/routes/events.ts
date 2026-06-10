import { Router } from 'express';

import { getTenantId } from '../../orchestrator/middleware/tenant.js';
import { apiError, validate } from '../../orchestrator/routes/helpers.js';
import type { GatewayEventService } from '../event.service.js';
import { platformEventInputSchema } from '../schemas.js';

export function createGatewayEventsRouter(eventService: GatewayEventService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    const tenantId = getTenantId(req);
    const parsed = validate(platformEventInputSchema, req.body, res);
    if (!parsed) return;

    if (parsed.tenantId !== tenantId) {
      return res.status(403).json(apiError('TENANT_MISMATCH', 'Event tenant does not match authenticated tenant'));
    }

    try {
      const result = await eventService.emitPlatformEvent(parsed);
      if (result.status === 'duplicate') {
        return res.status(409).json({
          eventId: result.event.id,
          status: 'duplicate',
        });
      }

      return res.status(202).json({
        eventId: result.event.id,
        status: 'accepted',
        deliveryAttemptCount: result.deliveryAttempts.length,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
