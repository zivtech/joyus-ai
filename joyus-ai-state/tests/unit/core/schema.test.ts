import { describe, it, expect } from 'vitest';
import { SnapshotSchema, GlobalConfigSchema, ProjectConfigSchema } from '../../../src/core/schema.js';

const VALID_SNAPSHOT = {
  id: 'clx1abc123',
  version: '1.0.0',
  timestamp: '2026-02-16T14:30:00Z',
  event: 'commit',
  project: { rootPath: '/home/user/project', hash: 'abc123def456', name: 'my-project' },
  git: {
    branch: 'feature/a11y-652',
    commitHash: 'abc1234',
    commitMessage: 'Fix accessibility',
    isDetached: false,
    hasUncommittedChanges: true,
    remoteBranch: 'origin/feature/a11y-652',
    aheadBehind: { ahead: 3, behind: 0 },
  },
  files: {
    staged: ['src/nav.html.twig'],
    unstaged: ['src/css/nav.css'],
    untracked: ['test-output.log'],
  },
  task: { id: 'NCLCRS-323', title: 'Fix nav a11y', source: 'jira', url: null },
  tests: {
    runner: 'vitest',
    passed: 12,
    failed: 2,
    skipped: 0,
    failingTests: ['FilterTest::testMobile', 'ThemeTest::testAria'],
    duration: 4.2,
    command: 'npx vitest run',
  },
  decisions: [
    {
      id: 'd1',
      question: 'Accordion or dropdown?',
      context: 'WCAG 2.1 AA requires...',
      options: ['accordion', 'dropdown'],
      answer: null,
      resolved: false,
      timestamp: '2026-02-16T14:00:00Z',
      resolvedAt: null,
    },
  ],
  canonical: [
    {
      name: 'tracking-spreadsheet',
      canonicalPath: 'data/tracking.csv',
      exists: true,
      lastModified: '2026-02-16T12:30:00Z',
      branchOverride: null,
    },
  ],
  sharer: null,
};

describe('SnapshotSchema', () => {
  it('validates a complete snapshot', () => {
    const result = SnapshotSchema.safeParse(VALID_SNAPSHOT);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = SnapshotSchema.safeParse({ id: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid event type', () => {
    const result = SnapshotSchema.safeParse({ ...VALID_SNAPSHOT, event: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid timestamp', () => {
    const result = SnapshotSchema.safeParse({ ...VALID_SNAPSHOT, timestamp: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('accepts null for optional fields', () => {
    const snapshot = { ...VALID_SNAPSHOT, task: null, tests: null, sharer: null };
    const result = SnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
  });

  it('enforces failingTests max 20', () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => `test-${i}`);
    const snapshot = { ...VALID_SNAPSHOT, tests: { ...VALID_SNAPSHOT.tests, failingTests: tooMany } };
    const result = SnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(false);
  });

  it('validates all event types', () => {
    const events = [
      'commit', 'branch-switch', 'test-run', 'canonical-update',
      'session-start', 'session-end', 'manual', 'file-change',
      'compaction', 'share',
    ];
    for (const event of events) {
      const result = SnapshotSchema.safeParse({ ...VALID_SNAPSHOT, event });
      expect(result.success).toBe(true);
    }
  });
});

describe('GlobalConfigSchema', () => {
  it('returns defaults for empty object', () => {
    const result = GlobalConfigSchema.parse({});
    expect(result.retentionDays).toBe(7);
    expect(result.retentionMaxBytes).toBe(52_428_800);
    expect(result.autoRestore).toBe(true);
    expect(result.verbosity).toBe('normal');
  });

  it('accepts partial overrides', () => {
    const result = GlobalConfigSchema.parse({ retentionDays: 14 });
    expect(result.retentionDays).toBe(14);
    expect(result.verbosity).toBe('normal');
  });
});

describe('ProjectConfigSchema', () => {
  it('returns defaults for empty object', () => {
    const result = ProjectConfigSchema.parse({});
    expect(result.eventTriggers.commit).toBe(true);
    expect(result.eventTriggers.branchSwitch).toBe(true);
    expect(result.customTriggers).toEqual([]);
    expect(result.periodicIntervalMinutes).toBe(15);
  });

  it('accepts partial event trigger overrides', () => {
    const result = ProjectConfigSchema.parse({
      eventTriggers: { commit: false },
    });
    expect(result.eventTriggers.commit).toBe(false);
    expect(result.eventTriggers.branchSwitch).toBe(true);
  });
});
