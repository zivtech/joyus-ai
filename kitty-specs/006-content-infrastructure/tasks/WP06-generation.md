---
work_package_id: WP06
title: Content-Aware Generation
lane: "done"
dependencies: []
base_branch: 006-content-infrastructure-WP01
base_commit: ad3ac9985edbc8dfbdeb1616fb5329168797f97f
created_at: '2026-02-21T12:42:00.598601+00:00'
subtasks: [T027, T028, T029, T030]
shell_pid: "98102"
reviewed_by: "Alex Urevick-Ackelsberg"
review_status: "approved"
history:
- date: '2026-02-21'
  action: created
  by: spec-kitty.tasks
---

# WP06: Content-Aware Generation

## Objective

Build the content-aware generation pipeline: retrieve relevant content from accessible sources, apply voice profiles, generate AI responses with source citations, and log everything for audit.

## Implementation Command

```bash
spec-kitty implement WP06 --base WP05
```

(WP04 and WP05 must both be merged. Use `--base WP05` as the later merge.)

## Context

- **Spec**: `kitty-specs/006-content-infrastructure/spec.md` (FR-015 through FR-017, SC-005)
- **Research**: `kitty-specs/006-content-infrastructure/research.md` (§R6: Generation Architecture)
- **Contracts**: `kitty-specs/006-content-infrastructure/contracts/content-tools.yaml` (content_generate tool)

The generation pipeline is shared by MCP tools (WP07) and the mediation API (WP09). Both paths call the same retriever → generator → citation pipeline. The generator is model-agnostic per §2.6.

---

## Subtask T027: Create Content Retriever

**Purpose**: Search for relevant content filtered by user entitlements, rank by relevance, and assemble context for generation.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/generation/retriever.ts`
2. Implement:
   ```typescript
   export class ContentRetriever {
     constructor(
       private searchService: SearchService,
       private db: DrizzleClient
     ) {}

     async retrieve(
       query: string,
       entitlements: ResolvedEntitlements,
       options?: { sourceIds?: string[]; maxSources?: number }
     ): Promise<RetrievalResult> {
       // 1. Search via SearchService (entitlement-filtered)
       // 2. Limit to maxSources (default 5) top results
       // 3. Fetch full content for each result (if body is null, on-demand fetch)
       // 4. Assemble into RetrievalResult with sources and context text
     }
   }

   export interface RetrievalResult {
     items: RetrievedItem[];
     contextText: string;  // Assembled text for generation prompt
     totalSearchResults: number;
   }

   export interface RetrievedItem {
     itemId: string;
     sourceId: string;
     title: string;
     body: string;
     metadata: Record<string, unknown>;
   }
   ```
3. `contextText` format: numbered source blocks that the generator can reference
   ```
   [Source 1: "Title"] Content excerpt...
   [Source 2: "Title"] Content excerpt...
   ```

**Files**:
- `joyus-ai-mcp-server/src/content/generation/retriever.ts` (new, ~80 lines)

**Validation**:
- [ ] Only retrieves from entitled sources
- [ ] Respects maxSources limit
- [ ] Fetches full content for pass-through items
- [ ] Formats context text with source markers

---

## Subtask T028: Create Voice-Consistent Generator

**Purpose**: Generate AI responses using retrieved content and voice profiles. Model-agnostic design.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/generation/generator.ts`
2. Define the generation interface (model-agnostic per §2.6):
   ```typescript
   export interface GenerationProvider {
     generate(prompt: string, systemPrompt: string): Promise<string>;
   }
   ```
3. Implement `ContentGenerator`:
   ```typescript
   export class ContentGenerator {
     constructor(private provider: GenerationProvider) {}

     async generate(
       query: string,
       retrieval: RetrievalResult,
       profileId?: string
     ): Promise<GenerationOutput> {
       // 1. Build system prompt:
       //    - Include voice profile instructions (if profileId provided)
       //    - Include retrieved content as reference material
       //    - Include citation instructions ("cite sources using [Source N] format")
       // 2. Build user prompt from query
       // 3. Call provider.generate(userPrompt, systemPrompt)
       // 4. Return raw generation text + metadata
     }
   }

   export interface GenerationOutput {
     text: string;
     profileUsed: string | null;
     sourcesProvided: number;
   }
   ```
