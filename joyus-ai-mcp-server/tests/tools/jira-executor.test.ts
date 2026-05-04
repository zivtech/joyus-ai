/**
 * Tests for jira-executor.ts — axios-based Jira API executor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

import { executeJiraTool } from '../../src/tools/executors/jira-executor.js';
import axios from 'axios';

const context = {
  accessToken: 'jira_test_token',
  userId: 'user-1',
  metadata: {
    resources: [{ id: 'cloud-123', name: 'test-site', url: 'https://test.atlassian.net' }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeJiraTool', () => {
  it('throws when no cloud ID in metadata', async () => {
    await expect(
      executeJiraTool('jira_search_issues', {}, { ...context, metadata: {} }),
    ).rejects.toThrow('No Jira cloud ID');
  });

  it('throws on unknown tool name', async () => {
    await expect(
      executeJiraTool('jira_unknown', {}, context),
    ).rejects.toThrow();
  });

  it('jira_search_issues — calls search API', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { issues: [{ key: 'PROJ-1', fields: { summary: 'Test' } }], total: 1 },
    });

    const result = await executeJiraTool(
      'jira_search_issues',
      { jql: 'project = PROJ', maxResults: 10 },
      context,
    );

    expect(result).toBeDefined();
  });

  it('jira_get_issue — calls issue API', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { key: 'PROJ-1', fields: { summary: 'Test', status: { name: 'Open' } } },
    });

    const result = await executeJiraTool(
      'jira_get_issue',
      { issueKey: 'PROJ-1' },
      context,
    );

    expect(result).toBeDefined();
  });

  it('jira_get_my_issues — calls search for current user', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { issues: [], total: 0 },
    });

    const result = await executeJiraTool(
      'jira_get_my_issues',
      {},
      context,
    );

    expect(result).toBeDefined();
  });
});
