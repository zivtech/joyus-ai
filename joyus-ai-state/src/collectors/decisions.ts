/**
 * Decision tracking — T012
 *
 * Carries forward decisions from previous snapshots,
 * adding new decisions or resolving existing ones.
 */

import { createId } from '@paralleldrive/cuid2';
import type { Decision } from '../core/types.js';

export function carryForwardDecisions(
  previousDecisions: Decision[],
  newDecision?: string,
  resolvedId?: string,
  resolvedAnswer?: string,
): Decision[] {
  const decisions = previousDecisions.map((d) => ({ ...d }));

  if (newDecision) {
    decisions.push({
      id: createId(),
      question: newDecision,
      context: '',
      options: [],
      answer: null,
      resolved: false,
      timestamp: new Date().toISOString(),
      resolvedAt: null,
    });
  }

  if (resolvedId) {
    const resolvedAt = new Date().toISOString();
    return decisions.map((d) =>
      d.id === resolvedId
        ? { ...d, resolved: true, answer: resolvedAnswer ?? null, resolvedAt }
        : d,
    );
  }

  return decisions;
}
