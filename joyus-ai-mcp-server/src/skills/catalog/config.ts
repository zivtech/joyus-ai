/**
 * Operator configuration and named bounds for the organization skill catalog.
 * Loads alias/location config only; secret VALUES are resolved by the adapters
 * that need them (source-github.ts, policy-s3.ts, refresh-routes.ts), never here.
 */

const KiB = 1024;
const MiB = 1024 * KiB;

/** FR-10 / catalog-source.md / refresh.md bounds, named rather than inlined. */
export const CATALOG_LIMITS = {
  MAX_ENTRIES: 1000,
  MAX_INDEX_BYTES: 1 * MiB,
  MAX_TREE_BYTES: 1 * MiB,
  MAX_DOCUMENT_BYTES: 256 * KiB,
  MAX_GENERATION_DOCUMENT_BYTES: 16 * MiB,
  MAX_ACTIVE_DOCUMENT_BYTES: 32 * MiB,
  MAX_TOTAL_DOCUMENT_BYTES: 64 * MiB,
  CANDIDATE_TIMEOUT_MS: 120_000,
  MAX_CONCURRENT_DOWNLOADS: 4,
  REFRESH_INTERVAL_MS: 5 * 60 * 1000,
  STALE_CEILING_MS: 60 * 60 * 1000,
  MAX_QUEUED_SOURCES: 1000,
  MAX_ACTIVE_CANDIDATES: 2,
  CANDIDATE_RELEASE_WAIT_MS: 5000,
  POLICY_MAX_BYTES: 1 * MiB,
  POLICY_MAX_TENANTS: 1000,
  POLICY_READ_DEADLINE_MS: 2000,
  ACCESS_READ_DEADLINE_MS: 5000,
  REFRESH_BODY_MAX_BYTES: 1 * KiB,
  REFRESH_REF_MAX_BYTES: 256,
  REFRESH_RATE_LIMIT_WINDOW_MS: 60_000,
  REFRESH_RATE_LIMIT_BURST: 1,
  REFRESH_STATUS_RETENTION_MS: 10 * 60 * 1000,
  REFRESH_STATUS_MAX_RECORDS: 100,
  NAME_MAX_LENGTH: 100,
  EXPECTED_REVISION_MAX_LENGTH: 128,
  CURSOR_MAX_BYTES: 2048,
  LIST_PAGE_SIZE_DEFAULT: 20,
  LIST_PAGE_SIZE_MAX: 100,
  CREDENTIAL_ALIAS_MAX_LENGTH: 64,
  SOURCE_OWNER_MAX_LENGTH: 39,
  SOURCE_REPOSITORY_MAX_LENGTH: 100,
  SOURCE_REF_MAX_LENGTH: 256,
} as const;

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Env-var-safe alias name: a policy-supplied `credentialAlias` must look like this before
 * it is ever combined with `sourceCredentialAliasPrefix` to form the env var actually read
 * (source-credential.ts). Bounds which secrets a compromised/misconfigured policy object
 * can reach — never an arbitrary string. */
export const CREDENTIAL_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** GitHub owner/org login shape (server adapter restriction, catalog-source.md / access-policy.md). */
export const SOURCE_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** GitHub repository name shape. */
export const SOURCE_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Conservative git ref/branch/tag name shape: no whitespace/control chars, no `..`, no
 * leading/trailing separator; rejects the constructs `git check-ref-format` also rejects. */
export const SOURCE_REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;

export function isSafeSourceRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > CATALOG_LIMITS.SOURCE_REF_MAX_LENGTH) return false;
  if (!SOURCE_REF_PATTERN.test(ref)) return false;
  if (ref.includes('..') || ref.includes('//') || ref.includes('@{')) return false;
  return true;
}

/** Policy epoch is an equality token, not a sortable counter, but must be a well-formed UUID
 * (access-policy.md: "a new UUID on every policy change"). */
export const POLICY_EPOCH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** GitHub blob/commit object IDs (SHA-1 or SHA-256 repos); identity only, never an ordering clock. */
export const GITHUB_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export interface CatalogEnvConfig {
  /** Name of the env var holding the refresh-trigger bearer secret value (never the value itself). */
  readonly refreshAuthSecretAlias: string;
  /** Name of the env var holding the cursor AEAD key (never the value itself). */
  readonly cursorKeyAlias: string;
  /** Optional prefix applied to a policy-supplied `credentialAlias` to form the env var name for that tenant's source-read credential. */
  readonly sourceCredentialAliasPrefix: string;
  readonly policyBucket: string;
  readonly policyRegion: string;
  readonly policyKey: string;
}

export type CatalogConfigResult =
  | { readonly ok: true; readonly config: CatalogEnvConfig }
  | { readonly ok: false; readonly error: string };

const REQUIRED_ENV_KEYS = [
  'CATALOG_REFRESH_AUTH_SECRET_ALIAS',
  'CATALOG_CURSOR_KEY_ALIAS',
  'CATALOG_POLICY_BUCKET',
  'CATALOG_POLICY_REGION',
  'CATALOG_POLICY_KEY',
] as const;

/**
 * Load optional catalog configuration from the environment. Never throws: a missing
 * required alias yields a sanitized `{ ok: false }` result so the main server can
 * start with the catalog feature simply unavailable (FR-15, refresh.md startup rule).
 */
export function loadCatalogConfig(env: NodeJS.ProcessEnv = process.env): CatalogConfigResult {
  const missing = REQUIRED_ENV_KEYS.filter(key => !env[key] || env[key]!.trim().length === 0);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `catalog configuration incomplete: missing ${missing.length} required alias(es)`,
    };
  }

  return {
    ok: true,
    config: {
      refreshAuthSecretAlias: env.CATALOG_REFRESH_AUTH_SECRET_ALIAS!,
      cursorKeyAlias: env.CATALOG_CURSOR_KEY_ALIAS!,
      sourceCredentialAliasPrefix: env.CATALOG_SOURCE_CREDENTIAL_ALIAS_PREFIX ?? '',
      policyBucket: env.CATALOG_POLICY_BUCKET!,
      policyRegion: env.CATALOG_POLICY_REGION!,
      policyKey: env.CATALOG_POLICY_KEY!,
    },
  };
}

/** Resolve a secret VALUE by env-var name (the alias). Never logs or embeds the value. */
export function resolveAliasedSecret(
  aliasEnvVarName: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const value = env[aliasEnvVarName];
  return value && value.trim().length > 0 ? value : undefined;
}
