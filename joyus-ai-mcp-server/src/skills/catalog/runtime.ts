import { config as serverConfig } from '../../config.js';
import { HttpSkillDecisionProvider } from '../../policy/skills.js';

/**
 * Lazily assembles the catalog service from environment configuration. Importing this
 * module has no side effects — construction only happens on first `getCatalogRuntime()`
 * call — so WP02 can import the runtime getter directly without triggering `index.ts`'s
 * server bootstrap.
 */
import { loadCatalogConfig, resolveAliasedSecret, type CatalogEnvConfig } from './config.js';
import { cursorKey } from './cursor.js';
import { createS3PolicyReader } from './policy-s3.js';
import { createGithubCatalogSourcePort } from './service-source.js';
import { createCatalogService, type CatalogService } from './service.js';
import { resolveSourceCredential } from './source-credential.js';
import type { CatalogAccessPolicyReader } from './types.js';

export interface CatalogRuntime {
  readonly service: CatalogService;
  readonly config: CatalogEnvConfig;
  readonly policyReader: CatalogAccessPolicyReader;
  readonly decisions: HttpSkillDecisionProvider;
  readonly cursorKey: Buffer;
}

let runtime: CatalogRuntime | undefined;
let initAttempted = false;

function buildRuntime(config: CatalogEnvConfig, env: NodeJS.ProcessEnv): CatalogRuntime {
  const policyReader = createS3PolicyReader({
    bucket: config.policyBucket,
    region: config.policyRegion,
    key: config.policyKey,
  });
  const sourcePort = createGithubCatalogSourcePort();
  const key = cursorKey(resolveAliasedSecret(config.cursorKeyAlias, env));
  const sharesCursorKey = (value: string | undefined): boolean =>
    value !== undefined && /^[a-f0-9]{64}$/i.test(value) && value.toLowerCase() === key.toString('hex');
  const resolveCredential = (credentialAlias: string): string | undefined => {
    const value = resolveSourceCredential(
      { aliasPrefix: config.sourceCredentialAliasPrefix, credentialAlias },
      env
    );
    return sharesCursorKey(value) ? undefined : value;
  };

  const service = createCatalogService({ policyReader, sourcePort, resolveCredential });
  const policyUrl = env.POLICY_SERVICE_URL ?? serverConfig.POLICY_SERVICE_URL;
  const policyToken = env.POLICY_SERVICE_TOKEN ?? serverConfig.POLICY_SERVICE_TOKEN;
  if (!policyUrl || !policyToken)
    throw new Error('Protected catalog requires policy configuration');
  const refreshSecret = resolveAliasedSecret(config.refreshAuthSecretAlias, env);
  if (sharesCursorKey(refreshSecret) || sharesCursorKey(policyToken))
    throw new Error('Catalog cursor key must be separate');
  return {
    service,
    config,
    policyReader,
    cursorKey: key,
    decisions: new HttpSkillDecisionProvider({ baseUrl: policyUrl, serviceToken: policyToken }),
  };
}

/**
 * Returns the process-wide catalog runtime, building it on first successful call.
 * Returns undefined (never throws) when required configuration is absent, per
 * refresh.md's non-blocking-startup rule: the optional catalog stays unavailable
 * without preventing the rest of the server from starting.
 */
export function getCatalogRuntime(
  env: NodeJS.ProcessEnv = process.env
): CatalogRuntime | undefined {
  if (runtime) return runtime;
  if (initAttempted) return undefined;
  initAttempted = true;

  const configResult = loadCatalogConfig(env);
  if (!configResult.ok) return undefined;

  runtime = buildRuntime(configResult.config, env);
  return runtime;
}

/** Test-only: clears the memoized runtime so a fresh environment can be exercised. */
export function resetCatalogRuntimeForTests(): void {
  runtime = undefined;
  initAttempted = false;
}
