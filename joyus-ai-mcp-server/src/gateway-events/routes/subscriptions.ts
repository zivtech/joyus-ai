import { Router } from 'express';

import { getTenantId } from '../../orchestrator/middleware/tenant.js';
import { apiError, validate } from '../../orchestrator/routes/helpers.js';
import { eventSubscriptionInputSchema } from '../schemas.js';
import {
  DeliveryEndpointNotFoundError,
  GatewaySubscriptionService,
  TenantMismatchError,
} from '../subscription.service.js';

export function createGatewaySubscriptionsRouter(
  subscriptionService: GatewaySubscriptionService,
): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const subscriptions = await subscriptionService.listSubscriptions(getTenantId(req));
      return res.json({ subscriptions });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    const tenantId = getTenantId(req);
    const parsed = validate(eventSubscriptionInputSchema, req.body, res);
    if (!parsed) return;

    if (parsed.tenantId !== tenantId) {
      return res.status(403).json(apiError('TENANT_MISMATCH', 'Subscription tenant does not match authenticated tenant'));
    }

    try {
      const subscription = await subscriptionService.createSubscription(parsed);
      return res.status(201).json(subscription);
    } catch (err) {
      if (err instanceof DeliveryEndpointNotFoundError) {
        return res.status(404).json(apiError('NOT_FOUND', err.message));
      }
      if (err instanceof TenantMismatchError) {
        return res.status(403).json(apiError('TENANT_MISMATCH', err.message));
      }
      return next(err);
    }
  });

  return router;
}
