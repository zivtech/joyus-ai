/**
 * Event Adapter — GitHub Event Parser
 *
 * Extracts structured metadata from GitHub webhook payloads.
 * Supported event types: push, pull_request, issues, release.
 *
 * Push events map to 'corpus-change' trigger type.
 * All other supported events map to 'manual-request'.
 * Unsupported event types throw UnsupportedEventTypeError
 * (caller should return 200 to avoid GitHub retry storms).
 */

// ============================================================
// TYPES
// ============================================================

export interface GitHubParsedEvent {
  eventType: string;
  action?: string;
  triggerType: 'corpus-change' | 'manual-request';
  metadata: Record<string, unknown>;
}

export class UnsupportedEventTypeError extends Error {
  constructor(public readonly eventType: string) {
    super(`Unsupported GitHub event type: ${eventType}`);
    this.name = 'UnsupportedEventTypeError';
  }
}

// ============================================================
// PARSER
// ============================================================

/**
 * Parse a GitHub webhook payload and extract structured metadata.
 *
 * @param headers - Request headers (lowercased keys)
 * @param body - Raw request body as Buffer
 * @returns Parsed event with metadata and trigger type
 * @throws UnsupportedEventTypeError for unrecognized event types
 */
export function parseGitHubEvent(
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
): GitHubParsedEvent {
  const eventType = headers['x-github-event'];
  if (!eventType || Array.isArray(eventType)) {
    throw new UnsupportedEventTypeError('unknown');
  }

  const payload = JSON.parse(body.toString('utf-8'));

  switch (eventType) {
    case 'push':
      return parsePushEvent(payload);
    case 'pull_request':
      return parsePullRequestEvent(payload);
    case 'issues':
      return parseIssuesEvent(payload);
    case 'release':
      return parseReleaseEvent(payload);
    default:
      throw new UnsupportedEventTypeError(eventType);
  }
}

// ============================================================
// EVENT TYPE PARSERS
// ============================================================

function parsePushEvent(payload: Record<string, unknown>): GitHubParsedEvent {
  const repo = payload.repository as Record<string, unknown> | undefined;
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const pusher = payload.pusher as Record<string, unknown> | undefined;

  // Flatten changed files from all commits
  const changedFiles = new Set<string>();
  for (const commit of commits) {
    const c = commit as Record<string, unknown>;
    for (const list of [c.added, c.modified, c.removed]) {
      if (Array.isArray(list)) {
        for (const f of list) {
          if (typeof f === 'string') changedFiles.add(f);
        }
      }
    }
  }

  const ref = typeof payload.ref === 'string' ? payload.ref : '';
  const branch = ref.replace(/^refs\/heads\//, '');

  return {
    eventType: 'push',
    triggerType: 'corpus-change',
    metadata: {
      repository: repo?.full_name ?? null,
      cloneUrl: repo?.clone_url ?? null,
      branch,
      ref,
      commitSha: payload.after ?? null,
      author: pusher?.name ?? null,
      compareUrl: payload.compare ?? null,
      changedFiles: [...changedFiles],
      commitCount: commits.length,
    },
  };
}

function parsePullRequestEvent(payload: Record<string, unknown>): GitHubParsedEvent {
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const head = pr?.head as Record<string, unknown> | undefined;
  const base = pr?.base as Record<string, unknown> | undefined;
  const action = typeof payload.action === 'string' ? payload.action : undefined;

  return {
    eventType: 'pull_request',
    action,
    triggerType: 'manual-request',
    metadata: {
      action,
      number: pr?.number ?? null,
      title: pr?.title ?? null,
      sourceBranch: head?.ref ?? null,
      targetBranch: base?.ref ?? null,
      merged: pr?.merged ?? false,
      mergedAt: pr?.merged_at ?? null,
      repository: repo?.full_name ?? null,
    },
  };
}

function parseIssuesEvent(payload: Record<string, unknown>): GitHubParsedEvent {
  const issue = payload.issue as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const action = typeof payload.action === 'string' ? payload.action : undefined;
  const labels = Array.isArray(issue?.labels)
    ? (issue.labels as Array<Record<string, unknown>>).map((l) => l.name).filter(Boolean)
    : [];

  return {
    eventType: 'issues',
    action,
    triggerType: 'manual-request',
    metadata: {
      action,
      number: issue?.number ?? null,
      title: issue?.title ?? null,
      state: issue?.state ?? null,
      labels,
      repository: repo?.full_name ?? null,
    },
  };
}

function parseReleaseEvent(payload: Record<string, unknown>): GitHubParsedEvent {
  const release = payload.release as Record<string, unknown> | undefined;
  const repo = payload.repository as Record<string, unknown> | undefined;
  const action = typeof payload.action === 'string' ? payload.action : undefined;

  return {
    eventType: 'release',
    action,
    triggerType: 'manual-request',
    metadata: {
      action,
      tagName: release?.tag_name ?? null,
      name: release?.name ?? null,
      prerelease: release?.prerelease ?? false,
      repository: repo?.full_name ?? null,
    },
  };
}
