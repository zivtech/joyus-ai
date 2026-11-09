import { z } from 'zod';

import type { SkillDecision, SkillDecisionProvider } from '../../policy/skills.js';

import { decodeCursor, encodeCursor } from './cursor.js';
import { getCatalogRuntime } from './runtime.js';
import {
  computeLogicalSourceKey,
  sourceBindingRevision,
  type CatalogAccessPolicyReader,
  type CatalogServiceRuntime,
  type Generation,
  type SkillMetadata,
} from './types.js';

const common = { schemaVersion: z.literal(2), workspaceId: z.string().min(1).max(256) };
export const catalogArguments = z.discriminatedUnion('action', [
  z
    .object({
      ...common,
      action: z.literal('list'),
      pageSize: z.number().int().min(1).max(100).default(20),
      cursor: z.string().min(1).max(2048).optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('info'),
      name: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(100),
      expectedRevision: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[\x20-\x7e]+$/)
        .optional(),
    })
    .strict(),
]);
type Arguments = z.infer<typeof catalogArguments>;
const messages = {
  invalid_arguments: 'Invalid catalog arguments',
  unavailable: 'Catalog unavailable',
  not_found: 'Skill not found',
  invalid_cursor: 'Invalid catalog cursor',
  catalog_changed: 'Catalog changed; list again',
} as const;
class PolicyChangedDuringRead extends Error {}

