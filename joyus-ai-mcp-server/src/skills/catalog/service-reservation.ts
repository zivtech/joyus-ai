import type { CatalogMemoryLedger } from './service-budget.js';

/** Owns one attempt's pre-admitted credits and streaming reservations. */
export class CandidateReservation {
  private streamed = 0;
  private closed = false;

  constructor(
    private readonly ledger: CatalogMemoryLedger,
    private reserved: number
  ) {}

  reserve(bytes: number): boolean {
    if (this.closed || !Number.isSafeInteger(bytes) || bytes < 0) return false;
    const additional = Math.max(0, this.streamed + bytes - this.reserved);
    if (!this.ledger.reserveCandidateBytes(additional)) return false;
    this.reserved += additional;
    this.streamed += bytes;
    return true;
  }

  release(bytes: number): void {
    if (this.closed) return;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.streamed) {
      throw new Error('Invalid catalog reservation release');
    }
    this.streamed -= bytes;
    this.reserved -= bytes;
    this.ledger.releaseCandidateBytes(bytes);
  }

  /** Leave only actual retained bytes in the ledger for the synchronous activation swap. */
  transfer(actualBytes: number): boolean {
    if (this.closed || this.streamed !== actualBytes) return false;
    this.ledger.releaseCandidateBytes(this.reserved - actualBytes);
    this.reserved = 0;
    this.streamed = 0;
    this.closed = true;
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.ledger.releaseCandidateBytes(this.reserved);
    this.reserved = 0;
    this.streamed = 0;
    this.closed = true;
  }
}
