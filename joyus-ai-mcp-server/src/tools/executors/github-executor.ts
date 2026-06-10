/**
 * GitHub Tool Executor
 * Executes GitHub API calls using OAuth tokens
 */

import axios from 'axios';

import { ExecutorContext } from '../executor.js';

const GITHUB_API_BASE = 'https://api.github.com';

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
  const { repo, prNumber } = input;

  const prResponse = await axios.get(`${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}`, { headers });
  const headSha = prResponse.data.head.sha;

  const [checkRunsResponse, statusResponse] = await Promise.all([
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/commits/${headSha}/check-runs`, { headers }),
    axios.get(`${GITHUB_API_BASE}/repos/${repo}/commits/${headSha}/status`, { headers })
  ]);

  const checkRuns = (checkRunsResponse.data.check_runs ?? []).map((run: any) => ({
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    detailsUrl: run.details_url,
    url: run.html_url
  }));
  const statuses = (statusResponse.data.statuses ?? []).map((status: any) => ({
    context: status.context,
    state: status.state,
    description: status.description,
    targetUrl: status.target_url,
    createdAt: status.created_at,
    updatedAt: status.updated_at,
    url: status.url
  }));
  const summary = summarizePRChecks(checkRuns, statuses);

  return {
    headSha,
    overallState: summary.overallState,
    checkRuns,
    statuses,
    summary
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

function summarizePRChecks(checkRuns: any[], statuses: any[]): any {
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
    pending: pendingCheckRuns.length + pendingStatuses.length
  };
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
    if (toolName === 'github_request_reviewers' || toolName === 'github_get_pr_checks' || toolName === 'github_get_pr') {
      return new Error(`GitHub pull request or repository not found for ${repo}. Confirm the PR number and repo.`);
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
