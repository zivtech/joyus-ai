/**
 * The ONLY place the spike talks to Headroom. WIRED to the local Headroom proxy.
 *
 * Finding (recorded in the SpikeReport): the npm `headroom-ai` package is a thin
 * client to the Headroom *proxy* — there is no in-process compression and no
 * `retrieve()` in the npm package at its current version. The real compression
 * engine and the CCR originals store live in the Python proxy. So both candidate
 * "modes" in a TS/Node MCP server collapse to the same surface: talk to the proxy.
 *   - compress  -> POST /v1/compress       (returns compressed messages + tiktoken counts)
 *   - retrieve  -> GET  /v1/retrieve/{hash} (returns the byte-identical original for a CCR hash)
 *
 * Versions are pinned and recorded (C-001): the proxy ENGINE version dominates
 * behavior; the npm client is incidental.
 */

export type DeployMode = 'library' | 'proxy';
export type PayloadKind = 'content_mcp' | 'rag_chunk' | 'executor_output';

export interface CompressInput {
  tenantId: string;
  kind: PayloadKind;
  content: string;
  mode: DeployMode;
}

export interface CompressResult {
  compressed: string;
  originalRef: string; // CCR hash when a large field was dropped; '' when compressed inline
  lossless: boolean;   // true when a CCR marker backs the drop (original retrievable)
  tokensBefore: number; // proxy tiktoken count (honest, real tokenizer — NFR-007)
  tokensAfter: number;
}

/**
 * Pinned versions used for this run (C-001). The proxy engine is what compresses.
 * proxy engine: Python `headroom-ai` 0.22.3 ; npm client `headroom-ai` 0.1.0 (proxy client).
 */
export const HEADROOM_VERSION = 'proxy-engine=headroom-ai@0.22.3; npm-client=headroom-ai@0.1.0';

const PROXY = process.env.HEADROOM_BASE_URL ?? 'http://127.0.0.1:8787';
const CCR_MARKER = /<<ccr:([A-Za-z0-9]+)/;

/** Compress a single payload by sending it as a tool message to the proxy. */
export async function compress(input: CompressInput): Promise<CompressResult> {
  const res = await fetch(`${PROXY}/v1/compress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'tool', tool_call_id: 'c1', content: input.content }],
    }),
  });
  if (!res.ok) throw new Error(`proxy /v1/compress ${res.status}`);
  const r = (await res.json()) as {
    messages: Array<{ role: string; content: string }>;
    tokens_before: number;
    tokens_after: number;
  };
  const toolMsg = r.messages.find((m) => m.role === 'tool');
  const compressed = typeof toolMsg?.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg?.content);
  const hash = compressed.match(CCR_MARKER)?.[1] ?? '';
  return {
    compressed,
    originalRef: hash,
    lossless: hash !== '',
    tokensBefore: r.tokens_before,
    tokensAfter: r.tokens_after,
  };
}

/**
 * Retrieve the exact original for a CCR hash. Must be byte-identical (NFR-004).
 * NOTE: the proxy CCR store is content-addressed and global by default; per-tenant
 * isolation requires HEADROOM_CCR_TENANT_PREFIX or a per-tenant backend. The tenantId
 * is carried here to model that requirement, but the default store ignores it — which
 * is itself the isolation finding (see isolationProbe in run-spike).
 */
export async function retrieve(_tenantId: string, originalRef: string): Promise<string> {
  if (!originalRef) throw new Error('no originalRef (payload was not CCR-dropped)');
  const res = await fetch(`${PROXY}/v1/retrieve/${originalRef}`);
  if (!res.ok) throw new Error(`proxy /v1/retrieve ${res.status}`);
  const r = (await res.json()) as { original_content?: string };
  return r.original_content ?? '';
}
