/**
 * Message Routes — WP06 (T043)
 *
 * Endpoint for sending a message to a session and receiving a streamed response.
 *
 * Endpoints:
 *   POST /sessions/:sessionId/messages
 *
 * Behavior:
 *   - Accepts { message: string, stream?: boolean }
 *   - If session is 'pending', automatically transitions to 'running' before
 *     processing (implicit start). This avoids requiring clients to issue a
 *     separate PATCH action before the first message.
 *   - If session is already 'running', proceeds directly.
 *   - Any other status → 409 Conflict.
 *   - Streams response as SSE when stream=true (default).
 *   - Returns JSON when stream=false.
 *
 * Note on implicit pending→running transition:
 *   The WP spec is silent on whether POST /messages triggers this. We opt for
 *   implicit start as the more ergonomic API — a reviewer can restrict this to
 *   require explicit PATCH /sessions/:id {action:resume} if preferred.
 */

import { Router } from 'express';

import { getTenantId } from '../middleware/tenant.js';
import type { AgentLoopService } from '../agent-loop.service.js';
import { AgentLoopError } from '../agent-loop.service.js';
import type { SessionService } from '../session.service.js';
import { SessionNotFoundError } from '../types.js';
import { SseStream } from '../streaming.js';
import { sendMessageRequestSchema } from '../schemas.js';
import { apiError, validate } from './helpers.js';

export function createMessagesRouter(
  sessionService: SessionService,
  agentLoopService: AgentLoopService,
): Router {
  const router = Router({ mergeParams: true });

  // ─── POST /sessions/:sessionId/messages ──────────────────────────────────────
  router.post('/', async (req, res) => {
    const tenantId = getTenantId(req);
    // mergeParams: true enables access to parent route params (:sessionId).
    // Cast required because TypeScript doesn't infer parent params on child routers.
    const { sessionId } = req.params as { sessionId: string };

    const parsed = validate(sendMessageRequestSchema, req.body, res);
    if (!parsed) return;

    // Verify session exists and belongs to this tenant
    let session = await sessionService.getSession(tenantId, sessionId);
    if (!session) {
      return res.status(404).json(apiError('NOT_FOUND', 'Session not found'));
    }

    // Handle pending → running implicit transition (ergonomic first-message start)
    if (session.status === 'pending') {
      try {
        session = await sessionService.updateSessionStatus({
          tenantId,
          sessionId,
          newStatus: 'running',
        });
      } catch (err) {
        if (err instanceof SessionNotFoundError) {
          return res.status(404).json(apiError('NOT_FOUND', 'Session not found'));
        }
        throw err;
      }
    }

    // Only 'running' sessions can accept messages
    if (session.status !== 'running') {
      return res.status(409).json(
        apiError(
          'SESSION_NOT_RUNNING',
          `Session is not accepting messages (status: ${session.status})`,
        ),
      );
    }

    const shouldStream = parsed.stream !== false;

    if (shouldStream) {
      // ── Streaming SSE response ────────────────────────────────────────────
      const stream = new SseStream(res);
      stream.open();

      // Clean up if client disconnects before the loop completes
      req.on('close', () => {
        if (!stream.isClosed) {
          stream.close();
        }
      });

      try {
        await agentLoopService.processMessage(
          sessionId,
          tenantId,
          parsed.message,
          stream,
        );
      } catch (err) {
        if (!stream.isClosed) {
          if (err instanceof AgentLoopError) {
            stream.error(err.message, err.code);
          } else {
            stream.error('Internal server error', 'INTERNAL_ERROR');
          }
        }
        // Error already sent to client via SSE; don't rethrow to the Express error handler
        // (which would try to write JSON headers on a streaming response).
      }
      return;
    }

    // ── Non-streaming JSON response ───────────────────────────────────────────
    try {
      const result = await agentLoopService.processMessage(
        sessionId,
        tenantId,
        parsed.message,
      );

      return res.json({
        sessionId,
        turnSequence: result.turnSequence,
        correlationId: result.correlationId,
        responseText: result.responseText,
        tokenUsage: result.tokenUsage,
      });
    } catch (err) {
      if (err instanceof AgentLoopError) {
        if (err.code === 'SESSION_NOT_RUNNING') {
          return res.status(409).json(apiError(err.code, err.message));
        }
        if (err.code === 'MAX_ITERATIONS_EXCEEDED') {
          return res.status(500).json(apiError(err.code, err.message));
        }
        return res.status(500).json(apiError(err.code, err.message));
      }
      throw err;
    }
  });

  return router;
}
