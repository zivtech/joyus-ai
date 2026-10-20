/**
 * Startup registry post (spec 016 WP03 T019): the platform tells the policy
 * service every tool name `getAllTools` can return, so denies can be expressed
 * against them. Additive on the service side; failure here never stops startup.
 */

export interface RegistryPostOptions {
  baseUrl: string;
  serviceToken: string;
  toolNames: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function postToolRegistry(options: RegistryPostOptions): Promise<{ created: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, '');
  const names = [...new Set(options.toolNames)].sort();
  const response = await fetchImpl(`${base}/policy/registry`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.serviceToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tools: names.map((name) => ({ name })) }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    redirect: 'error',
  });
  if (response.status !== 200) throw new Error(`policy registry post failed: HTTP ${response.status}`);
  const body = (await response.json()) as { created?: number };
  return { created: typeof body.created === 'number' ? body.created : 0 };
}
