/**
 * Event Adapter — Payload Mapper Service
 *
 * Applies JSONPath-style mapping rules to transform arbitrary webhook JSON
 * into the platform's trigger metadata format.
 *
 * Supports:
 * - $.field — top-level field access
 * - $.nested.field — dot-path traversal
 * - $.array[0].field — array index access
 * - Static string values (no $ prefix → return literal)
 */

// ============================================================
// TYPES
// ============================================================

export interface PayloadMappingConfig {
  triggerType?: string;
  pipelineId?: string;
  metadataMapping?: Record<string, string>;
}

export interface MappedPayload {
  triggerType?: string;
  pipelineId?: string;
  metadata: Record<string, unknown>;
}

// ============================================================
// PATH EVALUATOR
// ============================================================

/**
 * Evaluate a simple JSONPath expression against an object.
 * If the path does not start with '$', it is treated as a literal value.
 * Returns undefined for missing paths (never throws).
 */
export function evaluatePath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$')) return path;

  const pathStr = path.startsWith('$.') ? path.slice(2) : path.slice(1);
  if (!pathStr) return obj;

  const parts = pathStr.split('.');
  return parts.reduce((cur: unknown, part: string) => {
    if (cur == null || typeof cur !== 'object') return undefined;

    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      const [, key, idx] = arrayMatch;
      const arr = (cur as Record<string, unknown>)[key];
      if (!Array.isArray(arr)) return undefined;
      return arr[parseInt(idx, 10)];
    }

    return (cur as Record<string, unknown>)[part];
  }, obj);
}

// ============================================================
// PAYLOAD MAPPER
// ============================================================

/**
 * Apply mapping rules to transform a webhook payload into trigger metadata.
 *
 * - triggerType/pipelineId: evaluated as path if starts with $, else literal
 * - metadataMapping: each key maps to a path expression evaluated against the body
 * - Undefined path results are omitted from the output (not included as null)
 */
export function mapPayload(
  body: Record<string, unknown>,
  mapping: PayloadMappingConfig,
): MappedPayload {
  const result: MappedPayload = { metadata: {} };

  if (mapping.triggerType) {
    const value = evaluatePath(body, mapping.triggerType);
    if (value !== undefined) {
      result.triggerType = String(value);
    }
  }

  if (mapping.pipelineId) {
    const value = evaluatePath(body, mapping.pipelineId);
    if (value !== undefined) {
      result.pipelineId = String(value);
    }
  }

  if (mapping.metadataMapping) {
    for (const [outputKey, pathExpr] of Object.entries(mapping.metadataMapping)) {
      const value = evaluatePath(body, pathExpr);
      if (value !== undefined) {
        result.metadata[outputKey] = value;
      }
    }
  }

  return result;
}
