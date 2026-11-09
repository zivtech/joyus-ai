import { describe, it, expect, vi } from 'vitest';

import {
  fetchDocumentBlobs,
  fetchIndexBlob,
  fetchTree,
  resolveOrdinaryBlobEntry,
  resolveRevision,
  type GithubSourceRequest,
  type SourceFetchDeps,
  type TreeEntry,
} from '../src/skills/catalog/source-github.js';

const REQUEST: GithubSourceRequest = {
  owner: 'example-org',
  repository: 'example-skills-corpus',
  ref: 'main',
  credential: 'example-token',
};

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json' } });
}

function blobResponse(text: string, sha = SHA_A): Response {
  const content = Buffer.from(text, 'utf-8').toString('base64');
  return jsonResponse({ sha, content, encoding: 'base64', size: text.length });
}

function deps(fetchImpl: typeof fetch, extra: Partial<SourceFetchDeps> = {}): SourceFetchDeps {
  return { fetchImpl, clock: { now: () => 0 }, ...extra };
}

const FUTURE_DEADLINE = 60_000;

describe('resolveRevision', () => {
  it('accepts a well-formed hex sha', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sha: SHA_A }));
    const result = await resolveRevision(REQUEST, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result).toEqual({ ok: true, value: { revision: SHA_A } });
  });

  it('rejects a non-hex sha', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sha: 'not-hex!!' }));
    const result = await resolveRevision(REQUEST, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(false);
  });

  it('disables redirects and treats one as a source failure', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    const result = await resolveRevision(REQUEST, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(false);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('manual');
  });

  it('categorizes a 401 as source_authorization, never forwarding to a retry', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const result = await resolveRevision(REQUEST, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result).toMatchObject({ ok: false, failure: { category: 'source_authorization' } });
  });

  it('aborts and fails when a stalled connection never resolves headers/body', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );
      const clock = { now: () => 0 };
      const resultPromise = resolveRevision(REQUEST, 5000, deps(fetchImpl as unknown as typeof fetch, { clock }));
      await vi.advanceTimersByTimeAsync(5000);
      const result = await resultPromise;
      expect(result).toMatchObject({ ok: false, failure: { category: 'timeout' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an in-flight request when the external signal fires', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const resultPromise = resolveRevision(REQUEST, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch, { signal: controller.signal }));
    controller.abort();
    const result = await resultPromise;
    expect(result.ok).toBe(false);
  });
});

describe('fetchTree', () => {
  it('rejects an entry with a non-hex sha', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ truncated: false, tree: [{ path: 'index.json', type: 'blob', mode: '100644', sha: 'zz' }] }),
    );
    const result = await fetchTree(REQUEST, SHA_A, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(false);
  });

  it('rejects a truncated tree response explicitly', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ truncated: true, tree: [] }));
    const result = await fetchTree(REQUEST, SHA_A, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(false);
  });
});

