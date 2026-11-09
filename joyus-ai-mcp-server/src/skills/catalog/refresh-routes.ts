/**
 * Operator-only `POST/GET /internal/org-skills/refresh[/:operationId]` surface (refresh.md).
 * Authenticates the bearer refresh secret before parsing the body or reading any remote
 * policy/source; the body is parsed by a route-local parser capped at 1 KiB, mounted
 * before any global body parser. No body, secret, raw input, source URL or exception
 * stack ever appears in a response or log line.
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';

import { CATALOG_LIMITS } from './config.js';
import type { CatalogEnvConfig } from './config.js';
import {
  ManualRefreshRateLimiter,
  resolveRefreshSecret,
  resolveRefreshTenantBinding,
  verifyRefreshBearer,
} from './refresh-auth.js';
import type { CatalogService } from './service.js';
import type { RefreshAttempt, RefreshCategory } from './types.js';

export interface RefreshRoutesOptions {
  readonly service: CatalogService;
  readonly config: CatalogEnvConfig;
  readonly env?: NodeJS.ProcessEnv;
}

interface BodyReadResult {
  readonly ok: true;
  readonly text: string;
}
interface BodyTooLargeResult {
  readonly ok: false;
}

function readCappedBody(
  req: Request,
  maxBytes: number
): Promise<BodyReadResult | BodyTooLargeResult> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;

    const finishOnce = (result: BodyReadResult | BodyTooLargeResult): void => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      received += chunk.length;
      if (received > maxBytes) {
        finishOnce({ ok: false });
        req.resume();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void =>
      finishOnce({ ok: true, text: Buffer.concat(chunks).toString('utf8') });
    const onError = (): void => finishOnce({ ok: false });

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

interface ParsedRefreshBody {
  readonly ref?: string;
}

function parseRefreshBody(text: string): { ok: true; value: ParsedRefreshBody } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, value: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false };

  const keys = Object.keys(parsed as Record<string, unknown>);
  if (keys.some(key => key !== 'ref')) return { ok: false };

  const record = parsed as Record<string, unknown>;
  if ('ref' in record) {
    const ref = record.ref;
    if (
      typeof ref !== 'string' ||
      ref.length === 0 ||
      Buffer.byteLength(ref, 'utf8') > CATALOG_LIMITS.REFRESH_REF_MAX_BYTES
    ) {
      return { ok: false };
    }
    return { ok: true, value: { ref } };
  }
  return { ok: true, value: {} };
}

function safeAttemptView(attempt: RefreshAttempt): Record<string, unknown> {
  const view: Record<string, unknown> = {
    status: attempt.state,
    operationId: attempt.operationId,
    startedAt: attempt.startedAt,
  };
  if (attempt.completedAt) view.completedAt = attempt.completedAt;
  if (attempt.completedAt) {
    view.durationMs = Date.parse(attempt.completedAt) - Date.parse(attempt.startedAt);
  }
  if (attempt.category) view.category = attempt.category;
  if (attempt.revision) view.revision = attempt.revision;
  return view;
}

const REJECTED_HTTP_STATUS: Partial<Record<RefreshCategory, number>> = {
  limit: 429,
};

export function createRefreshRoutes(options: RefreshRoutesOptions): Router {
  const router = Router();
  const env = options.env ?? process.env;
  const manualLimiter = new ManualRefreshRateLimiter(CATALOG_LIMITS.REFRESH_RATE_LIMIT_WINDOW_MS);
  const unauthenticatedLimiter = rateLimit({
    windowMs: CATALOG_LIMITS.REFRESH_RATE_LIMIT_WINDOW_MS,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.use(unauthenticatedLimiter);

  router.post('/', async (req: Request, res: Response) => {
    const secret = resolveRefreshSecret(options.config, env);
    if (!secret || !verifyRefreshBearer(req.header('authorization'), secret)) {
      res.status(401).json({ status: 'unavailable' });
      return;
    }
    const tenantId = resolveRefreshTenantBinding(env);
    if (!tenantId) {
      res.status(503).json({ status: 'unavailable' });
      return;
    }

    const bodyResult = await readCappedBody(req, CATALOG_LIMITS.REFRESH_BODY_MAX_BYTES);
    if (!bodyResult.ok) {
      res.status(413).json({ status: 'rejected', category: 'request_too_large' });
      return;
    }
    const parsed = parseRefreshBody(bodyResult.text);
    if (!parsed.ok) {
      res.status(400).json({ status: 'rejected', category: 'invalid_request' });
      return;
    }

    const existing = options.service.peekInFlight(tenantId);
    if (existing) {
      res.status(202).json({ status: 'in_progress', operationId: existing.operationId });
      return;
    }

    if (!manualLimiter.tryAcquire(tenantId)) {
      res.status(429).json({ status: 'rejected', category: 'rate_limited' });
      return;
    }

    const attempt = options.service.refresh(tenantId, 'manual');
    if (attempt.state === 'rejected') {
      const httpStatus = (attempt.category && REJECTED_HTTP_STATUS[attempt.category]) ?? 503;
      res
        .status(httpStatus)
        .json(
          httpStatus === 503
            ? { status: 'unavailable' }
            : { status: 'rejected', category: attempt.category }
        );
      return;
    }

    res.status(202).json({ status: 'accepted', operationId: attempt.operationId });
  });

  router.get('/:operationId', (req: Request, res: Response) => {
    const secret = resolveRefreshSecret(options.config, env);
    if (!secret || !verifyRefreshBearer(req.header('authorization'), secret)) {
      res.status(401).json({ status: 'unavailable' });
      return;
    }
    const tenantId = resolveRefreshTenantBinding(env);
    if (!tenantId) {
      res.status(503).json({ status: 'unavailable' });
      return;
    }

    const attempt = options.service.getRefreshAttempt(req.params.operationId);
    if (!attempt || attempt.sourceKey !== tenantId) {
      res.status(404).json({ status: 'unavailable' });
      return;
    }

    res.status(200).json(safeAttemptView(attempt));
  });

  return router;
}
