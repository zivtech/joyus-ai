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

  it('jira_search_issues — can return raw issue fields', async () => {
    const rawIssue = { key: 'PROJ-1', fields: { summary: 'Raw Test' } };
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { issues: [rawIssue], total: 1, startAt: 0, maxResults: 1 },
    });

    const result = await executeJiraTool(
      'jira_search_issues',
      { jql: 'project = PROJ', maxResults: 1, includeRawFields: true },
      context,
    );

    expect(result.issues).toEqual([rawIssue]);
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

  it('jira_get_issue — formats detailed ADF description and fallbacks', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-2',
        fields: {
          summary: 'Detailed',
          description: {
            type: 'doc',
            content: [
              { type: 'heading', content: [{ text: 'Title' }] },
              { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ text: 'Point' }] }] }] },
            ],
          },
          status: { name: 'In Progress' },
          priority: null,
          assignee: null,
          reporter: { displayName: 'Reporter' },
          created: '2026-05-01',
          updated: '2026-05-02',
          labels: ['a'],
          components: [{ name: 'Backend' }],
          project: { key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_get_issue',
      { issueKey: 'PROJ-2', expand: ['renderedFields'] },
      context,
    );

    expect(result.description).toContain('Title');
    expect(result.description).toContain('Point');
    expect(result.assignee).toBe('Unassigned');
    expect(result.components).toEqual(['Backend']);
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

  it('jira_get_my_issues — includes optional status and project filters', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { issues: [], total: 0 },
    });

    await executeJiraTool(
      'jira_get_my_issues',
      { status: 'Done', project: 'PROJ', maxResults: 5 },
      context,
    );

    expect(vi.mocked(axios.post).mock.calls[0][1].jql).toContain('status = "Done"');
    expect(vi.mocked(axios.post).mock.calls[0][1].jql).toContain('project = PROJ');
  });

  it('jira_add_comment — posts Atlassian document body', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { id: 'comment-1' },
    });

    const result = await executeJiraTool(
      'jira_add_comment',
      { issueKey: 'PROJ-1', comment: 'Looks good' },
      context,
    );

    expect(result).toEqual({
      success: true,
      commentId: 'comment-1',
      message: 'Comment added to PROJ-1',
    });
    expect(vi.mocked(axios.post).mock.calls[0][1].body.content[0].content[0].text).toBe('Looks good');
  });

  it('jira_transition_issue — posts matching transition id', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { transitions: [{ id: '31', name: 'Done' }] },
    });
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

    const result = await executeJiraTool(
      'jira_transition_issue',
      { issueKey: 'PROJ-1', transitionName: 'done' },
      context,
    );

    expect(result.success).toBe(true);
    expect(vi.mocked(axios.post).mock.calls[0][1]).toEqual({ transition: { id: '31' } });
  });

  it('jira_transition_issue — reports available transitions when missing', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { transitions: [{ id: '11', name: 'In Progress' }] },
    });

    await expect(
      executeJiraTool(
        'jira_transition_issue',
        { issueKey: 'PROJ-1', transitionName: 'Done' },
        context,
      ),
    ).rejects.toThrow('Available: In Progress');
  });

  it('jira_get_fields — returns field list', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: [{ id: 'summary', name: 'Summary' }],
    });

    const result = await executeJiraTool('jira_get_fields', {}, context);

    expect(result.fields).toEqual([{ id: 'summary', name: 'Summary' }]);
  });

  it('jira_list_projects — maps project search results', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        total: 1,
        values: [{ key: 'PROJ', name: 'Project', projectTypeKey: 'software', lead: null }],
      },
    });

    const result = await executeJiraTool(
      'jira_list_projects',
      { maxResults: 2 },
      context,
    );

    expect(result).toEqual({
      total: 1,
      projects: [{ key: 'PROJ', name: 'Project', projectType: 'software', lead: undefined }],
    });
  });
});
