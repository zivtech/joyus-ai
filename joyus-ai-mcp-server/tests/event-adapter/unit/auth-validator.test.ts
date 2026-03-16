/**
 * Unit tests for Event Adapter authentication validators.
 *
 * Tests all three auth methods (HMAC-SHA256, API key header, IP allowlist)
 * and the factory dispatcher.
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';

import {
  validateHmacSha256,
  validateApiKeyHeader,
  validateIpAllowlist,
  validateWebhookAuth,
  extractClientIp,
  type SecretResolver,
} from '../../../src/event-adapter/services/auth-validator.js';

// ============================================================
// TEST HELPERS
// ============================================================

function makeGitHubSignature(payload: Buffer, secret: string): string {
  const hmac = createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${hmac}`;
}

const testSecretResolver: SecretResolver = {
  async resolve(ref: string): Promise<string | null> {
    const secrets: Record<string, string> = {
      'vault://webhook-secret': 'my-webhook-secret',
      'vault://api-key': 'test-api-key-value',
      'vault://missing': '',
    };
    return secrets[ref] ?? null;
  },
};

// ============================================================
// HMAC-SHA256 TESTS (T007)
// ============================================================

describe('HMAC-SHA256 Validator', () => {
  const secret = 'my-webhook-secret';
  const payload = Buffer.from('{"action":"push","ref":"refs/heads/main"}');

  it('validates a correct GitHub-style signature', () => {
    const signature = makeGitHubSignature(payload, secret);
    expect(validateHmacSha256(payload, signature, secret)).toBe(true);
  });

  it('rejects an incorrect signature', () => {
    const wrongSig = makeGitHubSignature(payload, 'wrong-secret');
    expect(validateHmacSha256(payload, wrongSig, secret)).toBe(false);
  });

  it('rejects a missing signature header (empty string)', () => {
    expect(validateHmacSha256(payload, '', secret)).toBe(false);
  });

  it('rejects a malformed signature (wrong prefix)', () => {
    expect(validateHmacSha256(payload, 'sha1=abcdef1234', secret)).toBe(false);
  });

  it('rejects a malformed signature (no hex)', () => {
    expect(validateHmacSha256(payload, 'sha256=not-hex!!', secret)).toBe(false);
  });

  it('rejects a signature with wrong length', () => {
    expect(validateHmacSha256(payload, 'sha256=abcd', secret)).toBe(false);
  });

  it('handles an empty payload', () => {
    const emptyPayload = Buffer.from('');
    const signature = makeGitHubSignature(emptyPayload, secret);
    expect(validateHmacSha256(emptyPayload, signature, secret)).toBe(true);
  });
});

// ============================================================
// API KEY HEADER TESTS (T008)
// ============================================================

describe('API Key Header Validator', () => {
  const expectedKey = 'test-api-key-value';

  it('validates correct key in configured header', () => {
    const headers = { 'x-api-key': expectedKey };
    expect(validateApiKeyHeader(headers, 'X-API-Key', expectedKey)).toBe(true);
  });

  it('rejects wrong key', () => {
    const headers = { 'x-api-key': 'wrong-key' };
    expect(validateApiKeyHeader(headers, 'X-API-Key', expectedKey)).toBe(false);
  });

  it('rejects missing header', () => {
    const headers = {};
    expect(validateApiKeyHeader(headers, 'X-API-Key', expectedKey)).toBe(false);
  });

  it('performs case-insensitive header lookup', () => {
    const headers = { 'authorization': expectedKey };
    expect(validateApiKeyHeader(headers, 'Authorization', expectedKey)).toBe(true);
  });

  it('rejects array header values', () => {
    const headers = { 'x-api-key': ['val1', 'val2'] };
    expect(validateApiKeyHeader(headers, 'X-API-Key', expectedKey)).toBe(false);
  });

  it('rejects undefined header value', () => {
    const headers = { 'x-api-key': undefined };
    expect(validateApiKeyHeader(headers, 'X-API-Key', expectedKey)).toBe(false);
  });
});

// ============================================================
// IP ALLOWLIST TESTS (T009)
// ============================================================

describe('IP Allowlist Validator', () => {
  it('allows an IP in the allowlist', () => {
    expect(validateIpAllowlist('192.168.1.100', ['192.168.1.100', '10.0.0.1'])).toBe(true);
  });

  it('rejects an IP not in the allowlist', () => {
    expect(validateIpAllowlist('172.16.0.5', ['192.168.1.100', '10.0.0.1'])).toBe(false);
  });

  it('matches IP within a CIDR range', () => {
    expect(validateIpAllowlist('192.168.1.50', ['192.168.1.0/24'])).toBe(true);
  });

  it('rejects IP outside a CIDR range', () => {
    expect(validateIpAllowlist('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
  });

  it('handles /32 CIDR (single IP)', () => {
    expect(validateIpAllowlist('10.0.0.1', ['10.0.0.1/32'])).toBe(true);
    expect(validateIpAllowlist('10.0.0.2', ['10.0.0.1/32'])).toBe(false);
  });

  it('handles /0 CIDR (all IPs)', () => {
    expect(validateIpAllowlist('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
  });

  it('rejects empty allowlist', () => {
    expect(validateIpAllowlist('192.168.1.1', [])).toBe(false);
  });

  it('handles mixed exact IPs and CIDR ranges', () => {
    const allowlist = ['10.0.0.1', '192.168.0.0/16'];
    expect(validateIpAllowlist('10.0.0.1', allowlist)).toBe(true);
    expect(validateIpAllowlist('192.168.5.5', allowlist)).toBe(true);
    expect(validateIpAllowlist('172.16.0.1', allowlist)).toBe(false);
  });
});

// ============================================================
// EXTRACT CLIENT IP TESTS
// ============================================================

describe('extractClientIp', () => {
  it('returns remote address when no X-Forwarded-For', () => {
    expect(extractClientIp('10.0.0.1')).toBe('10.0.0.1');
  });

  it('returns first IP from X-Forwarded-For', () => {
    expect(extractClientIp('10.0.0.1', '203.0.113.50, 70.41.3.18')).toBe('203.0.113.50');
  });

  it('falls back to remote address for invalid X-Forwarded-For', () => {
    expect(extractClientIp('10.0.0.1', 'not-an-ip')).toBe('10.0.0.1');
  });

  it('handles single IP in X-Forwarded-For', () => {
    expect(extractClientIp('10.0.0.1', '203.0.113.50')).toBe('203.0.113.50');
  });
});

// ============================================================
// FACTORY TESTS (T010)
// ============================================================

describe('validateWebhookAuth (factory)', () => {
  const payload = Buffer.from('{"test":"data"}');
  const secret = 'my-webhook-secret';

  it('dispatches to HMAC validator for hmac_sha256', async () => {
    const signature = makeGitHubSignature(payload, secret);
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: { 'x-hub-signature-256': signature },
        sourceIp: '10.0.0.1',
      },
      'hmac_sha256',
      { secretRef: 'vault://webhook-secret', headerName: 'X-Hub-Signature-256', algorithm: 'sha256' },
      testSecretResolver,
    );
    expect(result.valid).toBe(true);
  });

  it('returns failure for invalid HMAC signature', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' },
        sourceIp: '10.0.0.1',
      },
      'hmac_sha256',
      { secretRef: 'vault://webhook-secret', headerName: 'X-Hub-Signature-256', algorithm: 'sha256' },
      testSecretResolver,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('HMAC signature mismatch');
  });

  it('returns failure when signature header is missing', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: {},
        sourceIp: '10.0.0.1',
      },
      'hmac_sha256',
      { secretRef: 'vault://webhook-secret', headerName: 'X-Hub-Signature-256', algorithm: 'sha256' },
      testSecretResolver,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('Missing signature header');
  });

  it('dispatches to API key validator for api_key_header', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: { 'x-api-key': 'test-api-key-value' },
        sourceIp: '10.0.0.1',
      },
      'api_key_header',
      { headerName: 'X-API-Key', secretRef: 'vault://api-key' },
      testSecretResolver,
    );
    expect(result.valid).toBe(true);
  });

  it('returns failure for wrong API key', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: { 'x-api-key': 'wrong-key' },
        sourceIp: '10.0.0.1',
      },
      'api_key_header',
      { headerName: 'X-API-Key', secretRef: 'vault://api-key' },
      testSecretResolver,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('API key mismatch');
  });

  it('dispatches to IP allowlist validator for ip_allowlist', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: {},
        sourceIp: '192.168.1.50',
      },
      'ip_allowlist',
      { allowedIps: ['192.168.1.0/24'] },
      testSecretResolver,
    );
    expect(result.valid).toBe(true);
  });

  it('returns failure for IP not in allowlist', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: {},
        sourceIp: '10.0.0.1',
      },
      'ip_allowlist',
      { allowedIps: ['192.168.1.0/24'] },
      testSecretResolver,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toContain('not in allowlist');
  });

  it('returns failure when secret cannot be resolved', async () => {
    const result = await validateWebhookAuth(
      {
        rawBody: payload,
        headers: { 'x-hub-signature-256': 'sha256=abc' },
        sourceIp: '10.0.0.1',
      },
      'hmac_sha256',
      { secretRef: 'vault://nonexistent', headerName: 'X-Hub-Signature-256', algorithm: 'sha256' },
      testSecretResolver,
    );
    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe('Secret reference could not be resolved');
  });
});
