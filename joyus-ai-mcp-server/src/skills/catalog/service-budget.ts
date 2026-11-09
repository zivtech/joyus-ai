/**
 * In-process memory admission ledger for the catalog generation store
 * (catalog-source.md bounds, refresh.md activation rules). Enforces the 32 MiB
 * active-document admission cap and the 64 MiB aggregate budget across
 * active + in-flight-candidate + read-pinned-retired document bytes. Never
 * evicts another logical source's active generation to admit a new one.
 */
import { CATALOG_LIMITS } from './config.js';
import type { Generation } from './types.js';

export interface LedgerSnapshot {
  readonly activeBytes: number;
  readonly candidateBytes: number;
  readonly retiredBytes: number;
  readonly totalBytes: number;
}

export class CatalogMemoryLedger {
  private readonly activeByKey = new Map<string, number>();
  private readonly retiredByKey = new Map<Generation, number>();
  private candidateBytes = 0;

  private activeTotal(): number {
    let sum = 0;
    for (const bytes of this.activeByKey.values()) sum += bytes;
    return sum;
  }

  private retiredTotal(): number {
    let sum = 0;
    for (const bytes of this.retiredByKey.values()) sum += bytes;
    return sum;
  }

  snapshot(): LedgerSnapshot {
    const activeBytes = this.activeTotal();
    const retiredBytes = this.retiredTotal();
    return {
      activeBytes,
      candidateBytes: this.candidateBytes,
      retiredBytes,
      totalBytes: activeBytes + retiredBytes + this.candidateBytes,
    };
  }

  /** Reserve candidate bytes before/while downloading; fails closed at the 64 MiB aggregate. */
  reserveCandidateBytes(bytes: number): boolean {
    if (bytes <= 0) return true;
    const { totalBytes } = this.snapshot();
    if (totalBytes + bytes > CATALOG_LIMITS.MAX_TOTAL_DOCUMENT_BYTES) return false;
    this.candidateBytes += bytes;
    return true;
  }

  /** Release a previously reserved candidate amount (rejection, validation failure, or transfer-out). */
  releaseCandidateBytes(bytes: number): void {
    if (bytes <= 0) return;
    this.candidateBytes = Math.max(0, this.candidateBytes - bytes);
  }

  /** Would activating `newActiveBytes` for `logicalSourceKey` stay within the 32 MiB active cap? */
  canActivate(logicalSourceKey: string, newActiveBytes: number): boolean {
    const priorOwnBytes = this.activeByKey.get(logicalSourceKey) ?? 0;
    const projectedActive = this.activeTotal() - priorOwnBytes + newActiveBytes;
    return projectedActive <= CATALOG_LIMITS.MAX_ACTIVE_DOCUMENT_BYTES;
  }

  /**
   * Transfer `candidateBytes` from the candidate pool to active for `logicalSourceKey`.
   * The prior active bytes for this key are handed to the caller so it can decide whether
   * to retire (pin-held) or fully release them, based on outstanding read pins.
   */
  activate(logicalSourceKey: string, candidateBytesToTransfer: number): number {
    const priorOwnBytes = this.activeByKey.get(logicalSourceKey) ?? 0;
    this.releaseCandidateBytes(candidateBytesToTransfer);
    this.activeByKey.set(logicalSourceKey, candidateBytesToTransfer);
    return priorOwnBytes;
  }

  /** Drop a logical source's active bytes entirely (policy sweep: disabled/removed/unapproved). */
  removeActive(logicalSourceKey: string): void {
    this.activeByKey.delete(logicalSourceKey);
  }

  /** Move bytes into the retired-but-pinned pool (still counted against the 64 MiB aggregate). */
  retire(retiredKey: Generation, bytes: number): void {
    if (bytes <= 0) return;
    this.retiredByKey.set(retiredKey, bytes);
  }

  /** Release a retired generation's bytes once its last pinned read completes or times out. */
  releaseRetired(retiredKey: Generation): void {
    this.retiredByKey.delete(retiredKey);
  }
}
