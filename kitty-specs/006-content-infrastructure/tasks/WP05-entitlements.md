---
work_package_id: WP05
title: Entitlement Resolution
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:32:33.240972+00:00'
subtasks: [T022, T023, T024, T025, T026]
shell_pid: "25719"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP05: Entitlement Resolution

## Objective

Build the entitlement system: pluggable `EntitlementResolver` interface, HTTP-based resolver for querying external CRM/subscription APIs, session-scoped entitlement cache, and product management (CRUD for products with source and profile mappings).

## Implementation Command

```bash
spec-kitty implement WP05 --base WP01
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-011 through FR-014, SC-004, SC-009)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R3: Entitlement Resolution)
- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/internal-services.yaml` (EntitlementResolver)
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (Product, Entitlement, ProductSource, ProductProfile)

Entitlements are resolved from external systems at session start, cached for session duration, and re-resolved on new sessions. The platform does NOT manage subscriptions — it queries external sources. SC-009 is critical: zero unauthorized content exposure.

---

## Subtask T022: Define EntitlementResolver Interface

**Purpose**: Abstract interface for entitlement resolution backends.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/entitlements/interface.ts`
2. Define:
   ```typescript
   export interface EntitlementResolver {
     resolve(userId: string, tenantId: string, context: ResolverContext): Promise<ResolvedEntitlements>;
   }

   export interface ResolverContext {
     sessionId: string;
     integrationId?: string;  // if via mediation API
   }

   export interface ResolvedEntitlements {
     productIds: string[];
     resolvedFrom: string;
     resolvedAt: Date;
     ttlSeconds: number;
   }
   ```
3. Also define `EntitlementResolverConfig` for configuring resolver instances

**Files**:
- `joyus-ai-mcp-server/src/content/entitlements/interface.ts` (new, ~40 lines)

**Validation**:
- [ ] Interface is backend-agnostic
- [ ] ResolvedEntitlements includes metadata for audit

---

## Subtask T023: Implement HttpEntitlementResolver

**Purpose**: Generic HTTP-based resolver that queries any REST endpoint for user entitlements.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/entitlements/http-resolver.ts`
2. Implement:
   ```typescript
   export class HttpEntitlementResolver implements EntitlementResolver {
     constructor(private config: HttpResolverConfig) {}

     async resolve(userId: string, tenantId: string, context: ResolverContext): Promise<ResolvedEntitlements> {
       // 1. Build request URL from config.baseUrl + config.endpoint
       // 2. Add userId and tenantId as query params or request body (configurable)
       // 3. Set auth headers (bearer token, api key, or none — from config)
       // 4. POST/GET to endpoint with timeout (config.timeoutMs, default 2000)
       // 5. Parse response: expect { products: string[], ttl?: number }
       // 6. Map response to ResolvedEntitlements
     }
   }
   ```
3. Define `HttpResolverConfig`:
   ```typescript
   interface HttpResolverConfig {
     baseUrl: string;
     endpoint: string;
     method: 'GET' | 'POST';
     authType: 'none' | 'bearer' | 'api-key';
     authValue?: string;  // encrypted
     timeoutMs: number;
     responseMapping: {
       productsField: string;  // JSON path to products array
       ttlField?: string;      // JSON path to TTL value
     };
   }
   ```
4. Use `axios` for HTTP calls
5. Handle errors: timeout → throw, 4xx → throw with clear message, 5xx → throw

**Files**:
- `joyus-ai-mcp-server/src/content/entitlements/http-resolver.ts` (new, ~100 lines)

**Validation**:
- [ ] Supports GET and POST methods
- [ ] Supports 3 auth types
- [ ] Configurable response field mapping
- [ ] Timeout enforced (SC-004: <500ms total resolution)
- [ ] Error messages don't leak endpoint details

---

## Subtask T024: Create Session-Scoped Entitlement Cache

