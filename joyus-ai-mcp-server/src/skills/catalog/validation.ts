/**
 * Index schema-1 and frontmatter validation (catalog-source.md). Uses the runtime JSON
 * parser plus the maintained `yaml` parser's strict, unique-key-checking document parser to
 * reject duplicate JSON member keys and duplicate/aliased/tagged frontmatter fields.
 * Rejects the whole candidate on any inconsistency; never hand-rolls a parser.
 */
import { DateTime } from 'luxon';
import { parseDocument as parseYamlDocument, visit as visitYaml } from 'yaml';

import { CATALOG_LIMITS, SKILL_NAME_PATTERN } from './config.js';
import {
  fail,
  ok,
  type Result,
  type SkillMetadata,
  type SkillScope,
  type ValidatedSkill,
} from './types.js';

const SCOPES: readonly SkillScope[] = ['tenant', 'role', 'task'];
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const BOM = '﻿';

export interface ParsedIndex {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly skills: readonly SkillMetadata[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeUtf8Strict(raw: Uint8Array): Result<string> {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    return ok(text);
  } catch {
    return fail('validation', 'content is not valid UTF-8');
  }
}

/** `yaml`'s parser is expected to report malformed input via `doc.errors`, but a hostile or
 * pathological document could still throw during parsing or traversal; never let that escape
 * as an uncaught exception (candidate failures must always be a typed, sanitized `Result`). */
function safeParseYamlDocument(text: string): ReturnType<typeof parseYamlDocument> | null {
  try {
    return parseYamlDocument(text, { strict: true, uniqueKeys: true, merge: false });
  } catch {
    return null;
  }
}

/** The regex alone only checks shape and accepts calendar-invalid values (e.g. 2023-02-30,
 * which `Date.parse` would silently roll over to March). `generatedAt` is descriptive only
 * (catalog-source.md) but must still be a real, parseable instant. */
function isValidRfc3339(value: string): boolean {
  if (!RFC3339_PATTERN.test(value)) return false;
  try {
    return DateTime.fromISO(value, { setZone: true }).isValid;
  } catch {
    return false;
  }
}

function yamlHasDuplicateOrMalformedFields(text: string): boolean {
  const doc = safeParseYamlDocument(text);
  if (!doc) return true;
  return doc.errors.length > 0 || doc.warnings.length > 0;
}

/** Rejects any anchor, alias, explicit tag, or non-mapping frontmatter document. */
function yamlHasDisallowedConstructs(text: string): boolean {
  const doc = safeParseYamlDocument(text);
  if (!doc) return true;
  if (doc.errors.length > 0 || doc.warnings.length > 0) return true;

  let disallowed = false;
  try {
    visitYaml(doc, (_key, node) => {
      if (node && typeof node === 'object') {
        const anyNode = node as { anchor?: unknown; tag?: unknown; type?: string };
        if (anyNode.type === 'ALIAS') disallowed = true;
        if (anyNode.anchor) disallowed = true;
        if (typeof anyNode.tag === 'string') disallowed = true;
      }
    });
  } catch {
    return true;
  }
  return disallowed;
}

/** Require JSON syntax first, then strict/unique-key YAML parsing before accepting the object. */
export function parseIndex(raw: Uint8Array): Result<ParsedIndex> {
  if (raw.byteLength > CATALOG_LIMITS.MAX_INDEX_BYTES) {
    return fail('limit', 'index exceeds the maximum allowed size');
  }

  const decoded = decodeUtf8Strict(raw);
  if (!decoded.ok) return decoded;
  const text = decoded.value;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return fail('validation', 'index is not valid JSON');
  }

  if (yamlHasDuplicateOrMalformedFields(text)) {
    return fail('validation', 'index contains duplicate or malformed fields');
  }

  if (!isPlainObject(parsedJson)) {
    return fail('validation', 'index root must be an object');
  }

  const rootKeys = Object.keys(parsedJson).sort();
  if (rootKeys.join(',') !== ['generatedAt', 'schemaVersion', 'skills'].join(',')) {
    return fail('validation', 'index has unexpected or missing root fields');
  }

