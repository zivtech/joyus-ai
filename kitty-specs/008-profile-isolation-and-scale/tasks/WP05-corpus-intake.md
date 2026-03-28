---
work_package_id: WP05
title: Self-Service Corpus Intake
lane: planned
dependencies: [WP01]
subtasks: [T022, T023, T024, T025, T026, T027, T028]
phase: Phase 5 - Self-Service Corpus Intake
assignee: ''
agent: ''
shell_pid: ''
review_status: ''
reviewed_by: ''
history:
- timestamp: '2026-03-10T00:00:00Z'
  lane: planned
  agent: system
  action: Prompt generated via /spec-kitty.tasks
---

# WP05: Self-Service Corpus Intake

## Objective

Build the self-service corpus intake pipeline: a pluggable document parser interface with a registry, concrete parsers for PDF (pdf-parse), DOCX (mammoth), and TXT/HTML/Markdown (passthrough), content-hash deduplication within tenant scope, an intake orchestrator that drives the upload-to-snapshot flow, and robust unsupported format handling that rejects bad files without blocking good ones.

## Implementation Command

```bash
spec-kitty implement WP05 --base WP01
```

## Context

- **Spec**: `kitty-specs/008-profile-isolation-and-scale/spec.md` — FR-006 (supported formats), FR-007 (content-hash dedup), NFR-004 (<=2 manual interventions for 100-doc upload)
- **Plan**: `kitty-specs/008-profile-isolation-and-scale/plan.md` — Phase 5 deliverables
- **Research**: `kitty-specs/008-profile-isolation-and-scale/research.md` — R4 (pdf-parse for PDF, mammoth for DOCX, passthrough for TXT/HTML/MD; Unicode NFC normalization, whitespace collapse, SHA-256 hash)
- **Data Model**: `kitty-specs/008-profile-isolation-and-scale/data-model.md` — `corpus_documents` table with `(tenantId, contentHash)` UNIQUE constraint
- **Foundation**: WP01 schema, types (SUPPORTED_FORMATS, SUPPORTED_EXTENSIONS, SUPPORTED_MIME_TYPES), validation, tenant-scope
- **Dependencies to add**: `pdf-parse` and `mammoth` to `package.json` (plus `@types/pdf-parse` if available)
- **Key design**: Content hash is computed from NORMALIZED text (after Unicode NFC, whitespace collapse, line ending normalization), not from raw file bytes. This ensures the same text uploaded as PDF and DOCX is detected as a duplicate.

---

## Subtask T022: Define Document Parser Interface and Registry

