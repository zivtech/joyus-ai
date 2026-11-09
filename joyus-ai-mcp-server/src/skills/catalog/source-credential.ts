/**
 * Resolves a tenant policy's `credentialAlias` to an actual source-read secret value
 * (access-policy.md, data-model.md: "excludes credentials from cache identity/log output").
 *
 * A policy object lives in a shared authority (S3) an operator controls, but it is still
 * external input to this process. `credentialAlias` must never be usable to read an
 * arbitrary environment variable: it is validated against `CREDENTIAL_ALIAS_PATTERN`
 * (config.ts) and combined with a server-configured, non-empty prefix before lookup, so a
 * malformed or hostile policy object can at most reach names under that one prefix.
 */
import { CATALOG_LIMITS, CREDENTIAL_ALIAS_PATTERN } from './config.js';
import { resolveAliasedSecret } from './config.js';

export interface SourceCredentialLookup {
  readonly aliasPrefix: string;
  readonly credentialAlias: string;
}

/** True only for an alias shape safe to splice into an env var name. */
export function isSafeCredentialAlias(alias: string): boolean {
  return (
    alias.length > 0 &&
    alias.length <= CATALOG_LIMITS.CREDENTIAL_ALIAS_MAX_LENGTH &&
    CREDENTIAL_ALIAS_PATTERN.test(alias)
  );
}

/**
 * Builds the env var name a source credential is read from, or `undefined` if the prefix
 * is not configured (isolation is off by default — no implicit access to bare alias names)
 * or the alias/combined name is unsafe.
 */
export function resolveSourceCredentialEnvName(lookup: SourceCredentialLookup): string | undefined {
  if (lookup.aliasPrefix.trim().length === 0) return undefined;
  if (!isSafeCredentialAlias(lookup.credentialAlias)) return undefined;
  const envName = `${lookup.aliasPrefix}${lookup.credentialAlias}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) return undefined;
  return envName;
}

/** Resolve the actual credential value for one tenant's policy-supplied alias. Never logs it. */
export function resolveSourceCredential(
  lookup: SourceCredentialLookup,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const envName = resolveSourceCredentialEnvName(lookup);
  if (!envName) return undefined;
  return resolveAliasedSecret(envName, env);
}
