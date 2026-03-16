/**
 * Event Adapter — Shared TypeScript Types
 *
 * Application-level types, interfaces, and constants for the event adapter module.
 * Drizzle-inferred types live in schema.ts; these are for API shapes and business logic.
 */

// ============================================================
// ENUM TYPES (application-level mirrors of Drizzle enums)
// ============================================================

export type EventSourceType = 'github' | 'generic_webhook';

export type WebhookEventSourceType = 'github' | 'generic_webhook' | 'schedule' | 'automation_callback';

export type WebhookEventStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'dead_letter';

export type AuthMethod = 'hmac_sha256' | 'api_key_header' | 'ip_allowlist';

export type LifecycleState = 'active' | 'paused' | 'disabled' | 'archived';

// ============================================================
// TRIGGER METADATA INTERFACES
// ============================================================

export interface GitHubPushMetadata {
  ref: string;
  repository: string;
  sender: string;
  commits: Array<{
    id: string;
    message: string;
    timestamp: string;
  }>;
}

export interface GenericWebhookMetadata {
  contentType: string;
  sourceIp?: string;
}

export interface ScheduleMetadata {
  cronExpression: string;
  timezone: string;
  scheduledFireTime: string;
  actualFireTime: string;
}

export type TriggerMetadata = GitHubPushMetadata | GenericWebhookMetadata | ScheduleMetadata;

// ============================================================
// AUTH CONFIG INTERFACES
// ============================================================

export interface HmacAuthConfig {
  secretRef: string;
  headerName: string;
  algorithm: 'sha256';
}

export interface ApiKeyAuthConfig {
  headerName: string;
  secretRef: string;
}

export interface IpAllowlistAuthConfig {
  allowedIps: string[];
}

export type AuthConfig = HmacAuthConfig | ApiKeyAuthConfig | IpAllowlistAuthConfig;

// ============================================================
// TRANSLATED TRIGGER (output to Spec 009 pipelines)
// ============================================================

export interface TranslatedTrigger {
  triggerType: 'corpus-change' | 'manual-request';
  pipelineId: string;
  metadata: Record<string, unknown>;
  sourceEventId: string;
  timestamp: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const MAX_RETRY_ATTEMPTS = 5;
export const RETRY_BACKOFF_BASE_MS = 1000;
export const BUFFER_DRAIN_INTERVAL_MS = 5000;
export const SCHEDULER_POLL_INTERVAL_MS = 30000;
export const DEAD_LETTER_THRESHOLD = MAX_RETRY_ATTEMPTS;
