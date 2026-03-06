import { createId } from '@paralleldrive/cuid2';

export interface ProfileIngestionRequest {
  tenantId: string;
  profileId: string;
  profileVersionId?: string;
  payload: Record<string, unknown>;
}

export interface ProfileIngestionJob extends ProfileIngestionRequest {
  id: string;
  enqueuedAt: Date;
  attempt: number;
}

export interface ProfileIngestionQueueConfig {
  maxQueueDepth?: number;
  concurrency?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface ProfileQueueMetrics {
  depth: number;
  inFlight: number;
  maxQueueDepth: number;
  saturation: number;
  enqueued: number;
  completed: number;
  failed: number;
  retried: number;
  rejected: number;
  avgWaitMs: number;
}

export class ProfileQueueBackpressureError extends Error {
  constructor(public readonly maxQueueDepth: number) {
    super(`Profile ingestion queue is saturated (max depth: ${maxQueueDepth})`);
    this.name = 'ProfileQueueBackpressureError';
  }
}

type IngestionHandler = (job: ProfileIngestionJob, signal: AbortSignal) => Promise<void>;

interface InternalQueuedJob extends ProfileIngestionJob {
  attemptsRemaining: number;
}

const DEFAULT_CONFIG: Required<ProfileIngestionQueueConfig> = {
  maxQueueDepth: 500,
  concurrency: 2,
  maxRetries: 2,
  retryDelayMs: 250,
};

export class ProfileIngestionQueue {
  private readonly config: Required<ProfileIngestionQueueConfig>;
  private readonly pending: InternalQueuedJob[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private inFlight = 0;
  private accepting = true;

  private enqueued = 0;
  private completed = 0;
  private failed = 0;
  private retried = 0;
  private rejected = 0;
  private totalWaitMs = 0;

  constructor(
    private readonly handler: IngestionHandler,
    config?: ProfileIngestionQueueConfig,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  }

  enqueue(request: ProfileIngestionRequest): string {
    if (!this.accepting) {
      throw new Error('Profile ingestion queue is not accepting new jobs');
    }

    if (this.depth() >= this.config.maxQueueDepth) {
      this.rejected += 1;
      throw new ProfileQueueBackpressureError(this.config.maxQueueDepth);
    }

    const job: InternalQueuedJob = {
      id: createId(),
      tenantId: request.tenantId,
      profileId: request.profileId,
      profileVersionId: request.profileVersionId,
      payload: request.payload,
      enqueuedAt: new Date(),
      attempt: 0,
      attemptsRemaining: this.config.maxRetries + 1,
    };

    this.pending.push(job);
    this.enqueued += 1;
    this.pump();
    return job.id;
  }

  enqueueBatch(requests: ProfileIngestionRequest[]): {
    accepted: string[];
    rejected: number;
  } {
    const accepted: string[] = [];
    let rejected = 0;

    for (const req of requests) {
      try {
        accepted.push(this.enqueue(req));
      } catch (err) {
        if (err instanceof ProfileQueueBackpressureError) {
          rejected += 1;
          continue;
        }
        throw err;
      }
    }

    return { accepted, rejected };
  }

  cancel(jobId: string): boolean {
    const controller = this.controllers.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  startAccepting(): void {
    this.accepting = true;
  }

  getMetrics(): ProfileQueueMetrics {
    const saturation =
      this.config.maxQueueDepth > 0 ? this.depth() / this.config.maxQueueDepth : 0;
    return {
      depth: this.depth(),
      inFlight: this.inFlight,
      maxQueueDepth: this.config.maxQueueDepth,
      saturation: Math.min(1, saturation),
      enqueued: this.enqueued,
      completed: this.completed,
      failed: this.failed,
      retried: this.retried,
      rejected: this.rejected,
      avgWaitMs: this.completed > 0 ? Math.round(this.totalWaitMs / this.completed) : 0,
    };
  }

  private depth(): number {
    return this.pending.length + this.inFlight;
  }

  private pump(): void {
    while (this.inFlight < this.config.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) return;
      this.execute(job).catch(() => {
        // Failures are handled in execute; swallow to avoid unhandled promise.
      });
    }
  }

  private async execute(job: InternalQueuedJob): Promise<void> {
    this.inFlight += 1;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    const startedAt = Date.now();
    job.attempt += 1;
    job.attemptsRemaining -= 1;

    try {
      await this.handler(job, controller.signal);
      this.completed += 1;
      this.totalWaitMs += Math.max(0, startedAt - job.enqueuedAt.getTime());
    } catch {
      const shouldRetry = job.attemptsRemaining > 0 && !controller.signal.aborted;
      if (shouldRetry) {
        this.retried += 1;
        setTimeout(() => {
          this.pending.push(job);
          this.pump();
        }, this.config.retryDelayMs);
      } else {
        this.failed += 1;
      }
    } finally {
      this.controllers.delete(job.id);
      this.inFlight -= 1;
      this.pump();
    }
  }
}
