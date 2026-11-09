/**
 * The sole production `CatalogAccessPolicyReader` adapter (access-policy.md): one uncached,
 * authenticated GetObject per call against a configured primary bucket, no CDN/replica/cache/
 * version-pinned/last-known-good fallback. Object location/region are server deployment
 * settings, never caller input. Fails closed on any structural or transport problem.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { parseDocument as parseYamlDocument } from 'yaml';

import {
  CATALOG_LIMITS,
  CREDENTIAL_ALIAS_PATTERN,
  POLICY_EPOCH_PATTERN,
  SOURCE_OWNER_PATTERN,
  SOURCE_REPOSITORY_PATTERN,
  isSafeSourceRef,
} from './config.js';
import type {
  CatalogAccessPolicyReader,
  PolicyDocument,
  PolicyReadResult,
  PolicyTenantEntry,
} from './types.js';

/** Tenant IDs are object keys; reject names that could reach the prototype chain instead of
 * becoming an own data property (data-model.md: policy identifiers are internal/untrusted shape). */
const UNSAFE_DICTIONARY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface S3PolicyReaderOptions {
  readonly bucket: string;
  readonly region: string;
  readonly key: string;
  readonly client?: S3Client;
  /** Injectable wall-clock source for the body-read deadline; defaults to `Date.now`. */
  readonly now?: () => number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads at most `maxBytes` from `body`, aborting as soon as `deadlineAt` (clock ms) passes —
 * the S3 read-order contract's two-second deadline covers the body, not just the SDK call. */
async function readBoundedBody(
  body: unknown,
  maxBytes: number,
  deadlineAt: number,
  now: () => number
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!body || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function') {
    return { ok: false };
  }
  const iterator = (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      if (now() > deadlineAt) {
        await iterator.return?.();
        return { ok: false };
      }
      const { done, value } = await iterator.next();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          await iterator.return?.();
          return { ok: false };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false };
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(merged) };
  } catch {
    return { ok: false };
  }
}

/** Validate the complete policy object; reject duplicate/unknown fields; fail closed. Never
 * throws: any unexpected parser exception is caught and reported as a structural failure. */
export function parsePolicyDocument(raw: string): PolicyReadResult {
  try {
    return parsePolicyDocumentUnsafe(raw);
  } catch {
    return { ok: false, reason: 'policy object could not be parsed' };
  }
}

function parsePolicyDocumentUnsafe(raw: string): PolicyReadResult {
  if (raw.length > CATALOG_LIMITS.POLICY_MAX_BYTES) {
    return { ok: false, reason: 'policy object exceeds the maximum allowed size' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'policy object is not valid JSON' };
  }

  const yamlDoc = parseYamlDocument(raw, { strict: true, uniqueKeys: true, merge: false });
  if (yamlDoc.errors.length > 0 || yamlDoc.warnings.length > 0) {
    return { ok: false, reason: 'policy object contains duplicate or malformed fields' };
  }

  if (!isPlainObject(parsed)) return { ok: false, reason: 'policy object root must be an object' };

  const rootKeys = Object.keys(parsed).sort();
  if (rootKeys.join(',') !== ['schemaVersion', 'tenants'].join(',')) {
    return { ok: false, reason: 'policy object has unexpected or missing root fields' };
  }
  if (parsed.schemaVersion !== 1) return { ok: false, reason: 'unsupported policy schemaVersion' };
  if (!isPlainObject(parsed.tenants))
    return { ok: false, reason: 'policy tenants field must be an object' };

  const tenantIds = Object.keys(parsed.tenants);
  if (tenantIds.length > CATALOG_LIMITS.POLICY_MAX_TENANTS) {
    return { ok: false, reason: 'policy object exceeds the maximum tenant entry count' };
  }

  const tenants: Record<string, PolicyTenantEntry> = Object.create(null) as Record<
    string,
    PolicyTenantEntry
  >;
  for (const tenantId of tenantIds) {
    if (
      UNSAFE_DICTIONARY_KEYS.has(tenantId) ||
      !Object.prototype.hasOwnProperty.call(parsed.tenants, tenantId)
    ) {
      return { ok: false, reason: 'policy tenant id is not a valid identifier' };
    }
    const entryResult = parseTenantEntry((parsed.tenants as Record<string, unknown>)[tenantId]);
    if (!entryResult.ok) return entryResult;
    tenants[tenantId] = entryResult.value;
  }

  const policy: PolicyDocument = { schemaVersion: 1, tenants: { ...tenants } };
  return { ok: true, policy };
}

