/**
 * Profile Inheritance — Hierarchy Management (T017)
 *
 * Manages parent-child relationships between profile identities within a tenant.
 * Enforces acyclicity and maximum depth constraints before persisting.
 */

import { eq, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

import { db } from '../../db/client.js';
import { profileInheritance, type ProfileInheritance } from '../schema.js';
import { requireTenantId, tenantWhere } from '../tenant-scope.js';
import type { ProfileTier } from '../types.js';
import { MAX_HIERARCHY_DEPTH } from '../types.js';
import { ProfileOperationLogger } from '../monitoring/logger.js';

// ============================================================
// TYPES
// ============================================================

/** A node in a full hierarchy tree representation. */
export interface HierarchyNode {
  identity: string;
  tier: ProfileTier;
  children: HierarchyNode[];
}

// ============================================================
// SERVICE
// ============================================================

export class ProfileHierarchyService {
  private readonly logger: ProfileOperationLogger;

  constructor(logger?: ProfileOperationLogger) {
    this.logger = logger ?? new ProfileOperationLogger();
  }

  /**
   * Create a parent-child relationship between two profile identities.
   * Validates that the relationship is acyclic and within depth limits.
   */
  async createRelationship(
    tenantId: string,
    parentIdentity: string,
    childIdentity: string,
  ): Promise<ProfileInheritance> {
    requireTenantId(tenantId);

    if (parentIdentity === childIdentity) {
      throw new Error(
        `Cannot create self-referential hierarchy: "${parentIdentity}" cannot be its own parent`,
      );
    }

    // Circular reference check: if childIdentity is already an ancestor of parentIdentity,
    // adding parent→child would create a cycle.
    const ancestorChain = await this.getAncestorChain(tenantId, parentIdentity);
    if (ancestorChain.includes(childIdentity)) {
      throw new Error(
        `Circular reference detected: "${childIdentity}" is already an ancestor of "${parentIdentity}"`,
      );
    }

    // Depth check: the resulting chain [childIdentity, parentIdentity, ...ancestors] must not exceed MAX_HIERARCHY_DEPTH.
    // ancestorChain includes parentIdentity itself at index 0.
    const resultingDepth = ancestorChain.length + 1; // +1 for childIdentity
    if (resultingDepth > MAX_HIERARCHY_DEPTH) {
      throw new Error(
        `Hierarchy depth limit exceeded: adding this relationship would create a chain of depth ${resultingDepth}, ` +
        `maximum is ${MAX_HIERARCHY_DEPTH}`,
      );
    }

    const start = Date.now();
    const [row] = await db
      .insert(profileInheritance)
      .values({
        id: createId(),
        tenantId,
        parentProfileIdentity: parentIdentity,
        childProfileIdentity: childIdentity,
      })
      .returning();

    await this.logger.logOperation({
      tenantId,
      operation: 'hierarchy_create',
      profileIdentity: childIdentity,
      durationMs: Date.now() - start,
      success: true,
      metadata: { parentIdentity, childIdentity },
    });

    return row;
  }

  /**
   * Remove a parent-child relationship.
   * Returns true if a row was deleted, false if the relationship did not exist.
   */
  async removeRelationship(
    tenantId: string,
    parentIdentity: string,
    childIdentity: string,
  ): Promise<boolean> {
    requireTenantId(tenantId);

    const start = Date.now();
    const deleted = await db
      .delete(profileInheritance)
      .where(
        and(
          eq(profileInheritance.tenantId, tenantId),
          eq(profileInheritance.parentProfileIdentity, parentIdentity),
          eq(profileInheritance.childProfileIdentity, childIdentity),
        ),
      );

    // Drizzle delete resolves to an array of deleted rows (or [] when none deleted)
    const removed = Array.isArray(deleted) ? deleted.length > 0 : false;

    await this.logger.logOperation({
      tenantId,
      operation: 'hierarchy_delete',
      profileIdentity: childIdentity,
      durationMs: Date.now() - start,
      success: removed,
      metadata: { parentIdentity, childIdentity, removed },
    });

    return removed;
  }

  /**
   * Get the parent identity of a profile, or null if the profile is a root.
   */
  async getParent(tenantId: string, childIdentity: string): Promise<string | null> {
    requireTenantId(tenantId);

    const rows = await db
      .select()
      .from(profileInheritance)
      .where(
        and(
          eq(profileInheritance.tenantId, tenantId),
          eq(profileInheritance.childProfileIdentity, childIdentity),
        ),
      )
      .limit(1);

    return rows[0]?.parentProfileIdentity ?? null;
  }

  /**
   * Get all direct children of a profile identity.
   */
  async getChildren(tenantId: string, parentIdentity: string): Promise<string[]> {
    requireTenantId(tenantId);

    const rows = await db
      .select()
      .from(profileInheritance)
      .where(
        and(
          eq(profileInheritance.tenantId, tenantId),
          eq(profileInheritance.parentProfileIdentity, parentIdentity),
        ),
      );

    return rows.map((r) => r.childProfileIdentity);
  }

  /**
   * Walk up the hierarchy from a profile to its root.
   * Returns [self, parent, grandparent, ..., root].
   * Includes the starting identity as the first element.
   */
  async getAncestorChain(tenantId: string, profileIdentity: string): Promise<string[]> {
    requireTenantId(tenantId);

    const chain: string[] = [profileIdentity];
    let current = profileIdentity;

    // Guard against runaway loops (should not happen if data is clean, but be safe)
    for (let depth = 0; depth < MAX_HIERARCHY_DEPTH; depth++) {
      const parent = await this.getParent(tenantId, current);
      if (parent === null) {
        break;
      }
      chain.push(parent);
      current = parent;
    }

    return chain;
  }

  /**
   * Walk down the hierarchy from a profile, returning all descendant identities
   * via breadth-first traversal (excludes the starting identity itself).
   */
  async getDescendants(tenantId: string, profileIdentity: string): Promise<string[]> {
    requireTenantId(tenantId);

    const result: string[] = [];
    const queue: string[] = [profileIdentity];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const children = await this.getChildren(tenantId, current);
      for (const child of children) {
        result.push(child);
        queue.push(child);
      }
    }

    return result;
  }

  /**
   * Return the complete hierarchy for a tenant as a forest of HierarchyNode trees.
   * Roots are profiles with no parent.
   */
  async getFullHierarchy(tenantId: string): Promise<HierarchyNode[]> {
    requireTenantId(tenantId);

    const allRows = await db
      .select()
      .from(profileInheritance)
      .where(tenantWhere(profileInheritance, tenantId));

    // Collect all known identities and build adjacency map
    const childrenMap = new Map<string, string[]>();
    const allIdentities = new Set<string>();
    const hasParent = new Set<string>();

    for (const row of allRows) {
      allIdentities.add(row.parentProfileIdentity);
      allIdentities.add(row.childProfileIdentity);
      hasParent.add(row.childProfileIdentity);

      const existing = childrenMap.get(row.parentProfileIdentity) ?? [];
      existing.push(row.childProfileIdentity);
      childrenMap.set(row.parentProfileIdentity, existing);
    }

    const roots = [...allIdentities].filter((id) => !hasParent.has(id));

    const buildNode = (identity: string): HierarchyNode => {
      const children = childrenMap.get(identity) ?? [];
      const tier = inferTierFromIdentity(identity);
      return {
        identity,
        tier,
        children: children.map(buildNode),
      };
    };

    return roots.map(buildNode);
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Infer a ProfileTier from a profile identity string.
 * Convention: identities may be prefixed with tier, e.g. "org::...", "dept::...", "individual::...".
 * Falls back to 'base' if the pattern is not recognised.
 */
function inferTierFromIdentity(identity: string): ProfileTier {
  if (identity.startsWith('org::') || identity.startsWith('base::')) return 'base';
  if (identity.startsWith('dept::') || identity.startsWith('domain::')) return 'domain';
  if (identity.startsWith('individual::') || identity.startsWith('specialized::')) return 'specialized';
  if (identity.startsWith('contextual::')) return 'contextual';
  return 'base';
}
