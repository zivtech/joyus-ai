/**
 * Accuracy A/B for the gate (NFR-001). STUB — wire to your model for the real run.
 *
 * The gate is strict: any non-zero accuracyDelta on a kind disqualifies that kind. This
 * stub throws rather than returning a fake delta of 0 (which would be a false `go`).
 *
 * When wired: run each task's prompt twice with an IDENTICAL model + prompt template —
 * once with the uncompressed payload, once with the compressed payload — and score
 * correctness against the task's known answer.
 */

import { NotImplemented, PayloadKind } from './headroom-client';

export interface Task {
  id: string;
  prompt: string; // references the payload
  expected: string; // known-correct answer
}

export interface SuiteResult {
  kind: PayloadKind;
  /** correctness in [0,1] over the suite, run on UNCOMPRESSED payloads */
  uncompressedScore: number;
  /** correctness in [0,1] over the suite, run on COMPRESSED payloads */
  compressedScore: number;
  sampleSize: number;
}

/** accuracyDelta = compressed − uncompressed. Must equal 0 to pass (NFR-001). */
export function accuracyDelta(r: SuiteResult): number {
  return r.compressedScore - r.uncompressedScore;
}

export async function runSuite(
  _kind: PayloadKind,
  _tasks: Task[],
): Promise<SuiteResult> {
  throw new NotImplemented('accuracy.runSuite() — wire the model A/B before running');
}
