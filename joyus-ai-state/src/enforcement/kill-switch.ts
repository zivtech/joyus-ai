/**
 * Session-scoped kill switch — T006
 *
 * Global toggle that disables all enforcement for the current session.
 * In-memory only — new session (new process) starts with enforcement active.
 * Kill switch does NOT disable audit logging.
 */

let enforcementDisabled = false;
let disabledAt: string | null = null;
let disableReason: string | null = null;

export function disableEnforcement(reason?: string): void {
  enforcementDisabled = true;
  disabledAt = new Date().toISOString();
  disableReason = reason ?? null;
}

export function enableEnforcement(): void {
  enforcementDisabled = false;
  disabledAt = null;
  disableReason = null;
}

export function isEnforcementActive(): boolean {
  return !enforcementDisabled;
}

export interface KillSwitchState {
  active: boolean;
  disabledAt: string | null;
  reason: string | null;
}

export function getKillSwitchState(): KillSwitchState {
  return {
    active: !enforcementDisabled,
    disabledAt,
    reason: disableReason,
  };
}
