"""Structure analysis: document and paragraph structural patterns."""

from __future__ import annotations

import re

from joyus_profile.models.corpus import ProcessedCorpus
from joyus_profile.models.features import StructuralPatterns


class StructureAnalyzer:
    """Extract document-level and paragraph-level structural patterns."""

    def extract(self, corpus: ProcessedCorpus) -> StructuralPatterns:
        """Analyze structural patterns across the corpus."""
        texts = [doc.text for doc in corpus.corpus.documents]
        if not texts:
            return StructuralPatterns()

        para_lengths: list[int] = []
        paras_per_doc: list[int] = []
        heading_count = 0
        list_item_count = 0
        citation_count = 0
        total_words = 0

        for text in texts:
            paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
            paras_per_doc.append(len(paragraphs))

            for para in paragraphs:
                words = para.split()
                word_count = len(words)
                para_lengths.append(word_count)
                total_words += word_count

                # Detect headings (lines that are short and possibly capitalized/numbered)
                lines = para.split("\n")
                for line in lines:
                    stripped = line.strip()
                    if self._is_heading(stripped):
                        heading_count += 1
                    if self._is_list_item(stripped):
                        list_item_count += 1

                # Count citations
                citation_count += self._count_citations(para)

        num_paras = len(para_lengths)
        avg_para_length = sum(para_lengths) / num_paras if num_paras else 0.0
        avg_paras = sum(paras_per_doc) / len(paras_per_doc) if paras_per_doc else 0.0
        heading_freq = heading_count / num_paras if num_paras else 0.0
        list_ratio = list_item_count / num_paras if num_paras else 0.0
        citation_dens = (citation_count / total_words * 1000) if total_words else 0.0

        return StructuralPatterns(
            avg_paragraph_length=avg_para_length,
            avg_paragraphs_per_doc=avg_paras,
            heading_frequency=heading_freq,
            list_usage_ratio=list_ratio,
            citation_density=citation_dens,
        )

    def _is_heading(self, line: str) -> bool:
        """Heuristic: short line, possibly numbered or all-caps."""
        if not line or len(line) > 100:
            return False
        words = line.split()
        if len(words) > 10:
            return False
        # Markdown-style heading
        if line.startswith("#"):
            return True
        # Numbered heading (e.g., "1. Introduction", "Section 2")
        if re.match(r"^\d+[\.\)]\s+\w", line):
            return True
        # All caps short line
        if line.isupper() and len(words) <= 6:
            return True
        return False

    def _is_list_item(self, line: str) -> bool:
        """Detect list items (bulleted, numbered, lettered)."""
        return bool(
            re.match(r"^\s*[-*+•]\s+", line)
            or re.match(r"^\s*\(?[a-z0-9]+[\.\)]\s+", line)
        )

    def _count_citations(self, text: str) -> int:
        """Count citation-like references in text."""
        patterns = [
            r"\(\d{4}\)",  # (2024)
            r"\b\d+\s+U\.S\.\s+\d+",  # 123 U.S. 456
            r"\b\d+\s+F\.\s*\d*d\s+\d+",  # 123 F.2d 456
            r"\bid\.\s",  # Id.
            r"\bsupra\b",  # supra
            r"\binfra\b",  # infra
            r"\bsee\s+also\b",  # see also
            r"\bcf\.\b",  # cf.
            r"\[\d+\]",  # [1] style citations
        ]
        count = 0
        for pattern in patterns:
            count += len(re.findall(pattern, text, re.IGNORECASE))
        return count
