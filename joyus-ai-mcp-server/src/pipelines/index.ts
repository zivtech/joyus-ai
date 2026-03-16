/**
 * Automated Pipelines Framework — Module Entry Point
 *
 * Re-exports schema, types, and validation for convenient imports.
 * Extended in later WPs with event-bus, engine, triggers, steps, review, templates, analytics.
 */

export * from './schema.js';
export * from './types.js';
export * from './validation.js';
export * from './engine/index.js';
export * from './review/index.js';
