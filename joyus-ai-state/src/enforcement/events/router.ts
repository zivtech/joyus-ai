/**
 * Enforcement event router — T045
 *
 * Routes enforcement events to the appropriate handlers.
 * Standalone module that can be wired into 002's companion service.
 */

import type { MergedEnforcementConfig } from '../types.js';
import { onSessionStart } from './session-start.js';
import type { SessionStartReport } from './session-start.js';
import { processFileChange, DEBOUNCE_MS } from './file-change.js';
import type { SkillReloadResult } from './file-change.js';
import { onBranchSwitch } from './branch-switch.js';
import type { ConfigReloadResult } from './branch-switch.js';

export type EnforcementEvent =
  | { type: 'session-start' }
  | { type: 'file-change'; files: string[] }
  | { type: 'branch-switch'; branch: string };

export type EventResult = SessionStartReport | SkillReloadResult | ConfigReloadResult | null;

export class EnforcementEventRouter {
  private config: MergedEnforcementConfig;
  private readonly sessionId: string;
  private readonly auditDir: string;
  private readonly projectRoot: string;
  private previousSkillIds: string[] = [];

  // Instance-scoped debounce state (replaces module-level vars in file-change.ts)
  private pendingFiles: string[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    config: MergedEnforcementConfig,
    ctx: { sessionId: string; auditDir: string; projectRoot: string },
  ) {
    this.config = config;
    this.sessionId = ctx.sessionId;
    this.auditDir = ctx.auditDir;
    this.projectRoot = ctx.projectRoot;
  }

  /** Reset debounce state — useful in tests to avoid timer leaks between cases. */
  resetDebounceState(): void {
    this.pendingFiles = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private debouncedFileChange(files: string[]): Promise<SkillReloadResult> {
    return new Promise((resolve) => {
      this.pendingFiles.push(...files);

      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        const accumulated = [...this.pendingFiles];
        this.pendingFiles = [];
        this.debounceTimer = null;
        resolve(
          processFileChange(accumulated, this.config, {
            sessionId: this.sessionId,
            auditDir: this.auditDir,
            repoPath: this.projectRoot,
            previousSkillIds: this.previousSkillIds,
          }),
        );
      }, DEBOUNCE_MS);
    });
  }

  async handleEvent(event: EnforcementEvent): Promise<EventResult> {
    switch (event.type) {
      case 'session-start':
        return onSessionStart(this.config, {
          sessionId: this.sessionId,
          auditDir: this.auditDir,
        });

      case 'file-change': {
        const result = await this.debouncedFileChange(event.files);
        if (result.reloaded) {
          this.previousSkillIds = [
            ...new Set([...this.previousSkillIds, ...result.newSkillIds]),
          ];
        }
        return result;
      }

      case 'branch-switch': {
        const result = onBranchSwitch(event.branch, this.config, {
          projectRoot: this.projectRoot,
          sessionId: this.sessionId,
          auditDir: this.auditDir,
        });
        if (result.reloaded) {
          const { loadEnforcementConfig } = await import('../config.js');
          this.config = loadEnforcementConfig(this.projectRoot).config;
        }
        return result;
      }

      default:
        return null;
    }
  }

  updateConfig(config: MergedEnforcementConfig): void {
    this.config = config;
  }
}