**Purpose**: Cache resolved entitlements per session to avoid per-request external queries.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/entitlements/cache.ts`
2. Implement:
   ```typescript
   export class EntitlementCache {
     private cache = new Map<string, CachedEntitlements>();

     get(sessionId: string): ResolvedEntitlements | null;
     set(sessionId: string, entitlements: ResolvedEntitlements): void;
     invalidate(sessionId: string): void;
     cleanup(): void;  // Remove expired entries
   }

   interface CachedEntitlements {
     entitlements: ResolvedEntitlements;
     expiresAt: number;  // Unix timestamp
   }
   ```
3. `get` returns null if expired or not found
4. `cleanup` runs periodically (called by sync scheduler or dedicated interval)
5. Also persist to `content.entitlements` table for audit trail

**Files**:
- `joyus-ai-mcp-server/src/content/entitlements/cache.ts` (new, ~60 lines)

**Validation**:
- [ ] Cache hit returns entitlements without external call
- [ ] Expired entries are not returned
- [ ] Invalidate clears specific session
- [ ] Audit records written to entitlements table

---

## Subtask T025: Create Entitlement Service

**Purpose**: Orchestrate resolution, caching, and fallback behavior.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/entitlements/index.ts`
2. Implement:
   ```typescript
   export class EntitlementService {
     constructor(
       private resolver: EntitlementResolver,
       private cache: EntitlementCache,
       private db: DrizzleClient
     ) {}

     async resolve(userId: string, tenantId: string, context: ResolverContext, forceRefresh?: boolean): Promise<ResolvedEntitlements> {
       // 1. If !forceRefresh, check cache
       // 2. If cache hit, return cached
       // 3. Try resolver.resolve()
       // 4. On success: cache result, persist to DB, return
       // 5. On failure: check DB for previous entitlements (fallback)
       // 6. If no fallback: return empty entitlements (restricted mode)
     }

     async getAccessibleSourceIds(entitlements: ResolvedEntitlements): Promise<string[]> {
       // Join products → product_sources to get sourceIds
     }

     async getAccessibleProfileIds(entitlements: ResolvedEntitlements): Promise<string[]> {
       // Join products → product_profiles to get profileIds
     }
   }
   ```
3. Fallback logic (FR-014): if resolver fails, use most recent cached entitlements from DB. If none exist, return empty (restricted access mode — no content served)
4. Log entitlement resolution in operation_logs

**Files**:
- `joyus-ai-mcp-server/src/content/entitlements/index.ts` (new, ~120 lines)

**Validation**:
- [ ] Cache hit avoids external call
- [ ] Resolver failure falls back to DB cache
- [ ] No fallback available → restricted mode (empty entitlements)
- [ ] Accessible source/profile IDs resolved from product mappings
- [ ] Resolution logged for audit

---

## Subtask T026: Create Product Management

**Purpose**: CRUD operations for products and their source/profile mappings.

**Steps**:
1. Add to `entitlements/index.ts` or create `entitlements/products.ts`:
   ```typescript
   export class ProductService {
     async createProduct(tenantId: string, input: CreateProductInput): Promise<Product>;
     async getProduct(productId: string): Promise<Product | null>;
     async listProducts(tenantId: string): Promise<Product[]>;
     async updateProduct(productId: string, updates: Partial<CreateProductInput>): Promise<Product>;
     async deleteProduct(productId: string): Promise<void>;

     async addSourcesToProduct(productId: string, sourceIds: string[]): Promise<void>;
     async removeSourcesFromProduct(productId: string, sourceIds: string[]): Promise<void>;
     async addProfilesToProduct(productId: string, profileIds: string[]): Promise<void>;
     async removeProfilesFromProduct(productId: string, profileIds: string[]): Promise<void>;

     async getProductsForUser(entitlements: ResolvedEntitlements): Promise<Product[]>;
   }
   ```
2. `getProductsForUser` returns products with their associated sources and profiles, filtered by entitlement product IDs

**Files**:
- `joyus-ai-mcp-server/src/content/entitlements/products.ts` (new, ~120 lines)

**Validation**:
- [ ] CRUD operations work correctly
- [ ] Source/profile mappings via join tables
- [ ] `getProductsForUser` respects entitlements

---

## Definition of Done

- [ ] EntitlementResolver interface defined
- [ ] HttpEntitlementResolver queries external HTTP endpoints
- [ ] Session-scoped cache avoids repeated external calls
- [ ] Fallback behavior handles resolver failures gracefully
- [ ] Product CRUD with source/profile mappings
- [ ] SC-009: Zero unauthorized exposure — restricted mode on failure
- [ ] `npm run typecheck` passes

## Risks

- **External API latency**: Resolution must complete <500ms (SC-004). HttpResolver has configurable timeout.
- **Cache consistency**: Session-scoped cache means mid-session subscription changes aren't reflected (spec says this is acceptable).

## Reviewer Guidance

- Verify fallback logic: resolver failure → DB cache → restricted mode (never: resolver failure → full access)
- Check that empty entitlements result in NO content access (not ALL content access)
- Confirm audit records written for every resolution
- Verify timeout is enforced on HTTP calls

## Activity Log

- 2026-02-21T12:39:47Z – unknown – shell_pid=25719 – lane=done – Entitlements: resolver, cache, service, products
