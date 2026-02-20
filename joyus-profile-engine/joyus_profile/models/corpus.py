"""Corpus ingestion data models."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class DocumentFormat(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    HTML = "html"
    MARKDOWN = "md"
    TEXT = "txt"


class DocumentMetadata(BaseModel):
    """Metadata for a single source document."""

    source_path: str | None = None
    source_url: str | None = None
    author: str | None = None
    title: str | None = None
    format: DocumentFormat = DocumentFormat.TEXT
    word_count: int = 0
    created_at: datetime | None = None


class Document(BaseModel):
    """A single document in a corpus."""

    doc_id: str
    text: str
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)


class Chunk(BaseModel):
    """A text chunk extracted from a document."""

    chunk_id: str
    doc_id: str
    text: str
    start_offset: int
    end_offset: int
    word_count: int


class Corpus(BaseModel):
    """A collection of documents for analysis."""

    documents: list[Document] = Field(default_factory=list)
    total_words: int = 0
    total_documents: int = 0


class ProcessedCorpus(BaseModel):
    """A corpus that has been preprocessed and chunked."""

    corpus: Corpus
    chunks: list[Chunk] = Field(default_factory=list)
    total_chunks: int = 0
    avg_chunk_words: float = 0.0
