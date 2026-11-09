/**
 * Narrow port the generation service (service.ts) uses to resolve a revision and fetch
 * bounded index/document bytes for one candidate. Wraps the real GitHub adapter
 * (source-github.ts) so service.ts and its tests never depend on live HTTP; a fake
 * implementation lets refresh-lifecycle tests exercise coalescing, epoch fencing and
 * rollback without a network dependency.
 *
 * Split into two calls because the document paths to fetch (and their declared byte
 * budget) are only known after the index has been parsed: resolveCandidate() fetches
 * revision + tree + index; fetchDocuments() fetches the declared document paths once
 * the caller has reserved their declared byte total against the memory budget.
 */
import {
  fetchDocumentBlobs,
  fetchIndexBlob,
  fetchTree,
  resolveRevision,
  type GithubSourceRequest,
  type SourceFetchDeps,
  type TreeEntry,
} from './source-github.js';
import { fail, ok, type Result } from './types.js';

export interface CatalogSourceCredentials {
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly credential: string;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}

export interface CatalogCandidateHead {
  readonly revision: string;
  readonly indexRaw: Uint8Array;
}

export interface FetchDocumentsParams extends CatalogSourceCredentials {
  readonly revision: string;
  readonly paths: readonly string[];
  readonly reserveDocumentBytes: (bytes: number) => boolean;
  readonly releaseDocumentBytes: (bytes: number) => void;
}

export interface CatalogSourcePort {
  resolveCandidate(params: CatalogSourceCredentials): Promise<Result<CatalogCandidateHead>>;
  fetchDocuments(params: FetchDocumentsParams): Promise<Result<ReadonlyMap<string, Uint8Array>>>;
}

const INDEX_PATH = 'index.json';

/** Forward-compatible: source-github.ts's SourceFetchDeps is expected to grow `signal`,
 * `reserveDocumentBytes` and `releaseDocumentBytes` fields. Passing a variable (not an
 * object literal) here is structurally assignable today and picks up real streaming
 * reservation the moment source-github.ts starts reading these optional fields. */
interface ForwardCompatibleSourceDeps extends SourceFetchDeps {
  readonly signal?: AbortSignal;
  readonly reserveDocumentBytes?: (bytes: number) => boolean;
  readonly releaseDocumentBytes?: (bytes: number) => void;
}

function toGithubRequest(params: CatalogSourceCredentials): GithubSourceRequest {
  return {
    owner: params.owner,
    repository: params.repository,
    ref: params.ref,
    credential: params.credential,
  };
}

export function createGithubCatalogSourcePort(): CatalogSourcePort {
  return {
    async resolveCandidate(
      params: CatalogSourceCredentials
    ): Promise<Result<CatalogCandidateHead>> {
      const request = toGithubRequest(params);
      const deps: ForwardCompatibleSourceDeps = { signal: params.signal };

      const revisionResult = await resolveRevision(request, params.deadlineAt, deps);
      if (!revisionResult.ok) return revisionResult;
      const { revision } = revisionResult.value;

      const treeResult = await fetchTree(request, revision, params.deadlineAt, deps);
      if (!treeResult.ok) return treeResult;

      const indexResult = await fetchIndexBlob(
        request,
        treeResult.value,
        INDEX_PATH,
        params.deadlineAt,
        deps
      );
      if (!indexResult.ok) return indexResult;

      return ok({ revision, indexRaw: indexResult.value });
    },

    async fetchDocuments(
      params: FetchDocumentsParams
    ): Promise<Result<ReadonlyMap<string, Uint8Array>>> {
      const request = toGithubRequest(params);
      const deps: ForwardCompatibleSourceDeps = {
        signal: params.signal,
        reserveDocumentBytes: params.reserveDocumentBytes,
        releaseDocumentBytes: params.releaseDocumentBytes,
      };

      const treeResult = await fetchTree(request, params.revision, params.deadlineAt, deps);
      if (!treeResult.ok) return treeResult;
      return fetchDocumentBlobs(
        request,
        treeResult.value as readonly TreeEntry[],
        params.paths,
        params.deadlineAt,
        deps
      );
    },
  };
}

/** Deterministic in-memory fake for refresh-lifecycle/service tests. */
export interface FakeSourceFixture {
  readonly revision: string;
  readonly indexRaw: Uint8Array;
  readonly documents: ReadonlyMap<string, Uint8Array>;
  readonly failure?: { readonly category: Parameters<typeof fail>[0]; readonly message: string };
  readonly delayMs?: number;
}

async function waitOrAbort(delayMs: number | undefined, signal: AbortSignal): Promise<void> {
  if (!delayMs || delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

/** Keyed by credential so distinct tenants/epochs can register distinct fixtures. */
export function createFakeCatalogSourcePort(
  fixtureByCredential: Map<string, FakeSourceFixture>
): CatalogSourcePort {
  return {
    async resolveCandidate(
      params: CatalogSourceCredentials
    ): Promise<Result<CatalogCandidateHead>> {
      const fixture = fixtureByCredential.get(params.credential);
      if (!fixture) return fail('upstream_failure', 'no fixture registered for this credential');
      try {
        await waitOrAbort(fixture.delayMs, params.signal);
      } catch {
        return fail('timeout', 'candidate elapsed time budget exceeded');
      }
      if (params.signal.aborted) return fail('timeout', 'candidate elapsed time budget exceeded');
      if (fixture.failure) return fail(fixture.failure.category, fixture.failure.message);
      return ok({ revision: fixture.revision, indexRaw: fixture.indexRaw });
    },

    async fetchDocuments(
      params: FetchDocumentsParams
    ): Promise<Result<ReadonlyMap<string, Uint8Array>>> {
      const fixture = fixtureByCredential.get(params.credential);
      if (!fixture) return fail('upstream_failure', 'no fixture registered for this credential');
      if (params.signal.aborted) return fail('timeout', 'candidate elapsed time budget exceeded');
      if (fixture.failure) return fail(fixture.failure.category, fixture.failure.message);
      let reservedBytes = 0;
      for (const document of fixture.documents.values()) {
        if (!params.reserveDocumentBytes(document.byteLength)) {
          params.releaseDocumentBytes(reservedBytes);
          return fail('limit', 'candidate document budget exceeded');
        }
        reservedBytes += document.byteLength;
      }
      return ok(fixture.documents);
    },
  };
}
