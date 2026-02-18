/**
 * Gate type registry — T014
 *
 * Registry of supported gate types with metadata about each.
 * Output parsers are best-effort; if parsing fails, fall back to exit code.
 */

import type { GateType } from '../types.js';

export interface GateOutput {
  errorCount: number;
  warningCount: number;
  summary: string;
}

export interface GateTypeInfo {
  type: GateType;
  displayName: string;
  defaultCommand?: string;
  outputParser?: (stdout: string) => GateOutput | null;
}

function parseLintOutput(stdout: string): GateOutput | null {
  // ESLint summary line: "X problems (Y errors, Z warnings)"
  const match = stdout.match(/(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/);
  if (!match) return null;
  return {
    errorCount: parseInt(match[2], 10),
    warningCount: parseInt(match[3], 10),
    summary: match[0],
  };
}

function parseTestOutput(stdout: string): GateOutput | null {
  // Vitest summary: "Tests  X failed | Y passed"
  const failMatch = stdout.match(/(\d+)\s+failed/);
  const passMatch = stdout.match(/(\d+)\s+passed/);
  if (!failMatch && !passMatch) return null;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  return {
    errorCount: failed,
    warningCount: 0,
    summary: `${passed} passed, ${failed} failed`,
  };
}

function parseA11yOutput(stdout: string): GateOutput | null {
  // pa11y-ci summary: "X errors found"
  const match = stdout.match(/(\d+)\s+errors?\s+found/i);
  if (!match) return null;
  return {
    errorCount: parseInt(match[1], 10),
    warningCount: 0,
    summary: match[0],
  };
}

const registry: Record<GateType, GateTypeInfo> = {
  lint: {
    type: 'lint',
    displayName: 'Linting',
    defaultCommand: 'npx eslint .',
    outputParser: parseLintOutput,
  },
  test: {
    type: 'test',
    displayName: 'Tests',
    defaultCommand: 'npx vitest run',
    outputParser: parseTestOutput,
  },
  a11y: {
    type: 'a11y',
    displayName: 'Accessibility',
    defaultCommand: 'npx pa11y-ci',
    outputParser: parseA11yOutput,
  },
  'visual-regression': {
    type: 'visual-regression',
    displayName: 'Visual Regression',
  },
  custom: {
    type: 'custom',
    displayName: 'Custom',
  },
};

export function getGateInfo(type: GateType): GateTypeInfo {
  return registry[type];
}
