---
work_package_id: WP02
title: Corpus Ingestion
lane: planned
dependencies: [WP01]
subtasks: [T008, T009, T010, T011]
history:
- date: '2026-02-19'
  action: created
  by: spec-kitty.tasks
---

# WP02: Corpus Ingestion

## Objective

Build the document ingestion pipeline: load documents from multiple sources and formats, preprocess into normalized chunks ready for feature extraction.

## Implementation Command

```bash
spec-kitty implement WP02 --base WP01
```

## Context

- **Plan**: plan.md §A.2
- **API Contract**: contracts/profile-engine-api.md §Ingest
- **Data Models**: From WP01 — `Corpus`, `ProcessedCorpus`, `Document`, `Chunk`, `DocumentMetadata`

---

## Subtask T008: Implement CorpusLoader

**Purpose**: Unified interface for loading documents from files, directories, URLs, and raw text.

**Steps**:
1. Create `joyus_profile/ingest/loader.py`
2. Implement `CorpusLoader` class with methods:
   - `load_directory(path: str, formats: list[str] | None = None) -> Corpus`: Glob for supported file types, load each
   - `load_files(paths: list[str]) -> Corpus`: Load specific files
   - `load_urls(urls: list[str]) -> Corpus`: Fetch and extract text from URLs
   - `load_text(text: str, metadata: dict | None = None) -> Corpus`: Wrap raw text as a Corpus
3. Each method should:
   - Detect format from file extension
   - Delegate to format-specific extractors (T009)
   - Assign CUID2 doc_ids
   - Calculate word_count per document
   - Return a `Corpus` with `total_words` and `total_documents` computed
4. Raise `CorpusError` on loading failures (define in `joyus_profile/exceptions.py`)
5. Raise `InsufficientCorpusError` if fewer than 5 documents (with warning level for partial profiles)

**Files**:
- `joyus_profile/ingest/loader.py` (new, ~120 lines)
- `joyus_profile/exceptions.py` (new, ~40 lines — all typed exceptions)

**Validation**:
- [ ] `load_directory` finds and loads .txt, .md, .pdf, .docx, .html files
- [ ] `load_text` wraps a raw string with correct metadata
- [ ] `InsufficientCorpusError` raised for <5 documents

---

## Subtask T009: Format Extractors

**Purpose**: Extract clean text from PDF, DOCX, HTML, Markdown, and plain text files.

**Steps**:
1. Create `joyus_profile/ingest/formats.py`
2. Implement extractors:

   **PDF (PyMuPDF/fitz)**:
   ```python
   def extract_pdf(path: str) -> str:
       import fitz
       doc = fitz.open(path)
       return "\n\n".join(page.get_text() for page in doc)
   ```

   **DOCX (python-docx)**:
   ```python
   def extract_docx(path: str) -> str:
       from docx import Document
       doc = Document(path)
       return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
   ```

   **HTML (BeautifulSoup + trafilatura)**:
   ```python
   def extract_html(path_or_content: str) -> str:
       import trafilatura
       return trafilatura.extract(path_or_content) or ""
   ```

   **Markdown**: Strip markdown syntax (headers `#`, bold `**`, links `[]()`) or use `markdown-it-py` for clean text extraction.

   **Plain text**: Read directly, normalize line endings.

3. Create a dispatch function:
   ```python
   def extract_text(path: str, format: DocumentFormat) -> str:
       extractors = {
           DocumentFormat.PDF: extract_pdf,
           DocumentFormat.DOCX: extract_docx,
           DocumentFormat.HTML: extract_html,
           DocumentFormat.MARKDOWN: extract_markdown,
           DocumentFormat.TEXT: extract_text_file,
       }
       return extractors[format](path)
   ```

**Files**:
- `joyus_profile/ingest/formats.py` (new, ~100 lines)

