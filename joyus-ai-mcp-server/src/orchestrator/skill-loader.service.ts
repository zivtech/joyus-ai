/**
 * Skill Loader Service — WP05 (T038, T039, T040)
 *
 * Loads skills and the platform Constitution from the filesystem, then injects
 * them into the system prompt with token budget awareness.
 *
 * Phases:
 * - T038: Filesystem-based skill loading — reads .md files from skills/{tenantId}/
 *   with optional YAML frontmatter for priority/scope metadata.
 * - T039: Token-budget-aware skill injection — sorts by priority, skips skills
 *   that would exceed the remaining budget (never truncates mid-skill).
 * - T040: Constitution injection — always prepended, never subject to token budget.
 *
 * Interface compatibility:
 * - SkillResolver interface allows swapping to a DB-backed resolver (Spec 013)
 *   without changing callers. Today's filesystem implementation is a stub.
 *
 * Token budget math (matches agent-loop.service.ts heuristics):
 *   MAX_CONTEXT_TOKENS = 200_000
 *   CHARS_PER_TOKEN   = 4
 *   Reserved for response + user message = 8_000 tokens
 *   skill_budget = total - 8_000 - history_tokens - constitution_tokens
 */

import { promises as fsPromises } from 'fs';
import path from 'path';

// ============================================================
// TYPES
// ============================================================

/**
 * A skill loaded and ready for injection into the system prompt.
 */
export interface Skill {
  name: string;
  content: string;
  /** Higher priority skills are injected first. */
  priority: number;
  /** Scope: 'tenant' | 'role' | 'task' — informational for now */
  scope: 'tenant' | 'role' | 'task';
}

/**
 * SkillResolver interface — implement this to swap out the filesystem stub
 * for a Spec 013 / DB-backed implementation without touching callers.
 */
export interface SkillResolver {
  resolve(tenantId: string, userId?: string, taskContext?: string): Promise<Skill[]>;
}

/**
 * Result of system prompt assembly (constitution + skills).
 */
export interface SkillInjectionResult {
  /** Combined system prompt block (constitution + injected skills). */
  block: string;
  /** Names of skills successfully injected. */
  includedSkills: string[];
  /** Names of skills excluded due to token budget. */
  excludedSkills: string[];
  /** Approximate tokens consumed by this block. */
  estimatedTokens: number;
}

// ============================================================
// CONFIGURATION
// ============================================================

/** Token heuristic matching agent-loop.service.ts */
const CHARS_PER_TOKEN_ESTIMATE = 4;

/** Total context window (Claude 3.5 Sonnet) */
const MAX_CONTEXT_TOKENS = 200_000;

/**
 * Tokens reserved for user message and agent response.
 * Not deducted from the skill budget — caller passes history_tokens separately.
 */
const RESERVED_FOR_RESPONSE_TOKENS = 8_000;

/** Default skills directory (relative to process cwd, overridable via env) */
const DEFAULT_SKILLS_DIR =
  process.env.SKILLS_DIR ?? path.resolve(process.cwd(), 'skills');

/** Constitution file path (overridable via env) */
const CONSTITUTION_FILE =
  process.env.CONSTITUTION_FILE ?? path.resolve(process.cwd(), 'constitution.md');

/** Default priority when frontmatter is absent */
const DEFAULT_PRIORITY = 50;

// ============================================================
// FILESYSTEM SKILL RESOLVER (Phase 1 stub — swap for Spec 013)
// ============================================================

/**
 * Reads skill .md files from skills/{tenantId}/ directory.
 * Parses optional YAML frontmatter for priority and scope metadata.
 *
 * Frontmatter format (optional):
 *   ---
 *   priority: 80
 *   scope: tenant
 *   ---
 *   <skill content>
 */
export class FilesystemSkillResolver implements SkillResolver {
  constructor(private readonly skillsDir: string = DEFAULT_SKILLS_DIR) {}

