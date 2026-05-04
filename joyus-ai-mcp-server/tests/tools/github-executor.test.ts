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
