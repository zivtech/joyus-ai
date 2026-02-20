"""Corpus loading: unified interface for ingesting documents from multiple sources."""

from __future__ import annotations

import logging
from pathlib import Path

from cuid2 import cuid_wrapper

from joyus_profile.exceptions import CorpusError, InsufficientCorpusError
from joyus_profile.ingest.formats import EXTENSION_MAP, detect_format, extract_text
from joyus_profile.models.corpus import Corpus, Document, DocumentMetadata

logger = logging.getLogger(__name__)

_cuid = cuid_wrapper()

MINIMUM_DOCUMENTS = 5


class CorpusLoader:
    """Load documents from files, directories, URLs, or raw text into a Corpus."""

    def __init__(self, *, minimum_documents: int = MINIMUM_DOCUMENTS) -> None:
        self.minimum_documents = minimum_documents

    def load_directory(
        self,
        path: str,
        formats: list[str] | None = None,
    ) -> Corpus:
        """Load all supported documents from a directory.

        Args:
            path: Directory path to scan.
            formats: Optional list of extensions to include (e.g. [".txt", ".md"]).
                     Defaults to all supported formats.
        """
        dir_path = Path(path)
        if not dir_path.is_dir():
            raise CorpusError(f"Directory not found: {path}")

        allowed_exts = set(formats) if formats else set(EXTENSION_MAP.keys())
        documents: list[Document] = []

        for file_path in sorted(dir_path.iterdir()):
            if not file_path.is_file():
                continue
            if file_path.suffix.lower() not in allowed_exts:
                continue
            try:
                doc = self._load_single_file(str(file_path))
                documents.append(doc)
            except Exception:
                logger.warning("Skipping %s: extraction failed", file_path)

        return self._build_corpus(documents)

    def load_files(self, paths: list[str]) -> Corpus:
        """Load specific files by path."""
        documents: list[Document] = []
        for p in paths:
            if not Path(p).is_file():
                logger.warning("Skipping %s: file not found", p)
                continue
            try:
                doc = self._load_single_file(p)
                documents.append(doc)
            except Exception:
                logger.warning("Skipping %s: extraction failed", p)
        return self._build_corpus(documents)

    def load_text(
        self,
        text: str,
        metadata: dict | None = None,
    ) -> Corpus:
        """Wrap raw text as a single-document Corpus."""
        meta = metadata or {}
        word_count = len(text.split())
        doc = Document(
            doc_id=_cuid(),
            text=text,
            metadata=DocumentMetadata(
                title=meta.get("title"),
                author=meta.get("author"),
                word_count=word_count,
            ),
        )
        return self._build_corpus([doc])

    def load_urls(self, urls: list[str]) -> Corpus:
        """Fetch and extract text from URLs."""
        try:
            import trafilatura
        except ImportError as exc:
            raise CorpusError("trafilatura required for URL loading") from exc

        documents: list[Document] = []
        for url in urls:
            try:
                downloaded = trafilatura.fetch_url(url)
                if downloaded is None:
                    logger.warning("Skipping %s: fetch returned nothing", url)
                    continue
                text = trafilatura.extract(downloaded) or ""
                if not text.strip():
                    logger.warning("Skipping %s: no text extracted", url)
                    continue
                word_count = len(text.split())
                doc = Document(
                    doc_id=_cuid(),
                    text=text,
                    metadata=DocumentMetadata(
                        source_url=url,
                        word_count=word_count,
                    ),
                )
                documents.append(doc)
            except Exception:
                logger.warning("Skipping %s: extraction failed", url)

        return self._build_corpus(documents)

    def _load_single_file(self, path: str) -> Document:
        """Load a single file into a Document."""
        fmt = detect_format(path)
        text = extract_text(path, fmt)
        word_count = len(text.split())
        return Document(
            doc_id=_cuid(),
            text=text,
            metadata=DocumentMetadata(
                source_path=path,
                title=Path(path).stem,
                format=fmt,
                word_count=word_count,
            ),
        )

    def _build_corpus(self, documents: list[Document]) -> Corpus:
        """Build a Corpus from a list of documents, checking minimum threshold."""
        if len(documents) < self.minimum_documents:
            logger.warning(
                "Corpus has %d document(s), below minimum of %d",
                len(documents),
                self.minimum_documents,
            )
            raise InsufficientCorpusError(len(documents), self.minimum_documents)

        total_words = sum(d.metadata.word_count for d in documents)
        return Corpus(
            documents=documents,
            total_words=total_words,
            total_documents=len(documents),
        )
