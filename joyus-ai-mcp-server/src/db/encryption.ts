/**
 * Token Encryption Utilities
 * AES-256 encryption for OAuth tokens at rest
 */

import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
  console.warn('⚠️  TOKEN_ENCRYPTION_KEY not set - tokens will not be encrypted!');
}

/**
 * Encrypt a token for storage
 */
export function encryptToken(token: string): string {
  if (!ENCRYPTION_KEY) {
    return token; // Dev fallback - not for production!
  }
  return CryptoJS.AES.encrypt(token, ENCRYPTION_KEY).toString();
}

/**
 * Decrypt a stored token
 */
export function decryptToken(encryptedToken: string): string {
  if (!ENCRYPTION_KEY) {
    return encryptedToken;
  }
  const bytes = CryptoJS.AES.decrypt(encryptedToken, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Generate a random MCP token for user authentication
 */
export function generateMcpToken(): string {
  return CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Hex);
}

/**
 * Generate OAuth state parameter
 */
export function generateOAuthState(): string {
  return CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
}
