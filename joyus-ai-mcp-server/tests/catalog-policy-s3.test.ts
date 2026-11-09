import { describe, it, expect, vi } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

import { createFakePolicyReader, createS3PolicyReader, parsePolicyDocument } from '../src/skills/catalog/policy-s3.js';

const VALID_EPOCH = '00000000-0000-4000-8000-000000000000';

function validPolicyJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    tenants: {
      'example-tenant-id': {
        epoch: VALID_EPOCH,
        enabled: true,
        approved: true,
        source: {
          provider: 'github',
          owner: 'example-org',
          repository: 'example-skills-corpus',
          ref: 'main',
          credentialAlias: 'EXAMPLE_TENANT_TOKEN',
        },
        ...overrides,
      },
    },
  });
}

describe('parsePolicyDocument — epoch', () => {
  it('accepts a well-formed UUID epoch', () => {
    const result = parsePolicyDocument(validPolicyJson());
    expect(result.ok).toBe(true);
  });

  it('rejects a nonempty but non-UUID epoch', () => {
    const result = parsePolicyDocument(validPolicyJson({ epoch: 'not-a-uuid' }));
    expect(result.ok).toBe(false);
  });
});

describe('parsePolicyDocument — source identifier restrictions', () => {
  it.each([
    ['owner', 'has space'],
    ['owner', '-leading-hyphen'],
    ['repository', 'has space'],
    ['ref', '../escape'],
    ['ref', ''],
    ['credentialAlias', 'has space'],
    ['credentialAlias', '1starts-with-digit'],
  ])('rejects an unsafe %s value %j', (field, value) => {
    const raw = JSON.parse(validPolicyJson());
    raw.tenants['example-tenant-id'].source[field] = value;
    const result = parsePolicyDocument(JSON.stringify(raw));
    expect(result.ok).toBe(false);
  });

  it('rejects an overlong ref beyond the configured bound', () => {
    const raw = JSON.parse(validPolicyJson());
    raw.tenants['example-tenant-id'].source.ref = 'a'.repeat(257);
    const result = parsePolicyDocument(JSON.stringify(raw));
    expect(result.ok).toBe(false);
  });
});

describe('parsePolicyDocument — dictionary key hardening', () => {
  it('rejects a tenant id of "__proto__" rather than polluting the prototype chain', () => {
    const entry = JSON.parse(validPolicyJson()).tenants['example-tenant-id'];
    const rawJson = `{"schemaVersion":1,"tenants":{"__proto__":${JSON.stringify(entry)}}}`;
    // JSON.parse defines "__proto__" as an own data property here (not a [[Set]]), so this
    // exercises the parser's own-property/key-denylist guard, not a real pollution vector.
    expect(JSON.parse(rawJson).tenants.__proto__).toEqual(entry);
    const result = parsePolicyDocument(rawJson);
    expect(result.ok).toBe(false);
  });
});

describe('parsePolicyDocument — parser safety', () => {
  it('never throws for structurally hostile input', () => {
    expect(() => parsePolicyDocument('{"schemaVersion": 1, "tenants": {"a": [1,2,3]}}')).not.toThrow();
    expect(() => parsePolicyDocument('not json at all {{{')).not.toThrow();
  });
});

function fakeS3Client(bodyText: string, delayMs = 0): S3Client {
  return {
    async send() {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const encoded = new TextEncoder().encode(bodyText);
      return {
        Body: (async function* () {
          yield encoded;
        })(),
      };
    },
  } as unknown as S3Client;
}

describe('createS3PolicyReader', () => {
  it('reads and parses a valid policy object', async () => {
    const reader = createS3PolicyReader({
      bucket: 'example-bucket',
      region: 'us-east-1',
      key: 'policy.json',
      client: fakeS3Client(validPolicyJson()),
    });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result.ok).toBe(true);
  });

  it('fails closed immediately when given an already-aborted signal', async () => {
    const send = vi.fn();
    const reader = createS3PolicyReader({
      bucket: 'example-bucket',
      region: 'us-east-1',
      key: 'policy.json',
      client: { send } as unknown as S3Client,
    });
    const controller = new AbortController();
    controller.abort();
    const result = await reader.readPolicy(controller.signal);
    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when body streaming exceeds the deadline', async () => {
    let ticks = 0;
    const reader = createS3PolicyReader({
      bucket: 'example-bucket',
      region: 'us-east-1',
      key: 'policy.json',
      now: () => {
        ticks += 1;
        return ticks > 1 ? 1_000_000 : 0;
      },
      client: {
        async send() {
          return {
            Body: (async function* () {
              yield new TextEncoder().encode('{"schemaVersion":1,');
              yield new TextEncoder().encode('"tenants":{}}');
            })(),
          };
        },
      } as unknown as S3Client,
    });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result.ok).toBe(false);
  });

  it('fails closed when the client throws', async () => {
    const reader = createS3PolicyReader({
      bucket: 'example-bucket',
      region: 'us-east-1',
      key: 'policy.json',
      client: { async send() { throw new Error('network error'); } } as unknown as S3Client,
    });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result.ok).toBe(false);
  });

  it('fails closed when the body exceeds the maximum size', async () => {
    const reader = createS3PolicyReader({
      bucket: 'example-bucket',
      region: 'us-east-1',
      key: 'policy.json',
      client: fakeS3Client('x'.repeat(1024 * 1024 + 1)),
    });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result.ok).toBe(false);
  });
});

describe('createFakePolicyReader', () => {
  it('returns the configured policy after an optional delay', async () => {
    const policy = JSON.parse(validPolicyJson());
    const reader = createFakePolicyReader({ policy, delayMs: 1 });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result).toEqual({ ok: true, policy });
  });

  it('reports a configured failure reason', async () => {
    const reader = createFakePolicyReader({ policy: null, failure: 'unavailable' });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reports missing policy when none is configured', async () => {
    const reader = createFakePolicyReader({ policy: null });
    const result = await reader.readPolicy(new AbortController().signal);
    expect(result.ok).toBe(false);
  });

  it('fails closed when aborted during the configured delay', async () => {
    const reader = createFakePolicyReader({ policy: JSON.parse(validPolicyJson()), delayMs: 50 });
    const controller = new AbortController();
    const resultPromise = reader.readPolicy(controller.signal);
    controller.abort();
    const result = await resultPromise;
    expect(result.ok).toBe(false);
  });
});
