/**
 * Bounded round-robin FIFO scheduler for refresh candidates (catalog-source.md): at most
 * two concurrent attempts, one queued request per configured logical source, maximum
 * 1,000 queued sources. Timer/manual triggers never jump ahead of an already-queued source.
 */
import { CATALOG_LIMITS } from './config.js';

export type EnqueueOutcome = 'started' | 'queued' | 'coalesced' | 'full';

export class CatalogSourceQueue {
  private readonly queued: string[] = [];
  private readonly queuedSet = new Set<string>();
  private readonly running = new Set<string>();

  constructor(
    private readonly maxConcurrent: number = CATALOG_LIMITS.MAX_ACTIVE_CANDIDATES,
    private readonly maxQueued: number = CATALOG_LIMITS.MAX_QUEUED_SOURCES
  ) {}

  isInFlight(sourceKey: string): boolean {
    return this.running.has(sourceKey) || this.queuedSet.has(sourceKey);
  }

  /** Admit `sourceKey` for a candidate attempt; coalesces if already running or queued. */
  enqueue(sourceKey: string): EnqueueOutcome {
    if (this.running.has(sourceKey)) return 'coalesced';
    if (this.queuedSet.has(sourceKey)) return 'coalesced';
    if (this.running.size < this.maxConcurrent) {
      this.running.add(sourceKey);
      return 'started';
    }
    if (this.queued.length >= this.maxQueued) return 'full';
    this.queued.push(sourceKey);
    this.queuedSet.add(sourceKey);
    return 'queued';
  }

  /** Mark `sourceKey`'s attempt complete and promote the next queued source, if any (FIFO, fair). */
  complete(sourceKey: string): string | undefined {
    this.running.delete(sourceKey);
    if (this.running.size >= this.maxConcurrent) return undefined;
    const next = this.queued.shift();
    if (next === undefined) return undefined;
    this.queuedSet.delete(next);
    this.running.add(next);
    return next;
  }

  /** Shutdown: drop all queued work; in-flight attempts are cancelled by the caller separately. */
  clear(): void {
    this.queued.length = 0;
    this.queuedSet.clear();
    this.running.clear();
  }
}
