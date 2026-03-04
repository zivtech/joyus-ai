import { describe, it, expect } from 'vitest';
import {
  checkBranchNaming,
  generateSuggestion,
} from '../../../src/enforcement/git/branch-hygiene.js';
import type { BranchRule } from '../../../src/enforcement/types.js';

const defaultRules: BranchRule = {
  namingConvention: '^(feature|fix|hotfix)/[a-z0-9-]+$',
  staleDays: 14,
  maxActiveBranches: 10,
  protectedBranches: ['main', 'master'],
};

describe('checkBranchNaming', () => {
  it('passes for valid branch name', () => {
    const result = checkBranchNaming('feature/add-login', defaultRules);
    expect(result.valid).toBe(true);
  });

  it('fails for invalid branch name', () => {
    const result = checkBranchNaming('my-branch', defaultRules);
    expect(result.valid).toBe(false);
    expect(result.suggestedName).toBeDefined();
  });

  it('skips check for protected branches', () => {
    const result = checkBranchNaming('main', defaultRules);
    expect(result.valid).toBe(true);
  });

  it('passes when no naming convention configured', () => {
    const result = checkBranchNaming('anything', {
      ...defaultRules,
      namingConvention: undefined,
    });
    expect(result.valid).toBe(true);
  });

  it('handles invalid regex in config gracefully', () => {
    const result = checkBranchNaming('anything', {
      ...defaultRules,
      namingConvention: '[invalid regex',
    });
    expect(result.valid).toBe(true);
  });

  it('validates fix/ prefix', () => {
    expect(checkBranchNaming('fix/bug-123', defaultRules).valid).toBe(true);
  });

  it('validates hotfix/ prefix', () => {
    expect(checkBranchNaming('hotfix/urgent-fix', defaultRules).valid).toBe(true);
  });

  it('rejects uppercase in branch names', () => {
    expect(checkBranchNaming('feature/Add-Login', defaultRules).valid).toBe(false);
  });
});

describe('generateSuggestion', () => {
  it('lowercases and adds feature/ prefix', () => {
    expect(generateSuggestion('My Branch')).toBe('feature/my-branch');
  });

  it('keeps existing feature/ prefix', () => {
    expect(generateSuggestion('feature/my-branch')).toBe('feature/my-branch');
  });

  it('removes special characters', () => {
    expect(generateSuggestion('feature/my_branch!')).toBe('feature/mybranch');
  });
});
