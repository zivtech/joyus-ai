/**
 * Token Encryption Utilities
 * AES-256-GCM encryption for OAuth tokens at rest
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: TOKEN_ENCRYPTION_KEY is required in production');
  }
  console.warn('[joyus] TOKEN_ENCRYPTION_KEY not set - using development fallback');
}

/**
 * Encrypt a token for storage
 */
export function encryptToken(token: string): string {
  if (!ENCRYPTION_KEY) return token; // Dev-only fallback
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored token
 */
export function decryptToken(stored: string): string {
  if (!ENCRYPTION_KEY) return stored; // Dev-only fallback
  const parts = stored.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return stored; // Legacy plaintext fallback
  const [ivHex, tagHex, encHex] = parts;
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Generate a random MCP token for user authentication
 */
export function generateMcpToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate OAuth state parameter
 */
export function generateOAuthState(): string {
  return crypto.randomBytes(16).toString('hex');
}
