/**
 * GitHub Tool Executor
 * Executes GitHub API calls using OAuth tokens
 */

import axios from 'axios';

import { ExecutorContext } from '../executor.js';

import { extractA11yFailures, type A11yFindingInput } from './github-a11y-parser.js';

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_CHECK_POLL_INTERVAL_MS = 10000;
const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Execute a GitHub tool
 */
export async function executeGithubTool(
  toolName: string,
  input: any,
  context: ExecutorContext
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${context.accessToken}`,
    Accept: 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    switch (toolName) {
      case 'github_search_code':
        return await searchCode(headers, input);

      case 'github_list_prs':
        return await listPRs(headers, input);

      case 'github_get_pr':
        return await getPR(headers, input);

      case 'github_create_pr':
        return await createPR(headers, input);

      case 'github_request_reviewers':
        return await requestReviewers(headers, input);

      case 'github_get_pr_checks':
        return await getPRChecks(headers, input);

      case 'github_watch_pr_checks':
        return await watchPRChecks(headers, input);

      case 'github_get_check_annotations':
        return await getCheckAnnotations(headers, input);

      case 'github_list_issues':
        return await listIssues(headers, input);

      case 'github_get_issue':
        return await getIssue(headers, input);

      case 'github_list_repos':
        return await listRepos(headers, input);

      case 'github_get_file':
        return await getFile(headers, input);

      case 'github_create_issue_comment':
        return await createIssueComment(headers, input);

      default:
        throw new Error(`Unknown GitHub tool: ${toolName}`);
    }
  } catch (error: any) {
    throw normalizeGithubError(error, toolName, input);
  }
}

async function searchCode(headers: any, input: any): Promise<any> {
  const { query, org, per_page = 30 } = input;

  let q = query;
  if (org) q += ` org:${org}`;

  const response = await axios.get(`${GITHUB_API_BASE}/search/code`, {
    headers,
    params: {
      q,
      per_page: Math.min(per_page, 100)
    }
  });

  return {
    total: response.data.total_count,
    items: response.data.items.map((item: any) => ({
      name: item.name,
      path: item.path,
      repository: item.repository.full_name,
      url: item.html_url,
      score: item.score
    }))
  };
}

async function listPRs(headers: any, input: any): Promise<any> {
  const { repo, state = 'open', per_page = 30 } = input;

  const response = await axios.get(`${GITHUB_API_BASE}/repos/${repo}/pulls`, {
    headers,
    params: {
      state,
      per_page: Math.min(per_page, 100),
      sort: 'updated',
      direction: 'desc'
    }
  });

  return {
    count: response.data.length,
    pullRequests: response.data.map(formatPR)
  };
}

async function getPR(headers: any, input: any): Promise<any> {
  const { repo, prNumber } = input;

  const [prResponse, reviewsResponse, filesResponse] = await Promise.all([
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}`, { headers }),
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}/reviews`, { headers }),
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}/files`, { headers })
  ]);

  const pr = prResponse.data;
  const reviews = reviewsResponse.data;
  const files = filesResponse.data;

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    author: pr.user.login,
    body: pr.body,
    created: pr.created_at,
    updated: pr.updated_at,
    merged: pr.merged,
    mergedBy: pr.merged_by?.login,
    base: pr.base.ref,
    head: pr.head.ref,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    url: pr.html_url,
    reviews: reviews.map((r: any) => ({
      user: r.user.login,
      state: r.state,
      submitted: r.submitted_at
    })),
    files: files.slice(0, 20).map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions
    }))
  };
}

async function createPR(headers: any, input: any): Promise<any> {
  const { repo, head, base, title, body, draft, maintainer_can_modify } = input;
  const payload: any = { head, base, title };

  if (body !== undefined) payload.body = body;
  if (draft !== undefined) payload.draft = draft;
  if (maintainer_can_modify !== undefined) payload.maintainer_can_modify = maintainer_can_modify;

  const response = await axios.post(`${GITHUB_API_BASE}/repos/${repo}/pulls`, payload, { headers });
  const pr = response.data;

  return {
    success: true,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    base: pr.base.ref,
    head: pr.head.ref,
    url: pr.html_url
  };
}

