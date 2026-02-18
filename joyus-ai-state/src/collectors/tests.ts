/**
 * Test results collector — T011
 *
 * Parses output from common test runners (vitest, jest, phpunit, pytest)
 * to extract pass/fail/skip counts and failing test names.
 * Returns null if output doesn't match any known pattern.
 */

import type { TestResults } from '../core/types.js';

interface ParseOptions {
  runner?: string;
  command?: string;
}

const MAX_FAILING_TESTS = 20;

function parseVitest(output: string): Partial<TestResults> | null {
  // Vitest/Jest summary line: "Tests  3 passed (3)" or "Tests  2 failed | 3 passed (5)"
  const testsLine = output.match(
    /Tests\s+(?:(\d+)\s+failed\s*\|?\s*)?(?:(\d+)\s+skipped\s*\|?\s*)?(?:(\d+)\s+passed)?/,
  );
  if (!testsLine) return null;

  const failed = parseInt(testsLine[1] || '0', 10);
  const skipped = parseInt(testsLine[2] || '0', 10);
  const passed = parseInt(testsLine[3] || '0', 10);

  // Duration: "Duration  321ms" or "Duration  1.23s"
  let duration = 0;
  const durationMatch = output.match(/Duration\s+([\d.]+)(ms|s)/);
  if (durationMatch) {
    duration = parseFloat(durationMatch[1]);
    if (durationMatch[2] === 's') duration *= 1000;
  }

  return { runner: 'vitest', passed, failed, skipped, duration };
}

function parseJest(output: string): Partial<TestResults> | null {
  // Jest: "Tests:       2 failed, 1 skipped, 5 passed, 8 total"
  const testsLine = output.match(
    /Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/,
  );
  if (!testsLine) return null;

  const failed = parseInt(testsLine[1] || '0', 10);
  const skipped = parseInt(testsLine[2] || '0', 10);
  const passed = parseInt(testsLine[3] || '0', 10);

  // Jest: "Time:        1.234 s" or "Time:        234 ms"
  let duration = 0;
  const durationMatch = output.match(/Time:\s+([\d.]+)\s*(ms|s)/);
  if (durationMatch) {
    duration = parseFloat(durationMatch[1]);
    if (durationMatch[2] === 's') duration *= 1000;
  }

  return { runner: 'jest', passed, failed, skipped, duration };
}

function parsePHPUnit(output: string): Partial<TestResults> | null {
  // PHPUnit success: "OK (5 tests, 10 assertions)"
  const okMatch = output.match(/OK \((\d+) tests?,\s*\d+ assertions?\)/);
  if (okMatch) {
    return {
      runner: 'phpunit',
      passed: parseInt(okMatch[1], 10),
      failed: 0,
      skipped: 0,
      duration: 0,
    };
  }

  // PHPUnit failure: "FAILURES!\nTests: 5, Assertions: 10, Failures: 2"
  // or "Tests: 5, Assertions: 10, Errors: 1, Failures: 2, Skipped: 1"
  if (output.includes('FAILURES')) {
    const totalMatch = output.match(/Tests:\s*(\d+)/);
    if (totalMatch) {
      const total = parseInt(totalMatch[1], 10);
      const failures = parseInt(output.match(/Failures:\s*(\d+)/)?.[1] || '0', 10);
      const errors = parseInt(output.match(/Errors:\s*(\d+)/)?.[1] || '0', 10);
      const skipped = parseInt(output.match(/Skipped:\s*(\d+)/)?.[1] || '0', 10);
      const failed = failures + errors;
      return {
        runner: 'phpunit',
        passed: total - failed - skipped,
        failed,
        skipped,
        duration: 0,
      };
    }
  }

  return null;
}

function parsePytest(output: string): Partial<TestResults> | null {
  // Pytest: "===== 3 passed, 1 failed, 1 skipped in 0.12s ====="
  // or "===== 5 passed in 0.34s ====="
  const summaryMatch = output.match(
    /={2,}\s*((?:\d+\s+\w+,?\s*)+)in\s+([\d.]+)s\s*={2,}/,
  );
  if (!summaryMatch) return null;

  const summary = summaryMatch[1];
  const passed = parseInt(summary.match(/(\d+)\s+passed/)?.[1] || '0', 10);
  const failed = parseInt(summary.match(/(\d+)\s+failed/)?.[1] || '0', 10);
  const skipped = parseInt(summary.match(/(\d+)\s+skipped/)?.[1] || '0', 10);
  const duration = parseFloat(summaryMatch[2]) * 1000;

  return { runner: 'pytest', passed, failed, skipped, duration };
}

function extractFailingTests(output: string): string[] {
  const tests: string[] = [];

  // Vitest/Jest: "FAIL  path/to/test.ts > suite > test name"
  // or "✕ test name" or "× test name"
  const failPatterns = [
    /FAIL\s+.+?>\s+(.+)/g,
    /[✕×]\s+(.+)/g,
    /FAILED\s+(.+)/g,
  ];

  for (const pattern of failPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const name = match[1].trim();
      if (name && !tests.includes(name)) {
        tests.push(name);
      }
      if (tests.length >= MAX_FAILING_TESTS) break;
    }
    if (tests.length >= MAX_FAILING_TESTS) break;
  }

  return tests.slice(0, MAX_FAILING_TESTS);
}

export function parseTestResults(output: string, options?: ParseOptions): TestResults | null {
  const runner = options?.runner;
  const command = options?.command ?? '';

  const parsers: Array<(o: string) => Partial<TestResults> | null> = runner
    ? [{ vitest: parseVitest, jest: parseJest, phpunit: parsePHPUnit, pytest: parsePytest }[runner]!]
    : [parseVitest, parseJest, parsePHPUnit, parsePytest];

  for (const parser of parsers) {
    if (!parser) continue;
    const result = parser(output);
    if (result) {
      const failingTests = result.failed && result.failed > 0 ? extractFailingTests(output) : [];
      return {
        runner: result.runner ?? 'unknown',
        passed: result.passed ?? 0,
        failed: result.failed ?? 0,
        skipped: result.skipped ?? 0,
        failingTests,
        duration: result.duration ?? 0,
        command,
      };
    }
  }

  return null;
}
