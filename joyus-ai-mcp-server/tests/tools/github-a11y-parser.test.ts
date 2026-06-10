/**
 * Tests for GitHub CI accessibility failure extraction.
 */

import { describe, expect, it } from 'vitest';

import { extractA11yFailures } from '../../src/tools/executors/github-a11y-parser.js';

describe('extractA11yFailures', () => {
  it('extracts axe-core annotations into structured failures', () => {
    const failures = extractA11yFailures([
      {
        source: 'axe-core',
        path: 'src/components/Form.tsx',
        title: 'axe-core violation',
        message: 'Rule: color-contrast. Impact: serious. Selector: #submit',
        rawDetails: 'Elements must meet minimum color contrast ratio. Help: https://dequeuniversity.com/rules/axe/4.9/color-contrast',
        annotationLevel: 'failure',
        startLine: 12,
        endLine: 12,
      },
    ]);

    expect(failures).toEqual([
      expect.objectContaining({
        source: 'axe-core',
        ruleId: 'color-contrast',
        severity: 'serious',
        path: 'src/components/Form.tsx',
        selector: '#submit',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/color-contrast',
        startLine: 12,
        endLine: 12,
      }),
    ]);
  });

  it('extracts Lighthouse accessibility output', () => {
    const failures = extractA11yFailures([
      {
        source: 'lighthouse accessibility',
        title: 'Lighthouse accessibility audit failed',
        message: '[color-contrast] Background and foreground colors do not have a sufficient contrast ratio. Severity: warning',
        rawDetails: 'URL: https://example.test/page Help: https://web.dev/measure',
      },
    ]);

    expect(failures).toEqual([
      expect.objectContaining({
        source: 'lighthouse',
        ruleId: 'color-contrast',
        severity: 'warning',
        url: 'https://example.test/page',
      }),
    ]);
  });

  it('extracts pa11y WCAG codes and selectors', () => {
    const failures = extractA11yFailures([
      {
        source: 'pa11y',
        message: 'Error: Button has no accessible name. Code: WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.Button.Name Selector: button.save',
      },
    ]);

    expect(failures).toEqual([
      expect.objectContaining({
        source: 'pa11y',
        ruleId: 'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.Button.Name',
        severity: 'error',
        selector: 'button.save',
      }),
    ]);
  });

  it('ignores non-accessibility text', () => {
    const failures = extractA11yFailures([
      {
        source: 'unit tests',
        message: 'Expected 2 to equal 3',
      },
    ]);

    expect(failures).toEqual([]);
  });
});