export class CatalogError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(`${code}: ${messages[code]}`);
  }
}
export function safeCatalogError(error: unknown): CatalogError {
  return error instanceof CatalogError ? error : new CatalogError('unavailable');
}
export function catalogAuditInput(input: unknown): Record<string, unknown> {
  const parsed = catalogArguments.safeParse(input);
  const obj =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return {
    action: parsed.success ? parsed.data.action : 'invalid',
    hasCursor: Object.hasOwn(obj, 'cursor'),
    hasName: Object.hasOwn(obj, 'name'),
    hasExpectedRevision: Object.hasOwn(obj, 'expectedRevision'),
  };
}
const properties = {
  schemaVersion: { const: 2 },
  workspaceId: { type: 'string', minLength: 1, maxLength: 256 },
};
export const orgSkillsTool = {
  name: 'org_skills',
  description:
    'List available organization skill descriptions or retrieve one complete skill document.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    oneOf: [
      {
        type: 'object',
        properties: {
          ...properties,
          action: { const: 'list' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          cursor: { type: 'string', minLength: 1, maxLength: 2048 },
        },
        required: ['schemaVersion', 'workspaceId', 'action'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: {
          ...properties,
          action: { const: 'info' },
          name: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 100 },
          expectedRevision: { type: 'string', minLength: 1, maxLength: 128 },
        },
        required: ['schemaVersion', 'workspaceId', 'action', 'name'],
        additionalProperties: false,
      },
    ],
  },
};
export interface ProtectedCatalogDeps {
  service: CatalogServiceRuntime;
  policyReader: CatalogAccessPolicyReader;
  decisions: SkillDecisionProvider;
  cursorKey: Buffer;
}
async function authorize(
  deps: ProtectedCatalogDeps,
  workspace: string,
  actor: string
): Promise<SkillDecision> {
  const toolEpoch = await deps.decisions.assertToolAllowed(workspace, actor);
  const decision = await deps.decisions.decideSkills(workspace, actor);
  if (toolEpoch !== decision.policyRevision) throw new PolicyChangedDuringRead();
  if (
    decision.userId !== actor ||
    decision.workspaceId !== workspace ||
    !decision.policyRevision ||
    decision.sourceId !== 'skills' ||
    !decision.sourceBindingRevision
  )
    throw new CatalogError('unavailable');
  const policy = await deps.policyReader.readPolicy(AbortSignal.timeout(2000));
  const entry = policy.ok ? policy.policy.tenants[workspace] : undefined;
  if (
    !entry?.enabled ||
    !entry.approved ||
    sourceBindingRevision(entry.source) !== decision.sourceBindingRevision
  )
    throw new CatalogError('unavailable');
  return decision;
}
function metadata(skill: SkillMetadata) {
  return {
    name: skill.name,
    description: skill.description,
    priority: skill.priority,
    scope: skill.scope,
  };
}
function cursorOffset(
  args: Extract<Arguments, { action: 'list' }>,
  actor: string,
  decision: SkillDecision,
  gen: Generation,
  key: Buffer
): number {
  if (!args.cursor) return 0;
  let cursor;
  try {
    cursor = decodeCursor(args.cursor, key);
  } catch {
    throw new CatalogError('invalid_cursor');
  }
  if (cursor.actor !== actor || cursor.workspace !== args.workspaceId || cursor.source !== 'skills')
    throw new CatalogError('invalid_cursor');
  if (
    cursor.binding !== decision.sourceBindingRevision ||
    cursor.policy !== decision.policyRevision ||
    cursor.commit !== gen.revision
  )
    throw new CatalogError('catalog_changed');
  return cursor.offset;
}
function buildResult(
  args: Arguments,
  actor: string,
  decision: SkillDecision,
  gen: Generation,
  deps: ProtectedCatalogDeps
) {
  const allowed = new Set(decision.allowedSkills.map(skill => skill.key));
  const base = {
    revision: gen.revision,
    policyRevision: decision.policyRevision,
    verifiedAt: gen.verifiedAtIso,
    freshness: deps.service.computeFreshness(gen),
  };
  if (base.freshness === 'unavailable') throw new CatalogError('unavailable');
  if (args.action === 'info') {
    if (args.expectedRevision && args.expectedRevision !== gen.revision)
      throw new CatalogError('catalog_changed');
    const skill = gen.skills.find(entry => entry.name === args.name && allowed.has(entry.name));
    if (!skill) throw new CatalogError('not_found');
    const document = gen.documents.get(skill.path);
    if (document === undefined) throw new CatalogError('unavailable');
    return { ...base, skill: metadata(skill), document };
  }
  const skills = gen.skills.filter(skill => allowed.has(skill.name));
  const offset = cursorOffset(args, actor, decision, gen, deps.cursorKey);
  if (offset > skills.length) throw new CatalogError('invalid_cursor');
  const end = Math.min(offset + args.pageSize, skills.length);
  const nextCursor =
    end < skills.length
      ? encodeCursor(
          {
            version: 2,
            actor,
            workspace: args.workspaceId,
            source: 'skills',
            binding: decision.sourceBindingRevision!,
            policy: decision.policyRevision!,
            commit: gen.revision,
            offset: end,
          },
          deps.cursorKey
        )
      : null;
  return { ...base, skills: skills.slice(offset, end).map(metadata), nextCursor };
}
export async function executeProtectedCatalog(
  actor: string,
  input: unknown,
  deps: ProtectedCatalogDeps
): Promise<unknown> {
  const parsed = catalogArguments.safeParse(input);
  if (!parsed.success) throw new CatalogError('invalid_arguments');
  const args = parsed.data;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const decision = await authorize(deps, args.workspaceId, actor);
        const gen = deps.service.getActiveGeneration(
          computeLogicalSourceKey(args.workspaceId),
          decision.sourceBindingRevision!
        );
        if (!gen) throw new CatalogError('unavailable');
        deps.service.pinGeneration(gen);
        try {
          const result = buildResult(args, actor, decision, gen, deps);
          const final = await authorize(deps, args.workspaceId, actor);
          const same =
            final.sourceBindingRevision === decision.sourceBindingRevision &&
            JSON.stringify(final.allowedSkills) === JSON.stringify(decision.allowedSkills);
          if (
            same &&
            final.policyRevision === decision.policyRevision &&
            deps.service.computeFreshness(gen) !== 'unavailable'
          )
            return result;
        } finally {
          deps.service.releaseGeneration(gen);
        }
      } catch (error) {
        if (!(error instanceof PolicyChangedDuringRead)) throw error;
      }
    }
    throw new CatalogError('unavailable');
  } catch (error) {
    throw safeCatalogError(error);
  }
}
export async function executeOrgSkills(actor: string, input: unknown): Promise<unknown> {
  if (!catalogArguments.safeParse(input).success) throw new CatalogError('invalid_arguments');
  const runtime = getCatalogRuntime();
  if (!runtime) throw new CatalogError('unavailable');
  return executeProtectedCatalog(actor, input, runtime);
}
