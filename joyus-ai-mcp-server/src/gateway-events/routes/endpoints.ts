import { Router } from 'express';

import { getTenantId } from '../../orchestrator/middleware/tenant.js';
import { apiError, validate } from '../../orchestrator/routes/helpers.js';
import { deliveryEndpointInputSchema } from '../schemas.js';
import type { GatewaySubscriptionService } from '../subscription.service.js';

export function createGatewayEndpointsRouter(
  subscriptionService: GatewaySubscriptionService,
): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const endpoints = await subscriptionService.listEndpoints(getTenantId(req));
      return res.json({ endpoints });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    const tenantId = getTenantId(req);
    const parsed = validate(deliveryEndpointInputSchema, req.body, res);
    if (!parsed) return;

    if (parsed.tenantId !== tenantId) {
      return res.status(403).json(apiError('TENANT_MISMATCH', 'Endpoint tenant does not match authenticated tenant'));
    }

    try {
      const endpoint = await subscriptionService.createEndpoint(parsed);
      return res.status(201).json(endpoint);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
