/**
 * Pipeline Template Store
 *
 * CRUD operations and instantiation for pipeline templates.
 * Templates support parameter substitution ({{paramName}} placeholders)
 * and deep-clone the definition to prevent cross-instantiation mutation.
 */

import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { pipelineTemplates, pipelines, pipelineSteps } from '../schema.js';
import type { PipelineTemplate, NewPipelineTemplate } from '../schema.js';

// ============================================================
// TYPES
// ============================================================

export interface ListTemplatesOptions {
  category?: string;
  isActive?: boolean;
}

export interface TemplateParameter {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface TemplateStepDefinition {
  name: string;
  stepType: string;
  config: Record<string, unknown>;
  inputRefs?: unknown[];
  retryPolicyOverride?: Record<string, unknown>;
}

export interface TemplateDefinition {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  steps: TemplateStepDefinition[];
  retryPolicy?: Record<string, unknown>;
  concurrencyPolicy?: string;
  reviewGateTimeoutHours?: number;
  maxPipelineDepth?: number;
}

export interface CreateTemplateInput {
  tenantId?: string;
  name: string;
  description: string;
  category: string;
  definition: TemplateDefinition;
  parameters: TemplateParameter[];
  assumptions?: string[];
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  category?: string;
  definition?: TemplateDefinition;
  parameters?: TemplateParameter[];
  assumptions?: string[];
  isActive?: boolean;
}

export interface InstantiateOptions {
  name?: string;
  description?: string;
}

// ============================================================
// TEMPLATE STORE
// ============================================================

export class TemplateStore {
  constructor(private readonly db: NodePgDatabase) {}

  async listTemplates(options?: ListTemplatesOptions): Promise<PipelineTemplate[]> {
    const conditions = [];

    if (options?.category !== undefined) {
      conditions.push(eq(pipelineTemplates.category, options.category));
    }

    if (options?.isActive !== undefined) {
      conditions.push(eq(pipelineTemplates.isActive, options.isActive));
    }

    const query = this.db
      .select()
      .from(pipelineTemplates);

    if (conditions.length === 0) {
      return query.orderBy(pipelineTemplates.name);
    }

    if (conditions.length === 1) {
      return query.where(conditions[0]!).orderBy(pipelineTemplates.name);
    }

    return query.where(and(...conditions)).orderBy(pipelineTemplates.name);
  }

  async getTemplate(id: string): Promise<PipelineTemplate | undefined> {
    const rows = await this.db
      .select()
      .from(pipelineTemplates)
      .where(eq(pipelineTemplates.id, id))
      .limit(1);

    return rows[0];
  }

  async getTemplateByName(name: string): Promise<PipelineTemplate | undefined> {
    const rows = await this.db
      .select()
      .from(pipelineTemplates)
      .where(eq(pipelineTemplates.name, name))
      .limit(1);

    return rows[0];
  }

  async createTemplate(input: CreateTemplateInput): Promise<PipelineTemplate> {
    const id = createId();

    const rows = await this.db
      .insert(pipelineTemplates)
      .values({
        id,
        tenantId: input.tenantId ?? null,
        name: input.name,
        description: input.description,
        category: input.category,
        definition: input.definition as unknown as Record<string, unknown>,
        parameters: input.parameters as unknown as Record<string, unknown>[],
        assumptions: (input.assumptions ?? []) as unknown as string[],
        version: 1,
        isActive: true,
      } as NewPipelineTemplate)
      .returning();

    return rows[0]!;
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<PipelineTemplate | undefined> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      return undefined;
    }

    const updateValues: Partial<NewPipelineTemplate> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };

    if (input.name !== undefined) updateValues.name = input.name;
    if (input.description !== undefined) updateValues.description = input.description;
    if (input.category !== undefined) updateValues.category = input.category;
    if (input.definition !== undefined) updateValues.definition = input.definition as unknown as Record<string, unknown>;
    if (input.parameters !== undefined) updateValues.parameters = input.parameters as unknown as Record<string, unknown>[];
    if (input.assumptions !== undefined) updateValues.assumptions = input.assumptions as unknown as string[];
    if (input.isActive !== undefined) updateValues.isActive = input.isActive;

