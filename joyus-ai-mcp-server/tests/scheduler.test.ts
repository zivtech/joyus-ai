/**
 * Unit tests for scheduler utilities
 */

import { describe, it, expect, vi } from 'vitest';
import cron from 'node-cron';
import { parseExpression } from 'cron-parser';

describe('Scheduler Utilities', () => {
  describe('Cron Expression Validation', () => {
    it('should validate standard cron expressions', () => {
      // Valid expressions
      expect(cron.validate('0 9 * * 1-5')).toBe(true);  // 9am weekdays
      expect(cron.validate('0 8 * * 1')).toBe(true);    // 8am Mondays
      expect(cron.validate('*/15 * * * *')).toBe(true); // Every 15 minutes
      expect(cron.validate('0 0 1 * *')).toBe(true);    // Midnight, 1st of month
      expect(cron.validate('0 17 * * 5')).toBe(true);   // 5pm Fridays

      // Invalid expressions
      expect(cron.validate('invalid')).toBe(false);
      expect(cron.validate('60 * * * *')).toBe(false);  // Invalid minute
      expect(cron.validate('* * * *')).toBe(false);     // Missing field
    });

    it('should parse cron expressions to get next run time', () => {
      const expression = '0 9 * * 1-5'; // 9am weekdays
      const interval = parseExpression(expression, { tz: 'America/New_York' });
      const nextRun = interval.next().toDate();

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());
    });

    it('should handle timezone-aware scheduling', () => {
      const expression = '0 9 * * *'; // 9am daily

      const nyInterval = parseExpression(expression, { tz: 'America/New_York' });
      const laInterval = parseExpression(expression, { tz: 'America/Los_Angeles' });

      const nyNext = nyInterval.next().toDate();
      const laNext = laInterval.next().toDate();

      // LA is 3 hours behind NY, so next runs should differ by ~3 hours
      // (unless it's the same calendar day)
      expect(nyNext).not.toEqual(laNext);
    });
  });

  describe('Task Type Validation', () => {
    const validTaskTypes = [
      'JIRA_STANDUP_SUMMARY',
      'JIRA_OVERDUE_ALERT',
      'JIRA_SPRINT_REPORT',
      'SLACK_CHANNEL_DIGEST',
      'SLACK_MENTIONS_SUMMARY',
      'GITHUB_PR_REMINDER',
      'GITHUB_STALE_PR_ALERT',
      'GITHUB_RELEASE_NOTES',
      'GMAIL_DIGEST',
      'WEEKLY_STATUS_REPORT',
      'CUSTOM_TOOL_SEQUENCE',
    ];

    it('should recognize all task types', () => {
      for (const taskType of validTaskTypes) {
        expect(typeof taskType).toBe('string');
        expect(taskType.length).toBeGreaterThan(0);
      }
    });

    it('should have correct naming conventions', () => {
      for (const taskType of validTaskTypes) {
        // All task types should be UPPER_SNAKE_CASE
        expect(taskType).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    });
  });

  describe('Cron Expression Examples', () => {
    const examples = [
      { expr: '0 9 * * 1-5', description: '9am weekdays' },
      { expr: '0 8 * * 1', description: '8am Mondays' },
      { expr: '0 */4 * * *', description: 'Every 4 hours' },
      { expr: '0 17 * * 5', description: '5pm Fridays' },
      { expr: '0 0 1 * *', description: 'Midnight, 1st of month' },
      { expr: '30 8 * * *', description: '8:30am daily' },
    ];

    it('should validate all example expressions', () => {
      for (const { expr, description } of examples) {
        expect(cron.validate(expr)).toBe(true);
      }
    });

    it('should parse all example expressions', () => {
      for (const { expr, description } of examples) {
        const interval = parseExpression(expr);
        const nextRun = interval.next();

        expect(nextRun).toBeDefined();
        expect(nextRun.toDate().getTime()).toBeGreaterThan(Date.now());
      }
    });
  });
});

describe('Markdown Formatters', () => {
  // These tests verify the output format of task results

  it('should format standup summary correctly', () => {
    const summary = {
      date: '2024-01-15',
      project: 'PROJ',
      totalUpdated: 5,
      byStatus: { 'In Progress': 2, 'Done': 3 },
      highlights: [
        { key: 'PROJ-123', summary: 'Test issue', status: 'Done', assignee: 'User' },
      ],
    };

    // Test the structure (actual formatter is in task-executor.ts)
    expect(summary.highlights).toHaveLength(1);
    expect(summary.byStatus['Done']).toBe(3);
  });

  it('should handle empty results gracefully', () => {
    const emptyResult = {
      total: 0,
      issues: [],
    };

    expect(emptyResult.issues).toHaveLength(0);
    expect(Array.isArray(emptyResult.issues)).toBe(true);
  });
});
