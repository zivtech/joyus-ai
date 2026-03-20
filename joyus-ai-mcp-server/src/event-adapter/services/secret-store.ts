/**
 * Event Adapter — Secret Store (T039)
 *
 * AES-256-GCM encryption/decryption for webhook auth secrets.
 * Encrypted blobs are stored as base64(iv + authTag + ciphertext).
 *
 * Key source: process.env.EVENT_ADAPTER_SECRET_KEY (64 hex chars = 32 bytes).
 * In development, if the key is not set, a fixed fallback is used with a warning.
 *
 * This module also exports SecretStoreResolver — a SecretResolver implementation
 * that decrypts stored secret refs for use in auth validation.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { SecretResolver } from './auth-validator.js';

// ============================================================
// CONSTANTS
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Fallback key used only when no key is configured (development / test).
// 64 hex chars = 32 bytes of zeros — never use in production.
const DEV_FALLBACK_KEY = '0'.repeat(64);

// ============================================================
// KEY RESOLUTION
// ============================================================

function resolveKey(): Buffer {
  const raw = process.env.EVENT_ADAPTER_SECRET_KEY;
  if (!raw) {
    console.warn(
      '[secret-store] EVENT_ADAPTER_SECRET_KEY is not set. ' +
      'Using insecure dev fallback key. DO NOT use in production.',
    );
    return Buffer.from(DEV_FALLBACK_KEY, 'hex');
  }

  if (raw.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      '[secret-store] EVENT_ADAPTER_SECRET_KEY must be exactly 64 hex characters (32 bytes). ' +
      `Got ${raw.length} characters.`,
    );
  }

  return Buffer.from(raw, 'hex');
}

// ============================================================
// ENCRYPT
// ============================================================

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 *
 * @param plaintext - The secret to encrypt
 * @returns Base64-encoded string: iv (12 bytes) + authTag (16 bytes) + ciphertext
 */
export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Layout: iv (12) + authTag (16) + ciphertext (variable)
  const blob = Buffer.concat([iv, authTag, ciphertext]);
  return blob.toString('base64');
}

// ============================================================
// DECRYPT
// ============================================================

/**
 * Decrypt an AES-256-GCM encrypted secret.
 *
 * @param encrypted - Base64-encoded blob from encryptSecret()
 * @returns The original plaintext, or null if decryption fails
 */
export function decryptSecret(encrypted: string): string | null {
  try {
    const key = resolveKey();
    const blob = Buffer.from(encrypted, 'base64');

    if (blob.length < IV_BYTES + AUTH_TAG_BYTES + 1) {
      console.error('[secret-store] Encrypted blob is too short to be valid');
      return null;
    }

    const iv = blob.subarray(0, IV_BYTES);
    const authTag = blob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = blob.subarray(IV_BYTES + AUTH_TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return plaintext.toString('utf8');
  } catch (err) {
    console.error('[secret-store] Decryption failed', err instanceof Error ? err.message : err);
    return null;
  }
}

// ============================================================
// SECRET RESOLVER IMPLEMENTATION
// ============================================================

/**
 * SecretResolver implementation backed by AES-256-GCM decryption.
 *
 * Secret refs stored in authConfig (e.g., authConfig.secretRef) are
 * base64-encoded encrypted blobs produced by encryptSecret().
 * This resolver decrypts them on demand for auth validation.
 */
export class SecretStoreResolver implements SecretResolver {
  async resolve(secretRef: string): Promise<string | null> {
    if (!secretRef) return null;
    return decryptSecret(secretRef);
  }
}