**Purpose**: Define the pluggable `DocumentParser` interface and a registry that maps file extensions and MIME types to parser implementations.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/intake/parsers/interface.ts`
2. Define the `DocumentParser` interface (per research R4):
   ```typescript
   export interface DocumentParser {
     /** Human-readable parser name */
     name: string;
     /** MIME types this parser handles */
     supportedMimeTypes: string[];
     /** File extensions this parser handles (without dot, lowercase) */
     supportedExtensions: string[];
     /** Extract plain text content from a document buffer */
     parse(buffer: Buffer, filename: string): Promise<ParseResult>;
   }
   ```
3. The `ParseResult` interface is already defined in `types.ts` (WP01 T002):
   ```typescript
   { text: string; metadata: { title?, author?, pageCount?, wordCount }; warnings: string[] }
   ```
4. Create `joyus-ai-mcp-server/src/profiles/intake/parsers/registry.ts`
5. Implement `ParserRegistry` class:
   - `register(parser: DocumentParser): void` — register a parser
   - `getParserForFile(filename: string): DocumentParser | null` — look up by extension
   - `getParserForMimeType(mimeType: string): DocumentParser | null` — look up by MIME type
   - `getSupportedExtensions(): string[]` — list all supported extensions
   - `getSupportedMimeTypes(): string[]` — list all supported MIME types
   - `isSupported(filename: string): boolean` — quick check
6. The registry is populated at module initialization time (in the module entry point, WP07)
7. Write unit tests in `tests/profiles/intake/parsers/registry.test.ts`:
   - Register a parser, look it up by extension and MIME type
   - Unknown extension returns null
   - `isSupported` returns correct boolean

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/parsers/interface.ts` (new, ~30 lines)
- `joyus-ai-mcp-server/src/profiles/intake/parsers/registry.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/intake/parsers/registry.test.ts` (new, ~50 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Registry tests pass
- [ ] Interface is exported and usable by concrete parsers

---

## Subtask T023: Implement PDF Parser

**Purpose**: Implement a PDF document parser wrapping the `pdf-parse` library.

**Steps**:
1. Add `pdf-parse` to `dependencies` in `joyus-ai-mcp-server/package.json`
2. Add `@types/pdf-parse` to `devDependencies` if available (check npm registry); if not, create a minimal type declaration
3. Create `joyus-ai-mcp-server/src/profiles/intake/parsers/pdf-parser.ts`
4. Implement `PdfParser` class implementing `DocumentParser`:
   - `name`: `'pdf-parser'`
   - `supportedMimeTypes`: `['application/pdf']`
   - `supportedExtensions`: `['pdf']`
   - `async parse(buffer: Buffer, filename: string): Promise<ParseResult>`:
     1. Call `pdf-parse` with the buffer
     2. Extract: `text` (raw text), `numpages` (page count), `info.Title` (title), `info.Author` (author)
     3. Apply normalization pipeline (see normalization steps below)
     4. Compute word count from normalized text
     5. Collect warnings: empty pages, missing metadata, etc.
     6. Return `ParseResult`
5. Normalization pipeline (applied to extracted text before returning):
   1. Normalize Unicode to NFC form (`text.normalize('NFC')`)
   2. Collapse multiple whitespace characters to single space (`text.replace(/\s+/g, ' ')`)
   3. Normalize line endings to `\n` (`text.replace(/\r\n?/g, '\n')`)
   4. Trim leading/trailing whitespace (`text.trim()`)
6. Error handling: if pdf-parse throws (corrupt PDF, password-protected, etc.), catch and return a `ParseResult` with empty text and a warning explaining the failure
7. Write unit tests in `tests/profiles/intake/parsers/pdf-parser.test.ts`:
   - Parse a simple PDF buffer (use a minimal test fixture or mock pdf-parse)
   - Verify normalization is applied
   - Verify metadata extraction
   - Handle corrupt PDF gracefully (returns warning, not exception)

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/parsers/pdf-parser.ts` (new, ~70 lines)
- `joyus-ai-mcp-server/tests/profiles/intake/parsers/pdf-parser.test.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/package.json` (modify — add pdf-parse dependency)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] PDF parser tests pass
- [ ] Normalization is applied (Unicode NFC, whitespace collapse, line endings)
- [ ] Corrupt PDF produces warning, not exception
- [ ] Word count is accurate

---

## Subtask T024: Implement DOCX Parser

**Purpose**: Implement a DOCX document parser wrapping the `mammoth` library.

**Steps**:
1. Add `mammoth` to `dependencies` in `joyus-ai-mcp-server/package.json`
2. Create `joyus-ai-mcp-server/src/profiles/intake/parsers/docx-parser.ts`
3. Implement `DocxParser` class implementing `DocumentParser`:
   - `name`: `'docx-parser'`
   - `supportedMimeTypes`: `['application/vnd.openxmlformats-officedocument.wordprocessingml.document']`
   - `supportedExtensions`: `['docx']`
   - `async parse(buffer: Buffer, filename: string): Promise<ParseResult>`:
     1. Call `mammoth.extractRawText({ buffer })` to get plain text
     2. Apply the same normalization pipeline as PDF parser (NFC, whitespace, line endings, trim)
     3. Compute word count from normalized text
     4. Extract metadata: mammoth does not extract title/author natively — set these as `undefined` in metadata with a warning suggesting manual attribution
     5. Collect warnings from mammoth's `messages` array
     6. Return `ParseResult`
4. Error handling: catch mammoth errors (corrupt DOCX), return warning
5. Write unit tests in `tests/profiles/intake/parsers/docx-parser.test.ts`:
   - Parse a DOCX buffer (mock mammoth)
   - Verify normalization
   - Handle corrupt DOCX gracefully

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/parsers/docx-parser.ts` (new, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/intake/parsers/docx-parser.test.ts` (new, ~50 lines)
- `joyus-ai-mcp-server/package.json` (modify — add mammoth dependency)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] DOCX parser tests pass
- [ ] Normalization matches PDF parser (same pipeline)
- [ ] Missing metadata is reported as a warning

---

## Subtask T025: Implement TXT/HTML/Markdown Passthrough Parser

**Purpose**: Implement a lightweight parser for plain text formats that applies normalization and basic metadata extraction.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/intake/parsers/text-parser.ts`
2. Implement `TextParser` class implementing `DocumentParser`:
   - `name`: `'text-parser'`
   - `supportedMimeTypes`: `['text/plain', 'text/html', 'text/markdown']`
   - `supportedExtensions`: `['txt', 'html', 'htm', 'md', 'markdown']`
   - `async parse(buffer: Buffer, filename: string): Promise<ParseResult>`:
     1. Convert buffer to string (UTF-8)
     2. For HTML files: strip HTML tags to extract plain text
        - Use a simple regex-based strip: `text.replace(/<[^>]+>/g, '')` for basic tag removal
        - Also extract `<title>` content if present for metadata
     3. For TXT and Markdown: pass through as-is (Markdown syntax is acceptable for stylometric analysis — it is part of the author's voice)
     4. Apply normalization pipeline (NFC, whitespace, line endings, trim)
     5. Compute word count
     6. Return `ParseResult` with metadata (title from HTML `<title>` if available)
3. Write unit tests in `tests/profiles/intake/parsers/text-parser.test.ts`:
   - Parse plain text: returns normalized text
   - Parse HTML: strips tags, extracts title
   - Parse Markdown: passes through with normalization
   - Empty file: returns empty text with warning
   - Different encodings in the buffer: handle gracefully (assume UTF-8)

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/parsers/text-parser.ts` (new, ~70 lines)
- `joyus-ai-mcp-server/tests/profiles/intake/parsers/text-parser.test.ts` (new, ~60 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Text parser tests pass
- [ ] HTML tags are stripped correctly
- [ ] Markdown passes through unchanged (except normalization)
- [ ] Empty files produce a warning

---

## Subtask T026: Create Content-Hash Deduplication Service

**Purpose**: Implement content-hash deduplication that detects and handles duplicate documents within a tenant's corpus.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/intake/dedup.ts`
2. Import `createHash` from `node:crypto`
3. Implement `DeduplicationService` class:
   - `constructor(db: DrizzleClient)`
   - `computeContentHash(normalizedText: string): string`:
     - Compute SHA-256 hash of the normalized text
     - Return hex-encoded hash string
     - This is a pure function — no database interaction
   - `async checkDuplicate(tenantId: string, contentHash: string): Promise<{ isDuplicate: boolean; existingDocumentId?: string; existingFilename?: string }>`:
     - Query `corpus_documents` with `tenantWhere(tenantId)` and `contentHash` match
     - If found: return `{ isDuplicate: true, existingDocumentId, existingFilename }`
     - If not found: return `{ isDuplicate: false }`
   - `async checkDuplicateBatch(tenantId: string, contentHashes: string[]): Promise<Map<string, { isDuplicate: boolean; existingDocumentId?: string }>>`:
     - Batch check for multiple hashes in a single query (IN clause)
     - Return a map of hash -> duplicate status
4. Key design: deduplication operates WITHIN tenant scope only (FR-007). The same document uploaded by two different tenants is NOT a duplicate — each tenant has its own corpus.
5. The `(tenantId, contentHash)` UNIQUE constraint in the database (from WP01) is the ultimate enforcement — the dedup service is an advisory pre-check to provide user-friendly feedback before the insert fails.
6. Write unit tests in `tests/profiles/intake/dedup.test.ts`:
   - Same text produces same hash
   - Different text produces different hash
   - Duplicate detected within same tenant
   - Same text in different tenants: NOT a duplicate
   - Batch check works correctly

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/dedup.ts` (new, ~70 lines)
- `joyus-ai-mcp-server/tests/profiles/intake/dedup.test.ts` (new, ~70 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Dedup tests pass
- [ ] SHA-256 hash is deterministic (same input -> same output)
- [ ] Dedup is tenant-scoped (cross-tenant same-content is NOT a duplicate)
- [ ] Batch check is efficient (single query for multiple hashes)

---

## Subtask T027: Create Intake Orchestrator

**Purpose**: Build the main intake service that orchestrates the full upload-to-snapshot pipeline: receive documents, parse each, deduplicate, store in corpus_documents, and create a corpus snapshot.

**Steps**:
1. Create `joyus-ai-mcp-server/src/profiles/intake/service.ts`
2. Import parser registry, dedup service, corpus snapshot service (from WP02), schema, types, tenant-scope
3. Implement `IntakeService` class:
   - `constructor(db: DrizzleClient, parserRegistry: ParserRegistry, dedupService: DeduplicationService, snapshotService: CorpusSnapshotService, logger: ProfileOperationLogger)`
   - `async ingest(tenantId: string, documents: IntakeDocument[]): Promise<IntakeResult>`:
     1. `requireTenantId(tenantId)`
     2. Initialize result tracking: `{ processed: 0, stored: 0, duplicates: 0, rejected: 0, errors: [], warnings: [], documentIds: [] }`
     3. For each document in the upload:
        a. Check if format is supported via `parserRegistry.isSupported(doc.filename)`
        b. If unsupported: increment `rejected`, add to `errors` with message, CONTINUE to next document (do not block)
        c. Get the parser: `parserRegistry.getParserForFile(doc.filename)`
        d. Parse the document: `parser.parse(doc.buffer, doc.filename)`
        e. If parse result has empty text: increment `rejected`, add warning, continue
        f. Compute content hash: `dedupService.computeContentHash(parseResult.text)`
        g. Check for duplicate: `dedupService.checkDuplicate(tenantId, contentHash)`
        h. If duplicate: increment `duplicates`, add to `warnings` with existing document info, continue
        i. Store in `corpus_documents`: insert row with tenantId, contentHash, filename, format, extracted text, word count, author info, metadata
        j. Increment `stored`, add documentId to list
     4. After all documents processed:
        a. If `stored > 0`: create a corpus snapshot via `snapshotService.createSnapshot(tenantId)`
        b. Log the operation with counts
     5. Return `IntakeResult`
   - `IntakeDocument`: `{ buffer: Buffer; filename: string; authorId?: string; authorName?: string }`
   - `IntakeResult`: `{ processed, stored, duplicates, rejected, errors: string[], warnings: string[], documentIds: string[], snapshotId?: string }`
4. Author attribution: if `authorId` / `authorName` are provided per document, use them. If not, the document is stored with null author — spec edge case says "profile generation is deferred until author attribution is provided or inferred."
5. No-author corpus: all documents stored but flagged. Profile generation will handle the deferral.

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/service.ts` (new, ~150 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Mixed-format upload (PDF, DOCX, TXT) processes all supported files
- [ ] Unsupported format is rejected without blocking others
- [ ] Duplicates are detected and reported
- [ ] Corpus snapshot is created after successful ingestion
- [ ] Author attribution is optional per document

---

## Subtask T028: Add Unsupported Format Handling and Partial Failure Recovery

**Purpose**: Ensure robust handling of unsupported formats, parse failures, and partial upload failures — good files always succeed even when bad files are in the same batch.

**Steps**:
1. Extend `service.ts` with detailed error handling:
   - Each document is processed independently — a failure in one does not affect others
   - Track per-document status: `success`, `duplicate`, `unsupported`, `parse_error`
   - Return a detailed report showing the status of each document in the upload
2. Implement `IntakeDocumentResult` for per-document tracking:
   ```typescript
   interface IntakeDocumentResult {
     filename: string;
     status: 'stored' | 'duplicate' | 'unsupported' | 'parse_error' | 'empty';
     documentId?: string;
     duplicateOf?: string;
     error?: string;
     warnings: string[];
   }
   ```
3. Extend `IntakeResult` to include `documentResults: IntakeDocumentResult[]`
4. Handle edge cases:
   - Zero documents in upload: return immediately with empty result (no snapshot created)
   - All documents are duplicates: no new snapshot, report all as duplicates
   - All documents are unsupported: no new snapshot, report all as rejected
   - Mixed: some succeed, some fail — snapshot is created from successful documents only
5. Write comprehensive unit tests in `tests/profiles/intake/service.test.ts`:
   - Mixed format upload: 2 PDF, 1 DOCX, 1 TXT, 1 unsupported (.xlsx) — 4 stored, 1 rejected
   - Upload with 2 duplicates: 3 stored, 2 duplicate
   - All unsupported: 0 stored, all rejected, no snapshot
   - Parse failure (corrupt PDF): rejected with error, other files succeed
   - Empty upload: immediate return, no snapshot
   - Zero-text document (parsed but empty): rejected with warning
   - Author attribution: documents with and without author info

**Files**:
- `joyus-ai-mcp-server/src/profiles/intake/service.ts` (extend, ~60 lines)
- `joyus-ai-mcp-server/tests/profiles/intake/service.test.ts` (new, ~150 lines)

**Validation**:
- [ ] `npm run typecheck` passes
- [ ] Intake tests pass
- [ ] Unsupported formats are rejected with clear error messages
- [ ] Parse failures are isolated — do not block other documents
- [ ] Per-document result tracking is accurate
- [ ] Snapshot is only created when at least one document is successfully stored
- [ ] NFR-004: 100-document mixed-format upload requires <=2 manual interventions

---

## Definition of Done

- [ ] Document parser interface defined and registry functional
- [ ] PDF parser extracts text via pdf-parse with normalization (FR-006)
- [ ] DOCX parser extracts text via mammoth with normalization (FR-006)
- [ ] TXT/HTML/Markdown parser strips tags (HTML) or passes through with normalization (FR-006)
- [ ] Content-hash deduplication uses SHA-256 on normalized text, scoped per tenant (FR-007)
- [ ] Intake orchestrator processes mixed-format uploads end-to-end
- [ ] Unsupported formats are rejected without blocking valid files (FR-006)
- [ ] Partial failures are handled gracefully with per-document status tracking
- [ ] Corpus snapshot is created from successfully ingested documents
- [ ] All operations are tenant-scoped and logged
- [ ] `pdf-parse` and `mammoth` added to package.json
- [ ] `npm run typecheck` passes with zero errors
- [ ] All unit tests pass: `npx vitest run tests/profiles/intake/`

## Risks

- **PDF text extraction quality**: pdf-parse relies on pdf.js, which varies in quality across PDF generators. Mitigation: normalize aggressively. Add parser warnings for low-confidence extractions.
- **DOCX metadata**: mammoth does not extract title/author from DOCX metadata. Mitigation: warn the user that manual attribution may be needed for DOCX files.
- **Large file buffers**: A 100-document upload with large PDFs could exceed memory. Mitigation: process documents sequentially (not all in memory at once). Stream if needed in future optimization.
- **Hash collision**: SHA-256 collision probability is negligible but document the hashing strategy.

## Reviewer Guidance

- Verify all three parsers apply the SAME normalization pipeline (NFC, whitespace, line endings, trim)
- Verify content hash is computed from NORMALIZED text, not raw file bytes
- Confirm deduplication is tenant-scoped (uses `tenantWhere`)
- Check that unsupported format handling uses continue/skip pattern (not throw)
- Verify the intake orchestrator creates a snapshot only when `stored > 0`
- Confirm `pdf-parse` and `mammoth` are added to `dependencies` (not `devDependencies`)
- Check that per-document result tracking covers all status values