describe('resolveOrdinaryBlobEntry', () => {
  const ordinaryTree: readonly TreeEntry[] = [
    { path: 'skills', type: 'tree', mode: '040000', sha: SHA_A },
    { path: 'skills/example', type: 'tree', mode: '040000', sha: SHA_B },
    { path: 'skills/example/SKILL.md', type: 'blob', mode: '100644', sha: SHA_C },
  ];

  it('resolves an ordinary nested file', () => {
    const result = resolveOrdinaryBlobEntry(ordinaryTree, 'skills/example/SKILL.md');
    expect(result.ok).toBe(true);
  });

  it('rejects when an intermediate path component is a symlink', () => {
    const withSymlinkParent: readonly TreeEntry[] = [
      { path: 'skills', type: 'tree', mode: '040000', sha: SHA_A },
      { path: 'skills/example', type: 'blob', mode: '120000', sha: SHA_B },
      { path: 'skills/example/SKILL.md', type: 'blob', mode: '100644', sha: SHA_C },
    ];
    const result = resolveOrdinaryBlobEntry(withSymlinkParent, 'skills/example/SKILL.md');
    expect(result.ok).toBe(false);
  });

  it('rejects when an intermediate path component is a submodule', () => {
    const withSubmoduleParent: readonly TreeEntry[] = [
      { path: 'skills', type: 'tree', mode: '040000', sha: SHA_A },
      { path: 'skills/example', type: 'commit', mode: '160000', sha: SHA_B },
      { path: 'skills/example/SKILL.md', type: 'blob', mode: '100644', sha: SHA_C },
    ];
    const result = resolveOrdinaryBlobEntry(withSubmoduleParent, 'skills/example/SKILL.md');
    expect(result.ok).toBe(false);
  });

  it('rejects a leaf that is itself a symlink even though it "resolves" to a blob-shaped entry', () => {
    const leafSymlink: readonly TreeEntry[] = [
      { path: 'skills', type: 'tree', mode: '040000', sha: SHA_A },
      { path: 'skills/example', type: 'tree', mode: '040000', sha: SHA_B },
      { path: 'skills/example/SKILL.md', type: 'blob', mode: '120000', sha: SHA_C },
    ];
    const result = resolveOrdinaryBlobEntry(leafSymlink, 'skills/example/SKILL.md');
    expect(result.ok).toBe(false);
  });

  it('rejects a missing intermediate path (incomplete recursive tree) rather than guessing', () => {
    const missingParent: readonly TreeEntry[] = [{ path: 'skills/example/SKILL.md', type: 'blob', mode: '100644', sha: SHA_C }];
    const result = resolveOrdinaryBlobEntry(missingParent, 'skills/example/SKILL.md');
    expect(result.ok).toBe(false);
  });

  it('rejects a tree containing a duplicate path', () => {
    const duplicated: readonly TreeEntry[] = [
      { path: 'index.json', type: 'blob', mode: '100644', sha: SHA_A },
      { path: 'index.json', type: 'blob', mode: '100644', sha: SHA_B },
    ];
    const result = resolveOrdinaryBlobEntry(duplicated, 'index.json');
    expect(result.ok).toBe(false);
  });
});

