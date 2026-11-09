/**
 * GitHub source adapter (catalog-source.md). Resolves an operator-approved ref to an
 * immutable commit, inspects the tree, and fetches bounded index/document blobs. Never
 * trusts client-supplied identity, never follows redirects, never trusts a source-provided
 * download URL, and never compares commit SHAs for recency.
 */
import { CATALOG_LIMITS, GITHUB_SHA_PATTERN } from './config.js';
import { fail, ok, type Result } from './types.js';

const GITHUB_API_ORIGIN = 'https://api.github.com';

/** The adapter reads only the literal repository-root `index.json`; callers cannot select
 * another path even though the parameter is retained for call-site compatibility. */
const INDEX_PATH = 'index.json';

export interface GithubSourceRequest {
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  /** Resolved once at candidate start; retained only for this bounded attempt. */
  readonly credential: string;
}

export interface TreeEntry {
  readonly path: string;
  readonly type: 'blob' | 'tree' | 'commit';
  readonly mode: string;
  readonly sha: string;
}

export interface SourceClock {
  now(): number;
}

export interface SourceFetchDeps {
  readonly fetchImpl?: typeof fetch;
  readonly clock?: SourceClock;
  /** External cancellation (shutdown, superseded candidate); linked into every request this
   * call makes so an already-cancelled attempt never starts new network work. */
  readonly signal?: AbortSignal;
  /** Admission control for the shared active+candidate document byte budget
   * (data-model.md). Returns `false` when the reservation cannot be granted. The caller
   * supplies both hooks together; absent in contexts that don't enforce that shared budget
   * (e.g. most unit tests, index/tree fetches). */
  readonly reserveDocumentBytes?: (bytes: number) => boolean;
  readonly releaseDocumentBytes?: (bytes: number) => void;
}

type FullDeps = Required<Pick<SourceFetchDeps, 'fetchImpl' | 'clock'>> &
  Pick<SourceFetchDeps, 'signal' | 'reserveDocumentBytes' | 'releaseDocumentBytes'>;

const defaultClock: SourceClock = { now: () => performance.now() };

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function repoBaseUrl(request: GithubSourceRequest): string {
  return `${GITHUB_API_ORIGIN}/repos/${encodeSegment(request.owner)}/${encodeSegment(request.repository)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeUtf8Strict(raw: Uint8Array): Result<string> {
  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return fail('validation', 'content is not valid UTF-8');
  }
}

interface RequestScope {
  readonly signal: AbortSignal;
  readonly cleanup: () => void;
}

/**
 * Links external cancellation and the remaining candidate deadline into one abort signal.
 * A bare fresh `AbortController` with no timeout/parent linkage never fires on its own, so a
 * stalled connect/headers/body phase would previously hang past the candidate budget; every
 * fetch in this module now goes through this scope instead.
 */
function createRequestScope(
  parentSignal: AbortSignal | undefined,
  deadlineAt: number,
  clock: SourceClock
): RequestScope {
  const controller = new AbortController();

  if (parentSignal?.aborted) {
    controller.abort();
    return { signal: controller.signal, cleanup: () => {} };
  }

  const remainingMs = Math.max(0, deadlineAt - clock.now());
  const timer = setTimeout(() => controller.abort(), remainingMs);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

/** Streams at most `maxBytes` of the raw response body, aborting on deadline. `onChunk`, when
 * given, is invoked with each chunk's byte length before it is retained and may reject the
 * stream (used to reserve document-byte budget incrementally during download). */
async function streamBoundedRaw(
  response: Response,
  maxBytes: number,
  deadlineAt: number,
  clock: SourceClock,
  onChunk?: (chunkBytes: number) => Result<void>
): Promise<Result<Uint8Array>> {
  const body = response.body;
  if (!body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes)
      return fail('validation', 'response exceeded the maximum allowed size');
    if (onChunk) {
      const chunkResult = onChunk(buf.byteLength);
      if (!chunkResult.ok) return chunkResult;
    }
    return ok(buf);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      if (clock.now() > deadlineAt) {
        await reader.cancel().catch(() => {});
        return fail('timeout', 'candidate elapsed time budget exceeded');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          return fail('validation', 'response exceeded the maximum allowed size');
        }
        if (onChunk) {
          const chunkResult = onChunk(value.byteLength);
          if (!chunkResult.ok) {
            await reader.cancel().catch(() => {});
            return chunkResult;
          }
        }
        chunks.push(value);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('timeout', 'candidate elapsed time budget exceeded');
    }
    return fail('upstream_failure', 'response stream ended unexpectedly');
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(merged);
}

function categorizeHttpStatus(status: number): Result<never> | null {
  if (status === 401 || status === 403)
    return fail('source_authorization', 'source credential was rejected');
  if (status === 429) return fail('upstream_rate_limit', 'source rate limit exceeded');
  if (status >= 500) return fail('upstream_failure', 'source returned a server error');
  if (status >= 400) return fail('validation', 'source rejected the request');
  return null;
}

async function cancelBodySafely(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; the response is already being rejected.
  }
}

async function fetchBoundedJson(
  url: string,
  credential: string,
  maxBytes: number,
  deadlineAt: number,
  deps: FullDeps,
  onRawChunk?: (chunkBytes: number) => Result<void>
): Promise<Result<unknown>> {
  const scope = createRequestScope(deps.signal, deadlineAt, deps.clock);

  let response: Response;
  try {
    response = await deps.fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: scope.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential}`,
        'User-Agent': 'joyus-ai-org-skills-catalog',
      },
    });
  } catch (error) {
    scope.cleanup();
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('timeout', 'candidate elapsed time budget exceeded');
    }
    return fail('upstream_failure', 'source request failed');
  }

  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    await cancelBodySafely(response);
    scope.cleanup();
    return fail('upstream_failure', 'source attempted a redirect');
  }

  const statusFailure = categorizeHttpStatus(response.status);
  if (statusFailure) {
    await cancelBodySafely(response);
    scope.cleanup();
    return statusFailure;
  }

  const bodyResult = await streamBoundedRaw(response, maxBytes, deadlineAt, deps.clock, onRawChunk);
  scope.cleanup();
  if (!bodyResult.ok) return bodyResult;

  const decoded = decodeUtf8Strict(bodyResult.value);
  if (!decoded.ok) return decoded;

  try {
    return ok(JSON.parse(decoded.value));
  } catch {
    return fail('validation', 'source response was not valid JSON');
  }
}