  if (parsedJson.schemaVersion !== 1) {
    return fail('validation', 'unsupported index schemaVersion');
  }

  if (typeof parsedJson.generatedAt !== 'string' || !isValidRfc3339(parsedJson.generatedAt)) {
    return fail('validation', 'index generatedAt is not a valid RFC3339 timestamp');
  }

  if (!Array.isArray(parsedJson.skills)) {
    return fail('validation', 'index skills field must be an array');
  }

  if (parsedJson.skills.length > CATALOG_LIMITS.MAX_ENTRIES) {
    return fail('limit', 'index exceeds the maximum entry count');
  }

  const seenNames = new Set<string>();
  const skills: SkillMetadata[] = [];

  for (const rawEntry of parsedJson.skills) {
    const entryResult = parseIndexEntry(rawEntry);
    if (!entryResult.ok) return entryResult;
    const entry = entryResult.value;
    if (seenNames.has(entry.name)) {
      return fail('validation', 'index contains a duplicate skill name');
    }
    seenNames.add(entry.name);
    skills.push(entry);
  }

  return ok({ schemaVersion: 1, generatedAt: parsedJson.generatedAt, skills });
}

function parseIndexEntry(rawEntry: unknown): Result<SkillMetadata> {
  if (!isPlainObject(rawEntry)) {
    return fail('validation', 'index entry must be an object');
  }

  const keys = Object.keys(rawEntry).sort();
  const expected = ['bytes', 'description', 'name', 'path', 'priority', 'scope'];
  if (keys.join(',') !== expected.join(',')) {
    return fail('validation', 'index entry has unexpected or missing fields');
  }

  const { name, description, priority, scope, path, bytes } = rawEntry;

  if (
    typeof name !== 'string' ||
    name.length > CATALOG_LIMITS.NAME_MAX_LENGTH ||
    !SKILL_NAME_PATTERN.test(name)
  ) {
    return fail('validation', 'index entry name is not a valid slug');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return fail('validation', 'index entry description must be nonempty');
  }
  if (
    typeof priority !== 'number' ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 100
  ) {
    return fail('validation', 'index entry priority must be an integer 0-100');
  }
  if (typeof scope !== 'string' || !SCOPES.includes(scope as SkillScope)) {
    return fail('validation', 'index entry scope is invalid');
  }
  if (typeof path !== 'string' || path !== `skills/${name}/SKILL.md`) {
    return fail('validation', 'index entry path does not match the canonical layout');
  }
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) {
    return fail('validation', 'index entry bytes must be a nonnegative safe integer');
  }

  return ok({ name, description, priority, scope: scope as SkillScope, path, bytes });
}

export interface ParsedDocument {
  readonly name: string;
  readonly description: string;
  readonly priority: number;
  readonly scope: SkillScope;
  readonly body: string;
  readonly full: string;
}

function findDelimiterLines(
  text: string
): { openEnd: number; frontmatterEnd: number; closeEnd: number } | null {
  // First line must be exactly "---" (optional trailing \r), on its own line.
  const firstLineMatch = /^---\r?\n/.exec(text);
  if (!firstLineMatch) return null;
  const openEnd = firstLineMatch[0].length;

  // Scan subsequent lines for the closing "---" delimiter, on its own line. Captures the
  // line break preceding it so LF and CRLF frontmatter both retain their final line's
  // trailing newline once sliced (a lone trailing "\r" otherwise corrupts the last scalar).
  const closeDelimiter = /(\r?\n)---\r?\n/;
  const match = closeDelimiter.exec(text.slice(openEnd));
  if (!match) return null;
  const closeStart = openEnd + match.index;
  const frontmatterEnd = closeStart + match[1].length;
  const closeEnd = closeStart + match[0].length;
  return { openEnd, frontmatterEnd, closeEnd };
}

