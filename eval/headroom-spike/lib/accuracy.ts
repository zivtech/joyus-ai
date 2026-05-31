/**
 * Accuracy A/B for the gate (NFR-001).
 *
 * RUN VIA ORCHESTRATED SUBAGENTS, not an in-process LLM SDK — a Node child process
 * cannot spawn agents. The flow (see ../build-runset.py and the run record):
 *   1. build-runset.py emits, per task, a control prompt (FULL payload) and a treatment
 *      prompt (CCR-COMPRESSED payload + a `headroom_retrieve` curl affordance), plus a
 *      private expected-answers file. Tasks are fact-extraction questions whose answers
 *      live ONLY in the dropped prose body, so a treatment agent that does not retrieve
 *      cannot answer.
 *   2. One subagent per (payload, condition) answers with an IDENTICAL model both arms.
 *   3. Answers are scored EXACT-MATCH (numeric word/digit normalized) — no LLM judge —
 *      into runset/scored.json: per-kind uncompressedScore, compressedScore, accuracyDelta.
 *   4. run-spike.ts reads accuracyDelta per kind from that artifact.
 * The gate is strict: any non-zero accuracyDelta on a kind disqualifies that kind.
 */

import { PayloadKind } from './headroom-client';

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

/**
 * The suite is executed out-of-process by subagents (see header). This helper documents
 * the contract: run-spike.ts reads the resulting per-kind accuracyDelta from
 * runset/scored.json rather than calling a model in-process.
 */
export function suiteArtifactPath(): string {
  return 'runset/scored.json';
}