async function requestReviewers(headers: any, input: any): Promise<any> {
  const { repo, prNumber, reviewers = [], teamReviewers = [] } = input;

  if (reviewers.length === 0 && teamReviewers.length === 0) {
    throw new Error('At least one user reviewer or team reviewer is required');
  }

  const response = await axios.post(
    `${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}/requested_reviewers`,
    {
      reviewers,
      team_reviewers: teamReviewers
    },
    { headers }
  );
  const pr = response.data;

  return {
    success: true,
    number: pr.number,
    requestedReviewers: (pr.requested_reviewers ?? []).map((reviewer: any) => reviewer.login),
    requestedTeams: (pr.requested_teams ?? []).map((team: any) => team.slug),
    url: pr.html_url
  };
}

async function getPRChecks(headers: any, input: any): Promise<any> {
  return fetchCheckSnapshot(headers, input);
}

async function watchPRChecks(headers: any, input: any): Promise<any> {
  const pollIntervalMs = clampNumber(
    input.pollIntervalMs ?? DEFAULT_CHECK_POLL_INTERVAL_MS,
    0,
    60 * 1000
  );
  const timeoutMs = clampNumber(
    input.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    0,
    60 * 60 * 1000
  );
  const startedAt = Date.now();
  let attempts = 0;
  let snapshot: any;
  let timedOut = false;

  do {
    attempts += 1;
    snapshot = await fetchCheckSnapshot(headers, input);

    if (!shouldContinuePolling(snapshot.overallState)) {
      break;
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = timeoutMs - elapsedMs;

    if (remainingMs <= 0) {
      timedOut = true;
      break;
    }

    if (pollIntervalMs <= 0) {
      break;
    }

    await delay(Math.min(pollIntervalMs, remainingMs));
  } while (shouldContinuePolling(snapshot.overallState));

  const elapsedMs = Date.now() - startedAt;

  if (timedOut) {
    return buildTimeoutSnapshot(snapshot, attempts, elapsedMs);
  }

  return {
    ...snapshot,
    pollAttempts: attempts,
    elapsedMs,
    timedOut: false
  };
}

async function getCheckAnnotations(headers: any, input: any): Promise<any> {
  const annotations = await fetchCheckRunAnnotations(headers, input);
  const a11yFailures = extractA11yFailures(annotations.map(annotationToA11yInput));

  return {
    checkRunId: input.checkRunId,
    count: annotations.length,
    annotations,
    a11yFailures,
    remediationRecommended: a11yFailures.length > 0,
    nextAction: determineAnnotationNextAction(annotations.length, a11yFailures)
  };
}

async function fetchCheckSnapshot(headers: any, input: any): Promise<any> {
  const { repo, includeAnnotations = false, annotationLimit = 50 } = input;
  const headSha = await resolveHeadSha(headers, input);

  const [checkRunsResponse, statusResponse] = await Promise.all([
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/commits/${headSha}/check-runs`, { headers }),
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/commits/${headSha}/status`, { headers })
  ]);

  const checkRuns = (checkRunsResponse.data.check_runs ?? []).map(normalizeCheckRun);
  const statuses = (statusResponse.data.statuses ?? []).map(normalizeCommitStatus);
  const annotations = includeAnnotations
    ? await fetchBoundedAnnotations(headers, repo, checkRuns, annotationLimit)
    : [];
  const a11yFailures = extractA11yFailures([
    ...checkRuns.flatMap(checkRunToA11yInputs),
    ...statuses.map(statusToA11yInput),
    ...annotations.map(annotationToA11yInput)
  ]);
  const summary = summarizePRChecks(checkRuns, statuses, a11yFailures.length);

  return {
    headSha,
    overallState: summary.overallState,
    checkRuns,
    statuses,
    ...(includeAnnotations ? { annotations } : {}),
    a11yFailures,
    remediationRecommended: a11yFailures.length > 0 && summary.overallState === 'failure',
    nextAction: determineNextAction(summary.overallState, a11yFailures),
    summary
  };
}

async function resolveHeadSha(headers: any, input: any): Promise<string> {
  const { repo, prNumber, sha } = input;

  if (sha) {
    return sha;
  }

  if (prNumber) {
    const prResponse = await axios.get(`${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}`, { headers });
    return prResponse.data.head.sha;
  }

  throw new Error('Either prNumber or sha is required to inspect GitHub checks');
}

