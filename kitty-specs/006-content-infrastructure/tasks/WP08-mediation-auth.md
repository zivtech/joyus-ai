---
work_package_id: WP08
title: Mediation API Auth & Sessions
lane: done
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:42:02.153674+00:00'
subtasks: [T038, T039, T040, T041]
shell_pid: '98895'
review_status: approved
reviewed_by: Alex Urevick-Ackelsberg
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP08: Mediation API Auth & Sessions

## Objective

Build the mediation API authentication layer (two-layer: API key identifies the integration, OAuth2/OIDC token identifies the end user) and session management.

## Implementation Command

```bash
spec-kitty implement WP08 --base WP05
```

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-020, FR-021, SC-006)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R5: Two-Layer Auth)
- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/mediation-api.yaml` (security schemes, AuthError)
- **Data Model**: `kitty-specs/006-content-infrastructure/data-model.md` (ApiKey, MediationSession)

The mediation API is a separate Express router mounted at `/api/mediation`. It uses different auth from the existing MCP bearer token auth — two-layer with API key + user JWT.

---

## Subtask T038: Create Two-Layer Auth Middleware

**Purpose**: Express middleware chain that validates both API key and user JWT token on every mediation request.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/mediation/auth.ts`
2. Implement middleware chain:
   ```typescript
   export async function validateApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
     const apiKey = req.headers['x-api-key'] as string;
     if (!apiKey) return res.status(401).json({ error: 'missing_api_key', message: 'X-API-Key header required' });

     // Hash the key, look up in content.api_keys
     const keyHash = hashApiKey(apiKey);
     const key = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
     if (!key[0] || !key[0].isActive) return res.status(401).json({ error: 'invalid_api_key', message: 'Invalid or inactive API key' });

     // Attach integration info to request
     req.apiKey = key[0];
     // Update lastUsedAt
     await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key[0].id));
     next();
   }

   export async function validateUserToken(req: Request, res: Response, next: NextFunction): Promise<void> {
     const authHeader = req.headers.authorization;
     if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'missing_user_token', message: 'Authorization: Bearer <token> required' });

     const token = authHeader.substring(7);
     // Validate JWT using JWKS URI from the API key's configuration
     // Use jose library or manual JWT verification
     // Extract userId from token claims
     req.userId = decodedToken.sub;
     req.tenantId = req.apiKey.tenantId;
     next();
   }
   ```
3. Use `crypto.timingSafeEqual` for API key hash comparison (prevent timing attacks)
4. For JWT validation: fetch JWKS from `apiKey.jwksUri`, verify signature, check issuer and audience
5. Install `jose` library for JWT/JWKS handling (add to package.json)

**Important**: Define Express request type extensions:
```typescript
declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      userId?: string;
      tenantId?: string;
    }
  }
}
```

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/auth.ts` (new, ~120 lines)

**Validation**:
- [ ] Missing API key → 401 with `missing_api_key` error
- [ ] Invalid API key → 401 with `invalid_api_key` error
- [ ] Missing Bearer token → 401 with `missing_user_token` error
- [ ] Invalid JWT → 401 with `invalid_user_token` error
- [ ] Expired JWT → 401 with `token_expired` error
- [ ] Both valid → request enriched with apiKey, userId, tenantId

---

## Subtask T039: Create API Key Management

**Purpose**: Create, validate, and revoke API keys for integration partners.

**Steps**:
1. Add to `auth.ts` or create `mediation/keys.ts`:
   ```typescript
   export class ApiKeyService {
     async createKey(tenantId: string, input: CreateApiKeyInput): Promise<{ key: string; id: string }> {
       // 1. Generate random key: "jyk_" + 32 random hex chars
       // 2. Hash with SHA-256
       // 3. Store hash, prefix (first 8 chars), integration name, JWKS config
       // 4. Return raw key (shown once, never stored)
     }

     async revokeKey(keyId: string): Promise<void> {
       // Set isActive = false
     }

     async listKeys(tenantId: string): Promise<ApiKey[]> {
       // Return keys with prefix (NOT hash) for identification
     }
   }
   ```
2. `hashApiKey` utility: `crypto.createHash('sha256').update(key).digest('hex')`
3. Key format: `jyk_` prefix + 32 hex chars (64 total chars). "jyk" = "joyus key"

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/keys.ts` (new, ~60 lines)

