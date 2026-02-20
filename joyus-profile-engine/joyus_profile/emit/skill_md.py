"""Generate human/Claude-readable SKILL.md from an AuthorProfile."""

from __future__ import annotations

from joyus_profile.models.profile import AuthorProfile


def generate_skill_md(profile: AuthorProfile) -> str:
    """Render a structured Markdown skill file from a profile."""
    sections: list[str] = []

    # Header
    sections.append(f"# Writing Profile: {profile.author_name}\n")
    sections.append(
        f"**Domain**: {profile.domain} | "
        f"**Fidelity**: Tier {profile.fidelity_tier} | "
        f"**Confidence**: {profile.confidence}"
    )
    sections.append(
        f"**Corpus**: {profile.corpus_size} documents, "
        f"{profile.word_count:,} words\n"
    )

    # §1 Identity & Background
    sections.append("## Identity & Background\n")
    identity = profile.identity
    if identity.role:
        sections.append(f"- **Role**: {identity.role}")
    if identity.organization:
        sections.append(f"- **Organization**: {identity.organization}")
    if identity.background:
        sections.append(f"- **Background**: {identity.background}")
    if identity.expertise_areas:
        sections.append(
            f"- **Expertise**: {', '.join(identity.expertise_areas)}"
        )
    if not any([identity.role, identity.organization, identity.background]):
        sections.append("_Not specified._")
    sections.append("")

    # §2 Expertise Domains
    sections.append("## Expertise Domains\n")
    if profile.expertise.primary:
        sections.append(
            f"- **Primary**: {', '.join(profile.expertise.primary)}"
        )
    if profile.expertise.secondary:
        sections.append(
            f"- **Secondary**: {', '.join(profile.expertise.secondary[:10])}"
        )
    if not profile.expertise.primary and not profile.expertise.secondary:
        sections.append("_General domain._")
    sections.append("")

    # §3 Positions & Stances
    sections.append("## Positions & Stances\n")
    if profile.positions:
        for pos in profile.positions[:10]:
            strength_label = (
                "strong" if pos.strength >= 0.7
                else "moderate" if pos.strength >= 0.4
                else "mild"
            )
            sections.append(
                f"- **{pos.topic}**: {pos.stance} ({strength_label})"
            )
    else:
        sections.append("_No strong positions detected._")
    sections.append("")

    # §4 Voice & Tone
    sections.append("## Voice & Tone\n")
    sections.append(f"- **Formality**: {profile.voice.formality}/10")
    if profile.voice.tone_descriptors:
        sections.append(
            f"- **Tone**: {', '.join(profile.voice.tone_descriptors)}"
        )
    if profile.voice.emotion != 5.0:
        sections.append(f"- **Emotion**: {profile.voice.emotion}/10")
    if profile.voice.directness != 5.0:
        sections.append(f"- **Directness**: {profile.voice.directness}/10")
    if profile.voice.complexity != 5.0:
        sections.append(f"- **Complexity**: {profile.voice.complexity}/10")
    sections.append("")

    # §5 Structure
    sections.append("## Document Structure\n")
    s = profile.structure
    if s.avg_paragraph_length > 0:
        sections.append(
            f"- **Avg paragraph length**: {s.avg_paragraph_length:.1f} words"
        )
        sections.append(
            f"- **Avg paragraphs per doc**: {s.avg_paragraphs_per_doc:.1f}"
        )
        if s.heading_frequency > 0:
            sections.append(
                f"- **Heading frequency**: {s.heading_frequency:.2f}"
            )
        if s.list_usage_ratio > 0:
            sections.append(
                f"- **List usage ratio**: {s.list_usage_ratio:.2f}"
            )
    else:
        sections.append("_No structural data._")
    sections.append("")

    # §6 Vocabulary
    sections.append("## Vocabulary\n")
    v = profile.vocabulary
    if v.signature_phrases:
        sections.append("### Signature Phrases")
        for phrase in v.signature_phrases[:15]:
            sections.append(f"- {phrase}")
        sections.append("")
    if v.preferred_terms:
        sections.append("### Preferred Terms")
        for term in v.preferred_terms[:15]:
            sections.append(f"- {term}")
        sections.append("")
    if v.avoided_terms:
        sections.append("### Avoided Terms")
        for term in v.avoided_terms[:10]:
            sections.append(f"- {term}")
        sections.append("")
    if v.technical_terms:
        sections.append("### Technical Terms")
        for term in v.technical_terms[:10]:
            sections.append(f"- {term}")
        sections.append("")
    if not any([v.signature_phrases, v.preferred_terms, v.technical_terms]):
        sections.append("_No vocabulary data._\n")

    # §7 Argumentation
    sections.append("## Argumentation Patterns\n")
    a = profile.argumentation
    if a.evidence_types:
        sections.append(
            f"- **Evidence types**: {', '.join(a.evidence_types)}"
        )
    if a.reasoning_patterns:
        sections.append("- **Reasoning patterns**:")
        for pat in a.reasoning_patterns[:5]:
            sections.append(f"  - {pat}")
    if not a.evidence_types and not a.reasoning_patterns:
        sections.append("_No argumentation data._")
    sections.append("")

    # §8 Citations
    sections.append("## Citation Style\n")
    c = profile.citations
    if c.citation_frequency > 0:
        sections.append(
            f"- **Citation density**: {c.citation_frequency:.2f} per 1000 words"
        )
    if c.citation_style:
        sections.append(f"- **Style**: {c.citation_style}")
    if c.preferred_sources:
        sections.append(
            f"- **Preferred sources**: {', '.join(c.preferred_sources[:5])}"
        )
    if c.citation_frequency == 0 and not c.citation_style:
        sections.append("_No citation data._")
    sections.append("")

    # §9 Anti-Patterns
    sections.append("## Anti-Patterns (Never Do)\n")
    ap = profile.anti_patterns
    if ap.never_do:
        for item in ap.never_do[:10]:
            sections.append(f"- Do not use: \"{item}\"")
    if ap.common_ai_mistakes:
        sections.append("\n### Common AI Mistakes")
        for item in ap.common_ai_mistakes[:5]:
            sections.append(f"- {item}")
    if ap.prohibited_phrases:
        sections.append("\n### Prohibited Phrases")
        for item in ap.prohibited_phrases[:5]:
            sections.append(f"- \"{item}\"")
    if not ap.never_do and not ap.common_ai_mistakes:
        sections.append("_No anti-patterns identified._")
    sections.append("")

    # §10 Examples (reference only)
    sections.append("## Example Outputs\n")
    ex = profile.examples
    if ex.good_examples:
        sections.append("### Good Examples")
        for i, example in enumerate(ex.good_examples[:3], 1):
            sections.append(f"{i}. {example[:200]}")
        sections.append("")
    if ex.bad_examples:
        sections.append("### Bad Examples (Avoid)")
        for i, example in enumerate(ex.bad_examples[:3], 1):
            sections.append(f"{i}. {example[:200]}")
        sections.append("")
    if not ex.good_examples and not ex.bad_examples:
        sections.append("_No examples available._\n")

    # §11 Edge Cases
    sections.append("## Edge Cases\n")
    if profile.edge_cases:
        for ec in profile.edge_cases[:10]:
            sections.append(f"- **{ec.scenario}**: {ec.guidance}")
    else:
        sections.append("_No edge cases specified._")
    sections.append("")

    # §12 Validation
    sections.append("## Validation Criteria\n")
    val = profile.validation
    sections.append(
        f"- **Minimum fidelity score**: {val.minimum_fidelity_score}"
    )
    if val.required_markers:
        sections.append("- **Required markers**:")
        for marker in val.required_markers[:5]:
            sections.append(f"  - {marker}")
    if val.self_check_questions:
        sections.append("- **Self-check questions**:")
        for q in val.self_check_questions:
            sections.append(f"  - {q}")
    sections.append("")

    return "\n".join(sections)
