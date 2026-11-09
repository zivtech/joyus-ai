/**
 * Shared generic fixture builders for the catalog test suites. Every identifier here is
 * synthetic (data-model.md / access-policy.md): no real repository, tenant or credential
 * names ever appear in this package.
 */
import type { MonotonicClock } from '../src/skills/catalog/service.js';
import type { PolicyDocument, PolicyTenantEntry } from '../src/skills/catalog/types.js';

export interface FixtureSkill {
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  readonly scope: 'tenant' | 'role' | 'task';
  readonly body: string;
}

export interface BuiltCandidate {
  readonly indexRaw: Uint8Array;
  readonly documents: Map<string, Uint8Array>;
  readonly totalBytes: number;
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function documentFor(skill: FixtureSkill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\npriority: ${skill.priority}\nscope: ${skill.scope}\n---\n${skill.body}\n`;
}

/** Builds a valid schema-1 index plus matching original documents (catalog-source.md). */
export function buildCandidate(skills: readonly FixtureSkill[], generatedAt = '2026-01-01T00:00:00Z'): BuiltCandidate {
  const documents = new Map<string, Uint8Array>();
  let totalBytes = 0;
  const indexSkills = skills.map((skill) => {
    const path = `skills/${skill.name}/SKILL.md`;
    const documentText = documentFor(skill);
    const bytes = encode(documentText);
    documents.set(path, bytes);
    totalBytes += bytes.byteLength;
    return {
      name: skill.name,
      description: skill.description,
      priority: skill.priority,
      scope: skill.scope,
      path,
      bytes: bytes.byteLength,
    };
  });

  const indexRaw = encode(JSON.stringify({ schemaVersion: 1, generatedAt, skills: indexSkills }));
  return { indexRaw, documents, totalBytes };
}

export function buildPolicy(tenants: Readonly<Record<string, PolicyTenantEntry>>): PolicyDocument {
  return { schemaVersion: 1, tenants };
}

export function tenantEntry(overrides: Partial<PolicyTenantEntry> & { readonly epoch: string; readonly credentialAlias: string }): PolicyTenantEntry {
  return {
    epoch: overrides.epoch,
    enabled: overrides.enabled ?? true,
    approved: overrides.approved ?? true,
    source: {
      provider: 'github',
      owner: overrides.source?.owner ?? 'example-org',
      repository: overrides.source?.repository ?? 'example-skills-corpus',
      ref: overrides.source?.ref ?? 'main',
      credentialAlias: overrides.credentialAlias,
    },
  };
}

/** Deterministic, manually advanceable monotonic clock for freshness-table tests. */
export class FakeClock implements MonotonicClock {
  private currentMs = 0;
  now(): number {
    return this.currentMs;
  }
  advance(ms: number): void {
    this.currentMs += ms;
  }
  set(ms: number): void {
    this.currentMs = ms;
  }
}

export function immediateSleep(): (ms: number) => Promise<void> {
  return () => Promise.resolve();
}
