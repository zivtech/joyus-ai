import { describe, expect, it, vi } from 'vitest';

import type { ContentApiKey } from '../../src/content/schema.js';
import {
  type ApiKeyCommandService,
  runMediationApiKeyCommand,
} from '../../src/content/mediation/api-key-cli.js';

function apiKeyRecord(overrides: Partial<ContentApiKey> = {}): ContentApiKey {
  return {
    id: 'key-1',
    tenantId: 'tenant-1',
    keyHash: 'stored-hash-that-must-not-print',
    keyPrefix: 'jyk_list',
    integrationName: 'Example Integration',
    jwksUri: 'https://idp.example.com/.well-known/jwks.json',
    issuer: null,
    audience: null,
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date('2026-05-25T12:00:00.000Z'),
    ...overrides,
  };
}

function createService(overrides: Partial<ApiKeyCommandService> = {}): ApiKeyCommandService {
  return {
    createKey: vi.fn().mockResolvedValue({
      id: 'key-1',
      key: 'jyk_raw_secret_1234567890',
      keyPrefix: 'jyk_raw',
    }),
    listKeys: vi.fn().mockResolvedValue([]),
    revokeKey: vi.fn().mockResolvedValue({
      status: 'revoked',
      key: apiKeyRecord({ isActive: false }),
    }),
    ...overrides,
  };
}

async function runCommand(args: string[], service: ApiKeyCommandService) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runMediationApiKeyCommand(args, {
    service,
    io: {
      stdout: message => stdout.push(message),
      stderr: message => stderr.push(message),
    },
  });

  return {
    exitCode,
    stdout: stdout.join('\n'),
    stderr: stderr.join('\n'),
  };
}

describe('mediation API key CLI', () => {
  it('creates a key, passes metadata to the service, and prints the raw key exactly once', async () => {
    const service = createService();

    const result = await runCommand(
      [
        'create',
        '--tenant-id',
        'tenant-1',
        '--integration-name',
        'Example Integration',
        '--jwks-uri',
        'https://idp.example.com/.well-known/jwks.json',
        '--issuer',
        'https://idp.example.com',
        '--audience',
        'api://mediation',
      ],
      service
    );

    expect(result.exitCode).toBe(0);
    expect(service.createKey).toHaveBeenCalledWith('tenant-1', {
      integrationName: 'Example Integration',
      jwksUri: 'https://idp.example.com/.well-known/jwks.json',
      issuer: 'https://idp.example.com',
      audience: 'api://mediation',
    });
    expect(result.stdout.match(/jyk_raw_secret_1234567890/g)).toHaveLength(1);
    expect(result.stdout).toContain('Key ID: key-1');
    expect(result.stdout).toContain('Key prefix: jyk_raw');
  });

  it('lists only safe key metadata without raw keys or hashes', async () => {
    const service = createService({
      listKeys: vi.fn().mockResolvedValue([
        apiKeyRecord({
          keyHash: 'do-not-print-this-hash',
          keyPrefix: 'jyk_safe',
        }),
      ]),
    });

    const result = await runCommand(['list', '--tenant-id', 'tenant-1'], service);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Key prefix: jyk_safe');
    expect(result.stdout).toContain('Integration: Example Integration');
    expect(result.stdout).not.toContain('do-not-print-this-hash');
    expect(result.stdout).not.toContain('keyHash');
  });

  it('revokes a key and prints safe metadata', async () => {
    const service = createService();

    const result = await runCommand(['revoke', '--key-id', 'key-1'], service);

    expect(result.exitCode).toBe(0);
    expect(service.revokeKey).toHaveBeenCalledWith('key-1');
    expect(result.stdout).toContain('Mediation API key revoked.');
    expect(result.stdout).toContain('Active: no');
    expect(result.stdout).not.toContain('stored-hash-that-must-not-print');
  });

  it('handles missing and already revoked keys predictably', async () => {
    const missingService = createService({
      revokeKey: vi.fn().mockResolvedValue({ status: 'not_found' }),
    });
    const missing = await runCommand(['revoke', '--key-id', 'missing-key'], missingService);

    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('No mediation API key found');

    const alreadyRevokedService = createService({
      revokeKey: vi.fn().mockResolvedValue({
        status: 'already_revoked',
        key: apiKeyRecord({ isActive: false }),
      }),
    });
    const alreadyRevoked = await runCommand(['revoke', '--key-id', 'key-1'], alreadyRevokedService);

    expect(alreadyRevoked.exitCode).toBe(0);
    expect(alreadyRevoked.stdout).toContain('already revoked');
  });

  it('fails invalid create inputs before calling the service', async () => {
    const service = createService();

    const missingRequired = await runCommand(
      ['create', '--tenant-id', 'tenant-1', '--integration-name', 'Example Integration'],
      service
    );

    expect(missingRequired.exitCode).toBe(1);
    expect(missingRequired.stderr).toContain('Missing required option: --jwks-uri');
    expect(service.createKey).not.toHaveBeenCalled();

    const invalidUrl = await runCommand(
      [
        'create',
        '--tenant-id',
        'tenant-1',
        '--integration-name',
        'Example Integration',
        '--jwks-uri',
        'not-a-url',
      ],
      service
    );

    expect(invalidUrl.exitCode).toBe(1);
    expect(invalidUrl.stderr).toContain('Invalid URL for --jwks-uri');
    expect(service.createKey).not.toHaveBeenCalled();
  });
});
