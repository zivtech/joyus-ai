import { describe, it, expect, beforeEach } from 'vitest';
import {
  disableEnforcement,
  enableEnforcement,
  isEnforcementActive,
  getKillSwitchState,
} from '../../../src/enforcement/kill-switch.js';

describe('kill-switch', () => {
  beforeEach(() => {
    enableEnforcement();
  });

  it('starts with enforcement active', () => {
    expect(isEnforcementActive()).toBe(true);
  });

  it('disables enforcement', () => {
    disableEnforcement('hotfix deploy');
    expect(isEnforcementActive()).toBe(false);
  });

  it('re-enables enforcement', () => {
    disableEnforcement();
    enableEnforcement();
    expect(isEnforcementActive()).toBe(true);
  });

  it('tracks disable reason and timestamp', () => {
    disableEnforcement('emergency hotfix');
    const state = getKillSwitchState();
    expect(state.active).toBe(false);
    expect(state.reason).toBe('emergency hotfix');
    expect(state.disabledAt).toBeTruthy();
    // Verify it's a valid ISO timestamp
    expect(() => new Date(state.disabledAt!)).not.toThrow();
  });

  it('clears state on re-enable', () => {
    disableEnforcement('test');
    enableEnforcement();
    const state = getKillSwitchState();
    expect(state.active).toBe(true);
    expect(state.reason).toBeNull();
    expect(state.disabledAt).toBeNull();
  });

  it('works without a reason', () => {
    disableEnforcement();
    const state = getKillSwitchState();
    expect(state.active).toBe(false);
    expect(state.reason).toBeNull();
  });
});
