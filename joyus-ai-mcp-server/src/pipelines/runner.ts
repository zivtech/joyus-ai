import { createId } from '@paralleldrive/cuid2';

import { PipelineEngine } from './engine.js';
import type { PipelineDefinition, PipelineRunOptions, PipelineRunReport } from './types.js';

export interface PipelineRunnerConfig {
  concurrency?: number;
  maxQueueDepth?: number;
}

export interface PipelineQueueMetrics {
  depth: number;
  inFlight: number;
  completed: number;
  failed: number;
  rejected: number;
  maxQueueDepth: number;
  saturation: number;
}

export class PipelineQueueBackpressureError extends Error {
  constructor(public readonly maxQueueDepth: number) {
    super(`Pipeline queue is saturated (max depth: ${maxQueueDepth})`);
    this.name = 'PipelineQueueBackpressureError';
  }
}

interface QueuedPipelineRun {
  queueId: string;
  pipeline: PipelineDefinition;
  input: Record<string, unknown>;
  options?: PipelineRunOptions;
  resolve: (value: PipelineRunReport) => void;
  reject: (reason?: unknown) => void;
}

const DEFAULT_CONFIG = {
  concurrency: 2,
  maxQueueDepth: 200,
};

export class PipelineRunner {
  private readonly config: Required<PipelineRunnerConfig>;
  private readonly pending: QueuedPipelineRun[] = [];
  private inFlight = 0;
  private completed = 0;
  private failed = 0;
  private rejected = 0;

  constructor(
    private readonly engine: PipelineEngine,
    config?: PipelineRunnerConfig,
  ) {
    this.config = {
      concurrency: config?.concurrency ?? DEFAULT_CONFIG.concurrency,
      maxQueueDepth: config?.maxQueueDepth ?? DEFAULT_CONFIG.maxQueueDepth,
    };
  }

  enqueue(
    pipeline: PipelineDefinition,
    input: Record<string, unknown>,
    options?: PipelineRunOptions,
  ): Promise<PipelineRunReport> {
    if (this.depth() >= this.config.maxQueueDepth) {
      this.rejected += 1;
      throw new PipelineQueueBackpressureError(this.config.maxQueueDepth);
    }

    return new Promise<PipelineRunReport>((resolve, reject) => {
      this.pending.push({
        queueId: createId(),
        pipeline,
        input,
        options,
        resolve,
        reject,
      });
      this.pump();
    });
  }

  getMetrics(): PipelineQueueMetrics {
    const saturation =
      this.config.maxQueueDepth > 0 ? this.depth() / this.config.maxQueueDepth : 0;
    return {
      depth: this.depth(),
      inFlight: this.inFlight,
      completed: this.completed,
      failed: this.failed,
      rejected: this.rejected,
      maxQueueDepth: this.config.maxQueueDepth,
      saturation: Math.min(1, saturation),
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
        // Execution errors are handled by promise reject in execute.
      });
    }
  }

  private async execute(job: QueuedPipelineRun): Promise<void> {
    this.inFlight += 1;
    try {
      const report = await this.engine.run(job.pipeline, job.input, job.options);
      if (report.status === 'failed') {
        this.failed += 1;
      } else {
        this.completed += 1;
      }
      job.resolve(report);
    } catch (err) {
      this.failed += 1;
      job.reject(err);
    } finally {
      this.inFlight -= 1;
      this.pump();
    }
  }
}
