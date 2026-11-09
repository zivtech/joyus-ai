import { z } from 'zod';

const decisionSchema = z
  .object({
    schemaVersion: z.literal(2),
    workspaceId: z.string().min(1).max(256),
    userId: z.string().min(1).max(256),
    policyRevision: z.string().uuid().nullable(),
    sourceId: z.literal('skills').nullable(),
    sourceBindingRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    allowedSkills: z
      .array(
        z
          .object({
            resourceId: z.string().min(1).max(256),
            key: z
              .string()
              .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
              .max(100),
          })
          .strict()
      )
      .max(1000),
  })
  .strict();
export type SkillDecision = z.infer<typeof decisionSchema>;
export interface SkillDecisionProvider {
  decideSkills(workspaceId: string, userId: string): Promise<SkillDecision>;
  assertToolAllowed(workspaceId: string, userId: string): Promise<string>;
}
/** Per-request policy checks; transport failures never fall back to a cached allow. */
export class HttpSkillDecisionProvider implements SkillDecisionProvider {
  constructor(
    private readonly options: { baseUrl: string; serviceToken: string; fetchImpl?: typeof fetch }
  ) {}
  private async request(path: string): Promise<unknown> {
    const response = await (this.options.fetchImpl ?? fetch)(
      `${this.options.baseUrl.replace(/\/+$/, '')}${path}`,
      {
        headers: {
          authorization: `Bearer ${this.options.serviceToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
      }
    );
    if (response.status !== 200) throw new Error('Skill policy unavailable');
    if (!response.body) throw new Error('Skill policy unavailable');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1024 * 1024) throw new Error('Skill policy unavailable');
        chunks.push(chunk.value);
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } finally {
      await reader.cancel();
    }
  }
  async assertToolAllowed(workspace: string, actor: string): Promise<string> {
    const result = z
      .object({ epoch: z.string(), deniedTools: z.array(z.string()) })
      .parse(
        await this.request(
          `/policy/decide/${encodeURIComponent(workspace)}/${encodeURIComponent(actor)}`
        )
      );
    if (result.deniedTools.includes('org_skills')) throw new Error('Skill policy unavailable');
    return result.epoch;
  }
  async decideSkills(workspace: string, actor: string): Promise<SkillDecision> {
    try {
      const decision = decisionSchema.parse(
        await this.request(
          `/policy/v2/workspaces/${encodeURIComponent(workspace)}/users/${encodeURIComponent(actor)}/skills`
        )
      );
      if (decision.workspaceId !== workspace || decision.userId !== actor) throw new Error();
      if (
        decision.allowedSkills.length &&
        (!decision.policyRevision || !decision.sourceId || !decision.sourceBindingRevision)
      )
        throw new Error();
      const keys = decision.allowedSkills.map(skill => skill.key);
      const ids = decision.allowedSkills.map(skill => skill.resourceId);
      if (new Set(keys).size !== keys.length || new Set(ids).size !== ids.length) throw new Error();
      return decision;
    } catch {
      throw new Error('Skill policy unavailable');
    }
  }
}
