import { describe, it, expect } from 'vitest';
import { parseTestResults } from '../../../src/collectors/tests.js';

describe('parseTestResults', () => {
  describe('vitest', () => {
    it('parses vitest all-pass output', () => {
      const output = `
 ✓ tests/unit/core/schema.test.ts  (11 tests) 5ms
 ✓ tests/unit/core/config.test.ts  (5 tests) 23ms

 Test Files  2 passed (2)
      Tests  16 passed (16)
   Start at  14:00:00
   Duration  321ms (transform 58ms, setup 0ms, collect 74ms, tests 28ms, environment 0ms, prepare 126ms)
`;
      const result = parseTestResults(output, { command: 'npx vitest run' });
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('vitest');
      expect(result!.passed).toBe(16);
      expect(result!.failed).toBe(0);
      expect(result!.skipped).toBe(0);
      expect(result!.duration).toBe(321);
      expect(result!.command).toBe('npx vitest run');
    });

    it('parses vitest with failures', () => {
      const output = `
 ✕ tests/unit/foo.test.ts > suite > failing test
 ✓ tests/unit/bar.test.ts  (3 tests) 5ms

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 3 passed (5)
   Duration  450ms
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('vitest');
      expect(result!.passed).toBe(3);
      expect(result!.failed).toBe(2);
      expect(result!.failingTests.length).toBeGreaterThan(0);
    });

    it('parses vitest with skipped tests', () => {
      const output = `
 Test Files  1 passed (1)
      Tests  1 skipped | 4 passed (5)
   Duration  200ms
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.skipped).toBe(1);
      expect(result!.passed).toBe(4);
    });
  });

  describe('jest', () => {
    it('parses jest output', () => {
      const output = `
Test Suites:  1 failed, 2 passed, 3 total
Tests:       2 failed, 1 skipped, 5 passed, 8 total
Snapshots:   0 total
Time:        1.234 s
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('jest');
      expect(result!.passed).toBe(5);
      expect(result!.failed).toBe(2);
      expect(result!.skipped).toBe(1);
      expect(result!.duration).toBeCloseTo(1234, -1);
    });
  });

  describe('phpunit', () => {
    it('parses phpunit success output', () => {
      const output = `
PHPUnit 10.5.1 by Sebastian Bergmann and contributors.

..........

Time: 00:00.123, Memory: 10.00 MB

OK (10 tests, 20 assertions)
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('phpunit');
      expect(result!.passed).toBe(10);
      expect(result!.failed).toBe(0);
    });

    it('parses phpunit failure output', () => {
      const output = `
FAILURES!
Tests: 10, Assertions: 20, Failures: 2
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('phpunit');
      expect(result!.failed).toBe(2);
      expect(result!.passed).toBe(8);
    });
  });

  describe('pytest', () => {
    it('parses pytest output', () => {
      const output = `
=============================== test session starts ================================
collected 10 items

tests/test_foo.py ..........

================================ 8 passed, 1 failed, 1 skipped in 0.34s ================================
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('pytest');
      expect(result!.passed).toBe(8);
      expect(result!.failed).toBe(1);
      expect(result!.skipped).toBe(1);
      expect(result!.duration).toBeCloseTo(340, -1);
    });

    it('parses pytest all-pass output', () => {
      const output = `
============================== 5 passed in 0.12s ==============================
`;
      const result = parseTestResults(output);
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('pytest');
      expect(result!.passed).toBe(5);
      expect(result!.failed).toBe(0);
    });
  });

  describe('unknown', () => {
    it('returns null for unrecognized output', () => {
      const result = parseTestResults('Hello world, nothing here');
      expect(result).toBeNull();
    });

    it('returns null for empty string', () => {
      const result = parseTestResults('');
      expect(result).toBeNull();
    });
  });

  describe('explicit runner', () => {
    it('uses specified runner parser', () => {
      const output = `
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  100ms
`;
      const result = parseTestResults(output, { runner: 'vitest' });
      expect(result).not.toBeNull();
      expect(result!.runner).toBe('vitest');
    });
  });
});
