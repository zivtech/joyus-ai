/**
 * Unit tests for route helpers — apiError and validate.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { apiError, validate } from '../../../src/orchestrator/routes/helpers.js';

// ── apiError ─────────────────────────────────────────────────────────────────

describe('apiError', () => {
  it('returns a correctly shaped error object without details', () => {
    const result = apiError('NOT_FOUND', 'Session not found');
    expect(result).toEqual({
      error: { code: 'NOT_FOUND', message: 'Session not found' },
    });
    expect(result.error).not.toHaveProperty('details');
  });

  it('includes details when provided', () => {
    const result = apiError('VALIDATION_ERROR', 'Bad input', { field: 'userId' });
    expect(result).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Bad input',
        details: { field: 'userId' },
      },
    });
  });

  it('accepts null as details', () => {
    const result = apiError('SOMETHING', 'msg', null);
    expect(result.error.details).toBeNull();
  });
});

// ── validate ─────────────────────────────────────────────────────────────────

describe('validate', () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
  });

  function buildMockRes() {
    const res: Record<string, ReturnType<typeof vi.fn>> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('returns parsed data on success', () => {
    const mockRes = buildMockRes();
    const result = validate(schema, { name: 'Alice', age: 30 }, mockRes as never);
    expect(result).toEqual({ name: 'Alice', age: 30 });
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.json).not.toHaveBeenCalled();
  });

  it('writes 400 and returns null on invalid input', () => {
    const mockRes = buildMockRes();
    const result = validate(schema, { name: '', age: -1 }, mockRes as never);
    expect(result).toBeNull();
    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledOnce();
    const body = mockRes.json.mock.calls[0][0] as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('writes 400 when input is undefined', () => {
    const mockRes = buildMockRes();
    const result = validate(schema, undefined, mockRes as never);
    expect(result).toBeNull();
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it('applies Zod coercion/defaults and returns transformed value', () => {
    const coercingSchema = z.object({
      count: z.coerce.number().default(10),
    });
    const mockRes = buildMockRes();
    // Simulate query param (always string)
    const result = validate(coercingSchema, { count: '42' }, mockRes as never);
    expect(result).toEqual({ count: 42 });
    expect(mockRes.status).not.toHaveBeenCalled();
  });
});
