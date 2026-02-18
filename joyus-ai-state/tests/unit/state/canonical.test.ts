import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadCanonical,
  saveCanonical,
  addDeclaration,
  removeDeclaration,
  listDeclarations,
  checkPath,
  generateWarning,
  getCanonicalStatuses,
} from '../../../src/state/canonical.js';
import type { CanonicalDeclarations } from '../../../src/state/canonical.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('loadCanonical / saveCanonical', () => {
  it('returns empty documents when file does not exist', async () => {
    const result = await loadCanonical(tmpDir);
    expect(result).toEqual({ documents: {} });
  });

  it('round-trips declarations through save and load', async () => {
    const declarations: CanonicalDeclarations = {
      documents: {
        readme: { default: 'docs/README.md' },
        config: { default: 'config.yaml', branches: { staging: 'config.staging.yaml' } },
      },
    };
    await saveCanonical(tmpDir, declarations);
    const loaded = await loadCanonical(tmpDir);
    expect(loaded).toEqual(declarations);
  });

  it('returns empty documents for corrupted JSON', async () => {
    const filePath = path.join(tmpDir, '.joyus-ai', 'canonical.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not valid json!!!');
    const result = await loadCanonical(tmpDir);
    expect(result).toEqual({ documents: {} });
  });

  it('creates .joyus-ai directory if missing', async () => {
    await saveCanonical(tmpDir, { documents: { test: { default: 'test.md' } } });
    const exists = fs.existsSync(path.join(tmpDir, '.joyus-ai', 'canonical.json'));
    expect(exists).toBe(true);
  });
});

describe('addDeclaration', () => {
  it('adds a new declaration with default path', () => {
    const result = addDeclaration({ documents: {} }, 'readme', 'docs/README.md');
    expect(result.documents.readme).toEqual({ default: 'docs/README.md' });
  });

  it('adds a branch override', () => {
    const base: CanonicalDeclarations = {
      documents: { readme: { default: 'docs/README.md' } },
    };
    const result = addDeclaration(base, 'readme', 'docs/README.staging.md', 'staging');
    expect(result.documents.readme.default).toBe('docs/README.md');
    expect(result.documents.readme.branches?.staging).toBe('docs/README.staging.md');
  });

  it('replaces existing default path', () => {
    const base: CanonicalDeclarations = {
      documents: { readme: { default: 'old/README.md' } },
    };
    const result = addDeclaration(base, 'readme', 'new/README.md');
    expect(result.documents.readme.default).toBe('new/README.md');
  });

  it('does not mutate input', () => {
    const base: CanonicalDeclarations = { documents: {} };
    addDeclaration(base, 'readme', 'docs/README.md');
    expect(base.documents).toEqual({});
  });
});

describe('removeDeclaration', () => {
  it('removes an existing declaration', () => {
    const base: CanonicalDeclarations = {
      documents: { readme: { default: 'docs/README.md' }, config: { default: 'config.yaml' } },
    };
    const result = removeDeclaration(base, 'readme');
    expect(result.documents).toEqual({ config: { default: 'config.yaml' } });
  });

  it('returns same object if name does not exist', () => {
    const base: CanonicalDeclarations = { documents: {} };
    const result = removeDeclaration(base, 'nonexistent');
    expect(result).toBe(base);
  });
});

describe('listDeclarations', () => {
  it('returns flat list with branch overrides', () => {
    const declarations: CanonicalDeclarations = {
      documents: {
        readme: { default: 'docs/README.md', branches: { staging: 'docs/README.staging.md' } },
        config: { default: 'config.yaml' },
      },
    };
    const list = listDeclarations(declarations);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      name: 'readme',
      defaultPath: 'docs/README.md',
      branchOverrides: ['staging'],
    });
    expect(list[1]).toEqual({
      name: 'config',
      defaultPath: 'config.yaml',
      branchOverrides: [],
    });
  });
});

