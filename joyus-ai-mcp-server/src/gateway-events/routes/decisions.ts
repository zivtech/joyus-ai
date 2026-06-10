import { Router } from 'express';

import { getTenantId } from '../../orchestrator/middleware/tenant.js';
import { apiError, validate } from '../../orchestrator/routes/helpers.js';
import {
  GatewayDecisionEventNotFoundError,
  type GatewayDecisionService,
} from '../decision.service.js';
import { gatewayDecisionInputSchema } from '../schemas.js';
import { TenantMismatchError } from '../types.js';

export function createGatewayDecisionsRouter(decisionService: GatewayDecisionService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    const tenantId = getTenantId(req);
    const parsed = validate(gatewayDecisionInputSchema, req.body, res);
    if (!parsed) return;

    if (parsed.tenantId !== tenantId) {
      return res.status(403).json(apiError('TENANT_MISMATCH', 'Decision tenant does not match authenticated tenant'));
    }

    try {
      const result = await decisionService.ingestDecision(parsed);
      if (result.status === 'duplicate') {
        return res.status(409).json({
          decisionId: result.decision.id,
          status: 'duplicate',
          routeStatus: result.decision.routeStatus,
        });
      }

      if (result.status === 'rejected') {
        return res.status(422).json({
          decisionId: result.decision.id,
          status: result.status,
          routeStatus: result.decision.routeStatus,
        });
      }

      return res.status(202).json({
        decisionId: result.decision.id,
        status: result.status,
        routeStatus: result.decision.routeStatus,
      });
    } catch (err) {
      if (err instanceof GatewayDecisionEventNotFoundError) {
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