**Validation**:
- [ ] Generated keys are unique and random
- [ ] Only hash is stored (raw key returned once at creation)
- [ ] Revoked keys return invalid on validation
- [ ] Key prefix allows identification without revealing full key

---

## Subtask T040: Create Mediation Session Management

**Purpose**: Manage mediation sessions — create, retrieve, close.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/mediation/session.ts`
2. Implement:
   ```typescript
   export class MediationSessionService {
     constructor(
       private entitlementService: EntitlementService,
       private db: DrizzleClient
     ) {}

     async createSession(
       tenantId: string,
       apiKeyId: string,
       userId: string,
       profileId?: string
     ): Promise<MediationSessionResult> {
       // 1. Resolve entitlements for user
       // 2. If no entitlements, return 403
       // 3. Create MediationSession record
       // 4. Return session with entitlements summary
     }

     async getSession(sessionId: string): Promise<MediationSession | null>;
     async closeSession(sessionId: string): Promise<void>;
     async incrementMessageCount(sessionId: string): Promise<void>;
     async updateLastActivity(sessionId: string): Promise<void>;
   }
   ```
3. Session creation includes entitlement resolution (FR-022)

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/session.ts` (new, ~80 lines)

**Validation**:
- [ ] Session creation resolves entitlements
- [ ] No entitlements → session not created
- [ ] Session tracks message count and last activity
- [ ] Close sets endedAt timestamp

---

## Subtask T041: Mount Mediation Router

**Purpose**: Create the Express router and mount it in the app.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/mediation/router.ts`
2. Create Express router with auth middleware chain:
   ```typescript
   const mediationRouter = Router();

   // Auth middleware on all routes except /health
   mediationRouter.use(/^\/(?!health)/, validateApiKey, validateUserToken);

   // Routes will be added in WP09
   // For now, just export the router with auth middleware wired
   ```
3. Create `joyus-ai-mcp-server/src/content/mediation/index.ts` that exports all mediation components

**Note**: Do NOT modify `src/index.ts` yet — that happens in WP12 (server wiring). Just export the router.

**Files**:
- `joyus-ai-mcp-server/src/content/mediation/router.ts` (new, ~30 lines)
- `joyus-ai-mcp-server/src/content/mediation/index.ts` (new, ~15 lines)

**Validation**:
- [ ] Router created with auth middleware
- [ ] Health endpoint excluded from auth
- [ ] All mediation components exported

---

## Definition of Done

- [ ] Two-layer auth middleware validates API key + user JWT
- [ ] API key management: create (with prefix), validate, revoke
- [ ] Session management: create (with entitlement resolution), get, close
- [ ] Router created with auth middleware chain
- [ ] `jose` added to dependencies for JWT handling
- [ ] `npm run typecheck` passes

## Risks

- **JWKS fetching**: Network call to fetch signing keys. Must cache JWKS with TTL to avoid per-request fetches.
- **New dependency (jose)**: Need to add to package.json.

## Reviewer Guidance

- Verify timing-safe comparison for API key hash
- Check JWT validation: signature, expiry, issuer, audience all checked
- Confirm API key raw value is NEVER stored (only hash)
- Verify health endpoint is excluded from auth
- Check that failed auth returns correct error codes per mediation-api.yaml

## Activity Log

- 2026-02-21T12:53:01Z – unknown – shell_pid=98895 – lane=done – Mediation auth: two-layer API key + JWT, sessions, key management
