"""Text preprocessing: normalization, boilerplate removal, and chunking."""

from __future__ import annotations

import re
import unicodedata

from cuid2 import cuid_wrapper

from joyus_profile.models.corpus import Chunk, Corpus, ProcessedCorpus

_cuid = cuid_wrapper()

# Target chunk size in words
MIN_CHUNK_WORDS = 500
MAX_CHUNK_WORDS = 1000


class Preprocessor:
    """Normalize and segment corpus documents into analysis-ready chunks."""

    def __init__(
        self,
        *,
        min_chunk_words: int = MIN_CHUNK_WORDS,
        max_chunk_words: int = MAX_CHUNK_WORDS,
    ) -> None:
        self.min_chunk_words = min_chunk_words
        self.max_chunk_words = max_chunk_words

    def process(self, corpus: Corpus) -> ProcessedCorpus:
        """Process an entire corpus into normalized, chunked form."""
        chunks: list[Chunk] = []
        for doc in corpus.documents:
            text = self._normalize(doc.text)
            text = self._clean_boilerplate(text)
            doc_chunks = self._segment(text, doc.doc_id)
            chunks.extend(doc_chunks)

        total_words = sum(c.word_count for c in chunks)
        return ProcessedCorpus(
            corpus=corpus,
            chunks=chunks,
            total_chunks=len(chunks),
            avg_chunk_words=total_words / max(len(chunks), 1),
        )

    def _normalize(self, text: str) -> str:
        """Unicode normalization, whitespace collapse, quote/dash normalization."""
        # NFKC normalization
        text = unicodedata.normalize("NFKC", text)

        # Normalize line endings
        text = text.replace("\r\n", "\n").replace("\r", "\n")

        # Normalize quotes
        text = text.replace("\u2018", "'").replace("\u2019", "'")  # single curly
        text = text.replace("\u201c", '"').replace("\u201d", '"')  # double curly

        # Normalize dashes
        text = text.replace("\u2013", "\u2014")  # en-dash to em-dash

        # Collapse multiple spaces (but preserve paragraph breaks)
        text = re.sub(r"[^\S\n]+", " ", text)

        # Collapse 3+ newlines into 2
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    def _clean_boilerplate(self, text: str) -> str:
        """Remove common boilerplate patterns."""
        # Page numbers (standalone lines like "Page 1", "- 1 -", "1")
        text = re.sub(r"^(?:Page\s+)?\d+(?:\s*[-–—]\s*\d+)?$", "", text, flags=re.MULTILINE)
        text = re.sub(r"^[-–—]\s*\d+\s*[-–—]$", "", text, flags=re.MULTILINE)

        # Copyright notices
        text = re.sub(
            r"^(?:Copyright|©).*?\d{4}.*$", "", text, flags=re.MULTILINE | re.IGNORECASE
        )

        # "Table of Contents" sections (header + indented lines until next heading)
        text = re.sub(
            r"(?:^Table of Contents\s*\n)(?:.*\n)*?(?=\n[A-Z]|\Z)",
            "",
            text,
            flags=re.MULTILINE | re.IGNORECASE,
        )

        # Collapse resulting blank lines
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    def _segment(self, text: str, doc_id: str) -> list[Chunk]:
        """Split text into chunks at paragraph boundaries."""
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        if not paragraphs:
            return []

        chunks: list[Chunk] = []
        current_paragraphs: list[str] = []
        current_word_count = 0
        current_start = 0

        for para in paragraphs:
            para_words = len(para.split())

            # If adding this paragraph exceeds max and we have content, flush
            if (
                current_word_count + para_words > self.max_chunk_words
                and current_word_count >= self.min_chunk_words
            ):
                chunk_text = "\n\n".join(current_paragraphs)
                chunks.append(
                    Chunk(
                        chunk_id=_cuid(),
                        doc_id=doc_id,
                        text=chunk_text,
                        start_offset=current_start,
                        end_offset=current_start + len(chunk_text),
                        word_count=current_word_count,
                    )
                )
                current_start += len(chunk_text) + 2  # +2 for paragraph separator
                current_paragraphs = []
                current_word_count = 0

            current_paragraphs.append(para)
            current_word_count += para_words

        # Flush remaining paragraphs
        if current_paragraphs:
            chunk_text = "\n\n".join(current_paragraphs)
            chunks.append(
                Chunk(
                    chunk_id=_cuid(),
                    doc_id=doc_id,
                    text=chunk_text,
                    start_offset=current_start,
                    end_offset=current_start + len(chunk_text),
                    word_count=current_word_count,
                )
            )

        return chunks
