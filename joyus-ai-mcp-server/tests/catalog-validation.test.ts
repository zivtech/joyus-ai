import { describe, it, expect } from 'vitest';

import { parseDocument, parseIndex, sortSkills, validateCandidate } from '../src/skills/catalog/validation.js';

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function validIndexObject(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2024-01-01T00:00:00Z',
    skills: [],
    ...overrides,
  };
}

describe('parseIndex — generatedAt validity', () => {
  it('accepts a real RFC3339 instant', () => {
    const result = parseIndex(utf8(JSON.stringify(validIndexObject())));
    expect(result.ok).toBe(true);
  });

  it('rejects a calendar-invalid date the regex alone would accept (2023-02-30)', () => {
    const result = parseIndex(utf8(JSON.stringify(validIndexObject({ generatedAt: '2023-02-30T00:00:00Z' }))));
    expect(result.ok).toBe(false);
  });

  it('rejects an out-of-range time component (25:00:00)', () => {
    const result = parseIndex(utf8(JSON.stringify(validIndexObject({ generatedAt: '2024-01-01T25:00:00Z' }))));
    expect(result.ok).toBe(false);
  });
});

describe('parseIndex — JSON/YAML duplicate-key rejection', () => {
  it('rejects duplicate top-level JSON member keys the runtime parser silently collapses', () => {
    const raw = '{"schemaVersion":1,"generatedAt":"2024-01-01T00:00:00Z","skills":[],"skills":[]}';
    expect(() => JSON.parse(raw)).not.toThrow(); // runtime parser alone silently accepts this
    const result = parseIndex(utf8(raw));
    expect(result.ok).toBe(false);
  });

  it('rejects a nested duplicate key inside an index entry', () => {
    const raw =
      '{"schemaVersion":1,"generatedAt":"2024-01-01T00:00:00Z","skills":[{"name":"a","name":"b","description":"d","priority":1,"scope":"tenant","path":"skills/a/SKILL.md","bytes":1}]}';
    const result = parseIndex(utf8(raw));
    expect(result.ok).toBe(false);
  });

  it('never throws for structurally hostile index input', () => {
    expect(() => parseIndex(utf8('{{{not json'))).not.toThrow();
    expect(() => parseIndex(utf8('null'))).not.toThrow();
  });
});

const FRONTMATTER_FIELDS = 'name: example-skill\ndescription: An example.\npriority: 1\nscope: tenant';

describe('parseDocument — frontmatter delimiters and line endings', () => {
  it('accepts LF line endings', () => {
    const text = `---\n${FRONTMATTER_FIELDS}\n---\nBody text.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(true);
  });

  it('accepts CRLF line endings', () => {
    const text = `---\r\n${FRONTMATTER_FIELDS.replace(/\n/g, '\r\n')}\r\n---\r\nBody text.\r\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(true);
  });

  it('rejects a leading byte-order mark rather than stripping it', () => {
    const text = `﻿---\n${FRONTMATTER_FIELDS}\n---\nBody text.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });

  it('rejects a missing body', () => {
    const text = `---\n${FRONTMATTER_FIELDS}\n---\n   \n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed/missing closing delimiter', () => {
    const text = `---\n${FRONTMATTER_FIELDS}\nBody text with no closing fence.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });
});

describe('parseDocument — frontmatter YAML safety', () => {
  it('rejects a duplicate frontmatter field', () => {
    const text = `---\nname: a\nname: b\ndescription: d\npriority: 1\nscope: tenant\n---\nBody.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });

  it('rejects an anchor/alias pair', () => {
    const text = `---\nname: &n example-skill\ndescription: An example.\npriority: 1\nscope: tenant\nextra: *n\n---\nBody.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });

  it('rejects a custom tag', () => {
    const text = `---\nname: !!str example-skill\ndescription: An example.\npriority: 1\nscope: tenant\n---\nBody.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });

  it('rejects a merge key', () => {
    const text = `---\nbase: &b\n  scope: tenant\nname: example-skill\ndescription: An example.\npriority: 1\n<<: *b\n---\nBody.\n`;
    const result = parseDocument(utf8(text));
    expect(result.ok).toBe(false);
  });

  it('never throws for structurally hostile frontmatter', () => {
    const text = `---\n${'a: '.repeat(1)}[unterminated\n---\nBody.\n`;
    expect(() => parseDocument(utf8(text))).not.toThrow();
  });
});

