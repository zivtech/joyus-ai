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

const serverContext = {
  ...context,
  metadata: {
    apiVariant: 'server',
    baseUrl: 'https://jira.example.test',
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
    expect(vi.mocked(axios.post).mock.calls[0][0]).toBe(
      'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/search',
    );
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

  it('jira_resolve_reviewers — resolves a custom reviewer field when provided', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-1',
        fields: {
          customfield_10010: [
            { accountId: 'account-1', displayName: 'Reviewer A', active: true },
          ],
          assignee: { accountId: 'account-2', displayName: 'Assignee B' },
          reporter: { accountId: 'account-3', displayName: 'Reporter C' },
          components: [{ name: 'Navigation' }],
          project: { id: '10000', key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_resolve_reviewers',
      { issueKey: 'PROJ-1', reviewerFieldIds: ['customfield_10010'] },
      context,
    );

    expect(result.resolved).toBe(true);
    expect(result.reviewers).toEqual([
      {
        source: 'customfield_10010',
        displayName: 'Reviewer A',
        accountId: 'account-1',
        active: true,
        fieldId: 'customfield_10010',
      },
    ]);
    expect(result.metadata.components).toEqual(['Navigation']);
    expect(vi.mocked(axios.get).mock.calls[0][1].params.fields).toContain('customfield_10010');
  });

  it('jira_resolve_reviewers — falls back to assignee', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-2',
        fields: {
          customfield_10010: null,
          assignee: { accountId: 'account-2', displayName: 'Assignee B', active: true },
          reporter: { accountId: 'account-3', displayName: 'Reporter C' },
          components: [],
          project: { key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_resolve_reviewers',
      { issueKey: 'PROJ-2', reviewerFieldIds: ['customfield_10010'] },
      context,
    );

    expect(result.resolved).toBe(true);
    expect(result.reviewers[0]).toMatchObject({
      source: 'assignee',
      displayName: 'Assignee B',
      accountId: 'account-2',
    });
    expect(result.warnings).toContain('Reviewer field "customfield_10010" was present but empty on PROJ-2.');
  });

  it('jira_resolve_reviewers — falls back to reporter', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-3',
        fields: {
          assignee: null,
          reporter: { name: 'reporter-b', displayName: 'Reporter B', active: true },
          components: [],
          project: { key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_resolve_reviewers',
      { issueKey: 'PROJ-3' },
      context,
    );

    expect(result.resolved).toBe(true);
    expect(result.reviewers[0]).toMatchObject({
      source: 'reporter',
      displayName: 'Reporter B',
      username: 'reporter-b',
    });
    expect(result.warnings).toContain('Reviewer source "assignee" was empty on PROJ-3.');
  });

  it('jira_resolve_reviewers — returns a clear unresolved result when sources are empty', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-4',
        fields: {
          assignee: null,
          reporter: null,
          components: [],
          project: { key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_resolve_reviewers',
      { issueKey: 'PROJ-4' },
      context,
    );

    expect(result.resolved).toBe(false);
    expect(result.reviewers).toEqual([]);
    expect(result.message).toContain('Ask a human to choose a reviewer');
  });

  it('jira_resolve_reviewers — reports missing custom reviewer fields', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-5',
        fields: {
          assignee: { accountId: 'account-2', displayName: 'Assignee B' },
          reporter: null,
          components: [],
          project: { key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_resolve_reviewers',
      { issueKey: 'PROJ-5', reviewerFieldIds: ['customfield_10099'] },
      context,
    );

    expect(result.resolved).toBe(true);
    expect(result.reviewers[0].source).toBe('assignee');
    expect(result.warnings[0]).toContain('Reviewer field "customfield_10099" was not present');
  });

  it('jira_resolve_reviewers — uses Server API v2 metadata', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        key: 'PROJ-6',
        fields: {
          assignee: { name: 'reviewer-a', displayName: 'Reviewer A' },
          reporter: null,
          components: [],
          project: { key: 'PROJ', name: 'Project' },
        },
      },
    });

    const result = await executeJiraTool(
      'jira_resolve_reviewers',
      { issueKey: 'PROJ-6' },
      serverContext,
    );

    expect(result.reviewers[0]).toMatchObject({
      source: 'assignee',
      username: 'reviewer-a',
    });
    expect(vi.mocked(axios.get).mock.calls[0][0]).toBe(
      'https://jira.example.test/rest/api/2/issue/PROJ-6',
    );
  });

  it('jira_post_proposal_comment — posts Cloud ADF with required sections', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { id: '10001' },
    });

    const result = await executeJiraTool(
      'jira_post_proposal_comment',
      {
        issueKey: 'PROJ-7',
        summary: 'Improve keyboard focus handling.',
        affectedComponents: ['Navigation', 'Checkout Form'],
        proposedChanges: ['Add visible focus state', 'Preserve tab order'],
        riskLevel: 'medium',
        approvalPrompt: 'Approve this remediation plan?',
      },
      context,
    );

    const body = vi.mocked(axios.post).mock.calls[0][1].body;
    const serializedBody = JSON.stringify(body);
    expect(result).toMatchObject({
      success: true,
      commentId: '10001',
      issueKey: 'PROJ-7',
      url: 'https://test.atlassian.net/browse/PROJ-7?focusedCommentId=10001',
    });
    expect(body.type).toBe('doc');
    expect(serializedBody).toContain('Summary');
    expect(serializedBody).toContain('Affected components');
    expect(serializedBody).toContain('Proposed changes');
    expect(serializedBody).toContain('Risk level');
    expect(serializedBody).toContain('Approval prompt');
    expect(serializedBody).toContain('Checkout Form');
  });

  it('jira_post_proposal_comment — posts Server text with required sections', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { id: '20002' },
    });

    const result = await executeJiraTool(
      'jira_post_proposal_comment',
      {
        issueKey: 'PROJ-8',
        summary: 'Clarify form labels.',
        affectedComponents: ['Checkout Form'],
        proposedChanges: ['Associate labels with inputs'],
        riskLevel: 'low',
        approvalPrompt: 'Can this change proceed?',
        details: 'Tested with keyboard-only navigation.',
      },
      serverContext,
    );

    const requestBody = vi.mocked(axios.post).mock.calls[0][1].body;
    expect(result.url).toBe('https://jira.example.test/browse/PROJ-8?focusedCommentId=20002');
    expect(vi.mocked(axios.post).mock.calls[0][0]).toBe(
      'https://jira.example.test/rest/api/2/issue/PROJ-8/comment',
    );
    expect(requestBody).toContain('h3. Summary');
    expect(requestBody).toContain('* Checkout Form');
    expect(requestBody).toContain('h3. Proposed changes');
    expect(requestBody).toContain('h3. Risk level');
    expect(requestBody).toContain('h3. Approval prompt');
    expect(requestBody).toContain('h3. Details');
  });

  it('maps Jira permission failures to a clear error', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce({
      response: { status: 403, data: { message: 'Forbidden' } },
    });

    await expect(
      executeJiraTool(
        'jira_post_proposal_comment',
        {
          issueKey: 'PROJ-9',
          summary: 'Update status text.',
          affectedComponents: ['Navigation'],
          proposedChanges: ['Use clearer status message'],
          riskLevel: 'low',
          approvalPrompt: 'Approve?',
        },
        context,
      ),
    ).rejects.toThrow('Jira authentication or permission error');
  });

  it('maps Jira issue-not-found failures to a clear error', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce({
      response: { status: 404, data: { errorMessages: ['Issue does not exist'] } },
    });

    await expect(
      executeJiraTool(
        'jira_resolve_reviewers',
        { issueKey: 'PROJ-404' },
        context,
      ),
    ).rejects.toThrow('Jira issue not found or not accessible');
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
