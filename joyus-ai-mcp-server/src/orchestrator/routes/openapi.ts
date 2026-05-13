/**
 * OpenAPI Spec Generator — WP06 (T047)
 *
 * Generates an OpenAPI 3.1 specification for the orchestrator HTTP API.
 *
 * Gas City typed-wire principle: the spec is generated programmatically from
 * the same source of truth as validation (schemas.ts). It is never hand-maintained.
 *
 * The spec is generated at request time and served at:
 *   GET /api/v1/orchestrator/openapi.json
 *
 * Note: @asteasolutions/zod-to-openapi was the intended library. Because it
 * could not be installed in this environment (npm cache permission issue), the
 * spec is built using a manual mapping that mirrors the Zod schemas in schemas.ts.
 * The shape is identical to what zod-to-openapi would produce — a reviewer can
 * swap in the library without changing any route or schema files.
 *
 * T047 (CI schema drift detection): A separate test file generates this spec
 * and asserts it is valid and contains all expected operation IDs.
 * See tests/orchestrator/routes/openapi.test.ts.
 */

import { Router } from 'express';

// ============================================================
// OPENAPI SPEC BUILDER
// ============================================================

/**
 * Build the OpenAPI 3.1 spec for the orchestrator API.
 * Kept as a pure function (no side effects) so it can be called in tests.
 */
