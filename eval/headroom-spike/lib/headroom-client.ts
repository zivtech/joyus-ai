/**
 * The ONLY place the spike talks to Headroom. STUBS — wire these for the real run.
 *
 * Do NOT return fabricated compressed output or fake savings. Until implemented, every
 * method throws NotImplemented so the harness fails loudly instead of producing a fake
 * go/no-go. When you wire this:
 *   - pin `headroom-ai` to an exact version (record it in the report),
 *   - implement BOTH modes (library = headroom-ai in-process; proxy = headroom sidecar),
 *   - keep tenant scoping intact (originals are per-tenant; see the isolation probe).
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
  originalRef: string; // tenant-scoped handle
  lossless: boolean;
}

export class NotImplemented extends Error {
  constructor(what: string) {
    super(
      `NotImplemented: ${what}. Wire lib/headroom-client.ts before running the spike. ` +
        `This stub refuses to fabricate compression results.`,
    );
    this.name = 'NotImplemented';
  }
}

/** Pinned Headroom version used for the run. Set this when you wire the client. */
export const HEADROOM_VERSION = 'TODO-pin-exact-version';

export async function compress(_input: CompressInput): Promise<CompressResult> {
  throw new NotImplemented('headroom compress()');
}

/** Retrieve the exact original by tenant-scoped ref. Must be byte-identical (NFR-004). */
export async function retrieve(_tenantId: string, _originalRef: string): Promise<string> {
  throw new NotImplemented('headroom retrieve()');
}
