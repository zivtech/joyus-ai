/**
 * Pipeline Templates — Module Entry Point
 *
 * Exports TemplateStore and the seedBuiltInTemplates utility.
 * seedBuiltInTemplates loads JSON definitions from disk and upserts them by name
 * so repeated calls are idempotent.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TemplateStore } from './store.js';
import type { CreateTemplateInput } from './store.js';

export { TemplateStore };
export type { CreateTemplateInput, ListTemplatesOptions, UpdateTemplateInput, InstantiateOptions } from './store.js';

// ============================================================
// SEED
// ============================================================

const DEFINITION_FILES = [
  'corpus-update-to-profiles.json',
  'regulatory-change-monitor.json',
  'content-audit.json',
] as const;

export async function seedBuiltInTemplates(store: TemplateStore): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const defsDir = join(__dirname, 'definitions');

  for (const filename of DEFINITION_FILES) {
    const raw = readFileSync(join(defsDir, filename), 'utf-8');
    const def = JSON.parse(raw) as CreateTemplateInput;

    // Idempotency: skip if a template with this name already exists
    const existing = await store.getTemplateByName(def.name);
    if (existing) {
      continue;
    }

    await store.createTemplate(def);
  }
}