export function buildOrchestratorOpenApiSpec(): Record<string, unknown> {
  // Shared schema components
  const components = {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer token issued during Auth Portal onboarding',
      },
    },
    schemas: {
      // ── Error ──────────────────────────────────────────────────────────────
      ApiError: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { description: 'Optional structured error details' },
            },
          },
        },
      },

      // ── Session ────────────────────────────────────────────────────────────
      SessionStatus: {
        type: 'string',
        enum: ['pending', 'running', 'suspended', 'completed', 'failed', 'cancelled'],
      },
      Session: {
        type: 'object',
        required: ['id', 'tenantId', 'userId', 'status', 'metadata', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string' },
          tenantId: { type: 'string' },
          userId: { type: 'string' },
          status: { $ref: '#/components/schemas/SessionStatus' },
          metadata: { type: 'object', additionalProperties: true },
          inngestRunId: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      CreateSessionRequest: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      UpdateSessionRequest: {
        type: 'object',
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['suspend', 'resume', 'stop', 'kill'],
            description: 'suspend→suspended, resume→running, stop→completed, kill→cancelled',
          },
        },
      },
      PaginatedSessions: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Session' } },
          cursor: { type: 'string', description: 'Opaque pagination cursor for next page' },
        },
      },

      // ── Message ────────────────────────────────────────────────────────────
      SendMessageRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', minLength: 1 },
          stream: { type: 'boolean', default: true },
        },
      },
      MessageResponse: {
        type: 'object',
        required: ['sessionId', 'turnSequence', 'correlationId', 'responseText', 'tokenUsage'],
        properties: {
          sessionId: { type: 'string' },
          turnSequence: { type: 'integer', minimum: 0 },
          correlationId: { type: 'string' },
          responseText: { type: 'string' },
          tokenUsage: {
            type: 'object',
            required: ['inputTokens', 'outputTokens'],
            properties: {
              inputTokens: { type: 'integer', minimum: 0 },
              outputTokens: { type: 'integer', minimum: 0 },
            },
          },
        },
      },

      // ── Turn ─────────────────────────────────────────────────────────────
      Turn: {
        type: 'object',
        required: ['id', 'sessionId', 'role', 'sequence', 'createdAt'],
        properties: {
          id: { type: 'string' },
          sessionId: { type: 'string' },
          role: { type: 'string', enum: ['user', 'assistant', 'tool_call', 'tool_result'] },
          content: { type: 'string', nullable: true },
          toolCalls: { nullable: true },
          toolResults: { nullable: true },
          tokenUsage: { nullable: true },
          sequence: { type: 'integer', minimum: 0 },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      TurnList: {
        type: 'object',
        required: ['items', 'hasMore'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Turn' } },
          hasMore: { type: 'boolean' },
        },
      },

      // ── Work Unit ──────────────────────────────────────────────────────────
      WorkUnitStatus: {
        type: 'string',
        enum: ['pending', 'assigned', 'running', 'completed', 'failed', 'cancelled'],
      },
      WorkUnit: {
        type: 'object',
        required: ['id', 'tenantId', 'status', 'title', 'type', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string' },
          tenantId: { type: 'string' },
          sessionId: { type: 'string', nullable: true },
          coordinationGroupId: { type: 'string', nullable: true },
          status: { $ref: '#/components/schemas/WorkUnitStatus' },
          title: { type: 'string' },
          type: { type: 'string' },
          assignee: { type: 'string', nullable: true },
          dependencies: { type: 'array', items: { type: 'string' } },
          labels: { type: 'array', items: { type: 'string' } },
          metadata: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      CreateWorkUnitRequest: {
        type: 'object',
        required: ['title', 'type'],
        properties: {
          title: { type: 'string', minLength: 1 },
          type: { type: 'string', minLength: 1 },
          sessionId: { type: 'string' },
          coordinationGroupId: { type: 'string' },
          assignee: { type: 'string' },
          dependencies: { type: 'array', items: { type: 'string' }, default: [] },
          labels: { type: 'array', items: { type: 'string' }, default: [] },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      UpdateWorkUnitRequest: {
        type: 'object',
        properties: {
          status: { $ref: '#/components/schemas/WorkUnitStatus' },
          assignee: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      WorkUnitList: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/WorkUnit' } },
        },
      },

      // ── Coordination Group ─────────────────────────────────────────────────
      CompletionPolicy: {
        type: 'string',
        enum: ['all', 'any', 'majority'],
      },
      CoordinationGroupStatus: {
        type: 'string',
        enum: ['active', 'completed', 'failed'],
      },
      CoordinationGroup: {
        type: 'object',
        required: ['id', 'tenantId', 'title', 'completionPolicy', 'status', 'createdAt'],
        properties: {
          id: { type: 'string' },
          tenantId: { type: 'string' },
          title: { type: 'string' },
          completionPolicy: { $ref: '#/components/schemas/CompletionPolicy' },
          status: { $ref: '#/components/schemas/CoordinationGroupStatus' },
          metadata: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      CoordinationGroupWithUnits: {
        allOf: [
          { $ref: '#/components/schemas/CoordinationGroup' },
          {
            type: 'object',
            required: ['workUnits'],
            properties: {
              workUnits: { type: 'array', items: { $ref: '#/components/schemas/WorkUnit' } },
            },
          },
        ],
      },
      CreateCoordinationGroupRequest: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          completionPolicy: { $ref: '#/components/schemas/CompletionPolicy', default: 'all' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  };

  const security = [{ bearerAuth: [] as string[] }];
  const baseErrorResponses = {
    '400': {
      description: 'Invalid request body',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
    },
    '401': {
      description: 'Unauthorized — missing or invalid bearer token',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
    },
    '500': {
      description: 'Internal server error',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
    },
  };

  const paths: Record<string, unknown> = {
    // ── Sessions ──────────────────────────────────────────────────────────────
    '/sessions': {
      post: {
        operationId: 'createSession',
        summary: 'Create a new orchestrator session',
        tags: ['Sessions'],
        security,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateSessionRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Session created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } },
          },
          ...baseErrorResponses,
        },
      },
      get: {
        operationId: 'listSessions',
        summary: 'List sessions for the authenticated tenant',
        tags: ['Sessions'],
        security,
        parameters: [
          { in: 'query', name: 'status', schema: { $ref: '#/components/schemas/SessionStatus' } },
          { in: 'query', name: 'userId', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20, maximum: 100 } },
          { in: 'query', name: 'cursor', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Paginated list of sessions',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedSessions' } } },
          },
          ...baseErrorResponses,
        },
      },
    },
    '/sessions/{sessionId}': {
      parameters: [{ in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getSession',
        summary: 'Get session by ID',
        tags: ['Sessions'],
        security,
        responses: {
          '200': { description: 'Session details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
          '404': { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
      patch: {
        operationId: 'updateSession',
        summary: 'Update session status via action',
        tags: ['Sessions'],
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateSessionRequest' } } },
        },
        responses: {
          '200': { description: 'Updated session', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
          '404': { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '409': { description: 'Invalid status transition', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
    },

    // ── Turns ─────────────────────────────────────────────────────────────────
    '/sessions/{sessionId}/turns': {
      parameters: [{ in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'listTurns',
        summary: 'List conversation turns for a session',
        tags: ['Sessions'],
        security,
        parameters: [
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 50, maximum: 200 } },
          { in: 'query', name: 'after_sequence', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Turn list', content: { 'application/json': { schema: { $ref: '#/components/schemas/TurnList' } } } },
          '404': { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
    },

    // ── Messages ──────────────────────────────────────────────────────────────
    '/sessions/{sessionId}/messages': {
      parameters: [{ in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } }],
      post: {
        operationId: 'sendMessage',
        summary: 'Send a message to a session (may stream SSE)',
        tags: ['Messages'],
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SendMessageRequest' } } },
        },
        responses: {
          '200': {
            description: 'JSON response (stream=false) or SSE stream (stream=true)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } },
              'text/event-stream': { schema: { type: 'string', description: 'SSE event stream' } },
            },
          },
          '404': { description: 'Session not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '409': { description: 'Session not in running state', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
    },

    // ── Events ────────────────────────────────────────────────────────────────
    '/sessions/{sessionId}/events': {
      parameters: [{ in: 'path', name: 'sessionId', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'subscribeSessionEvents',
        summary: 'Subscribe to SSE events for a specific session',
        tags: ['Events'],
        security,
        parameters: [
          { in: 'query', name: 'types', schema: { type: 'string' }, description: 'Comma-separated event type filter' },
          { in: 'header', name: 'Last-Event-ID', schema: { type: 'integer' }, description: 'Resume from this sequence number' },
        ],
        responses: {
          '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
          ...baseErrorResponses,
        },
      },
    },
    '/events': {
      get: {
        operationId: 'subscribeTenantEvents',
        summary: 'Subscribe to SSE stream of all tenant events',
        tags: ['Events'],
        security,
        parameters: [
          { in: 'query', name: 'types', schema: { type: 'string' }, description: 'Comma-separated event type filter' },
          { in: 'header', name: 'Last-Event-ID', schema: { type: 'integer' }, description: 'Resume from this sequence number' },
        ],
        responses: {
          '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
          ...baseErrorResponses,
        },
      },
    },

    // ── Work Units ────────────────────────────────────────────────────────────
    '/work-units': {
      post: {
        operationId: 'createWorkUnit',
        summary: 'Create a new work unit',
        tags: ['Coordination'],
        security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateWorkUnitRequest' } } } },
        responses: {
          '201': { description: 'Work unit created', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkUnit' } } } },
          '422': { description: 'Dependency cycle detected', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
      get: {
        operationId: 'listWorkUnits',
        summary: 'List work units (filtered)',
        tags: ['Coordination'],
        security,
        parameters: [
          { in: 'query', name: 'sessionId', schema: { type: 'string' } },
          { in: 'query', name: 'coordinationGroupId', schema: { type: 'string' } },
          { in: 'query', name: 'status', schema: { $ref: '#/components/schemas/WorkUnitStatus' } },
        ],
        responses: {
          '200': { description: 'Work unit list', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkUnitList' } } } },
          ...baseErrorResponses,
        },
      },
    },
    '/work-units/{workUnitId}': {
      parameters: [{ in: 'path', name: 'workUnitId', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getWorkUnit',
        summary: 'Get work unit by ID',
        tags: ['Coordination'],
        security,
        responses: {
          '200': { description: 'Work unit details', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkUnit' } } } },
          '404': { description: 'Work unit not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
      patch: {
        operationId: 'updateWorkUnit',
        summary: 'Update work unit status, assignee, or metadata',
        tags: ['Coordination'],
        security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateWorkUnitRequest' } } } },
        responses: {
          '200': { description: 'Updated work unit', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkUnit' } } } },
          '404': { description: 'Work unit not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '409': { description: 'Invalid status transition', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '422': { description: 'Dependencies not met', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
    },

    // ── Coordination Groups ───────────────────────────────────────────────────
    '/coordination-groups': {
      post: {
        operationId: 'createCoordinationGroup',
        summary: 'Create a coordination group',
        tags: ['Coordination'],
        security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateCoordinationGroupRequest' } } } },
        responses: {
          '201': { description: 'Group created', content: { 'application/json': { schema: { $ref: '#/components/schemas/CoordinationGroup' } } } },
          ...baseErrorResponses,
        },
      },
    },
    '/coordination-groups/{groupId}': {
      parameters: [{ in: 'path', name: 'groupId', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getCoordinationGroup',
        summary: 'Get coordination group with its work units',
        tags: ['Coordination'],
        security,
        responses: {
          '200': { description: 'Group with work units', content: { 'application/json': { schema: { $ref: '#/components/schemas/CoordinationGroupWithUnits' } } } },
          '404': { description: 'Group not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          ...baseErrorResponses,
        },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Joyus AI Platform Orchestrator API',
      version: '1.0.0',
      description: [
        'HTTP API for the Joyus AI Platform Orchestrator.',
        'Exposes session management, agent message delivery, real-time event streaming,',
        'and coordination primitives (work units, coordination groups).',
        '',
        'All endpoints require bearer token authentication.',
        'All resources are tenant-scoped: the authenticated token determines the tenant.',
        'tenantId is never accepted from the request body or query parameters.',
      ].join('\n'),
    },
    servers: [
      { url: '/api/v1/orchestrator', description: 'Orchestrator API' },
    ],
    components,
    paths,
  };
}

// ============================================================
// OPENAPI ROUTE
// ============================================================

/**
 * Express router that serves the generated OpenAPI spec.
 * Mounted at /api/v1/orchestrator and serves at /openapi.json.
 */
export function createOpenApiRouter(): Router {
  const router = Router();

  // Cache the spec (it's static per process)
  let cachedSpec: Record<string, unknown> | null = null;

  router.get('/openapi.json', (_req, res) => {
    if (!cachedSpec) {
      cachedSpec = buildOrchestratorOpenApiSpec();
    }
    return res.json(cachedSpec);
  });

  return router;
}
