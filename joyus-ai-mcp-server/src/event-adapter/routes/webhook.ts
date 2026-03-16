/**
 * Event Adapter — Webhook Ingestion Route
 *
 * POST /webhook/:slug
 *
 * The public-facing entry point for all external webhook events.
 * Resolves slug → event source, validates auth, parses payload,
 * buffers event, and returns 202 immediately.
 *
 * The endpoint must be fast: critical path < 100ms.
 * Never await downstream processing.
 */

import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { eventSources, type EventSource } from '../schema.js';
import type { AuthMethod, AuthConfig } from '../types.js';
import { validateWebhookAuth, extractClientIp, type SecretResolver } from '../services/auth-validator.js';
import { bufferEvent } from '../services/event-buffer.js';
import { RateLimiter, type RateLimitResult } from '../services/rate-limiter.js';
import { parseGitHubEvent, UnsupportedEventTypeError } from '../parsers/github.js';
import { parseGenericWebhook, PayloadParseError } from '../parsers/generic.js';

// ============================================================
// TYPES
// ============================================================

export interface WebhookRouterDeps {
  db: NodePgDatabase<Record<string, unknown>>;
  secretResolver: SecretResolver;
  rateLimiter: RateLimiter;
}

// ============================================================
// ROUTE FACTORY
// ============================================================

/** Max request body size: 1MB */
const MAX_BODY_SIZE = 1024 * 1024;

export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();

  // Raw body middleware — must come before any JSON parsing so the
  // raw bytes are available for HMAC signature verification.
  router.post(
    '/webhook/:slug',
    (req: Request, res: Response, next) => {
      // Collect raw body chunks
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          aborted = true;
          req.removeAllListeners('data');
          res.status(413).json({ error: 'payload_too_large', max_bytes: MAX_BODY_SIZE });
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        if (aborted) return;
        (req as Request & { rawBody: Buffer }).rawBody = Buffer.concat(chunks);
        next();
      });

      req.on('error', (err) => next(err));
    },
    webhookHandler(deps),
  );

  return router;
}

// ============================================================
// HANDLER
// ============================================================

function webhookHandler(deps: WebhookRouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;
    const rawBody = (req as Request & { rawBody: Buffer }).rawBody;

    // 1. Resolve event source by slug
    const [source] = await deps.db
      .select()
      .from(eventSources)
      .where(eq(eventSources.endpointSlug, slug));

    if (!source) {
      res.status(404).json({ error: 'unknown_endpoint' });
      return;
    }

    // 2. Check lifecycle state
    if (source.lifecycleState !== 'active') {
      res.status(503).json({ error: 'source_inactive' });
      return;
    }

    // 3. Rate limiting
    const tenantId = source.tenantId ?? 'platform';
    const rateLimitResult = deps.rateLimiter.checkRateLimit(source.id, tenantId);
    setRateLimitHeaders(res, rateLimitResult);

    if (!rateLimitResult.allowed) {
      const retryAfterSec = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'rate_limited', retry_after: retryAfterSec });
      return;
    }

    // 4. Auth validation
    const sourceIp = extractClientIp(
      req.socket.remoteAddress ?? '0.0.0.0',
      req.headers['x-forwarded-for'] as string | undefined,
    );

    const authResult = await validateWebhookAuth(
      { rawBody, headers: req.headers as Record<string, string | string[] | undefined>, sourceIp },
      source.authMethod as AuthMethod,
      source.authConfig as AuthConfig,
      deps.secretResolver,
    );

    if (!authResult.valid) {
      console.warn('[event-adapter] Webhook auth failure', {
        slug,
        reason: authResult.failureReason,
        sourceIp,
      });
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    // 5. Parse payload based on source type
    try {
      const parsed = parsePayload(source, rawBody, req.headers as Record<string, string | string[] | undefined>);

      // 6. Buffer event (fast write, no downstream await)
      // Store raw body base64-encoded in headers for HMAC re-validation
      const storedHeaders = sanitizeHeaders(
        req.headers as Record<string, string>,
        source.authConfig as AuthConfig,
      );
      storedHeaders['_raw_body_b64'] = rawBody.toString('base64');

      const event = await bufferEvent(deps.db, {
        tenantId,
        sourceType: source.sourceType as 'github' | 'generic_webhook',
        sourceId: source.id,
        payload: parsed.metadata,
        headers: storedHeaders,
        signatureValid: authResult.valid,
      });

      // 7. Return 202 immediately
      res.status(202).json({ event_id: event.id, status: 'pending' });
    } catch (err) {
      if (err instanceof UnsupportedEventTypeError) {
        // Return 200 for unsupported GitHub events (e.g., ping) to avoid retry storms
        res.status(200).json({ message: 'Event type not processed', event_type: err.eventType });
        return;
      }
      if (err instanceof PayloadParseError) {
        res.status(400).json({ error: 'invalid_payload', detail: err.message });
        return;
      }
      throw err;
    }
  };
}

// ============================================================
// HELPERS
// ============================================================

interface ParsedPayload {
  triggerType: string;
  pipelineId?: string;
  metadata: Record<string, unknown>;
}

function parsePayload(
  source: EventSource,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): ParsedPayload {
  if (source.sourceType === 'github') {
    const parsed = parseGitHubEvent(headers, rawBody);
    return {
      triggerType: parsed.triggerType,
      pipelineId: source.targetPipelineId ?? undefined,
      metadata: parsed.metadata,
    };
  }

  // generic_webhook
  const parsed = parseGenericWebhook(rawBody, source);
  return {
    triggerType: parsed.triggerType,
    pipelineId: parsed.pipelineId,
    metadata: parsed.metadata,
  };
}

function setRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.set('X-RateLimit-Limit', String(result.limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.currentCount)));
  res.set('X-RateLimit-Reset', String(result.resetAt));
}

/**
 * Remove potentially sensitive headers before storing.
 * Redacts authorization, cookie, and auth-method-specific headers.
 */
function sanitizeHeaders(
  headers: Record<string, string>,
  authConfig?: AuthConfig,
): Record<string, string> {
  const redactKeys = new Set(['authorization', 'cookie', 'set-cookie']);
  if (authConfig && 'headerName' in authConfig) {
    redactKeys.add((authConfig as { headerName: string }).headerName.toLowerCase());
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (redactKeys.has(lower)) {
      sanitized[lower] = '[REDACTED]';
    } else {
      sanitized[lower] = typeof value === 'string' ? value : String(value);
    }
  }
  return sanitized;
}
