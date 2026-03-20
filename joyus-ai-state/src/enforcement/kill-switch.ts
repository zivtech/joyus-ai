/**
 * Session-scoped kill switch — T006
 *
 * Global toggle that disables all enforcement for the current session.
 * In-memory only — new session (new process) starts with enforcement active.
 * Kill switch does NOT disable audit logging.
 *
 * State is encapsulated in KillSwitch instances. A module-level singleton
 * is exported for production use; tests can construct isolated instances.
 */

export interface KillSwitchState {
  active: boolean;
  disabledAt: string | null;
  reason: string | null;
}

export class KillSwitch {
  private enforcementDisabled = false;
  private disabledAt: string | null = null;
  private disableReason: string | null = null;

  disable(reason?: string): void {
    this.enforcementDisabled = true;
    this.disabledAt = new Date().toISOString();
    this.disableReason = reason ?? null;
  }

  enable(): void {
    this.enforcementDisabled = false;
    this.disabledAt = null;
    this.disableReason = null;
  }

  isActive(): boolean {
    return !this.enforcementDisabled;
  }

  getState(): KillSwitchState {
    return {
      active: !this.enforcementDisabled,
      disabledAt: this.disabledAt,
      reason: this.disableReason,
    };
  }
}

// Module-level singleton — used by all production callers.
const _singleton = new KillSwitch();

export function disableEnforcement(reason?: string): void {
  _singleton.disable(reason);
}

export function enableEnforcement(): void {
  _singleton.enable();
}

export function isEnforcementActive(): boolean {
  return _singleton.isActive();
}

export function getKillSwitchState(): KillSwitchState {
  return _singleton.getState();
}
