/**
 * Tests for github-executor.ts — axios-based GitHub API executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

import { executeGithubTool } from '../../src/tools/executors/github-executor.js';
import axios from 'axios';

const context = {
  accessToken: 'ghp_test_token',
  userId: 'user-1',
  metadata: {},
};

async function expectRejectedMessage(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeGithubTool', () => {
  it('throws on unknown tool name', async () => {
    await expect(
      executeGithubTool('github_unknown', {}, context),
    ).rejects.toThrow();
  });

  it('github_search_code — calls search API', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        items: [{
          path: 'src/test.ts',
          repository: { full_name: 'org/repo' },
          html_url: 'https://github.com/org/repo/blob/main/src/test.ts',
        }],
        total_count: 1,
      },
    });

    const result = await executeGithubTool(
      'github_search_code',
      { query: 'test function', repo: 'org/repo' },
      context,
    );

    expect(axios.get).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });

  it('github_list_prs — calls pulls API', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [{
        number: 1,
        title: 'PR',
        state: 'open',
        user: { login: 'alice' },
        html_url: 'https://github.com/org/repo/pull/1',
        created_at: '2024-01-15',
        updated_at: '2024-01-15',
        draft: false,
        base: { ref: 'main' },
        head: { ref: 'feature-branch' },
      }],
    });

    const result = await executeGithubTool(
      'github_list_prs',
      { repo: 'org/repo', state: 'open' },
      context,
    );

    expect(axios.get).toHaveBeenCalledOnce();
    expect(result).toBeDefined();
  });

  it('github_create_pr — creates a pull request and returns normalized metadata', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        number: 12,
        title: 'Improve form labels',
        state: 'open',
        draft: true,
        base: { ref: 'main' },
        head: { ref: 'remediation/form-labels' },
        html_url: 'https://github.com/example-org/example-app/pull/12',
      },
    });

    const result = await executeGithubTool(
      'github_create_pr',
      {
        repo: 'example-org/example-app',
        head: 'remediation/form-labels',
        base: 'main',
        title: 'Improve form labels',
        body: 'Adds accessible names to inputs.',
        draft: true,
        maintainer_can_modify: false,
      },
      context,
    );

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.github.com/repos/example-org/example-app/pulls',
      {
        head: 'remediation/form-labels',
        base: 'main',
        title: 'Improve form labels',
        body: 'Adds accessible names to inputs.',
        draft: true,
        maintainer_can_modify: false,
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test_token',
        }),
      }),
    );
    expect(result).toEqual({
      success: true,
      number: 12,
      title: 'Improve form labels',
      state: 'open',
      draft: true,
      base: 'main',
      head: 'remediation/form-labels',
      url: 'https://github.com/example-org/example-app/pull/12',
    });
  });

  it('github_request_reviewers — sends user and team reviewer requests', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        number: 12,
        requested_reviewers: [{ login: 'reviewer-a' }, { login: 'reviewer-b' }],
        requested_teams: [{ slug: 'accessibility-reviewers' }],
        html_url: 'https://github.com/example-org/example-app/pull/12',
      },
    });

    const result = await executeGithubTool(
      'github_request_reviewers',
      {
        repo: 'example-org/example-app',
        prNumber: 12,
        reviewers: ['reviewer-a', 'reviewer-b'],
        teamReviewers: ['accessibility-reviewers'],
      },
      context,
    );

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.github.com/repos/example-org/example-app/pulls/12/requested_reviewers',
      {
        reviewers: ['reviewer-a', 'reviewer-b'],
        team_reviewers: ['accessibility-reviewers'],
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test_token',
        }),
      }),
    );
    expect(result).toEqual({
      success: true,
      number: 12,
      requestedReviewers: ['reviewer-a', 'reviewer-b'],
      requestedTeams: ['accessibility-reviewers'],
      url: 'https://github.com/example-org/example-app/pull/12',
    });
  });

  it('github_get_pr_checks — combines check runs and commit statuses', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          head: { sha: 'abc123' },
        },
      })
      .mockResolvedValueOnce({
        data: {
          check_runs: [
            {
              name: 'validate',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-05-25T12:00:00Z',
              completed_at: '2026-05-25T12:01:00Z',
              details_url: 'https://github.com/example-org/example-app/actions/runs/1',
              html_url: 'https://github.com/example-org/example-app/runs/1',
            },
            {
              name: 'lint',
              status: 'queued',
              conclusion: null,
              started_at: null,
              completed_at: null,
              details_url: 'https://github.com/example-org/example-app/actions/runs/2',
              html_url: 'https://github.com/example-org/example-app/runs/2',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          statuses: [
            {
              context: 'coverage',
              state: 'success',
              description: 'Coverage threshold met',
              target_url: 'https://ci.example.test/build/1',
              created_at: '2026-05-25T12:00:00Z',
              updated_at: '2026-05-25T12:01:00Z',
              url: 'https://api.github.com/repos/example-org/example-app/statuses/abc123',
            },
          ],
        },
      });

    const result = await executeGithubTool(
      'github_get_pr_checks',
      {
        repo: 'example-org/example-app',
        prNumber: 12,
      },
      context,
    );

    expect(axios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/example-org/example-app/pulls/12',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(axios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/repos/example-org/example-app/commits/abc123/check-runs',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(axios.get).toHaveBeenNthCalledWith(
      3,
      'https://api.github.com/repos/example-org/example-app/commits/abc123/status',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toEqual({
      headSha: 'abc123',
      overallState: 'pending',
      checkRuns: [
        {
          name: 'validate',
          status: 'completed',
          conclusion: 'success',
          startedAt: '2026-05-25T12:00:00Z',
          completedAt: '2026-05-25T12:01:00Z',
          detailsUrl: 'https://github.com/example-org/example-app/actions/runs/1',
          url: 'https://github.com/example-org/example-app/runs/1',
        },
        {
          name: 'lint',
          status: 'queued',
          conclusion: null,
          startedAt: null,
          completedAt: null,
          detailsUrl: 'https://github.com/example-org/example-app/actions/runs/2',
          url: 'https://github.com/example-org/example-app/runs/2',
        },
      ],
      statuses: [
        {
          context: 'coverage',
          state: 'success',
          description: 'Coverage threshold met',
          targetUrl: 'https://ci.example.test/build/1',
          createdAt: '2026-05-25T12:00:00Z',
          updatedAt: '2026-05-25T12:01:00Z',
          url: 'https://api.github.com/repos/example-org/example-app/statuses/abc123',
        },
      ],
      summary: {
        overallState: 'pending',
        checkRunCount: 2,
        statusCount: 1,
        successful: 2,
        neutral: 0,
        skipped: 0,
        failed: 0,
        pending: 1,
      },
    });
  });

  it('github_create_pr — maps missing branch errors to a clear message', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({
      response: {
        status: 404,
        data: { message: 'Not Found' },
      },
    });

    await expectRejectedMessage(
      executeGithubTool(
        'github_create_pr',
        {
          repo: 'example-org/example-app',
          head: 'missing-branch',
          base: 'main',
          title: 'Improve form labels',
        },
        context,
      ),
      'GitHub branch or repository not found for example-org/example-app',
    );
  });

  it('github_create_pr — maps validation errors to a clear message', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          message: 'Validation Failed',
          errors: [{ field: 'head', message: 'No commits between main and remediation/form-labels' }],
        },
      },
    });

    await expectRejectedMessage(
      executeGithubTool(
        'github_create_pr',
        {
          repo: 'example-org/example-app',
          head: 'remediation/form-labels',
          base: 'main',
          title: 'Improve form labels',
        },
        context,
      ),
      'GitHub pull request creation failed validation',
    );
  });

  it('github_request_reviewers — maps invalid reviewer errors to a clear message', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          message: 'Validation Failed',
          errors: [{ field: 'reviewers', message: 'reviewer-a is not a collaborator' }],
        },
      },
    });

    await expectRejectedMessage(
      executeGithubTool(
        'github_request_reviewers',
        {
          repo: 'example-org/example-app',
          prNumber: 12,
          reviewers: ['reviewer-a'],
        },
        context,
      ),
      'GitHub reviewer request failed validation',
    );
  });

  it('github_get_pr_checks — maps permission errors to a clear message', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce({
      response: {
        status: 403,
        data: { message: 'Resource not accessible by integration' },
        headers: { 'x-ratelimit-remaining': '20' },
      },
    });

    await expectRejectedMessage(
      executeGithubTool(
        'github_get_pr_checks',
        {
          repo: 'example-org/example-app',
          prNumber: 12,
        },
        context,
      ),
      'GitHub permission denied for example-org/example-app',
    );
  });

  it('github_list_repos — calls repos API', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [{
        full_name: 'org/repo',
        name: 'repo',
        description: 'A repo',
        stargazers_count: 10,
        language: 'TypeScript',
      }],
    });

    const result = await executeGithubTool(
      'github_list_repos',
      { org: 'org' },
      context,
    );

    expect(result).toBeDefined();
  });

  it('github_list_issues — calls issues API', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [{
        number: 1,
        title: 'Bug',
        state: 'open',
        user: { login: 'bob' },
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'bob' }],
        created_at: '2024-01-10',
        updated_at: '2024-01-10',
        html_url: 'https://github.com/org/repo/issues/1',
      }],
    });

    const result = await executeGithubTool(
      'github_list_issues',
      { repo: 'org/repo' },
      context,
    );

    expect(result).toBeDefined();
  });
});
