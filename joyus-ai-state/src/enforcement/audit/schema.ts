/**
 * Audit-specific Zod schemas — T008
 *
 * Re-exports from the main schemas module for audit-specific use.
 * Keeps audit module self-contained while avoiding duplication.
 */

export { AuditEntrySchema, CorrectionSchema } from '../schemas.js';
