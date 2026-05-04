/**
 * Filesystem watcher — T030
 *
 * Monitors .git/ for commits and branch switches, emits typed events.
 * Uses chokidar for reliable cross-platform file watching.
 */

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import chokidar from 'chokidar';
import picomatch from 'picomatch';
import type { CustomTrigger } from '../core/types.js';

export interface WatcherOptions {
  projectRoot: string;
  debounce?: {
    gitEvents: number;   // default: 500ms
    fileChanges: number; // default: 5000ms
  };
  customTriggers?: CustomTrigger[];
  usePolling?: boolean; // default: false — use true in tests or unreliable FS environments
}

const DEFAULT_DEBOUNCE = {
  gitEvents: 500,
  fileChanges: 5000,
};

export class FileWatcher extends EventEmitter {
  private projectRoot: string;
  private debounceMs: { gitEvents: number; fileChanges: number };
  private usePolling: boolean;
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private projectWatcher: ReturnType<typeof chokidar.watch> | null = null;
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastHead: string | null = null;
  private customMatchers: Array<{ event: string; match: (filePath: string) => boolean }> = [];

  constructor(options: WatcherOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.debounceMs = { ...DEFAULT_DEBOUNCE, ...options.debounce };
    this.usePolling = options.usePolling ?? false;
    this.customMatchers = (options.customTriggers ?? []).map((trigger) => ({
      event: trigger.event,
      match: picomatch(trigger.pattern, { dot: true }),
    }));
  }

  async start(): Promise<void> {
    // Read initial HEAD to detect branch switches
    try {
      this.lastHead = await readFile(path.join(this.projectRoot, '.git', 'HEAD'), 'utf8');
    } catch {
      this.lastHead = null;
    }

    const headPath = path.join(this.projectRoot, '.git', 'HEAD');
    const refsPath = path.join(this.projectRoot, '.git', 'refs', 'heads');

    this.watcher = chokidar.watch([headPath, refsPath], {
      persistent: false,
      ignoreInitial: true,
      usePolling: this.usePolling,
      interval: this.usePolling ? 50 : undefined,
    });

    const onFileEvent = (changedPath: string) => {
      if (changedPath === headPath) {
        this.debounceEmit('git-branch-switch', this.debounceMs.gitEvents);
      } else {
        this.debounceEmit('git-commit', this.debounceMs.gitEvents);
      }
    };

    this.watcher.on('change', onFileEvent);
    this.watcher.on('add', onFileEvent);

    this.watcher.on('error', () => {
      // Ignore watch errors
    });

    this.projectWatcher = chokidar.watch(this.projectRoot, {
      persistent: false,
      ignoreInitial: true,
      usePolling: this.usePolling,
      interval: this.usePolling ? 50 : undefined,
      ignored: [
        '**/.git/**',
        '**/.joyus-ai/**',
        '**/.omc/**',
        '**/node_modules/**',
        '**/dist/**',
      ],
    });

    const onProjectFileEvent = (changedPath: string) => {
      const relativePath = path.relative(this.projectRoot, changedPath);
      if (!relativePath || relativePath.startsWith('..')) return;

      this.debounceEmit('file-change', this.debounceMs.fileChanges);

      for (const trigger of this.customMatchers) {
        if (trigger.match(relativePath)) {
          this.debounceEmit('custom-event', this.debounceMs.fileChanges, trigger.event);
        }
      }
    };

    this.projectWatcher.on('change', onProjectFileEvent);
    this.projectWatcher.on('add', onProjectFileEvent);
    this.projectWatcher.on('unlink', onProjectFileEvent);

    this.projectWatcher.on('error', () => {
      // Ignore watch errors
    });

    // Wait for watchers to be ready
    await new Promise<void>((resolve) => {
      let readyCount = 0;
      const markReady = () => {
        readyCount += 1;
        if (readyCount >= 2) resolve();
      };
      this.watcher!.on('ready', markReady);
      this.projectWatcher!.on('ready', markReady);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.projectWatcher) {
      await this.projectWatcher.close();
      this.projectWatcher = null;
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private debounceEmit(eventName: string, debounceMs: number, detail?: string): void {
    const timerKey = detail ? `${eventName}:${detail}` : eventName;
    const existing = this.timers.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.timers.delete(timerKey);

      // For branch switch, verify HEAD actually changed
      if (eventName === 'git-branch-switch') {
        try {
          const currentHead = await readFile(
            path.join(this.projectRoot, '.git', 'HEAD'),
            'utf8',
          );
          if (currentHead === this.lastHead) {
            // HEAD file was touched but ref didn't change — this is a commit, not a switch
            return;
          }
          this.lastHead = currentHead;
        } catch {
          return;
        }
      }

      if (eventName === 'custom-event') {
        this.emit(eventName, detail);
      } else {
        this.emit(eventName);
      }
    }, debounceMs);

    this.timers.set(timerKey, timer);
  }
}
