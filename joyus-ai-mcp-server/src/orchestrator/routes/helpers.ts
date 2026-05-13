/**
 * Route Handler Helpers — WP06
 *
 * Shared utilities for orchestrator route handlers:
 *   - Consistent error response format
 *   - Zod request validation with automatic 400 on failure
 */

import type { Response } from 'express';
import { type ZodSchema, ZodError } from 'zod';

import type { ApiError } from '../schemas.js';

// ============================================================
// ERROR RESPONSE FACTORY
// ============================================================

/**
 * Build a consistent error response body.
 * Shape: { error: { code, message, details? } }
 *
 * Usage in route handlers:
 *   return res.status(404).json(apiError('NOT_FOUND', 'Session not found'));
 */
export function apiError(code: string, message: string, details?: unknown): ApiError {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

// ============================================================
// ZOD VALIDATION HELPER
// ============================================================

/**
 * Validate a value against a Zod schema.
 *
 * Returns the parsed value on success.
 * On failure: writes a 400 JSON response with Zod error details and returns null.
 *
 * Usage in route handlers:
 *   const parsed = validate(createSessionRequestSchema, req.body, res);
 *   if (!parsed) return; // 400 already sent
 */
export function validate<T>(
  schema: ZodSchema<T>,
  value: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const formatted = result.error instanceof ZodError
    ? result.error.flatten()
    : String(result.error);

  res.status(400).json(
    apiError('VALIDATION_ERROR', 'Request validation failed', formatted),
  );
  return null;
}