4. Ship a placeholder `GenerationProvider` that returns a formatted message indicating generation is not yet configured (actual AI model integration is infrastructure setup, not this WP's scope)
5. The system prompt template should instruct the model to:
   - Use the provided reference material to answer the query
   - Cite sources using `[Source N]` markers matching the retrieval context
   - Apply voice profile characteristics if provided
   - Never reference content not in the provided sources

**Files**:
- `joyus-ai-mcp-server/src/content/generation/generator.ts` (new, ~100 lines)

**Validation**:
- [ ] System prompt includes voice profile instructions when profileId provided
- [ ] System prompt includes all retrieved sources
- [ ] Citation format instructions are clear
- [ ] Provider interface is model-agnostic (no Anthropic-specific code)

---

## Subtask T029: Create Citation Manager

**Purpose**: Extract source citations from generated text and return structured citation metadata.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/generation/citations.ts`
2. Implement:
   ```typescript
   export class CitationManager {
     extractCitations(
       generatedText: string,
       retrievedItems: RetrievedItem[]
     ): CitationResult {
       // 1. Parse [Source N] markers from generated text
       // 2. Match each marker to the corresponding RetrievedItem
       // 3. Build Citation objects with sourceId, itemId, title, excerpt
       // 4. Return cleaned text (markers replaced with footnote-style refs) + citations array
     }
   }

   export interface CitationResult {
     text: string;         // Generated text with formatted citations
     citations: Citation[];
     citationCount: number;
   }
   ```
3. Handle edge cases:
   - Generator references a source not in retrieved items → skip citation, log warning
   - No citations found → return text as-is with empty citations array
   - Duplicate references → deduplicate in citations array

**Files**:
- `joyus-ai-mcp-server/src/content/generation/citations.ts` (new, ~70 lines)

**Validation**:
- [ ] Correctly parses `[Source N]` markers
- [ ] Maps markers to retrieved items
- [ ] Handles missing/invalid references gracefully
- [ ] Deduplicates citations

---

## Subtask T030: Create Generation Audit Logging

**Purpose**: Log every generation request for audit and drift monitoring.

**Steps**:
1. Create `joyus-ai-mcp-server/src/content/generation/index.ts`
2. Implement `GenerationService` that orchestrates the full pipeline:
   ```typescript
   export class GenerationService {
     constructor(
       private retriever: ContentRetriever,
       private generator: ContentGenerator,
       private citationManager: CitationManager,
       private db: DrizzleClient
     ) {}

     async generate(
       query: string,
       userId: string,
       tenantId: string,
       entitlements: ResolvedEntitlements,
       options?: GenerateOptions
     ): Promise<GenerationResult> {
       // 1. Retrieve relevant content
       // 2. Generate with voice profile
       // 3. Extract citations
       // 4. Log to generation_logs table
       // 5. Return result
     }
   }
   ```
3. GenerationLog record includes: tenantId, userId, sessionId, profileId, query, sourcesUsed (item IDs), citationCount, responseLength
4. `driftScore` is left null — populated later by drift monitoring (WP10)

**Files**:
- `joyus-ai-mcp-server/src/content/generation/index.ts` (new, ~100 lines)

**Validation**:
- [ ] Full pipeline: retrieve → generate → cite → log
- [ ] GenerationLog record created for every generation
- [ ] Sources used tracked as JSONB array of item IDs
- [ ] SC-005: At least one citation when relevant content exists

---

## Definition of Done

- [ ] Content retriever searches and assembles context from entitled sources
- [ ] Generator applies voice profiles and citation instructions
- [ ] Citation manager extracts and structures source references
- [ ] Every generation logged for audit
- [ ] Pipeline is model-agnostic (GenerationProvider interface)
- [ ] `npm run typecheck` passes

## Risks

- **Citation parsing reliability**: LLM output format may vary. Citation extraction must be robust to formatting variations.
- **Voice profile integration**: Profile engine is in a separate private repo. This WP defines the interface; actual profile data loading is a deployment concern.

## Reviewer Guidance

- Verify generation is model-agnostic (no hardcoded model calls)
- Check citation extraction handles edge cases (no citations, invalid refs)
- Confirm audit log captures all required fields
- Verify entitlement filtering in retrieval (no unauthorized content in generation context)

## Activity Log

- 2026-02-21T12:52:59Z – unknown – shell_pid=98102 – lane=done – Generation pipeline: retriever, generator, citations, audit
