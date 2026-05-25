/**
 * Tests for task-executor.ts — the 11-case switch dispatcher and markdown formatters.
 * Mocks executeTool at the boundary; exercises real dispatch + formatting logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const coordinationMocks = vi.hoisted(() => ({
  listWorkUnits: vi.fn(),
  createWorkUnit: vi.fn(),
}));

vi.mock('../../src/db/client.js', () => ({
  db: {},
}));

vi.mock('../../src/orchestrator/coordination.service.js', () => ({
  CoordinationService: vi.fn().mockImplementation(() => ({
    listWorkUnits: coordinationMocks.listWorkUnits,
    createWorkUnit: coordinationMocks.createWorkUnit,
  })),
}));

vi.mock('../../src/tools/executor.js', () => ({
  executeTool: vi.fn(),
}));

import { executeScheduledTask } from '../../src/scheduler/task-executor.js';
import { executeTool } from '../../src/tools/executor.js';

const mockedExecuteTool = vi.mocked(executeTool);

const mockUser = { id: 'user-1', connections: [] };

beforeEach(() => {
  vi.clearAllMocks();
  coordinationMocks.listWorkUnits.mockResolvedValue([]);
  coordinationMocks.createWorkUnit.mockResolvedValue({ id: 'wu-1', status: 'pending' });
});

describe('executeScheduledTask — dispatch', () => {
  it('throws on unknown task type', async () => {
    await expect(
      executeScheduledTask({ taskType: 'INVALID_TYPE', config: {} }, mockUser),
    ).rejects.toThrow('Unknown task type: INVALID_TYPE');
  });

  describe('JIRA tasks', () => {
    it('JIRA_STANDUP_SUMMARY — dispatches and formats markdown', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [
          { key: 'PROJ-1', summary: 'Test', status: 'Done', assignee: 'Alice', updated: '2024-01-15' },
          { key: 'PROJ-2', summary: 'WIP', status: 'In Progress', assignee: 'Bob', updated: '2024-01-15' },
        ],
        total: 2,
      });

      const result = await executeScheduledTask(
        { taskType: 'JIRA_STANDUP_SUMMARY', config: { project: 'PROJ' } },
        mockUser,
      );

      expect(mockedExecuteTool).toHaveBeenCalledOnce();
      expect(result.type).toBe('standup_summary');
      expect(result.summary.totalUpdated).toBe(2);
      expect(result.markdown).toContain('Standup Summary');
      expect(result.markdown).toContain('Done');
    });

    it('JIRA_OVERDUE_ALERT — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [
          { key: 'PROJ-5', summary: 'Late', status: 'Open', assignee: 'Eve', duedate: '2024-01-01' },
        ],
        total: 1,
      });

      const result = await executeScheduledTask(
        { taskType: 'JIRA_OVERDUE_ALERT', config: { project: 'PROJ' } },
        mockUser,
      );

      expect(result.type).toBe('overdue_alert');
      expect(result.count).toBe(1);
      expect(result.markdown).toContain('Overdue');
    });

    it('JIRA_SPRINT_REPORT — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [
          { key: 'PROJ-1', summary: 'A', status: 'Done', storyPoints: 3 },
          { key: 'PROJ-2', summary: 'B', status: 'In Progress', storyPoints: 5 },
        ],
        total: 2,
      });

      const result = await executeScheduledTask(
        { taskType: 'JIRA_SPRINT_REPORT', config: { project: 'PROJ' } },
        mockUser,
      );

      expect(result.type).toBe('sprint_report');
      expect(result.markdown).toContain('Sprint');
    });

    it('JIRA_A11Y_TRIAGE — dry run qualifies matching Jira issues without enqueueing', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [
          {
            key: 'A11Y-1',
            fields: {
              summary: 'Button has no accessible name',
              status: { name: 'Open' },
              priority: { name: 'High' },
              labels: ['a11y'],
              components: [{ name: 'UI' }],
              customfield_10001: { value: 'Critical' },
              updated: '2026-05-25T10:00:00.000Z',
            },
          },
        ],
        total: 1,
      });

      const result = await executeScheduledTask(
        {
          id: 'task-1',
          taskType: 'JIRA_A11Y_TRIAGE',
          config: {
            dryRun: true,
            priorityAllowlist: ['High'],
            componentAllowlist: ['UI'],
            severityField: 'customfield_10001',
            severityAllowlist: ['Critical'],
          },
        },
        mockUser,
      );

      expect(mockedExecuteTool).toHaveBeenCalledWith('user-1', 'jira_search_issues', expect.objectContaining({
        includeRawFields: true,
        fields: expect.arrayContaining(['summary', 'status', 'priority', 'components', 'customfield_10001']),
      }));
      expect(coordinationMocks.listWorkUnits).toHaveBeenCalledWith('user-1');
      expect(coordinationMocks.createWorkUnit).not.toHaveBeenCalled();
      expect(result.type).toBe('jira_a11y_triage');
      expect(result.examined).toBe(1);
      expect(result.qualified).toBe(1);
      expect(result.enqueued).toHaveLength(0);
      expect(result.markdown).toContain('Jira Accessibility Triage');
    });

    it('JIRA_A11Y_TRIAGE — deduplicates existing work units and records skipped issues', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [
          {
            key: 'A11Y-1',
            fields: {
              summary: 'Missing heading order',
              status: { name: 'Open' },
              priority: { name: 'High' },
              labels: ['a11y'],
              components: [{ name: 'UI' }],
            },
          },
          {
            key: 'A11Y-2',
            fields: {
              summary: 'Already fixed',
              status: { name: 'Done' },
              priority: { name: 'High' },
              labels: ['a11y'],
              components: [{ name: 'UI' }],
            },
          },
          {
            key: 'A11Y-3',
            fields: {
              summary: 'Low priority color contrast issue',
              status: { name: 'Open' },
              priority: { name: 'Low' },
              labels: ['a11y'],
              components: [{ name: 'UI' }],
            },
          },
        ],
        total: 3,
      });
      coordinationMocks.listWorkUnits.mockResolvedValueOnce([
        {
          id: 'wu-existing',
          status: 'running',
          createdAt: new Date('2026-05-25T09:00:00.000Z'),
          metadata: { sourceIssueKey: 'A11Y-1' },
        },
      ]);

      const result = await executeScheduledTask(
        {
          id: 'task-1',
          taskType: 'JIRA_A11Y_TRIAGE',
          config: {
            dryRun: true,
            priorityAllowlist: ['High'],
          },
        },
        mockUser,
      );

      expect(result.examined).toBe(3);
      expect(result.qualified).toBe(0);
      expect(result.duplicates).toEqual([
        { issueKey: 'A11Y-1', workUnitId: 'wu-existing', status: 'running' },
      ]);
      expect(result.skipped).toEqual([
        { issueKey: 'A11Y-2', reason: 'terminal_status' },
        { issueKey: 'A11Y-3', reason: 'priority_not_allowed' },
      ]);
    });

    it('JIRA_A11Y_TRIAGE — enqueues qualified issues as coordination work units', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [
          {
            key: 'A11Y-1',
            fields: {
              summary: 'Input error is not announced',
              status: { name: 'Open' },
              priority: { name: 'High' },
              labels: ['accessibility'],
              components: [{ name: 'Forms' }],
            },
          },
        ],
        total: 1,
      });
      coordinationMocks.createWorkUnit.mockResolvedValueOnce({ id: 'wu-a11y-1', status: 'pending' });

      const result = await executeScheduledTask(
        {
          id: 'task-1',
          taskType: 'JIRA_A11Y_TRIAGE',
          config: {
            tenantId: 'tenant-a',
            workUnitType: 'a11y_remediation',
          },
        },
        mockUser,
      );

      expect(coordinationMocks.createWorkUnit).toHaveBeenCalledWith('tenant-a', expect.objectContaining({
        title: 'Remediate accessibility issue A11Y-1',
        type: 'a11y_remediation',
        labels: ['accessibility', 'jira-triage'],
        metadata: expect.objectContaining({
          sourceSystem: 'jira',
          sourceIssueKey: 'A11Y-1',
          schedulerTaskId: 'task-1',
          components: ['Forms'],
        }),
      }));
      expect(result.enqueued).toEqual([
        { issueKey: 'A11Y-1', workUnitId: 'wu-a11y-1', status: 'pending' },
      ]);
    });
  });

  describe('Slack tasks', () => {
    it('SLACK_CHANNEL_DIGEST — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        messages: [
          { text: 'Hello world', user: 'alice', threadReplies: 3 },
          { text: 'Meeting notes', user: 'bob', threadReplies: 0 },
        ],
        total: 2,
      });

      const result = await executeScheduledTask(
        { taskType: 'SLACK_CHANNEL_DIGEST', config: { channel: 'general' } },
        mockUser,
      );

      expect(result.type).toBe('channel_digest');
      expect(result.markdown).toContain('general');
    });

    it('SLACK_MENTIONS_SUMMARY — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        messages: [
          { text: 'Hey @user', user: 'alice', channel: 'dev' },
        ],
        total: 1,
      });

      const result = await executeScheduledTask(
        { taskType: 'SLACK_MENTIONS_SUMMARY', config: {} },
        mockUser,
      );

      expect(result.type).toBe('mentions_summary');
      expect(result.markdown).toContain('Mentions');
    });
  });

  describe('GitHub tasks', () => {
    it('GITHUB_PR_REMINDER — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        pullRequests: [
          { number: 42, title: 'Add feature', url: 'https://gh.com/pr/42', author: 'alice', created: '2024-01-10' },
        ],
      });

      const result = await executeScheduledTask(
        { taskType: 'GITHUB_PR_REMINDER', config: { repo: 'org/repo' } },
        mockUser,
      );

      expect(result.type).toBe('pr_reminder');
      expect(result.markdown).toContain('PRs');
    });

    it('GITHUB_STALE_PR_ALERT — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        pullRequests: [
          { number: 10, title: 'Old PR', url: 'https://gh.com/pr/10', updated: '2024-01-01' },
        ],
      });

      const result = await executeScheduledTask(
        { taskType: 'GITHUB_STALE_PR_ALERT', config: { repo: 'org/repo', staleDays: 14 } },
        mockUser,
      );

      expect(result.type).toBe('stale_pr_alert');
      expect(result.markdown).toContain('Stale');
    });

    it('GITHUB_RELEASE_NOTES — dispatches and formats', async () => {
      mockedExecuteTool
        .mockResolvedValueOnce({ repositories: [{ fullName: 'org/repo', name: 'repo' }] })
        .mockResolvedValueOnce({
          pullRequests: [
            { number: 1, title: 'feat: new thing', url: 'url1' },
            { number: 2, title: 'fix: bug', url: 'url2' },
            { number: 3, title: 'chore: cleanup', url: 'url3' },
          ],
        });

      const result = await executeScheduledTask(
        { taskType: 'GITHUB_RELEASE_NOTES', config: { repo: 'org/repo' } },
        mockUser,
      );

      expect(result.type).toBe('release_notes');
      expect(result.markdown).toContain('Release Notes');
    });
  });

  describe('Google tasks', () => {
    it('GMAIL_DIGEST — dispatches and formats', async () => {
      mockedExecuteTool.mockResolvedValueOnce({
        messages: [
          { subject: 'Meeting invite', from: 'boss@co.com', date: '2024-01-15' },
        ],
        total: 1,
      });

      const result = await executeScheduledTask(
        { taskType: 'GMAIL_DIGEST', config: { query: 'is:unread' } },
        mockUser,
      );

      expect(result.type).toBe('gmail_digest');
      expect(result.markdown).toContain('Email Digest');
    });
  });

  describe('Cross-service tasks', () => {
    it('WEEKLY_STATUS_REPORT — dispatches multiple tools', async () => {
      // Jira sprint
      mockedExecuteTool.mockResolvedValueOnce({
        issues: [{ key: 'P-1', status: 'Done', storyPoints: 3 }],
        total: 1,
      });
      // GitHub PRs
      mockedExecuteTool.mockResolvedValueOnce({
        pullRequests: [{ number: 1, title: 'PR' }],
      });
      // Slack mentions
      mockedExecuteTool.mockResolvedValueOnce({
        messages: [],
        total: 0,
      });

      const result = await executeScheduledTask(
        { taskType: 'WEEKLY_STATUS_REPORT', config: { project: 'PROJ', repo: 'org/repo' } },
        mockUser,
      );

      expect(result.type).toBe('weekly_status_report');
      expect(result.markdown).toContain('Weekly Status Report');
    });

    it('CUSTOM_TOOL_SEQUENCE — runs tools in order', async () => {
      mockedExecuteTool
        .mockResolvedValueOnce({ result: 'step1' })
        .mockResolvedValueOnce({ result: 'step2' });

      const result = await executeScheduledTask(
        {
          taskType: 'CUSTOM_TOOL_SEQUENCE',
          config: {
            tools: [
              { name: 'jira_search_issues', input: { jql: 'project = A' } },
              { name: 'slack_send_message', input: { channel: 'test' } },
            ],
          },
        },
        mockUser,
      );

      expect(result.type).toBe('custom_sequence');
      expect(result.results).toHaveLength(2);
      expect(mockedExecuteTool).toHaveBeenCalledTimes(2);
    });
  });
});