function normalizeCheckRun(run: any): any {
  const output = normalizeCheckRunOutput(run.output);

  return {
    ...(run.id !== undefined ? { id: run.id } : {}),
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    detailsUrl: run.details_url,
    url: run.html_url,
    ...(run.check_run_url ? { annotationsUrl: `${run.check_run_url}/annotations` } : {}),
    ...(output ? { output } : {})
  };
}

function normalizeCheckRunOutput(output: any): any | undefined {
  if (!output || (!output.title && !output.summary && !output.text)) {
    return undefined;
  }

  return {
    title: output.title,
    summary: output.summary ? boundText(output.summary, 2000) : undefined,
    text: output.text ? boundText(output.text, 4000) : undefined
  };
}

function normalizeCommitStatus(status: any): any {
  return {
    context: status.context,
    state: status.state,
    description: status.description,
    targetUrl: status.target_url,
    createdAt: status.created_at,
    updatedAt: status.updated_at,
    url: status.url
  };
}

async function fetchBoundedAnnotations(headers: any, repo: string, checkRuns: any[], limit: number): Promise<any[]> {
  const annotations: any[] = [];
  const cappedLimit = clampNumber(limit, 0, 100);

  for (const run of checkRuns) {
    if (annotations.length >= cappedLimit || !run.id || run.conclusion === 'success') {
      continue;
    }

    const remaining = cappedLimit - annotations.length;
    const runAnnotations = await fetchCheckRunAnnotations(headers, {
      repo,
      checkRunId: run.id,
      per_page: remaining
    });

    annotations.push(
      ...runAnnotations.map((annotation) => ({
        ...annotation,
        checkRunId: run.id,
        checkRunName: run.name
      }))
    );
  }

  return annotations;
}

async function fetchCheckRunAnnotations(headers: any, input: any): Promise<any[]> {
  const { repo, checkRunId, page = 1, per_page = 100 } = input;

  const response = await axios.get(
    `${GITHUB_API_BASE}/repos/${repo}/check-runs/${checkRunId}/annotations`,
    {
      headers,
      params: {
        page,
        per_page: Math.min(per_page, 100)
      }
    }
  );

  return (response.data ?? []).map(normalizeCheckAnnotation);
}

function normalizeCheckAnnotation(annotation: any): any {
  return {
    path: annotation.path,
    startLine: annotation.start_line,
    endLine: annotation.end_line,
    startColumn: annotation.start_column,
    endColumn: annotation.end_column,
    annotationLevel: annotation.annotation_level,
    title: annotation.title,
    message: annotation.message,
    rawDetails: annotation.raw_details ? boundText(annotation.raw_details, 2000) : undefined,
    blobUrl: annotation.blob_href
  };
}

function checkRunToA11yInputs(run: any): A11yFindingInput[] {
  return [
    {
      source: run.name,
      title: run.output?.title,
      message: run.output?.summary,
      rawDetails: run.output?.text,
      url: run.detailsUrl ?? run.url
    }
  ];
}

function statusToA11yInput(status: any): A11yFindingInput {
  return {
    source: status.context,
    message: status.description,
    url: status.targetUrl
  };
}

function annotationToA11yInput(annotation: any): A11yFindingInput {
  return {
    source: annotation.checkRunName ?? annotation.title,
    path: annotation.path,
    message: annotation.message,
    title: annotation.title,
    rawDetails: annotation.rawDetails,
    annotationLevel: annotation.annotationLevel,
    startLine: annotation.startLine,
    endLine: annotation.endLine
  };
}

async function listIssues(headers: any, input: any): Promise<any> {
  const { repo, state = 'open', labels, per_page = 30 } = input;

  const params: any = {
    state,
    per_page: Math.min(per_page, 100),
    sort: 'updated',
    direction: 'desc'
  };
  if (labels) params.labels = labels;

  const response = await axios.get(`${GITHUB_API_BASE}/repos/${repo}/issues`, {
    headers,
    params
  });

  // Filter out PRs (GitHub API returns PRs in issues endpoint)
  const issues = response.data.filter((i: any) => !i.pull_request);

  return {
    count: issues.length,
    issues: issues.map(formatIssue)
  };
}