function toFullDeps(deps: SourceFetchDeps): FullDeps {
  return {
    fetchImpl: deps.fetchImpl ?? fetch,
    clock: deps.clock ?? defaultClock,
    signal: deps.signal,
    reserveDocumentBytes: deps.reserveDocumentBytes,
    releaseDocumentBytes: deps.releaseDocumentBytes,
  };
}

export interface ResolvedRevision {
  readonly revision: string;
}

export async function resolveRevision(
  request: GithubSourceRequest,
  deadlineAt: number,
  deps: SourceFetchDeps = {}
): Promise<Result<ResolvedRevision>> {
  const fullDeps = toFullDeps(deps);
  const url = `${repoBaseUrl(request)}/commits/${encodeSegment(request.ref)}`;
  const result = await fetchBoundedJson(
    url,
    request.credential,
    CATALOG_LIMITS.MAX_TREE_BYTES,
    deadlineAt,
    fullDeps
  );
  if (!result.ok) return result;

  if (
    !isPlainObject(result.value) ||
    typeof result.value.sha !== 'string' ||
    !GITHUB_SHA_PATTERN.test(result.value.sha)
  ) {
    return fail('validation', 'source commit resolution response was malformed');
  }
  // Object IDs are identity, never an ordering clock — no comparison against a prior sha here.
  return ok({ revision: result.value.sha });
}

export async function fetchTree(
  request: GithubSourceRequest,
  revision: string,
  deadlineAt: number,
  deps: SourceFetchDeps = {}
): Promise<Result<readonly TreeEntry[]>> {
  const fullDeps = toFullDeps(deps);
  const url = `${repoBaseUrl(request)}/git/trees/${encodeSegment(revision)}?recursive=1`;
  const result = await fetchBoundedJson(
    url,
    request.credential,
    CATALOG_LIMITS.MAX_TREE_BYTES,
    deadlineAt,
    fullDeps
  );
  if (!result.ok) return result;

  if (!isPlainObject(result.value) || !Array.isArray(result.value.tree)) {
    return fail('validation', 'source tree response was malformed');
  }
  if (result.value.truncated === true) {
    return fail('validation', 'source tree response was truncated');
  }

  const entries: TreeEntry[] = [];
  for (const rawEntry of result.value.tree) {
    if (
      !isPlainObject(rawEntry) ||
      typeof rawEntry.path !== 'string' ||
      typeof rawEntry.type !== 'string' ||
      typeof rawEntry.mode !== 'string' ||
      typeof rawEntry.sha !== 'string'
    ) {
      return fail('validation', 'source tree entry was malformed');
    }
    if (rawEntry.type !== 'blob' && rawEntry.type !== 'tree' && rawEntry.type !== 'commit') {
      return fail('validation', 'source tree entry has an unsupported type');
    }
    if (!GITHUB_SHA_PATTERN.test(rawEntry.sha)) {
      return fail('validation', 'source tree entry sha is not a valid object id');
    }
    entries.push({
      path: rawEntry.path,
      type: rawEntry.type,
      mode: rawEntry.mode,
      sha: rawEntry.sha,
    });
  }
  return ok(entries);
}

