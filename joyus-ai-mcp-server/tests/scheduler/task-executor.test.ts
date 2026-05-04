/**
 * Tests for task-executor.ts — the 11-case switch dispatcher and markdown formatters.
 * Mocks executeTool at the boundary; exercises real dispatch + formatting logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/tools/executor.js', () => ({
  executeTool: vi.fn(),
}));

import { executeScheduledTask } from '../../src/scheduler/task-executor.js';
import { executeTool } from '../../src/tools/executor.js';

const mockedExecuteTool = vi.mocked(executeTool);

const mockUser = { id: 'user-1', connections: [] };

beforeEach(() => {
  vi.clearAllMocks();
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