async function getIssue(headers: any, input: any): Promise<any> {
  const { repo, issueNumber } = input;

  const [issueResponse, commentsResponse] = await Promise.all([
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/issues/${issueNumber}`, { headers }),
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/issues/${issueNumber}/comments`, {
      headers,
      params: { per_page: 10 }
    })
  ]);

  const issue = issueResponse.data;
  const comments = commentsResponse.data;

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user.login,
    body: issue.body,
    labels: issue.labels.map((l: any) => l.name),
    assignees: issue.assignees.map((a: any) => a.login),
    milestone: issue.milestone?.title,
    created: issue.created_at,
    updated: issue.updated_at,
    closed: issue.closed_at,
    url: issue.html_url,
    comments: comments.map((c: any) => ({
      author: c.user.login,
      body: c.body?.substring(0, 500) + (c.body?.length > 500 ? '...' : ''),
      created: c.created_at
    }))
  };
}

async function listRepos(headers: any, input: any): Promise<any> {
  const { org, type = 'all', per_page = 30 } = input;

  const response = await axios.get(`${GITHUB_API_BASE}/orgs/${org}/repos`, {
    headers,
    params: {
      type,
      per_page: Math.min(per_page, 100),
      sort: 'updated',
      direction: 'desc'
    }
  });

  return {
    count: response.data.length,
    repositories: response.data.map((r: any) => ({
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      private: r.private,
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      openIssues: r.open_issues_count,
      updated: r.updated_at,
      url: r.html_url
    }))
  };
}

async function getFile(headers: any, input: any): Promise<any> {
  const { repo, path, ref } = input;

  const params: any = {};
  if (ref) params.ref = ref;

  try {
    const response = await axios.get(`${GITHUB_API_BASE}/repos/${repo}/contents/${path}`, {
      headers,
      params
    });

    const file = response.data;

    if (file.type !== 'file') {
      // It's a directory
      return {
        type: 'directory',
        path: path,
        contents: file.map((f: any) => ({
          name: f.name,
          type: f.type,
          size: f.size,
          url: f.html_url
        }))
      };
    }

    // Decode content (base64)
    const content = Buffer.from(file.content, 'base64').toString('utf-8');

    return {
      type: 'file',
      path: path,
      size: file.size,
      encoding: file.encoding,
      content: content.length > 10000 ? content.substring(0, 10000) + '\n... (truncated)' : content,
      url: file.html_url
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`File not found: ${path}`);
    }
    throw error;
  }
}

async function createIssueComment(headers: any, input: any): Promise<any> {
  const { repo, issueNumber, body } = input;

  const response = await axios.post(
    `${GITHUB_API_BASE}/repos/${repo}/issues/${issueNumber}/comments`,
    { body },
    { headers }
  );

  return {
    success: true,
    commentId: response.data.id,
    url: response.data.html_url,
    message: `Comment added to ${repo}#${issueNumber}`
  };
}

// Formatters
function formatPR(pr: any): any {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    author: pr.user.login,
    created: pr.created_at,
    updated: pr.updated_at,
    base: pr.base.ref,
    head: pr.head.ref,
    url: pr.html_url
  };
}

function formatIssue(issue: any): any {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user.login,
    labels: issue.labels.map((l: any) => l.name),
    assignees: issue.assignees.map((a: any) => a.login),
    created: issue.created_at,
    updated: issue.updated_at,
    comments: issue.comments,
    url: issue.html_url
  };
}

function summarizePRChecks(checkRuns: any[], statuses: any[], a11yFailureCount = 0): any {
  const pendingCheckRuns = checkRuns.filter((run) => run.status !== 'completed' || !run.conclusion);
  const failedCheckRuns = checkRuns.filter((run) =>
    ['failure', 'cancelled', 'timed_out', 'action_required'].includes(run.conclusion)
  );
  const successfulCheckRuns = checkRuns.filter((run) => run.conclusion === 'success');
  const neutralCheckRuns = checkRuns.filter((run) => run.conclusion === 'neutral');
  const skippedCheckRuns = checkRuns.filter((run) => run.conclusion === 'skipped');
  const pendingStatuses = statuses.filter((status) => status.state === 'pending');
  const failedStatuses = statuses.filter((status) => ['failure', 'error'].includes(status.state));
  const successfulStatuses = statuses.filter((status) => status.state === 'success');

  let overallState = 'unknown';
  if (checkRuns.length > 0 || statuses.length > 0) {
    if (failedCheckRuns.length > 0 || failedStatuses.length > 0) {
      overallState = 'failure';
    } else if (pendingCheckRuns.length > 0 || pendingStatuses.length > 0) {
      overallState = 'pending';
    } else {
      overallState = 'success';
    }
  }

  return {
    overallState,
    checkRunCount: checkRuns.length,
    statusCount: statuses.length,
    successful: successfulCheckRuns.length + successfulStatuses.length,
    neutral: neutralCheckRuns.length,
    skipped: skippedCheckRuns.length,
    failed: failedCheckRuns.length + failedStatuses.length,
    pending: pendingCheckRuns.length + pendingStatuses.length,
    a11yFailureCount
  };
}