const ORDINARY_FILE_MODES = new Set(['100644', '100755']);

/**
 * Locate and validate one ordinary-file tree entry, checking every parent path component —
 * not just the leaf — so a symlink or submodule masquerading as an intermediate directory
 * (or a tree fetch missing intermediate entries) is rejected rather than silently traversed.
 * Also rejects a tree containing duplicate paths, which would otherwise let one path resolve
 * ambiguously to either entry.
 */
export function resolveOrdinaryBlobEntry(
  entries: readonly TreeEntry[],
  path: string
): Result<TreeEntry> {
  const byPath = new Map<string, TreeEntry>();
  for (const entry of entries) {
    if (byPath.has(entry.path)) {
      return fail('validation', 'source tree contains a duplicate path');
    }
    byPath.set(entry.path, entry);
  }

  const segments = path.split('/');
  let accumulated = '';
  for (let index = 0; index < segments.length; index += 1) {
    accumulated = accumulated.length > 0 ? `${accumulated}/${segments[index]}` : segments[index];
    const entry = byPath.get(accumulated);
    if (!entry) {
      return fail('validation', 'required source path is missing from the tree');
    }
    const isLeaf = index === segments.length - 1;
    if (isLeaf) {
      if (entry.type !== 'blob' || !ORDINARY_FILE_MODES.has(entry.mode)) {
        return fail('validation', 'required source path is not an ordinary file');
      }
    } else if (entry.type !== 'tree') {
      // Rejects a symlink (blob, mode 120000) or submodule (type "commit") standing in for
      // a parent directory, and never trusts a resolved body just because it looks valid.
      return fail('validation', 'required source path traverses a non-ordinary directory');
    }
  }

  // Safe: every segment, including the last, was confirmed present above.
  return ok(byPath.get(path) as TreeEntry);
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** `Buffer.from(x, 'base64')` silently ignores invalid characters instead of failing, so the
 * encoded string is validated for shape (charset, length, padding position) first. */
function isWellFormedBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (!BASE64_PATTERN.test(value)) return false;
  const firstPadding = value.indexOf('=');
  return firstPadding === -1 || firstPadding >= value.length - 2;
}

async function fetchBlobBytes(
  request: GithubSourceRequest,
  entry: TreeEntry,
  maxDecodedBytes: number,
  deadlineAt: number,
  deps: FullDeps
): Promise<Result<Uint8Array>> {
  const url = `${repoBaseUrl(request)}/git/blobs/${encodeSegment(entry.sha)}`;
  // Base64 inflates size by ~4/3; bound the raw streamed JSON accordingly before decoding.
  const maxRawBytes = Math.ceil((maxDecodedBytes * 4) / 3) + 4096;

  let reservedSoFar = 0;
  const reserve = deps.reserveDocumentBytes;
  const release = deps.releaseDocumentBytes;

  const onRawChunk = reserve
    ? (chunkBytes: number): Result<void> => {
        // Reserve the decoded-equivalent upper bound for this chunk during streaming, before
        // any of it is retained, rounding up so the true decoded size never exceeds it.
        const decodedUpperBound = Math.ceil((chunkBytes * 3) / 4) + 1;
        if (!reserve(decodedUpperBound)) {
          return fail('limit', 'document byte budget exhausted');
        }
        reservedSoFar += decodedUpperBound;
        return ok(undefined);
      }
    : undefined;

  const result = await fetchBoundedJson(
    url,
    request.credential,
    maxRawBytes,
    deadlineAt,
    deps,
    onRawChunk
  );

  const releaseAllReserved = () => {
    if (reservedSoFar > 0) release?.(reservedSoFar);
    reservedSoFar = 0;
  };

  if (!result.ok) {
    releaseAllReserved();
    return result;
  }

  if (
    !isPlainObject(result.value) ||
    typeof result.value.content !== 'string' ||
    result.value.encoding !== 'base64'
  ) {
    releaseAllReserved();
    return fail('validation', 'source blob response was malformed');
  }

  const encoded = result.value.content.replace(/\n/g, '');
  if (!isWellFormedBase64(encoded)) {
    releaseAllReserved();
    return fail('validation', 'source blob content was not valid base64');
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, 'base64');
  } catch {
    releaseAllReserved();
    return fail('validation', 'source blob content was not valid base64');
  }

  if (decoded.byteLength > maxDecodedBytes) {
    releaseAllReserved();
    return fail('limit', 'source blob exceeded the maximum decoded size');
  }

  // Adjust the upper-bound reservation down to the actual decoded size before reporting
  // success, so the net reservation the caller now holds equals this blob's byte length.
  if (reservedSoFar > decoded.byteLength) {
    release?.(reservedSoFar - decoded.byteLength);
    reservedSoFar = decoded.byteLength;
  } else if (reserve && reservedSoFar < decoded.byteLength) {
    if (!reserve(decoded.byteLength - reservedSoFar)) {
      releaseAllReserved();
      return fail('limit', 'document byte budget exhausted');
    }
    reservedSoFar = decoded.byteLength;
  }

  return ok(new Uint8Array(decoded));
}

