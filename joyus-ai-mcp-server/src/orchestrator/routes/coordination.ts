/**
 * Coordination Routes — WP06 (T045)
 *
 * CRUD endpoints for work units and coordination groups.
 *
 * Work Unit Endpoints:
 *   POST  /work-units                    — create work unit
 *   GET   /work-units                    — list work units (with filters)
 *   GET   /work-units/:workUnitId        — get work unit
 *   PATCH /work-units/:workUnitId        — update work unit (status, assignee, metadata)
 *
 * Coordination Group Endpoints:
 *   POST /coordination-groups            — create coordination group
 *   GET  /coordination-groups/:groupId   — get group with its work units
 *
 * Security contract:
 *   - tenantId always from getTenantId() — never from request body/query.
 *   - Not-found and cross-tenant access both return 404.
 *   - Invalid status transitions return 409.
 */

import { Router } from 'express';

import type { CoordinationService } from '../coordination.service.js';
import {
  WorkUnitNotFoundError,
  InvalidWorkUnitTransitionError,
  CoordinationGroupNotFoundError,
  DependencyNotMetError,
  DependencyCycleError,
  DependencyNotFoundError,
} from '../coordination.service.js';
import { getTenantId } from '../middleware/tenant.js';
import {
  createWorkUnitRequestSchema,
  updateWorkUnitRequestSchema,
  listWorkUnitsQuerySchema,
  createCoordinationGroupRequestSchema,
} from '../schemas.js';

import { apiError, validate } from './helpers.js';

export function createCoordinationRouter(coordinationService: CoordinationService): Router {
  const router = Router();

  // ============================================================
  // WORK UNIT ROUTES
  // ============================================================

  // ─── POST /work-units ───────────────────────────────────────────────────────
  router.post('/work-units', async (req, res) => {
    const tenantId = getTenantId(req);

    const parsed = validate(createWorkUnitRequestSchema, req.body, res);
    if (!parsed) return;

    try {
      const unit = await coordinationService.createWorkUnit(tenantId, {
        title: parsed.title,
        type: parsed.type,
        sessionId: parsed.sessionId,
        coordinationGroupId: parsed.coordinationGroupId,
        assignee: parsed.assignee,
        dependencies: parsed.dependencies,
        labels: parsed.labels,
        metadata: parsed.metadata ?? {},
      });
      return res.status(201).json(unit);
    } catch (err) {
      if (err instanceof DependencyNotFoundError) {
        return res.status(422).json(
          apiError('DEPENDENCY_NOT_FOUND', err.message),
        );
      }
      if (err instanceof DependencyCycleError) {
        return res.status(422).json(
          apiError('DEPENDENCY_CYCLE', err.message),
        );
      }
      throw err;
    }
  });

  // ─── GET /work-units ─────────────────────────────────────────────────────────
  router.get('/work-units', async (req, res) => {
    const tenantId = getTenantId(req);

    const parsed = validate(listWorkUnitsQuerySchema, req.query, res);
    if (!parsed) return;

    const units = await coordinationService.listWorkUnits(tenantId, {
      sessionId: parsed.sessionId,
      coordinationGroupId: parsed.coordinationGroupId,
      status: parsed.status,
    });

    return res.json({ items: units });
  });

  // ─── GET /work-units/:workUnitId ─────────────────────────────────────────────
  router.get('/work-units/:workUnitId', async (req, res) => {
    const tenantId = getTenantId(req);
    const { workUnitId } = req.params;

    const unit = await coordinationService.getWorkUnit(tenantId, workUnitId);
    if (!unit) {
      return res.status(404).json(apiError('NOT_FOUND', 'Work unit not found'));
    }

    return res.json(unit);
  });

  // ─── PATCH /work-units/:workUnitId ───────────────────────────────────────────
  router.patch('/work-units/:workUnitId', async (req, res) => {
    const tenantId = getTenantId(req);
    const { workUnitId } = req.params;

    const parsed = validate(updateWorkUnitRequestSchema, req.body, res);
    if (!parsed) return;

    try {
      const updated = await coordinationService.updateWorkUnit(tenantId, workUnitId, {
        status: parsed.status,
        assignee: parsed.assignee,
        metadata: parsed.metadata,
      });
      return res.json(updated);
    } catch (err) {
      if (err instanceof WorkUnitNotFoundError) {
        return res.status(404).json(apiError('NOT_FOUND', 'Work unit not found'));
      }
      if (err instanceof InvalidWorkUnitTransitionError) {
        return res.status(409).json(
          apiError('INVALID_TRANSITION', err.message),
        );
      }
      if (err instanceof DependencyNotFoundError) {
        return res.status(422).json(
          apiError('DEPENDENCY_NOT_FOUND', err.message),
        );
      }
      if (err instanceof DependencyNotMetError) {
        return res.status(422).json(
          apiError('DEPENDENCY_NOT_MET', err.message),
        );
      }
      throw err;
    }
  });

  // ============================================================
  // COORDINATION GROUP ROUTES
  // ============================================================

  // ─── POST /coordination-groups ───────────────────────────────────────────────
  router.post('/coordination-groups', async (req, res) => {
    const tenantId = getTenantId(req);

    const parsed = validate(createCoordinationGroupRequestSchema, req.body, res);
    if (!parsed) return;

    const group = await coordinationService.createCoordinationGroup(tenantId, {
      title: parsed.title,
      completionPolicy: parsed.completionPolicy,
      metadata: parsed.metadata ?? {},
    });

    return res.status(201).json(group);
  });

  // ─── GET /coordination-groups/:groupId ───────────────────────────────────────
  // Returns the group with its associated work units ("with units" response shape).
  router.get('/coordination-groups/:groupId', async (req, res) => {
    const tenantId = getTenantId(req);
    const { groupId } = req.params;

    const group = await coordinationService.getCoordinationGroup(tenantId, groupId);
    if (!group) {
      return res.status(404).json(apiError('NOT_FOUND', 'Coordination group not found'));
    }

    // Compose work units inline (CoordinationService has no single "getGroupWithUnits" method)
    const workUnits = await coordinationService.listWorkUnits(tenantId, {
      coordinationGroupId: groupId,
    });

    return res.json({ ...group, workUnits });
  });

  return router;
}