function shouldContinuePolling(overallState: string): boolean {
  return overallState === 'pending' || overallState === 'unknown';
}

function determineNextAction(overallState: string, a11yFailures: unknown[]): string {
  if (overallState === 'success') {
    return 'none';
  }

  if (overallState === 'pending' || overallState === 'unknown') {
    return 'wait';
  }

  if (overallState === 'failure' && a11yFailures.length > 0) {
    return 'rerun_remediation';
  }

  return 'manual_review';
}

function determineAnnotationNextAction(annotationCount: number, a11yFailures: unknown[]): string {
  if (a11yFailures.length > 0) {
    return 'rerun_remediation';
  }

  if (annotationCount > 0) {
    return 'manual_review';
  }

  return 'none';
}

function buildTimeoutSnapshot(snapshot: any, pollAttempts: number, elapsedMs: number): any {
  return {
    ...snapshot,
    overallState: 'timeout',
    remediationRecommended: false,
    nextAction: 'manual_review',
    timedOut: true,
    pollAttempts,
    elapsedMs,
    summary: {
      ...snapshot.summary,
      overallState: 'timeout'
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function boundText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}


function normalizeGithubError(error: any, toolName: string, input: any): Error {
  if (!error.response) {
    return error;
  }

  const status = error.response.status;
  const repo = input?.repo ?? 'the repository';
  const message = error.response.data?.message;
  const details = formatGithubValidationErrors(error.response.data?.errors);
  const rateLimitRemaining = error.response.headers?.['x-ratelimit-remaining'];

  if (status === 401) {
    return new Error('GitHub authentication failed. Reconnect GitHub and try again.');
  }

  if (status === 403) {
    if (rateLimitRemaining === '0' || (typeof message === 'string' && message.toLowerCase().includes('rate limit'))) {
      return new Error('GitHub rate limit reached. Wait for the limit to reset, then retry.');
    }
    return new Error(`GitHub permission denied for ${repo}. Confirm the connected account has repo access.`);
  }

  if (status === 404) {
    if (toolName === 'github_create_pr') {
      return new Error(`GitHub branch or repository not found for ${repo}. Confirm repo, head, and base branches.`);
    }
    if (
      toolName === 'github_request_reviewers' ||
      toolName === 'github_get_pr_checks' ||
      toolName === 'github_watch_pr_checks' ||
      toolName === 'github_get_pr'
    ) {
      return new Error(`GitHub pull request or repository not found for ${repo}. Confirm the PR number and repo.`);
    }
    if (toolName === 'github_get_check_annotations') {
      return new Error(`GitHub check run or repository not found for ${repo}. Confirm the check run ID and repo.`);
    }
    return new Error(`GitHub resource not found for ${repo}.`);
  }

  if (status === 422) {
    if (toolName === 'github_request_reviewers') {
      return new Error(`GitHub reviewer request failed validation for ${repo}: ${message ?? 'invalid reviewer or team'}${details}`);
    }
    if (toolName === 'github_create_pr') {
      return new Error(`GitHub pull request creation failed validation for ${repo}: ${message ?? 'invalid branch or duplicate pull request'}${details}`);
    }
    return new Error(`GitHub validation failed for ${repo}: ${message ?? 'invalid request'}${details}`);
  }

  if (message) {
    return new Error(`GitHub API error (${status}) for ${repo}: ${message}${details}`);
  }

  return error;
}

function formatGithubValidationErrors(errors: any[] | undefined): string {
  if (!Array.isArray(errors) || errors.length === 0) {
    return '';
  }

  const formatted = errors
    .map((validationError) => {
      const field = validationError.field ? `${validationError.field}: ` : '';
      return `${field}${validationError.message ?? validationError.code ?? 'invalid'}`;
    })
    .join('; ');

  return ` (${formatted})`;
}
