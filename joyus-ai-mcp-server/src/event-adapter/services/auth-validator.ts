/**
 * Event Adapter — Authentication Validator
 *
 * Validates incoming webhook requests using three methods:
 * - HMAC-SHA256 signature verification (GitHub-style)
 * - API key header comparison
 * - IP allowlist / CIDR range matching
 *
 * SECURITY: All secret comparisons use constant-time operations via
 * crypto.timingSafeEqual() to prevent timing attacks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { AuthMethod, AuthConfig, HmacAuthConfig, ApiKeyAuthConfig, IpAllowlistAuthConfig } from '../types.js';

// ============================================================
// AUTH RESULT
// ============================================================

export interface AuthResult {
  valid: boolean;
  failureReason?: string;
}

// ============================================================
// SECRET RESOLVER INTERFACE
// ============================================================

/**
 * Interface for resolving secret references to actual values.
 * WP07 will provide a concrete implementation backed by a secrets manager.
 * Until then, callers can provide a simple in-memory resolver for testing.
 */
export interface SecretResolver {
  resolve(secretRef: string): Promise<string | null>;
}

// ============================================================
// HMAC-SHA256 VALIDATOR (T007)
// ============================================================

/**
 * Validate a webhook payload signed with HMAC-SHA256.
 * Supports GitHub-style `sha256=<hex>` signature format.
 *
 * @param payload - Raw request body as Buffer
 * @param signatureHeader - The signature header value (e.g., "sha256=abc123...")
 * @param secret - The shared secret for HMAC computation
 * @returns true if the signature is valid
 */
export function validateHmacSha256(
  payload: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;

  const hexSignature = signatureHeader.slice(prefix.length);
  if (!/^[a-f0-9]+$/i.test(hexSignature)) return false;

  const receivedSig = Buffer.from(hexSignature, 'hex');
  const expectedSig = createHmac('sha256', secret).update(payload).digest();

  if (receivedSig.length !== expectedSig.length) return false;
  return timingSafeEqual(receivedSig, expectedSig);
}

// ============================================================
// API KEY HEADER VALIDATOR (T008)
// ============================================================

/**
 * Validate a webhook by comparing the value of a named header against an expected key.
 * Header lookup is case-insensitive.
 *
 * @param headers - Request headers (keys should already be lowercased by Express)
 * @param headerName - The header name to check (e.g., "X-API-Key")
 * @param expectedKey - The expected API key value
 * @returns true if the header value matches
 */
export function validateApiKeyHeader(
  headers: Record<string, string | string[] | undefined>,
  headerName: string,
  expectedKey: string,
): boolean {
  const headerValue = headers[headerName.toLowerCase()];
  if (!headerValue || Array.isArray(headerValue)) return false;

  const receivedBuf = Buffer.from(headerValue);
  const expectedBuf = Buffer.from(expectedKey);

  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// ============================================================
// IP ALLOWLIST VALIDATOR (T009)
// ============================================================

/**
 * Parse an IPv4 address to a 32-bit number.
 */
function ipv4ToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv4 address is within a CIDR range.
 */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const ipNum = ipv4ToNumber(ip);
  const rangeNum = ipv4ToNumber(rangeIp);

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Extract the client IP from request context.
 * If X-Forwarded-For is present, takes the leftmost (original client) IP.
 *
 * WARNING: X-Forwarded-For can be spoofed if the server is not behind a trusted
 * reverse proxy. Only trust this header when behind a load balancer that strips
 * untrusted X-Forwarded-For values.
 */
export function extractClientIp(
  remoteAddress: string,
  forwardedFor?: string,
): string {
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim();
    if (firstIp && isIP(firstIp)) return firstIp;
  }
  return remoteAddress;
}

/**
 * Validate that a source IP is in the allowlist.
 * Supports individual IPs and CIDR ranges (IPv4 only for CIDR).
 *
 * @param sourceIp - The client IP address
 * @param allowedIps - Array of allowed IPs or CIDR ranges
 * @returns true if the source IP is allowed
 */
export function validateIpAllowlist(
  sourceIp: string,
  allowedIps: string[],
): boolean {
  for (const entry of allowedIps) {
    if (entry.includes('/')) {
      // CIDR range — IPv4 only
      if (isIP(sourceIp) === 4 && ipv4InCidr(sourceIp, entry)) return true;
    } else {
      // Exact IP match
      if (sourceIp === entry) return true;
    }
  }
  return false;
}

// ============================================================
// AUTH VALIDATOR FACTORY (T010)
// ============================================================

/**
 * Validate webhook authentication using the configured method.
 *
 * Dispatches to the appropriate validator based on authMethod:
 * - hmac_sha256: Verifies HMAC-SHA256 signature header
 * - api_key_header: Checks named header against expected key
 * - ip_allowlist: Checks source IP against allowed IPs/CIDRs
 *
 * @param request - Object containing raw body, headers, and source IP
 * @param authMethod - The authentication method to use
 * @param authConfig - Method-specific configuration
 * @param secretResolver - Resolver for secret references
 */
export async function validateWebhookAuth(
  request: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
    sourceIp: string;
  },
  authMethod: AuthMethod,
  authConfig: AuthConfig,
  secretResolver: SecretResolver,
): Promise<AuthResult> {
  switch (authMethod) {
    case 'hmac_sha256': {
      const config = authConfig as HmacAuthConfig;
      const signatureHeader = request.headers[config.headerName.toLowerCase()];
      if (!signatureHeader || Array.isArray(signatureHeader)) {
        return { valid: false, failureReason: 'Missing signature header' };
      }

      const secret = await secretResolver.resolve(config.secretRef);
      if (!secret) {
        return { valid: false, failureReason: 'Secret reference could not be resolved' };
      }

      const valid = validateHmacSha256(request.rawBody, signatureHeader, secret);
      return valid
        ? { valid: true }
        : { valid: false, failureReason: 'HMAC signature mismatch' };
    }

    case 'api_key_header': {
      const config = authConfig as ApiKeyAuthConfig;
      const secret = await secretResolver.resolve(config.secretRef);
      if (!secret) {
        return { valid: false, failureReason: 'Secret reference could not be resolved' };
      }

      const valid = validateApiKeyHeader(request.headers, config.headerName, secret);
      return valid
        ? { valid: true }
        : { valid: false, failureReason: 'API key mismatch' };
    }

    case 'ip_allowlist': {
      const config = authConfig as IpAllowlistAuthConfig;
      const valid = validateIpAllowlist(request.sourceIp, config.allowedIps);
      return valid
        ? { valid: true }
        : { valid: false, failureReason: `IP ${request.sourceIp} not in allowlist` };
    }

    default:
      return { valid: false, failureReason: `Unknown auth method: ${authMethod as string}` };
  }
}
