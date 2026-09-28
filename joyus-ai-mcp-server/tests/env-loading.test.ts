/**
 * Regression test: .env must be loaded before any module reads process.env.
 *
 * ESM evaluates every import before the importing module's body runs, so a
 * dotenv `config()` call in the body of src/index.ts runs too late: modules
 * such as src/db/client.ts read process.env while they are being imported (the
 * pg pool was created with an undefined DATABASE_URL). A side-effect
 * `import 'dotenv/config'` only helps while it is the entry point's first
 * runtime import.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it, expect } from 'vitest';

const ENTRY_POINT = fileURLToPath(new URL('../src/index.ts', import.meta.url));

interface ModuleRequest {
  specifier: string;
  sideEffectOnly: boolean;
}

const specifierText = (specifier: ts.Expression): string =>
  ts.isStringLiteral(specifier) ? specifier.text : '<non-literal specifier>';

/** The first statement that makes the module evaluate another module at runtime. */
function firstRuntimeImport(file: string): ModuleRequest | undefined {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022);

  for (const statement of source.statements) {
    // `import type` / `export type … from` are erased and never evaluate anything.
    if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
      return {
        specifier: specifierText(statement.moduleSpecifier),
        sideEffectOnly: statement.importClause === undefined,
      };
    }
    // Re-exports evaluate their target module in declaration order too.
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      return { specifier: specifierText(statement.moduleSpecifier), sideEffectOnly: false };
    }
  }
  return undefined;
}

describe('src/index.ts environment loading', () => {
  it("loads .env with `import 'dotenv/config'` before any other import", () => {
    expect(firstRuntimeImport(ENTRY_POINT)).toEqual({
      specifier: 'dotenv/config',
      sideEffectOnly: true,
    });
  });
});