  async resolve(tenantId: string): Promise<Skill[]> {
    const tenantDir = path.join(this.skillsDir, tenantId);

    let entries: string[];
    try {
      const dirents = await fsPromises.readdir(tenantDir, { withFileTypes: true });
      entries = dirents
        .filter((d) => d.isFile() && d.name.endsWith('.md'))
        .map((d) => d.name);
    } catch (err) {
      // Directory missing → no skills for this tenant (not an error)
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const skills: Skill[] = [];

    for (const filename of entries) {
      const filePath = path.join(tenantDir, filename);
      try {
        const raw = await fsPromises.readFile(filePath, 'utf-8');
        const { content, priority, scope } = parseFrontmatter(raw);
        const name = filename.replace(/\.md$/i, '');
        skills.push({ name, content, priority, scope });
      } catch (err) {
        console.warn(`[SkillLoaderService] Failed to read skill file "${filePath}":`, err);
        // Continue loading other skills
      }
    }

    return skills;
  }
}

// ============================================================
// SKILL LOADER SERVICE
// ============================================================

export interface SkillLoaderServiceDeps {
  resolver?: SkillResolver;
  constitutionFile?: string;
}

export class SkillLoaderService {
  private readonly resolver: SkillResolver;
  private readonly constitutionFile: string;

  constructor(deps: SkillLoaderServiceDeps = {}) {
    this.resolver = deps.resolver ?? new FilesystemSkillResolver();
    this.constitutionFile = deps.constitutionFile ?? CONSTITUTION_FILE;
  }

  // ---------------------------------------------------------------------------
  // T038: Skill Loading
  // ---------------------------------------------------------------------------

  /**
   * Load all applicable skills for a tenant.
   *
   * Returns skills ordered by priority descending (highest-priority first).
   * Tenant-level skills have higher priority than role/task-level.
   */
  async loadSkills(
    tenantId: string,
    _userId?: string,
    _taskContext?: string,
  ): Promise<Skill[]> {
    const skills = await this.resolver.resolve(tenantId, _userId, _taskContext);
    // Sort descending by priority so highest-priority skills are first
    return skills.slice().sort((a, b) => b.priority - a.priority);
  }

  // ---------------------------------------------------------------------------
  // T040: Constitution Loading
  // ---------------------------------------------------------------------------