describe('checkPath', () => {
  const declarations: CanonicalDeclarations = {
    documents: {
      readme: {
        default: 'docs/README.md',
        branches: { staging: 'docs/README.staging.md' },
      },
    },
  };

  it('returns isCanonical: true for exact match', () => {
    const result = checkPath(declarations, 'docs/README.md', 'main');
    expect(result.isCanonical).toBe(true);
    expect(result.canonicalName).toBe('readme');
    expect(result.suggestion).toBeNull();
  });

  it('uses branch override when on matching branch', () => {
    const result = checkPath(declarations, 'docs/README.staging.md', 'staging');
    expect(result.isCanonical).toBe(true);
    expect(result.canonicalName).toBe('readme');
  });

  it('returns suggestion for basename match in different directory', () => {
    const result = checkPath(declarations, 'other/README.md', 'main');
    expect(result.isCanonical).toBe(false);
    expect(result.canonicalName).toBe('readme');
    expect(result.canonicalPath).toBe('docs/README.md');
    expect(result.suggestion).toContain('docs/README.md');
  });

  it('returns no match for unrelated file', () => {
    const result = checkPath(declarations, 'src/index.ts', 'main');
    expect(result.isCanonical).toBe(false);
    expect(result.canonicalName).toBeNull();
    expect(result.canonicalPath).toBeNull();
    expect(result.suggestion).toBeNull();
  });

  it('normalizes trailing slashes', () => {
    const decl: CanonicalDeclarations = {
      documents: { dir: { default: 'docs/guide' } },
    };
    const result = checkPath(decl, 'docs/guide/', 'main');
    expect(result.isCanonical).toBe(true);
  });
});

describe('generateWarning', () => {
  it('returns null when isCanonical is true', () => {
    const result = generateWarning({
      isCanonical: true,
      canonicalName: 'readme',
      canonicalPath: 'docs/README.md',
      suggestion: null,
    });
    expect(result).toBeNull();
  });

  it('returns null when no canonical match', () => {
    const result = generateWarning({
      isCanonical: false,
      canonicalName: null,
      canonicalPath: null,
      suggestion: null,
    });
    expect(result).toBeNull();
  });

  it('returns formatted warning for non-canonical access', () => {
    const result = generateWarning(
      {
        isCanonical: false,
        canonicalName: 'readme',
        canonicalPath: 'docs/README.md',
        suggestion: 'Use canonical source at docs/README.md',
      },
      'other/README.md',
    );
    expect(result).toContain('WARNING');
    expect(result).toContain('other/README.md');
    expect(result).toContain('docs/README.md');
    expect(result).toContain('readme');
  });
});

describe('getCanonicalStatuses', () => {
  it('reports existing file with lastModified', async () => {
    // Create a file in the temp dir
    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'README.md'), '# Hello');

    const declarations: CanonicalDeclarations = {
      documents: { readme: { default: 'docs/README.md' } },
    };
    const statuses = await getCanonicalStatuses(tmpDir, declarations, 'main');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].name).toBe('readme');
    expect(statuses[0].exists).toBe(true);
    expect(statuses[0].lastModified).toBeTruthy();
    expect(statuses[0].branchOverride).toBeNull();
  });

  it('reports missing file', async () => {
    const declarations: CanonicalDeclarations = {
      documents: { readme: { default: 'docs/README.md' } },
    };
    const statuses = await getCanonicalStatuses(tmpDir, declarations, 'main');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].exists).toBe(false);
    expect(statuses[0].lastModified).toBeNull();
  });

  it('uses branch override for resolution', async () => {
    const stagingDir = path.join(tmpDir, 'staging-docs');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.writeFileSync(path.join(stagingDir, 'README.md'), '# Staging');

    const declarations: CanonicalDeclarations = {
      documents: {
        readme: {
          default: 'docs/README.md',
          branches: { staging: 'staging-docs/README.md' },
        },
      },
    };
    const statuses = await getCanonicalStatuses(tmpDir, declarations, 'staging');
    expect(statuses[0].canonicalPath).toBe('staging-docs/README.md');
    expect(statuses[0].exists).toBe(true);
    expect(statuses[0].branchOverride).toBe('staging');
  });
});