**Validation**:
- [ ] PDF extraction returns readable text (test with a simple PDF fixture)
- [ ] DOCX extraction returns paragraph text without formatting
- [ ] HTML extraction strips navigation, headers, footers (trafilatura handles this)
- [ ] Markdown extraction produces clean prose

---

## Subtask T010: Implement Preprocessor

**Purpose**: Normalize and segment documents into analysis-ready chunks.

**Steps**:
1. Create `joyus_profile/ingest/preprocessor.py`
2. Implement `Preprocessor` class:
   ```python
   class Preprocessor:
       def process(self, corpus: Corpus) -> ProcessedCorpus:
           chunks = []
           for doc in corpus.documents:
               text = self._normalize(doc.text)
               text = self._clean_boilerplate(text)
               doc_chunks = self._segment(text, doc.doc_id)
               chunks.extend(doc_chunks)
           return ProcessedCorpus(
               corpus=corpus,
               chunks=chunks,
               total_chunks=len(chunks),
               avg_chunk_words=sum(c.word_count for c in chunks) / max(len(chunks), 1),
           )
   ```
3. `_normalize`: Unicode normalization (NFKC), collapse whitespace, normalize quotes/dashes
4. `_clean_boilerplate`: Remove headers/footers patterns (page numbers, copyright notices, "Table of Contents" sections). Use heuristics, not ML.
5. `_segment`: Split into chunks of ~500-1000 words at paragraph boundaries. Each chunk gets a `Chunk` model with offsets.

**Files**:
- `joyus_profile/ingest/preprocessor.py` (new, ~100 lines)

**Validation**:
- [ ] Normalization collapses `\r\n` → `\n`, curly quotes → straight, em-dash → `—`
- [ ] Chunks respect paragraph boundaries (no mid-sentence splits)
- [ ] Chunk word counts are in the 500-1000 range

---

## Subtask T011: Unit Tests for Ingestion

**Purpose**: Verify all ingestion components work correctly.

**Steps**:
1. Create `tests/unit/test_ingest/test_loader.py`:
   - Test `load_directory` with fixtures/example/
   - Test `load_text` with raw string
   - Test `InsufficientCorpusError` for <5 documents
2. Create `tests/unit/test_ingest/test_formats.py`:
   - Test each extractor with a minimal fixture file
   - Test format detection from file extension
3. Create `tests/unit/test_ingest/test_preprocessor.py`:
   - Test normalization (unicode, whitespace)
   - Test chunking (boundaries, word counts)
   - Test round-trip: load → preprocess → access chunks
4. Create minimal test fixtures:
   - `fixtures/example/test.pdf` (simple 1-page PDF)
   - `fixtures/example/test.docx` (simple 1-page doc)
   - `fixtures/example/test.html` (simple article)

**Files**:
- `tests/unit/test_ingest/test_loader.py` (new, ~80 lines)
- `tests/unit/test_ingest/test_formats.py` (new, ~60 lines)
- `tests/unit/test_ingest/test_preprocessor.py` (new, ~60 lines)
- Fixture files as needed

**Validation**:
- [ ] `pytest tests/unit/test_ingest/ -v` — all tests pass
- [ ] Coverage: all public methods of CorpusLoader, Preprocessor tested

---

## Definition of Done

- [ ] `CorpusLoader().load_directory("fixtures/example/")` returns a valid Corpus
- [ ] All 5 format extractors work (PDF, DOCX, HTML, MD, TXT)
- [ ] `Preprocessor().process(corpus)` returns ProcessedCorpus with chunks
- [ ] All unit tests pass
- [ ] No ruff/mypy errors in `joyus_profile/ingest/`

## Risks

- **PDF quality**: Scanned PDFs produce gibberish — PyMuPDF handles text-based PDFs only. Document this limitation.
- **trafilatura availability**: May have C dependencies that fail on some systems. Fall back to BeautifulSoup `get_text()` if needed.
- **URL loading**: Network-dependent — mock in tests, handle timeouts gracefully.