describe('validateCandidate — index/document cross-check', () => {
  const documentText = `---\n${FRONTMATTER_FIELDS}\n---\nBody text.\n`;
  const documentBytes = utf8(documentText);
  const indexObject = validIndexObject({
    skills: [
      {
        name: 'example-skill',
        description: 'An example.',
        priority: 1,
        scope: 'tenant',
        path: 'skills/example-skill/SKILL.md',
        bytes: documentBytes.byteLength,
      },
    ],
  });

  it('accepts a matching index and document', () => {
    const result = validateCandidate(
      utf8(JSON.stringify(indexObject)),
      new Map([['skills/example-skill/SKILL.md', documentBytes]]),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects when the index references a document that was not fetched', () => {
    const result = validateCandidate(utf8(JSON.stringify(indexObject)), new Map());
    expect(result.ok).toBe(false);
  });

  it('rejects when the index byte count disagrees with the actual document bytes', () => {
    const badIndex = validIndexObject({
      skills: [{ ...indexObject.skills[0], bytes: documentBytes.byteLength + 1 }],
    });
    const result = validateCandidate(
      utf8(JSON.stringify(badIndex)),
      new Map([['skills/example-skill/SKILL.md', documentBytes]]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a document exceeding the maximum per-document size', () => {
    const oversizedBytes = new Uint8Array(256 * 1024 + 1);
    const badIndex = validIndexObject({
      skills: [{ ...indexObject.skills[0], bytes: oversizedBytes.byteLength }],
    });
    const result = validateCandidate(
      utf8(JSON.stringify(badIndex)),
      new Map([['skills/example-skill/SKILL.md', oversizedBytes]]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects when the total document bytes for the generation exceed the aggregate cap', () => {
    // 16 MiB aggregate / 256 KiB per-document cap requires at least 64 max-sized documents.
    const docCount = 70;
    const bodySize = 250 * 1024;
    const skills = Array.from({ length: docCount }, (_, i) => ({
      name: `example-skill-${i}`,
      description: 'An example.',
      priority: 1,
      scope: 'tenant' as const,
      path: `skills/example-skill-${i}/SKILL.md`,
    }));
    const documents = new Map(
      skills.map((s) => [
        s.path,
        utf8(`---\nname: ${s.name}\ndescription: An example.\npriority: 1\nscope: tenant\n---\n${'x'.repeat(bodySize)}\n`),
      ]),
    );
    const indexed = validIndexObject({
      skills: skills.map((s) => ({ ...s, bytes: documents.get(s.path)!.byteLength })),
    });
    const result = validateCandidate(utf8(JSON.stringify(indexed)), documents);
    expect(result).toMatchObject({ ok: false, failure: { category: 'limit' } });
  });

  it('rejects when index and frontmatter scope disagree', () => {
    const badIndex = validIndexObject({
      skills: [{ ...indexObject.skills[0], scope: 'role' }],
    });
    const result = validateCandidate(
      utf8(JSON.stringify(badIndex)),
      new Map([['skills/example-skill/SKILL.md', documentBytes]]),
    );
    expect(result.ok).toBe(false);
  });
});

describe('sortSkills', () => {
  it('sorts by descending priority then ascending name', () => {
    const sorted = sortSkills([
      { name: 'b', priority: 1 },
      { name: 'a', priority: 2 },
      { name: 'c', priority: 2 },
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['a', 'c', 'b']);
  });
});
