/**
 * Content Infrastructure — Zod Validation Schemas
 *
 * Input validation for content operations (MCP tool inputs, API request bodies).
 */

import { z } from 'zod';

// ============================================================
// SOURCE MANAGEMENT
// ============================================================

export const CreateSourceInput = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['relational-database', 'rest-api']),
  syncStrategy: z.enum(['mirror', 'pass-through', 'hybrid']),
  connectionConfig: z.record(z.unknown()),
  freshnessWindowMinutes: z.number().int().positive().default(1440),
});
export type CreateSourceInput = z.infer<typeof CreateSourceInput>;

// ============================================================
// SEARCH
// ============================================================

export const SearchInput = z.object({
  query: z.string().min(1).max(1000),
  sourceId: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});
export type SearchInput = z.infer<typeof SearchInput>;

// ============================================================
// PRODUCT MANAGEMENT
// ============================================================

export const CreateProductInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  sourceIds: z.array(z.string()).default([]),
  profileIds: z.array(z.string()).default([]),
});
export type CreateProductInput = z.infer<typeof CreateProductInput>;

// ============================================================
// GENERATION
// ============================================================

export const GenerateInput = z.object({
  query: z.string().min(1).max(10000),
  profileId: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  maxSources: z.number().int().min(1).max(20).default(5),
});
export type GenerateInput = z.infer<typeof GenerateInput>;

// ============================================================
// MEDIATION
// ============================================================

export const MediationMessageInput = z.object({
  message: z.string().min(1).max(10000),
  maxSources: z.number().int().min(1).max(20).default(5),
});
export type MediationMessageInput = z.infer<typeof MediationMessageInput>;

export const CreateApiKeyInput = z.object({
  integrationName: z.string().min(1).max(200),
  jwksUri: z.string().url().optional(),
  issuer: z.string().optional(),
  audience: z.string().optional(),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInput>;

export const CreateSessionInput = z.object({
  profileId: z.string().optional(),
});
export type CreateSessionInput = z.infer<typeof CreateSessionInput>;