export async function fetchIndexBlob(
  request: GithubSourceRequest,
  entries: readonly TreeEntry[],
  indexPath: string,
  deadlineAt: number,
  deps: SourceFetchDeps = {}
): Promise<Result<Uint8Array>> {
  if (indexPath !== INDEX_PATH) {
    return fail('validation', 'index path is not the literal repository-root index.json');
  }
  const entryResult = resolveOrdinaryBlobEntry(entries, indexPath);
  if (!entryResult.ok) return entryResult;
  const fullDeps = toFullDeps({
    ...deps,
    reserveDocumentBytes: undefined,
    releaseDocumentBytes: undefined,
  });
  return fetchBlobBytes(
    request,
    entryResult.value,
    CATALOG_LIMITS.MAX_INDEX_BYTES,
    deadlineAt,
    fullDeps
  );
}

/**
 * Fetch document blobs with bounded concurrency (at most 4 in flight per candidate).
 * Reserves each document's actual bytes during streaming before retention and releases the
 * full reservation for every blob if the call fails as a whole; on success, the net
 * reservation equals the sum of the returned map's `byteLength`s and remains held for the
 * caller to activate/release. Any single failure aborts every other in-flight fetch.
 */
export async function fetchDocumentBlobs(
  request: GithubSourceRequest,
  entries: readonly TreeEntry[],
  paths: readonly string[],
  deadlineAt: number,
  deps: SourceFetchDeps = {}
): Promise<Result<ReadonlyMap<string, Uint8Array>>> {
  const fullDeps = toFullDeps(deps);
  const results = new Map<string, Uint8Array>();
  let failure: Result<never> | null = null;
  let aggregateBytes = 0;

  const siblingController = new AbortController();
  const onExternalAbort = () => siblingController.abort();
  fullDeps.signal?.addEventListener('abort', onExternalAbort);
  const workerDeps: FullDeps = { ...fullDeps, signal: siblingController.signal };

  const recordFailure = (result: Result<never>) => {
    if (!failure) failure = result;
    siblingController.abort();
  };

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      if (failure || siblingController.signal.aborted) return;
      const index = cursor;
      cursor += 1;
      if (index >= paths.length) return;
      const path = paths[index];

      const entryResult = resolveOrdinaryBlobEntry(entries, path);
      if (!entryResult.ok) {
        recordFailure(entryResult);
        return;
      }
      const blobResult = await fetchBlobBytes(
        request,
        entryResult.value,
        CATALOG_LIMITS.MAX_DOCUMENT_BYTES,
        deadlineAt,
        workerDeps
      );
      if (!blobResult.ok) {
        recordFailure(blobResult);
        return;
      }
      aggregateBytes += blobResult.value.byteLength;
      if (aggregateBytes > CATALOG_LIMITS.MAX_GENERATION_DOCUMENT_BYTES) {
        fullDeps.releaseDocumentBytes?.(blobResult.value.byteLength);
        recordFailure(fail('limit', 'generation exceeds the maximum total document bytes'));
        return;
      }
      results.set(path, blobResult.value);
    }
  }

  const workerCount = Math.min(CATALOG_LIMITS.MAX_CONCURRENT_DOWNLOADS, Math.max(paths.length, 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  fullDeps.signal?.removeEventListener('abort', onExternalAbort);

  if (failure) {
    if (fullDeps.releaseDocumentBytes) {
      for (const value of results.values()) {
        fullDeps.releaseDocumentBytes(value.byteLength);
      }
    }
    return failure;
  }
  return ok(results);
}