describe('fetchIndexBlob', () => {
  const entries: readonly TreeEntry[] = [{ path: 'index.json', type: 'blob', mode: '100644', sha: SHA_A }];

  it('reads the literal root index.json', async () => {
    const fetchImpl = vi.fn(async () => blobResponse('{"schemaVersion":1}'));
    const result = await fetchIndexBlob(REQUEST, entries, 'index.json', FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(true);
  });

  it('rejects any caller-supplied path other than the literal index.json', async () => {
    const fetchImpl = vi.fn(async () => blobResponse('{}'));
    const result = await fetchIndexBlob(REQUEST, entries, 'other/index.json', FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a garbage base64 payload instead of silently truncating it', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sha: SHA_A, content: '!!!not-base64!!!', encoding: 'base64' }));
    const result = await fetchIndexBlob(REQUEST, entries, 'index.json', FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));
    expect(result.ok).toBe(false);
  });
});

describe('fetchDocumentBlobs — reservation', () => {
  const entries: readonly TreeEntry[] = [
    { path: 'skills', type: 'tree', mode: '040000', sha: 'd'.repeat(40) },
    { path: 'skills/a', type: 'tree', mode: '040000', sha: 'e'.repeat(40) },
    { path: 'skills/b', type: 'tree', mode: '040000', sha: 'f'.repeat(40) },
    { path: 'skills/a/SKILL.md', type: 'blob', mode: '100644', sha: SHA_A },
    { path: 'skills/b/SKILL.md', type: 'blob', mode: '100644', sha: SHA_B },
  ];

  it('keeps net reservation equal to the sum of returned byte lengths on success', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(SHA_A)) return blobResponse('a'.repeat(100), SHA_A);
      return blobResponse('b'.repeat(50), SHA_B);
    });

    let outstanding = 0;
    const reserveDocumentBytes = vi.fn((bytes: number) => {
      outstanding += bytes;
      return true;
    });
    const releaseDocumentBytes = vi.fn((bytes: number) => {
      outstanding -= bytes;
    });

    const result = await fetchDocumentBlobs(
      REQUEST,
      entries,
      ['skills/a/SKILL.md', 'skills/b/SKILL.md'],
      FUTURE_DEADLINE,
      deps(fetchImpl as unknown as typeof fetch, { reserveDocumentBytes, releaseDocumentBytes }),
    );

    expect(result.ok).toBe(true);
    expect(reserveDocumentBytes).toHaveBeenCalled();
    if (result.ok) {
      const sum = [...result.value.values()].reduce((total, bytes) => total + bytes.byteLength, 0);
      expect(outstanding).toBe(sum);
    }
  });

  it('releases the full reservation for a blob that fails validation after streaming', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ sha: SHA_A, content: 'not-base64!!!', encoding: 'base64' }));

    let outstanding = 0;
    const reserveDocumentBytes = vi.fn((bytes: number) => {
      outstanding += bytes;
      return true;
    });
    const releaseDocumentBytes = vi.fn((bytes: number) => {
      outstanding -= bytes;
    });

    const result = await fetchDocumentBlobs(
      REQUEST,
      entries,
      ['skills/a/SKILL.md'],
      FUTURE_DEADLINE,
      deps(fetchImpl as unknown as typeof fetch, { reserveDocumentBytes, releaseDocumentBytes }),
    );

    expect(result.ok).toBe(false);
    expect(outstanding).toBe(0);
  });

  it('rejects and releases everything already reserved when the budget is exhausted mid-stream', async () => {
    const fetchImpl = vi.fn(async () => blobResponse('x'.repeat(1000), SHA_A));
    const releaseDocumentBytes = vi.fn();

    const result = await fetchDocumentBlobs(
      REQUEST,
      entries,
      ['skills/a/SKILL.md'],
      FUTURE_DEADLINE,
      deps(fetchImpl as unknown as typeof fetch, {
        reserveDocumentBytes: () => false,
        releaseDocumentBytes,
      }),
    );

    expect(result).toMatchObject({ ok: false, failure: { category: 'limit' } });
  });

  it('aborts sibling in-flight fetches when one document fails, and releases their bytes', async () => {
    let secondStarted = false;
    let secondAborted = false;

    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes(SHA_A)) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      secondStarted = true;
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          secondAborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    const result = await fetchDocumentBlobs(
      REQUEST,
      entries,
      ['skills/a/SKILL.md', 'skills/b/SKILL.md'],
      FUTURE_DEADLINE,
      deps(fetchImpl as unknown as typeof fetch),
    );

    expect(result).toMatchObject({ ok: false, failure: { category: 'source_authorization' } });
    expect(secondStarted).toBe(true);
    expect(secondAborted).toBe(true);
  });

  it('rejects once the per-candidate 16 MiB aggregate document cap is exceeded', async () => {
    // 16 MiB aggregate / 256 KiB per-document cap requires >64 max-sized documents.
    const docCount = 70;
    const bodySize = 250 * 1024;
    const manyEntries: TreeEntry[] = [{ path: 'skills', type: 'tree', mode: '040000', sha: 'd'.repeat(40) }];
    const paths: string[] = [];
    for (let i = 0; i < docCount; i += 1) {
      const sha = i.toString(16).padStart(40, '0');
      manyEntries.push({ path: `skills/doc-${i}`, type: 'tree', mode: '040000', sha });
      manyEntries.push({ path: `skills/doc-${i}/SKILL.md`, type: 'blob', mode: '100644', sha });
      paths.push(`skills/doc-${i}/SKILL.md`);
    }
    const fetchImpl = vi.fn(async () => blobResponse('x'.repeat(bodySize)));

    const result = await fetchDocumentBlobs(REQUEST, manyEntries, paths, FUTURE_DEADLINE, deps(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ ok: false, failure: { category: 'limit' } });
  });
});