/** Parse one original document's frontmatter with a maintained strict/unique-key YAML parser. */
export function parseDocument(raw: Uint8Array): Result<ParsedDocument> {
  const decoded = decodeUtf8Strict(raw);
  if (!decoded.ok) return decoded;
  const text = decoded.value;

  if (text.startsWith(BOM)) {
    return fail('validation', 'document has a leading byte-order mark');
  }

  const delimiters = findDelimiterLines(text);
  if (!delimiters) {
    return fail('validation', 'document is missing a valid frontmatter delimiter pair');
  }

  const frontmatterText = text.slice(delimiters.openEnd, delimiters.frontmatterEnd);
  const body = text.slice(delimiters.closeEnd);

  if (body.trim().length === 0) {
    return fail('validation', 'document body must be nonempty');
  }

  if (yamlHasDisallowedConstructs(frontmatterText)) {
    return fail(
      'validation',
      'document frontmatter contains duplicate fields, aliases, anchors, or tags'
    );
  }

  const doc = safeParseYamlDocument(frontmatterText);
  if (!doc) return fail('validation', 'document frontmatter could not be parsed');
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch {
    return fail('validation', 'document frontmatter could not be safely materialized');
  }

  if (!isPlainObject(value)) {
    return fail('validation', 'document frontmatter must be a mapping');
  }

  const keys = Object.keys(value).sort();
  const expected = ['description', 'name', 'priority', 'scope'];
  if (keys.join(',') !== expected.join(',')) {
    return fail('validation', 'document frontmatter has unexpected or missing fields');
  }

  const { name, description, priority, scope } = value;
  if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) {
    return fail('validation', 'document frontmatter name is invalid');
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return fail('validation', 'document frontmatter description must be nonempty');
  }
  if (
    typeof priority !== 'number' ||
    !Number.isInteger(priority) ||
    priority < 0 ||
    priority > 100
  ) {
    return fail('validation', 'document frontmatter priority must be an integer 0-100');
  }
  if (typeof scope !== 'string' || !SCOPES.includes(scope as SkillScope)) {
    return fail('validation', 'document frontmatter scope is invalid');
  }

  return ok({ name, description, priority, scope: scope as SkillScope, body, full: text });
}

/** Deterministic serving order: descending priority, then ASCII-ascending name. */
export function sortSkills<T extends { readonly priority: number; readonly name: string }>(
  skills: readonly T[]
): T[] {
  return [...skills].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

export interface ValidatedCandidate {
  readonly skills: readonly ValidatedSkill[];
  readonly totalDocumentBytes: number;
}

/**
 * Cross-validate the index against fetched original document bytes. Rejects the whole
 * candidate — never just the offending entry — on any mismatch.
 */
export function validateCandidate(
  indexRaw: Uint8Array,
  documents: ReadonlyMap<string, Uint8Array>
): Result<ValidatedCandidate> {
  const indexResult = parseIndex(indexRaw);
  if (!indexResult.ok) return indexResult;

  const skills: ValidatedSkill[] = [];
  let totalDocumentBytes = 0;

  for (const entry of indexResult.value.skills) {
    const raw = documents.get(entry.path);
    if (!raw) {
      return fail('validation', 'index references a document that was not fetched');
    }
    if (raw.byteLength > CATALOG_LIMITS.MAX_DOCUMENT_BYTES) {
      return fail('limit', 'document exceeds the maximum allowed size');
    }

    const parsed = parseDocument(raw);
    if (!parsed.ok) return parsed;

    if (
      parsed.value.name !== entry.name ||
      parsed.value.description !== entry.description ||
      parsed.value.priority !== entry.priority ||
      parsed.value.scope !== entry.scope
    ) {
      return fail('validation', 'index and document frontmatter disagree');
    }

    if (entry.bytes !== raw.byteLength) {
      return fail('validation', 'index byte count does not match the original document');
    }

    totalDocumentBytes += raw.byteLength;
    if (totalDocumentBytes > CATALOG_LIMITS.MAX_GENERATION_DOCUMENT_BYTES) {
      return fail('limit', 'generation exceeds the maximum total document bytes');
    }

    skills.push({ ...entry, document: parsed.value.full });
  }

  return ok({ skills: sortSkills(skills), totalDocumentBytes });
}