  /**
   * Load the platform Constitution.
   *
   * Constitution is ALWAYS included in the system prompt — it is not subject to
   * token budget. If the file is missing, logs a warning and returns an empty string
   * (graceful degradation, not a fatal error).
   *
   * Non-ENOENT errors (EACCES, EIO, etc.) are intentionally re-thrown:
   * the constitution is a safety rail; a silent empty-constitution is worse than a hard failure.
   */
  async loadConstitution(): Promise<string> {
    try {
      return await fsPromises.readFile(this.constitutionFile, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          `[SkillLoaderService] Constitution file not found at "${this.constitutionFile}". Continuing without constitution.`,
        );
        return '';
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // T039: Skill Injection with Token Budget
  // ---------------------------------------------------------------------------

  /**
   * Inject skills into a system prompt block, respecting the token budget.
   *
   * @param skills - Skills to inject, must be in priority order (highest first).
   * @param constitution - Constitution text (already loaded, always included).
   * @param historyTokens - Estimated tokens consumed by conversation history.
   * @returns A SkillInjectionResult with the composed block and diagnostics.
   */
  injectSkills(
    skills: Skill[],
    constitution: string,
    historyTokens: number,
  ): SkillInjectionResult {
    // Constitution is not subject to budget — estimate its cost for diagnostics only
    const constitutionTokens = estimateTokens(constitution);

    // Budget for skills = total window - history - reserved response - constitution
    const skillBudget =
      MAX_CONTEXT_TOKENS - historyTokens - RESERVED_FOR_RESPONSE_TOKENS - constitutionTokens;

    if (skillBudget <= 0) {
      console.warn('[SkillLoaderService] No token budget remaining for skills.', {
        MAX_CONTEXT_TOKENS,
        historyTokens,
        RESERVED_FOR_RESPONSE_TOKENS,
        constitutionTokens,
        skillBudget,
      });
    }

    const includedSkills: string[] = [];
    const excludedSkills: string[] = [];
    const skillBlocks: string[] = [];
    let usedTokens = 0;

    for (const skill of skills) {
      const skillTokens = estimateTokens(skill.content);

      if (usedTokens + skillTokens > Math.max(skillBudget, 0)) {
        // Skip this skill entirely — never truncate mid-skill
        excludedSkills.push(skill.name);
        console.info(`[SkillLoaderService] Skipping skill "${skill.name}" (${skillTokens} tokens) — budget exhausted`, {
          usedTokens,
          skillBudget,
        });
        continue;
      }

      skillBlocks.push(skill.content);
      includedSkills.push(skill.name);
      usedTokens += skillTokens;
    }

    if (includedSkills.length > 0) {
      console.info('[SkillLoaderService] Injected skills', {
        included: includedSkills,
        excluded: excludedSkills,
        usedTokens,
        skillBudget,
      });
    }

    // Compose the final block: constitution first, then skills
    const parts: string[] = [];
    if (constitution) {
      parts.push(constitution.trim());
    }
    if (skillBlocks.length > 0) {
      parts.push(skillBlocks.join('\n\n---\n\n'));
    }

    const block = parts.join('\n\n---\n\n');
    const estimatedTokens = constitutionTokens + usedTokens;

    return { block, includedSkills, excludedSkills, estimatedTokens };
  }

  // ---------------------------------------------------------------------------
  // Convenience: assemble the full constitution + skills block
  // ---------------------------------------------------------------------------

  /**
   * Load constitution and skills, then compose the full system prompt prefix.
   *
   * This is the primary integration point for AgentLoopService.
   *
   * Constitution is loaded first and unconditionally — skill loading failures are
   * caught and logged but do not abort the turn. The invariant is:
   * "Constitution injection cannot be bypassed even if skill loading fails."
   * (See spec: SkillResolver interface is designed to be swappable for a DB-backed
   * resolver per Spec 013; network or DB failures must not silence the constitution.)
   */
  async assemblePromptPrefix(
    tenantId: string,
    historyTokens: number,
    userId?: string,
    taskContext?: string,
  ): Promise<SkillInjectionResult> {
    const constitution = await this.loadConstitution();

    let skills: Skill[] = [];
    try {
      skills = await this.loadSkills(tenantId, userId, taskContext);
    } catch (err) {
      // Log warning but don't fail — Constitution must always reach the agent.
      // A DB-backed resolver (Spec 013) can fail for network reasons entirely
      // unrelated to the constitution; we must not discard the constitution in that case.
      console.warn('[SkillLoaderService] Skill loading failed; continuing with constitution only.', err);
    }

    return this.injectSkills(skills, constitution, historyTokens);
  }
}

// ============================================================
// Frontmatter Parser
// ============================================================

interface FrontmatterResult {
  content: string;
  priority: number;
  scope: 'tenant' | 'role' | 'task';
}

/**
 * Parse optional YAML frontmatter from a skill .md file.
 *
 * Supports a minimal subset: priority (number) and scope (string).
 * Any YAML parse failure is silently ignored (uses defaults).
 */
function parseFrontmatter(raw: string): FrontmatterResult {
  const defaults: FrontmatterResult = {
    content: raw,
    priority: DEFAULT_PRIORITY,
    scope: 'tenant',
  };

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return defaults;
  }

  const frontmatterBlock = match[1];
  const body = match[2];

  let priority = DEFAULT_PRIORITY;
  let scope: 'tenant' | 'role' | 'task' = 'tenant';

  // Simple line-by-line key: value parsing (avoids a YAML library dependency)
  for (const line of frontmatterBlock.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;

    if (key === 'priority') {
      const parsed = parseInt(value.trim(), 10);
      if (!isNaN(parsed)) priority = parsed;
    } else if (key === 'scope') {
      const trimmed = value.trim();
      if (trimmed === 'tenant' || trimmed === 'role' || trimmed === 'task') {
        scope = trimmed;
      }
    }
  }

  return { content: body.trim(), priority, scope };
}

// ============================================================
// Token Estimation Utility
// ============================================================

/**
 * Estimate token count from a string using the 4-chars-per-token heuristic.
 * Matches the same heuristic used in agent-loop.service.ts.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

// Export for testing
export { estimateTokens, parseFrontmatter };