function parseTenantEntry(
  rawEntry: unknown
): { ok: true; value: PolicyTenantEntry } | { ok: false; reason: string } {
  if (!isPlainObject(rawEntry))
    return { ok: false, reason: 'policy tenant entry must be an object' };

  const keys = Object.keys(rawEntry).sort();
  if (keys.join(',') !== ['approved', 'enabled', 'epoch', 'source'].join(',')) {
    return { ok: false, reason: 'policy tenant entry has unexpected or missing fields' };
  }

  const { epoch, enabled, approved, source } = rawEntry;
  if (typeof epoch !== 'string' || !POLICY_EPOCH_PATTERN.test(epoch)) {
    return { ok: false, reason: 'policy tenant epoch is not a valid UUID' };
  }
  if (typeof enabled !== 'boolean')
    return { ok: false, reason: 'policy tenant enabled must be boolean' };
  if (typeof approved !== 'boolean')
    return { ok: false, reason: 'policy tenant approved must be boolean' };
  if (!isPlainObject(source))
    return { ok: false, reason: 'policy tenant source must be an object' };

  const sourceKeys = Object.keys(source).sort();
  if (
    sourceKeys.join(',') !== ['credentialAlias', 'owner', 'provider', 'ref', 'repository'].join(',')
  ) {
    return { ok: false, reason: 'policy tenant source has unexpected or missing fields' };
  }
  const { provider, owner, repository, ref, credentialAlias } = source;
  if (provider !== 'github')
    return { ok: false, reason: 'policy tenant source provider is unsupported' };
  if (
    typeof owner !== 'string' ||
    owner.length > CATALOG_LIMITS.SOURCE_OWNER_MAX_LENGTH ||
    !SOURCE_OWNER_PATTERN.test(owner)
  ) {
    return { ok: false, reason: 'policy tenant source owner is invalid' };
  }
  if (
    typeof repository !== 'string' ||
    repository.length > CATALOG_LIMITS.SOURCE_REPOSITORY_MAX_LENGTH ||
    !SOURCE_REPOSITORY_PATTERN.test(repository)
  ) {
    return { ok: false, reason: 'policy tenant source repository is invalid' };
  }
  if (typeof ref !== 'string' || !isSafeSourceRef(ref)) {
    return { ok: false, reason: 'policy tenant source ref is invalid' };
  }
  if (
    typeof credentialAlias !== 'string' ||
    credentialAlias.length > CATALOG_LIMITS.CREDENTIAL_ALIAS_MAX_LENGTH ||
    !CREDENTIAL_ALIAS_PATTERN.test(credentialAlias)
  ) {
    return { ok: false, reason: 'policy tenant source credentialAlias is invalid' };
  }

  return {
    ok: true,
    value: {
      epoch,
      enabled,
      approved,
      source: { provider: 'github', owner, repository, ref, credentialAlias },
    },
  };
}

export function createS3PolicyReader(options: S3PolicyReaderOptions): CatalogAccessPolicyReader {
  const client =
    options.client ??
    new S3Client({ region: options.region, maxAttempts: 1, followRegionRedirects: false });
  const now = options.now ?? Date.now;

  return {
    async readPolicy(signal: AbortSignal): Promise<PolicyReadResult> {
      if (signal.aborted) return { ok: false, reason: 'policy read was already cancelled' };

      const deadlineAt = now() + CATALOG_LIMITS.POLICY_READ_DEADLINE_MS;
      const deadlineController = new AbortController();
      const timer = setTimeout(
        () => deadlineController.abort(),
        CATALOG_LIMITS.POLICY_READ_DEADLINE_MS
      );
      const onExternalAbort = () => deadlineController.abort();
      signal.addEventListener('abort', onExternalAbort);

      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: options.key }),
          { abortSignal: deadlineController.signal }
        );
        // The 2-second deadline covers the whole call including the body (access-policy.md);
        // the SDK call above may have already consumed part of it.
        const bodyResult = await readBoundedBody(
          response.Body,
          CATALOG_LIMITS.POLICY_MAX_BYTES,
          deadlineAt,
          now
        );
        if (!bodyResult.ok)
          return { ok: false, reason: 'policy object could not be read within bounds' };
        return parsePolicyDocument(bodyResult.text);
      } catch {
        return { ok: false, reason: 'policy read failed' };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

/** In-memory shared authority for deterministic tests (e.g. two instances observing one disable). */
export interface FakePolicyAuthority {
  policy: PolicyDocument | null;
  failure?: string;
  delayMs?: number;
}

export function createFakePolicyReader(authority: FakePolicyAuthority): CatalogAccessPolicyReader {
  return {
    async readPolicy(signal: AbortSignal): Promise<PolicyReadResult> {
      if (authority.delayMs && authority.delayMs > 0) {
        // Never let an abort-during-delay escape as an unhandled rejection; fail closed
        // with a typed result like every other path through this port.
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, authority.delayMs);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      if (signal.aborted) return { ok: false, reason: 'policy read timed out' };
      if (authority.failure) return { ok: false, reason: authority.failure };
      if (!authority.policy) return { ok: false, reason: 'policy object not found' };
      return { ok: true, policy: authority.policy };
    },
  };
}
