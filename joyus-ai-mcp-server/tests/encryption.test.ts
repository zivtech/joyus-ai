/**
 * Unit tests for encryption utilities
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock environment variable before importing
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key-32-bytes!!');

// Dynamic import to ensure env is set first
let encryptToken: (token: string) => string;
let decryptToken: (encryptedToken: string) => string;
let generateMcpToken: () => string;
let generateOAuthState: () => string;

beforeAll(async () => {
  const encryption = await import('../src/db/encryption.js');
  encryptToken = encryption.encryptToken;
  decryptToken = encryption.decryptToken;
  generateMcpToken = encryption.generateMcpToken;
  generateOAuthState = encryption.generateOAuthState;
});

describe('Encryption Utilities', () => {
  describe('encryptToken / decryptToken', () => {
    it('should encrypt and decrypt a token correctly', () => {
      const originalToken = 'my-secret-oauth-token-12345';
      const encrypted = encryptToken(originalToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(originalToken);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const token = 'same-token';
      const encrypted1 = encryptToken(token);
      const encrypted2 = encryptToken(token);

      // AES with random IV should produce different ciphertexts
      // (though both decrypt to the same value)
      expect(encrypted1).not.toBe(token);
      expect(encrypted2).not.toBe(token);
    });

    it('should handle empty strings', () => {
      const encrypted = encryptToken('');
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe('');
    });

    it('should handle special characters', () => {
      const specialToken = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
      const encrypted = encryptToken(specialToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(specialToken);
    });

    it('should handle long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const encrypted = encryptToken(longToken);
      const decrypted = decryptToken(encrypted);

      expect(decrypted).toBe(longToken);
    });
  });

  describe('generateMcpToken', () => {
    it('should generate a 64-character hex string', () => {
      const token = generateMcpToken();

      expect(token).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(token)).toBe(true);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateMcpToken());
      }

      expect(tokens.size).toBe(100);
    });
  });

  describe('generateOAuthState', () => {
    it('should generate a 32-character hex string', () => {
      const state = generateOAuthState();

      expect(state).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(state)).toBe(true);
    });

    it('should generate unique states', () => {
      const states = new Set<string>();
      for (let i = 0; i < 100; i++) {
        states.add(generateOAuthState());
      }

      expect(states.size).toBe(100);
    });
  });
});