    const rows = await this.db
      .update(pipelineTemplates)
      .set(updateValues)
      .where(eq(pipelineTemplates.id, id))
      .returning();

    return rows[0];
  }

  async deactivateTemplate(id: string): Promise<void> {
    await this.db
      .update(pipelineTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(pipelineTemplates.id, id));
  }

  // ============================================================
  // INSTANTIATION
  // ============================================================

  async instantiate(
    templateId: string,
    tenantId: string,
    parameters: Record<string, unknown>,
    overrides?: InstantiateOptions,
  ): Promise<typeof pipelines.$inferSelect> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const templateParams = template.parameters as unknown as TemplateParameter[];

    // Validate required parameters are present
    for (const param of templateParams) {
      if (param.required && !(param.name in parameters)) {
        if (param.default === undefined) {
          throw new Error(`Missing required parameter: ${param.name}`);
        }
      }
    }

    // Build resolved parameter map (supplied values override defaults)
    const resolvedParams: Record<string, unknown> = {};
    for (const param of templateParams) {
      if (param.name in parameters) {
        resolvedParams[param.name] = parameters[param.name];
      } else if (param.default !== undefined) {
        resolvedParams[param.name] = param.default;
      }
    }

    // Deep clone definition to avoid cross-instantiation mutation
    const definition = structuredClone(template.definition) as unknown as TemplateDefinition;

    // Substitute {{paramName}} placeholders throughout
    const resolvedDefinition = substituteParams(definition, resolvedParams) as TemplateDefinition;

    // Build pipeline name
    const pipelineName = overrides?.name ?? substituteParamsInString(template.name, resolvedParams);
    const pipelineDescription = overrides?.description ?? template.description;

    // Determine retry policy
    const retryPolicy = resolvedDefinition.retryPolicy ?? {
      maxRetries: 3,
      baseDelayMs: 30000,
      maxDelayMs: 300000,
      backoffMultiplier: 2,
    };

    // Create pipeline
    const pipelineId = createId();
    const pipelineRows = await this.db
      .insert(pipelines)
      .values({
        id: pipelineId,
        tenantId,
        name: pipelineName,
        description: pipelineDescription,
        triggerType: resolvedDefinition.triggerType as typeof pipelines.$inferInsert['triggerType'],
        triggerConfig: resolvedDefinition.triggerConfig as unknown as Record<string, unknown>,
        retryPolicy: retryPolicy as unknown as Record<string, unknown>,
        concurrencyPolicy: (resolvedDefinition.concurrencyPolicy ?? 'skip_if_running') as typeof pipelines.$inferInsert['concurrencyPolicy'],
        reviewGateTimeoutHours: resolvedDefinition.reviewGateTimeoutHours ?? 48,
        maxPipelineDepth: resolvedDefinition.maxPipelineDepth ?? 10,
        status: 'active',
        templateId: template.id,
      })
      .returning();

    const pipeline = pipelineRows[0]!;

    // Create pipeline steps
    const stepDefs = resolvedDefinition.steps;
    for (let i = 0; i < stepDefs.length; i++) {
      const step = stepDefs[i]!;
      await this.db.insert(pipelineSteps).values({
        id: createId(),
        pipelineId,
        position: i + 1,
        name: step.name,
        stepType: step.stepType as typeof pipelineSteps.$inferInsert['stepType'],
        config: step.config as unknown as Record<string, unknown>,
        inputRefs: (step.inputRefs ?? []) as unknown as Record<string, unknown>[],
        retryPolicyOverride: step.retryPolicyOverride
          ? (step.retryPolicyOverride as unknown as Record<string, unknown>)
          : undefined,
      });
    }

    return pipeline;
  }
}

// ============================================================
// PARAMETER SUBSTITUTION HELPERS
// ============================================================

function substituteParamsInString(value: string, params: Record<string, unknown>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in params) {
      return String(params[key]);
    }
    return match;
  });
}

function substituteParams(value: unknown, params: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return substituteParamsInString(value, params);
  }

  if (Array.isArray(value)) {
    return value.map((item) => substituteParams(item, params));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = substituteParams(v, params);
    }
    return result;
  }

  return value;
}
