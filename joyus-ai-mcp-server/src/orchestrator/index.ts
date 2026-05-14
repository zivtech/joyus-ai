/**
 * Orchestrator Module Entry Point — WP06 (T041)
 *
 * Public surface of the orchestrator module.
 * Consumers (src/index.ts) import from here — not from individual files.
 *
 * Exports:
 *   - createOrchestratorRouter: factory for the full orchestrator HTTP router
 *   - Service classes needed for DI at the app level
 *
 * Mount in src/index.ts:
 *   import { createOrchestratorRouter } from './orchestrator/index.js';
 *   app.use('/api/v1/orchestrator', requireBearerToken, createOrchestratorRouter({ ... }));
 */

export { createOrchestratorRoutes } from './routes/index.js';
export type { OrchestratorRouterDeps } from './routes/index.js';

// Re-export service classes for DI wiring in src/index.ts
export { SessionService } from './session.service.js';
export { AgentLoopService } from './agent-loop.service.js';
export { EventService } from './event.service.js';
export { CoordinationService } from './coordination.service.js';
export { MemoryService } from './memory.service.js';
export { ToolRouterService } from './tool-router.service.js';
export { createDefaultSafetyService } from './safety.service.js';
export { UsageService } from './usage.service.js';
export { SkillLoaderService } from './skill-loader.service.js';
