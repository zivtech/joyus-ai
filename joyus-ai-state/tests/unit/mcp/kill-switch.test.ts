import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleKillSwitch } from '../../../src/mcp/tools/kill-switch.js';
import { enableEnforcement, isEnforcementActive } from '../../../src/enforcement/kill-switch.js';
import { listAuditFiles, readEntries } from '../../../src/enforcement/audit/writer.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('handleKillSwitch', () => {
  let auditDir: string;
  const ctx = () => ({
    projectRoot: '/tmp/nonexistent-project',
    sessionId: 'test-session',
    auditDir,
  });

  beforeEach(() => {
    auditDir = join(tmpdir(), `mcp-kill-test-${Date.now()}`);
    enableEnforcement();
  });

  afterEach(() => {
    enableEnforcement();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('disables enforcement', () => {
    const result = handleKillSwitch({ action: 'disable' }, ctx());
    expect(result.enforcementActive).toBe(false);
    expect(isEnforcementActive()).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('enables enforcement', () => {
    handleKillSwitch({ action: 'disable' }, ctx());
    const result = handleKillSwitch({ action: 'enable' }, ctx());
    expect(result.enforcementActive).toBe(true);
    expect(isEnforcementActive()).toBe(true);
    expect(result.message).toContain('re-enabled');
  });

  it('creates audit entry on disable', () => {
    handleKillSwitch({ action: 'disable', reason: 'testing' }, ctx());
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('kill-switch-on');
    expect(entries[0].details.reason).toBe('testing');
  });

  it('creates audit entry on enable', () => {
    handleKillSwitch({ action: 'enable' }, ctx());
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].actionType).toBe('kill-switch-off');
  });

  it('returns auditEntryId', () => {
    const result = handleKillSwitch({ action: 'disable' }, ctx());
    expect(result.auditEntryId).toBeTruthy();
    expect(typeof result.auditEntryId).toBe('string');
  });

  it('records reason in audit', () => {
    handleKillSwitch({ action: 'disable', reason: 'emergency' }, ctx());
    const files = listAuditFiles(auditDir);
    const { entries } = readEntries(files[0]);
    expect(entries[0].details.reason).toBe('emergency');
  });

  it('audit works even when disabling enforcement', () => {
    const result = handleKillSwitch({ action: 'disable' }, ctx());
    expect(result.enforcementActive).toBe(false);
    const files = listAuditFiles(auditDir);
    expect(files.length).toBe(1);
  });
});
