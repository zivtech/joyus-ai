/**
 * Content Infrastructure — Product Service
 *
 * CRUD operations for products and their source/profile mappings.
 * Products define what content a subscription grants access to.
 */

import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createId } from '@paralleldrive/cuid2';

import {
  contentProducts,
  contentProductSources,
  contentProductProfiles,
  type ContentProduct,
} from '../schema.js';
import type { ResolvedEntitlements } from '../types.js';
import type { CreateProductInput } from '../validation.js';

type DrizzleClient = ReturnType<typeof drizzle>;

// ============================================================
// PRODUCT WITH RELATIONS TYPE
// ============================================================

export interface ProductWithMappings extends ContentProduct {
  sourceIds: string[];
  profileIds: string[];
}

// ============================================================
// PRODUCT SERVICE
// ============================================================

export class ProductService {
  constructor(private readonly db: DrizzleClient) {}

  // ----------------------------------------------------------
  // PRODUCT CRUD
  // ----------------------------------------------------------

  async createProduct(tenantId: string, input: CreateProductInput): Promise<ProductWithMappings> {
    const id = createId();
    const now = new Date();

    const [product] = await this.db
      .insert(contentProducts)
      .values({
        id,
        tenantId,
        name: input.name,
        description: input.description,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Add initial source and profile mappings
    if (input.sourceIds && input.sourceIds.length > 0) {
      await this.addSourcesToProduct(id, input.sourceIds);
    }
    if (input.profileIds && input.profileIds.length > 0) {
      await this.addProfilesToProduct(id, input.profileIds);
    }

    return {
      ...product,
      sourceIds: input.sourceIds ?? [],
      profileIds: input.profileIds ?? [],
    };
  }

  async getProduct(productId: string): Promise<ProductWithMappings | null> {
    const [product] = await this.db
      .select()
      .from(contentProducts)
      .where(eq(contentProducts.id, productId))
      .limit(1);

    if (!product) return null;
    return this.attachMappings(product);
  }

  async listProducts(tenantId: string): Promise<ProductWithMappings[]> {
    const products = await this.db
      .select()
      .from(contentProducts)
      .where(eq(contentProducts.tenantId, tenantId));

    return Promise.all(products.map((p) => this.attachMappings(p)));
  }

  async updateProduct(
    productId: string,
    updates: Partial<Pick<CreateProductInput, 'name' | 'description'>>,
  ): Promise<ProductWithMappings> {
    const [product] = await this.db
      .update(contentProducts)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(contentProducts.id, productId))
      .returning();

    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }
    return this.attachMappings(product);
  }

  async deleteProduct(productId: string): Promise<void> {
    // Cascading deletes on product_sources and product_profiles are handled by FK constraints.
    await this.db
      .delete(contentProducts)
      .where(eq(contentProducts.id, productId));
  }

  // ----------------------------------------------------------
  // SOURCE MAPPINGS
  // ----------------------------------------------------------

  async addSourcesToProduct(productId: string, sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return;
    await this.db
      .insert(contentProductSources)
      .values(sourceIds.map((sourceId) => ({ productId, sourceId })))
      .onConflictDoNothing();
  }

  async removeSourcesFromProduct(productId: string, sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return;
    await Promise.all(
      sourceIds.map((sourceId) =>
        this.db
          .delete(contentProductSources)
          .where(
            and(
              eq(contentProductSources.productId, productId),
              eq(contentProductSources.sourceId, sourceId),
            ),
          ),
      ),
    );
  }

  // ----------------------------------------------------------
  // PROFILE MAPPINGS
  // ----------------------------------------------------------

  async addProfilesToProduct(productId: string, profileIds: string[]): Promise<void> {
    if (profileIds.length === 0) return;
    await this.db
      .insert(contentProductProfiles)
      .values(profileIds.map((profileId) => ({ productId, profileId })))
      .onConflictDoNothing();
  }

  async removeProfilesFromProduct(productId: string, profileIds: string[]): Promise<void> {
    if (profileIds.length === 0) return;
    await Promise.all(
      profileIds.map((profileId) =>
        this.db
          .delete(contentProductProfiles)
          .where(
            and(
              eq(contentProductProfiles.productId, productId),
              eq(contentProductProfiles.profileId, profileId),
            ),
          ),
      ),
    );
  }

  // ----------------------------------------------------------
  // ENTITLEMENT-SCOPED QUERY
  // ----------------------------------------------------------

  /**
   * Return products (with their source/profile mappings) accessible via the
   * given entitlements. Respects entitlement product ID list exactly.
   */
  async getProductsForUser(entitlements: ResolvedEntitlements): Promise<ProductWithMappings[]> {
    if (entitlements.productIds.length === 0) return [];

    const products = await Promise.all(
      entitlements.productIds.map((id) =>
        this.db
          .select()
          .from(contentProducts)
          .where(and(eq(contentProducts.id, id), eq(contentProducts.isActive, true)))
          .limit(1)
          .then((rows) => rows[0] ?? null),
      ),
    );

    const found = products.filter((p): p is ContentProduct => p !== null);
    return Promise.all(found.map((p) => this.attachMappings(p)));
  }

  // ----------------------------------------------------------
  // INTERNAL HELPERS
  // ----------------------------------------------------------

  private async attachMappings(product: ContentProduct): Promise<ProductWithMappings> {
    const [sourceRows, profileRows] = await Promise.all([
      this.db
        .select({ sourceId: contentProductSources.sourceId })
        .from(contentProductSources)
        .where(eq(contentProductSources.productId, product.id)),
      this.db
        .select({ profileId: contentProductProfiles.profileId })
        .from(contentProductProfiles)
        .where(eq(contentProductProfiles.productId, product.id)),
    ]);

    return {
      ...product,
      sourceIds: sourceRows.map((r) => r.sourceId),
      profileIds: profileRows.map((r) => r.profileId),
    };
  }
}
