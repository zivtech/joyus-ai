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
      a11yFailures: [],
      remediationRecommended: false,
      nextAction: 'wait',
      summary: {
        overallState: 'pending',
        checkRunCount: 2,
        statusCount: 1,
        successful: 2,
        neutral: 0,
        skipped: 0,
        failed: 0,
        pending: 1,
        a11yFailureCount: 0,
      },
    });
  });

  it('github_get_pr_checks — supports commit SHA checks with all passing state', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          check_runs: [
            {
              id: 101,
              name: 'validate',
              status: 'completed',
              conclusion: 'success',
              started_at: '2026-05-25T12:00:00Z',
              completed_at: '2026-05-25T12:01:00Z',
              details_url: 'https://github.com/example-org/example-app/actions/runs/1',
              html_url: 'https://github.com/example-org/example-app/runs/1',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { statuses: [] },
      });

    const result = await executeGithubTool(
      'github_get_pr_checks',
      {
        repo: 'example-org/example-app',
        sha: 'def456',
      },
      context,
    );

    expect(axios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/example-org/example-app/commits/def456/check-runs',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result).toMatchObject({
      headSha: 'def456',
      overallState: 'success',
      remediationRecommended: false,
      nextAction: 'none',
      summary: {
        overallState: 'success',
        checkRunCount: 1,
        statusCount: 0,
        successful: 1,
        failed: 0,
        pending: 0,
        a11yFailureCount: 0,
      },
    });
  });

  it('github_get_pr_checks — represents legacy commit status failure', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: { check_runs: [] },
      })
      .mockResolvedValueOnce({
        data: {
          statuses: [
            {
              context: 'legacy-ci',
              state: 'failure',
              description: 'Unit tests failed',
              target_url: 'https://ci.example.test/build/2',
              created_at: '2026-05-25T12:00:00Z',
              updated_at: '2026-05-25T12:01:00Z',
              url: 'https://api.github.com/repos/example-org/example-app/statuses/def456',
            },
          ],
        },
      });

    const result = await executeGithubTool(
      'github_get_pr_checks',
      {
        repo: 'example-org/example-app',
        sha: 'def456',
      },
      context,
    );

    expect(result).toMatchObject({
      overallState: 'failure',
      nextAction: 'manual_review',
      summary: {
        checkRunCount: 0,
        statusCount: 1,
        failed: 1,
      },
    });
  });

  it('github_get_pr_checks — extracts a11y failures from failed check output', async () => {
    vi.mocked(axios.get)
      .mockResolvedValueOnce({
        data: {
          check_runs: [
            {
              id: 101,
              name: 'Lighthouse accessibility',
              status: 'completed',
              conclusion: 'failure',
              started_at: '2026-05-25T12:00:00Z',
              completed_at: '2026-05-25T12:01:00Z',
              details_url: 'https://github.com/example-org/example-app/actions/runs/1',
              html_url: 'https://github.com/example-org/example-app/runs/1',
              output: {
                title: 'Lighthouse accessibility audit failed',
                summary: '[color-contrast] Background and foreground colors do not have a sufficient contrast ratio. Severity: warning',
                text: 'URL: https://example.test/page Help: https://web.dev/measure',
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { statuses: [] },
      });

    const result = await executeGithubTool(
      'github_get_pr_checks',
      {
        repo: 'example-org/example-app',
        sha: 'def456',
      },
      context,
    );

    expect(result).toMatchObject({
      overallState: 'failure',
      remediationRecommended: true,
      nextAction: 'rerun_remediation',
      a11yFailures: [
        expect.objectContaining({
          source: 'lighthouse',
          ruleId: 'color-contrast',
          severity: 'warning',
        }),
      ],
      summary: {
        a11yFailureCount: 1,
      },
    });
  });

  it('github_get_check_annotations — extracts axe-style annotation failures', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [
        {
          path: 'src/components/Form.tsx',
          start_line: 12,
          end_line: 12,
          annotation_level: 'failure',
          title: 'axe-core violation',
          message: 'Rule: color-contrast. Impact: serious. Selector: #submit',
          raw_details: 'Elements must meet minimum color contrast ratio. Help: https://dequeuniversity.com/rules/axe/4.9/color-contrast',
          blob_href: 'https://github.com/example-org/example-app/blob/def456/src/components/Form.tsx#L12',
        },
      ],
    });

    const result = await executeGithubTool(
      'github_get_check_annotations',
      {
        repo: 'example-org/example-app',
        checkRunId: 101,
      },
      context,
    );

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/example-org/example-app/check-runs/101/annotations',
      expect.objectContaining({
        headers: expect.any(Object),
        params: { page: 1, per_page: 100 },
      }),
    );
    expect(result).toMatchObject({
      checkRunId: 101,
      count: 1,
      remediationRecommended: true,
      nextAction: 'rerun_remediation',
      a11yFailures: [
        expect.objectContaining({
          source: 'axe-core',
          ruleId: 'color-contrast',
          severity: 'serious',
          path: 'src/components/Form.tsx',
          selector: '#submit',
        }),
      ],
    });
  });

  it('github_get_check_annotations — sends non-a11y annotations to manual review', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [
        {
          path: 'src/math.ts',
          start_line: 7,
          end_line: 7,
          annotation_level: 'failure',
          title: 'unit test failure',
          message: 'Expected total to equal 42',
          raw_details: 'AssertionError: expected 41 to equal 42',
        },
      ],
    });

    const result = await executeGithubTool(
      'github_get_check_annotations',
      {
        repo: 'example-org/example-app',
        checkRunId: 102,
      },
      context,
    );

    expect(result).toMatchObject({
      count: 1,
      remediationRecommended: false,
      nextAction: 'manual_review',
      a11yFailures: [],
    });
  });

  it('github_watch_pr_checks — returns timeout without looping forever', async () => {
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
              status: 'in_progress',
              conclusion: null,
              started_at: '2026-05-25T12:00:00Z',
              completed_at: null,
              details_url: 'https://github.com/example-org/example-app/actions/runs/1',
              html_url: 'https://github.com/example-org/example-app/runs/1',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { statuses: [] },
      });

    const result = await executeGithubTool(
      'github_watch_pr_checks',
      {
        repo: 'example-org/example-app',
        prNumber: 12,
        pollIntervalMs: 0,
        timeoutMs: 0,
      },
      context,
    );

    expect(result).toMatchObject({
      overallState: 'timeout',
      timedOut: true,
      pollAttempts: 1,
      nextAction: 'manual_review',
      summary: {
        overallState: 'timeout',
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
