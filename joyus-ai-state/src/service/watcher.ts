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

export interface WatcherOptions {
  projectRoot: string;
  debounce?: {
    gitEvents: number;   // default: 500ms
    fileChanges: number; // default: 5000ms
  };
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
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastHead: string | null = null;

  constructor(options: WatcherOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.debounceMs = { ...DEFAULT_DEBOUNCE, ...options.debounce };
    this.usePolling = options.usePolling ?? false;
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

    // Wait for watcher to be ready
    await new Promise<void>((resolve) => {
      this.watcher!.on('ready', resolve);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  private debounceEmit(eventName: string, debounceMs: number): void {
    const existing = this.timers.get(eventName);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.timers.delete(eventName);

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

      this.emit(eventName);
    }, debounceMs);

    this.timers.set(eventName, timer);
  }
}
