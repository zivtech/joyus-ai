/**
 * Step handler interface and dependency injection types for built-in step handlers.
 */

import type { ExecutionContext, PipelineStepHandler as EngineStepHandler } from '../engine/step-runner.js';

// ============================================================
// LIGHTWEIGHT CLIENT INTERFACES
// ============================================================

export interface ProfileEngineClient {
  regenerateProfile(profileId: string): Promise<{ profileId: string; success: boolean; durationMs?: number }>;
}

export interface ContentIntelClient {
  runFidelityCheck(
    profileId: string,
    contentIds: string[],
  ): Promise<{ score: number; passed: boolean; details?: Record<string, unknown> }>;
}

export interface ContentInfraClient {
  generateContent(
    prompt: string,
    profileId: string,
    sourceIds?: string[],
  ): Promise<{ artifactId: string; type: string; metadata?: Record<string, unknown> }>;
  querySource(
    query: string,
    sourceIds?: string[],
    maxResults?: number,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }>;
}

export interface NotificationService {
  send(
    channel: string,
    message: string,
    recipients?: string[],
  ): Promise<{ sent: boolean; messageId?: string }>;
}

// ============================================================
// DEPENDENCY CONTAINER
// ============================================================

export interface StepHandlerDependencies {
  profileEngine?: ProfileEngineClient;
  contentIntelligence?: ContentIntelClient;
  contentInfrastructure?: ContentInfraClient;
  notificationService?: NotificationService;
}

// ============================================================
// STEP HANDLER INTERFACE
// ============================================================

export interface PipelineStepHandler extends EngineStepHandler {
  validateConfig(config: Record<string, unknown>): string[];
}
