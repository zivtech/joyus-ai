import { describe, it, expect } from 'vitest';
import { getGateInfo } from '../../../src/enforcement/gates/registry.js';
import type { GateType } from '../../../src/enforcement/types.js';

describe('getGateInfo', () => {
  it('returns info for lint gate', () => {
    const info = getGateInfo('lint');
    expect(info.type).toBe('lint');
    expect(info.displayName).toBe('Linting');
    expect(info.defaultCommand).toBe('npx eslint .');
    expect(info.outputParser).toBeDefined();
  });

  it('returns info for test gate', () => {
    const info = getGateInfo('test');
    expect(info.type).toBe('test');
    expect(info.displayName).toBe('Tests');
    expect(info.defaultCommand).toBe('npx vitest run');
  });

  it('returns info for a11y gate', () => {
    const info = getGateInfo('a11y');
    expect(info.type).toBe('a11y');
    expect(info.displayName).toBe('Accessibility');
    expect(info.defaultCommand).toBe('npx pa11y-ci');
  });

  it('returns info for visual-regression gate (no default command)', () => {
    const info = getGateInfo('visual-regression');
    expect(info.type).toBe('visual-regression');
    expect(info.defaultCommand).toBeUndefined();
  });

  it('returns info for custom gate (no parser)', () => {
    const info = getGateInfo('custom');
    expect(info.type).toBe('custom');
    expect(info.outputParser).toBeUndefined();
  });

  it('covers all gate types', () => {
    const types: GateType[] = ['lint', 'test', 'a11y', 'visual-regression', 'custom'];
    for (const type of types) {
      const info = getGateInfo(type);
      expect(info).toBeDefined();
      expect(info.type).toBe(type);
    }
  });
});

describe('output parsers', () => {
  it('parses ESLint output', () => {
    const parser = getGateInfo('lint').outputParser!;
    const result = parser('5 problems (3 errors, 2 warnings)');
    expect(result).toEqual({
      errorCount: 3,
      warningCount: 2,
      summary: '5 problems (3 errors, 2 warnings)',
    });
  });

  it('returns null for unparseable lint output', () => {
    const parser = getGateInfo('lint').outputParser!;
    expect(parser('all good')).toBeNull();
  });

  it('parses vitest output', () => {
    const parser = getGateInfo('test').outputParser!;
    const result = parser('Tests  2 failed | 10 passed');
    expect(result).toEqual({
      errorCount: 2,
      warningCount: 0,
      summary: '10 passed, 2 failed',
    });
  });

  it('parses pa11y-ci output', () => {
    const parser = getGateInfo('a11y').outputParser!;
    const result = parser('3 errors found');
    expect(result).toEqual({
      errorCount: 3,
      warningCount: 0,
      summary: '3 errors found',
    });
  });
});
