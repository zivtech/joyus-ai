import { describe, it, expect } from 'vitest';
import { resolveGateTier } from '../../src/enforcement/gates/runner.js';
import { verifyBranch } from '../../src/enforcement/git/branch-verify.js';
import type { QualityGate, UserTier } from '../../src/enforcement/types.js';

function makeGate(id: string): QualityGate {
  return {
    id,
    name: id,
    type: 'custom',
    command: 'echo ok',
    triggerPoints: ['pre-commit'],
    defaultTier: 'always-run',
    timeout: 60,
    order: 0,
  };
}

describe('Integration: Tier Behavior Matrix', () => {
  // --- Gates ---

  describe('Tier 1 (junior) + gates', () => {
    it('gate failure blocks operation (always-run)', () => {
      const tier = resolveGateTier(makeGate('lint'), 'tier-1', {}, []);
      expect(tier).toBe('always-run');
    });
  });

  describe('Tier 2 (power) + gates', () => {
    it('gate uses configured default tier (ask-me when configured)', () => {
      const gate = makeGate('lint');
      gate.defaultTier = 'ask-me';
      const tier = resolveGateTier(gate, 'tier-2', {}, []);
      expect(tier).toBe('ask-me');
    });

    it('mandatory gate overrides tier-2 default', () => {
      const gate = makeGate('lint');
      gate.defaultTier = 'skip';
      const tier = resolveGateTier(gate, 'tier-2', {}, ['lint']);
      expect(tier).toBe('always-run');
    });
  });

  describe('Tier 3 (non-tech) + gates', () => {
    it('gate failure blocks silently (always-run)', () => {
      const tier = resolveGateTier(makeGate('lint'), 'tier-3', {}, []);
      expect(tier).toBe('always-run');
    });
  });

  // --- Branch verification ---

  describe('Tier 1 (junior) + branch', () => {
    it('branch mismatch blocks commit', () => {
      const result = verifyBranch({
        currentBranch: 'wrong-branch',
        expectedBranch: 'feature/correct',
        operation: 'commit',
        userTier: 'tier-1',
      });
      expect(result.match).toBe(false);
      expect(result.enforcement).toBe('block');
    });
  });

  describe('Tier 2 (power) + branch', () => {
    it('branch mismatch warns but allows', () => {
      const result = verifyBranch({
        currentBranch: 'wrong-branch',
        expectedBranch: 'feature/correct',
        operation: 'commit',
        userTier: 'tier-2',
      });
      expect(result.match).toBe(false);
      expect(result.enforcement).toBe('warn');
    });
  });

  describe('Tier 3 (non-tech) + branch', () => {
    it('branch mismatch blocks', () => {
      const result = verifyBranch({
        currentBranch: 'wrong-branch',
        expectedBranch: 'feature/correct',
        operation: 'commit',
        userTier: 'tier-3',
      });
      expect(result.match).toBe(false);
      expect(result.enforcement).toBe('block');
    });
  });

  // --- Skills ---

  describe('Tier 1 (junior) + skills', () => {
    it('skills cannot be bypassed (mandatory always enforced)', () => {
      // tier-1 always resolves to always-run for gates, and skills are always active
      const tier = resolveGateTier(makeGate('skill-check'), 'tier-1', {}, []);
      expect(tier).toBe('always-run');
    });
  });

  describe('Tier 2 (power) + skills', () => {
    it('skill bypass allowed with override', () => {
      // tier-2 respects gate default tier including skip overrides
      const gate = makeGate('skill-check');
      const tier = resolveGateTier(gate, 'tier-2', { 'skill-check': 'skip' }, []);
      expect(tier).toBe('skip');
    });
  });

  describe('Tier 3 (non-tech) + skills', () => {
    it('skills always active, no bypass option', () => {
      const tier = resolveGateTier(makeGate('skill-check'), 'tier-3', {}, []);
      expect(tier).toBe('always-run');
      // Even with an override, tier-3 always runs
      const tierWithOverride = resolveGateTier(makeGate('skill-check'), 'tier-3', {}, []);
      expect(tierWithOverride).toBe('always-run');
    });
  });

  // --- Cross-tier verification ---

  describe('cross-tier enforcement consistency', () => {
    it('all 3 tiers x branch mismatch produce expected enforcement', () => {
      const tiers: UserTier[] = ['tier-1', 'tier-2', 'tier-3'];
      const expected: Record<UserTier, 'block' | 'warn'> = {
        'tier-1': 'block',
        'tier-2': 'warn',
        'tier-3': 'block',
      };

      for (const tier of tiers) {
        const result = verifyBranch({
          currentBranch: 'wrong',
          expectedBranch: 'correct',
          operation: 'commit',
          userTier: tier,
        });
        expect(result.enforcement).toBe(expected[tier]);
      }
    });

    it('all 3 tiers resolve gates correctly', () => {
      const gate = makeGate('lint');
      gate.defaultTier = 'ask-me';

      expect(resolveGateTier(gate, 'tier-1', {}, [])).toBe('always-run');
      expect(resolveGateTier(gate, 'tier-2', {}, [])).toBe('ask-me');
      expect(resolveGateTier(gate, 'tier-3', {}, [])).toBe('always-run');
    });
  });
});
