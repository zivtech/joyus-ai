# Content Intelligence — Feature Specification

**Feature:** 005-content-intelligence
**Date:** February 18, 2026
**Status:** Specification Draft
**Depends on:** Profile Engine library (spec/profile-engine-spec.md), Platform core (002, 004)
**Constitution references:** §2.2 Skills as Encoded Knowledge, §2.4 Monitor Everything, §2.5 Feedback Loops, §2.7 Automated Pipelines, §2.9 Assumption Awareness, §3.2 Compliance Framework Awareness

---

## 1. Purpose

Three interconnected systems that give organizations the ability to:

1. **Validate** whether a piece of text is authentically theirs — at the person, department, or organizational level
2. **Generate** new content that matches a specific person's, department's, or organization's voice and positions
3. **Monitor** the fidelity of generated content over time and initiate repair when quality degrades

These systems encode organizational knowledge as testable, enforceable skills — the core value proposition of the Joyus AI platform (Constitution §2.2).

### Beyond the first use case: Self-service profile building

While the legal advocacy org drives the high-fidelity (Tier 4) requirements, the same profile engine can serve anyone who wants to build a writing profile for their own content. A blogger, a marketing team, or a solo consultant should be able to provide a handful of writing samples and get a usable writing skill — even if it's lower fidelity than a full forensic-grade profile. The platform supports four fidelity tiers (see §5.6), each with different data requirements and capabilities, making the profile engine valuable from casual use through expert-level authorship preservation.

### First validated use case

A nonprofit legal advocacy organization — the foremost experts on consumer law in the United States — that:
- Publishes multi-volume legal treatises updated as laws change
- Has 30+ expert attorneys, each with distinct specializations, audiences, and writing voices
- Needs AI to help update treatise content when regulations change, written in the correct author's voice
- Must validate that AI-generated content is consistent with the organization's positions and style
- Has **paywalled content** (subscriber-only treatises) that is both the training corpus and the primary revenue source

---

## 2. System Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │       Content Intelligence          │
                    │                                     │
  ┌─────────────────┤  Three systems, one shared model:   │
  │                 │  hierarchical profiles              │
  │                 └──────────┬──────────────────────────┘
  │                            │
  │                 ┌──────────┴──────────┐
  │                 │  Profile Hierarchy  │
  │                 │                     │
  │                 │  Organization       │
  │                 │    ├── Department A │
  │                 │    │   ├── Person 1 │
  │                 │    │   └── Person 2 │
  │                 │    └── Department B │
  │                 │        ├── Person 3 │
  │                 │        └── Person 4 │
  │                 └──────────┬──────────┘
  │                            │
  ▼                            ▼                          ▼
┌──────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ System 1:    │  │ System 2:            │  │ System 3:            │
│ Attribution  │  │ Writing Profiles     │  │ Fidelity Monitoring  │
│ & Validation │  │ & Generation         │  │ & Repair             │
│              │  │                      │  │                      │
│ "Is this     │  │ "Write this as       │  │ "Is System 2 still   │
│  ours?"      │  │  [person/dept/org]"  │  │  working correctly?" │
└──────┬───────┘  └──────────┬───────────┘  └──────────┬───────────┘
       │                     │                          │
       │                     ▼                          │
       │              ┌──────────────┐                  │
       └─────────────►│  Every       │◄─────────────────┘
                      │  generated   │
                      │  output      │
                      └──────────────┘
```

All three systems share the **profile hierarchy** — the same profiles that System 2 uses to generate content are used by System 1 to validate it and by System 3 to monitor its quality.

---

## 3. The Profile Hierarchy

### 3.1 Three Levels

| Level | What it captures | How it's built | Example |
|-------|-----------------|----------------|---------|
| **Person** | Individual voice, vocabulary, positions, citation patterns, audience registers | Statistical analysis of the person's corpus (proven: 97.9% accuracy on 9 authors) | "Lauren Saunders writes about rent-a-bank schemes with a tone of measured outrage and heavy CFPB citations" |
| **Department / Expertise Area** | Shared vocabulary and positions of a group, common structural patterns, domain terminology | Composite of person-level profiles within the group, with individual quirks abstracted away | "The credit reporting team writes with heavy FCRA citation density and technical precision about furnisher obligations" |
| **Organization** | Official positions, editorial voice, brand standards, organizational terminology, prohibited framings | Composite of all department profiles + editorial/brand layer that captures the org's collective identity | "The organization writes as consumer advocates — never neutral, always on the side of the consumer, never adopting industry framing" |

### 3.2 Composite Profile Construction

**Person profiles** are built bottom-up from corpus analysis (the profile-engine-spec covers this).

**Department profiles** are composites:
- **Shared vocabulary**: Terms that appear across all/most members of the department (intersection)
- **Shared positions**: Stances held by the department collectively (may differ from any individual)
- **Structural range**: The union of structural patterns across members (department writing is more varied than any individual)
- **Audience registers**: Merged from members, with notes on which registers are used by which members
- **Abstracted quirks**: Individual signature phrases and stylistic tics are removed — what remains is the departmental voice

**Organization profiles** add:
- **Editorial layer**: Organizational style guide, official terminology, brand voice
- **Position authority**: Official organizational positions (which may override individual positions)
- **Prohibited framings**: Terms and framings the organization never uses (e.g., industry euphemisms)
- **Cross-department consistency**: Vocabulary and structural patterns that are consistent organization-wide

### 3.3 Profile Hierarchy Data Model

```python
class ProfileHierarchy:
    """Complete organizational profile hierarchy."""

    org_profile: OrganizationProfile
    departments: dict[str, DepartmentProfile]
    people: dict[str, PersonProfile]

    # Relationships
    department_members: dict[str, list[str]]   # dept_id → [person_ids]
    person_departments: dict[str, list[str]]   # person_id → [dept_ids]
    # (a person can belong to multiple departments)

class OrganizationProfile(AuthorProfile):
    """Extends AuthorProfile with org-level fields."""

    editorial_style_guide: StyleGuide
    official_positions: list[OfficialPosition]
    prohibited_framings: list[ProhibitedFraming]
    department_overrides: dict[str, OverrideSet]  # dept-specific org rules

    # Voice catalog: defines the audience voices available org-wide
    voice_definitions: dict[str, VoiceDefinition]  # audience_key → definition

class VoiceDefinition(BaseModel):
    """Org-level voice definition — declares an audience voice available to all authors."""

    audience_key: str              # e.g., "litigator", "advocate", "educator"
    audience_label: str            # Human-readable label
    description: str               # When and how this voice is used
    target_audience: str           # Who is being addressed
    access_level: Optional[ContentAccessLevel]  # None = unrestricted
    #   Org declares which voices exist; individual AuthorProfiles
    #   populate VoiceContext overrides per voice via profile-engine-spec §3.1

class DepartmentProfile(AuthorProfile):
    """Extends AuthorProfile with department-level fields."""

    member_ids: list[str]
    shared_positions: list[Position]
    domain_specialization: str
    typical_document_types: list[str]

class PersonProfile(AuthorProfile):
    """The person-level profile from the profile-engine-spec."""
    # Already defined in spec/profile-engine-spec.md §3
    department_ids: list[str]
```

---

## 4. System 1: Attribution & Validation Engine

### 4.1 Purpose

Answer: "Can we validate this text as ours?" at any level of the hierarchy.

### 4.2 Modes

| Mode | Input | Output | Use case |
|------|-------|--------|----------|
| **Verify known author** | Text + target person ID | Confidence score + explanation | "Confirm this draft matches Lauren's voice before publishing" |
| **Identify author** | Text only | Ranked list of candidate authors + scores | "Who wrote this unsigned document?" |
| **Validate department** | Text + target department ID | Confidence score + explanation | "Is this consistent with how our credit reporting team writes?" |
| **Validate organization** | Text only (checked against org profile) | Confidence score + explanation | "Is this consistent with our organizational voice?" |
| **Detect outsider** | Text only | Boolean + confidence | "This doesn't match anyone in our hierarchy — flag for review" |

### 4.3 Cascade Logic

When identifying authorship with no target specified:

```
1. Check against all person profiles
   → If high-confidence match (>0.85): return person match

2. If no person match, check against department profiles
   → If high-confidence match (>0.80): return department match
   (meaning: "this sounds like your credit reporting team, but
    we can't pin it to a specific person")

3. If no department match, check against org profile
   → If match (>0.70): return org match
   (meaning: "this is consistent with your organization's voice,
    but doesn't match any specific team")

4. If no org match: flag as outsider / unverified
   (meaning: "this doesn't match your organizational voice —
    it may not be yours, or it may be from someone not yet profiled")
```

### 4.4 Attribution Explanation Tiers

To respect paywalled content (see §7 — Access Control):

| Explanation level | What it includes | Who can see it |
|---|---|---|
| **Pattern-level** | Which markers matched, stylometric scores, confidence breakdown | Any authorized system user |
| **Passage-level** | Source text comparisons, "your draft vs. the author's typical phrasing" | Only users with access to the source content |

---

## 5. System 2: Writing Profiles & Generation Engine

### 5.1 Purpose

Answer: "Write this as [person/department/org]" — using the profile hierarchy to shape AI-generated content.

### 5.2 Profile Building Pipeline

The profile-engine-spec (`spec/profile-engine-spec.md`) covers the core library:
- **Ingest**: Load documents from files, URLs, raw text (PDF, DOCX, HTML, etc.)
- **Analyze**: 129-feature stylometric extraction, content marker identification, vocabulary analysis
- **Profile**: Features → structured 12-section profile (Pydantic model)
- **Emit**: Profile → SKILL.md + markers.json + stylometrics.json

**New for Content Intelligence:** The profile engine must also support:
- **Composite profile generation** (department and org levels)
- **Profile diffing** (what changed between profile versions)
- **Profile inheritance** (org-level prohibited framings cascade to all departments and people)

### 5.3 Generation Workflow

For standard content generation:

```
Request: "Write [content type] about [topic] as [person/dept/org]"
    │
    ▼
Load target profile (person, department, or org level)
    │
    ▼
Load applicable parent profiles (dept inherits org rules, person inherits dept+org rules)
    │
    ▼
Resolve voice context (if audience specified):
  - Look up VoiceContext for the requested audience in target profile
  - If found: apply section overrides (voice, vocabulary, argumentation, etc.)
  - If not found: use base profile (Layer 0 behavior)
  - Check VoiceAccessLevel: does the requesting user have access to this voice?
  - Use voice-specific fidelity_tier for quality thresholds
    │
    ▼
Construct skill context:
  - Voice & tone from resolved profile (base or voice-overridden)
  - Vocabulary (preferred/avoided) merged from all applicable levels
  - Positions merged (person overrides dept overrides org, unless org position is marked "authoritative")
  - Anti-patterns merged from all levels (including voice-specific anti-patterns)
  - Prohibited framings from org level (always enforced)
    │
    ▼
Generate content with skill context loaded
    │
    ▼
System 1: Inline attribution check (Tier 1, <500ms)
  - Does the output match the target profile?
  - If score < threshold: regenerate with specific feedback
    │
    ▼
Deliver to review queue (or directly, depending on confidence + org policy)
    │
    ▼
System 3: Async deep analysis (Tier 2, background)
```

### 5.4 Treatise Update Pipeline

The key automated workflow for the legal advocacy org:

```
Trigger: Regulatory change detected
  (Federal Register notice, state law change, court decision)
    │
    ▼
Step 1: IMPACT MAPPING
  Identify all treatise sections that reference the changed law/regulation
  - Full-text search for statute/regulation citations
  - Semantic search for related concepts
  - Output: list of (treatise, chapter, section, paragraph) tuples
    │
    ▼
Step 2: AUTHOR ROUTING
  For each affected section, determine whose voice it's written in
  - Run System 1 attribution on each section
  - Map to the person profile (or department if person is ambiguous)
  - Group affected sections by author for efficient drafting
    │
    ▼
Step 3: CHANGE ANALYSIS
  For each affected section, determine what needs to change
  - Compare old law/regulation text with new
  - Identify which statements in the section are now outdated
  - Classify change type: factual update, analysis update, position update, or no change needed
    │
    ▼
Step 4: DRAFT GENERATION
  For each affected section, generate an updated draft
  - Load the attributed author's writing profile
  - Load the organization's position on the changed law (if one exists)
  - Generate updated text preserving the author's voice
  - Include change annotations: [CHANGED: old text → new text] [REASON: ...]
    │
    ▼
Step 5: FIDELITY CHECK
  System 1 validates each draft against the target author profile
  - Tier 1 inline check (voice match)
  - Cross-check: does the update accurately reflect the legal change?
  - Flag any sections where confidence is low
    │
    ▼
Step 6: EXPERT REVIEW QUEUE
  Route each draft to the appropriate attorney for review
  - Group by author (Lauren reviews all Lauren-voiced updates)
  - Include: original text, proposed update, fidelity score, change rationale
  - Attorney approves, edits, or rejects each update
  - Rejections feed back into System 3 for profile improvement
    │
    ▼
Step 7: PUBLISH
  Approved updates are applied to the treatise content
  - Track which updates were accepted as-is vs. edited
  - Edited updates become training data for profile improvement
  - Audit trail: who approved, when, what changed, what the AI proposed vs. final
```

### 5.5 Non-Treatise Use Cases

The same profile infrastructure supports:
- **Blog posts**: "Write a blog post about [topic] in [person]'s voice for a general audience"
- **Congressional testimony**: "Draft testimony on [bill] in [person]'s voice, Congressional register"
- **Regulatory comments**: "Draft a comment letter to [agency] on [docket] in the organization's voice"
- **Press releases**: "Draft a press release about [event] in the org's editorial voice"
- **Internal memos**: "Summarize [legal development] for staff in the org's informal register"

### 5.6 Profile Fidelity Tiers

Not every use case requires a 50,000-word corpus and 129-feature analysis. The profile engine supports four fidelity tiers, each representing a qualitative shift in what linguistic features are modeled — not just "more data = better."

**Why this matters:** Frontier LLMs (Claude, GPT-4o, Gemini) plateau at Tier 1-2 fidelity regardless of prompting sophistication (EMNLP 2025, Wang et al.: 40,000+ generations across 400+ authors). The reason is the **explicit/implicit gap**: explicit style features (tone, vocabulary level) can be described in a prompt; implicit features (function-word fingerprints, syntactic patterns, rare-word preferences) can only be measured numerically. Tier 3-4 profiles capture what cannot be said, only measured.

| | Tier 1: Surface Tone | Tier 2: Lexical Profile | Tier 3: Syntactic + Rhetorical | Tier 4: Full Stylometric |
|---|---|---|---|---|
| **Data required** | ~300-2,000 words | ~2,000-10,000 words | ~10,000-50,000 words | ~50,000+ words |
| **Attribution accuracy** | 55-70% | 70-82% | 82-92% | 92-98% |
| **What it captures** | Tone, vocabulary register, sentiment, basic punctuation | Function word frequencies, type-token ratio, sentence length distribution, preferred connectives | POS n-grams, clause embedding, discourse markers, argument sequencing, entity reference style | 129+ features: character n-grams, rare word signatures, rhythmic cadence, topic-invariant latent style |
| **Generation approach** | Zero/few-shot prompt | Prompt + frequency constraints | Prompt + syntactic constraints | Full stylometric vector-guided generation |
| **Topic-invariant?** | No | Partially | Mostly | Yes |
| **Forensic-grade?** | No | No | Borderline | Yes |
| **Good enough for** | Social media, short marketing copy, email templates | Blog drafts, newsletters, long-form content | Ghostwritten articles, thought leadership, extended content series | High-fidelity ghostwriting across domains, forensic attribution, automated content pipelines |
| **Commercial equivalent** | What ChatGPT does with a style prompt | What Writer.com / Jasper do | Nothing commercially available | Nothing commercially available |

#### Tier 1: Surface Tone (~300-2,000 words)

The user provides a few writing samples. The system extracts tone, vocabulary register, sentiment polarity, and basic punctuation habits. This is what any LLM does today with a "write in my style" prompt — the profile makes it consistent and reproducible. Good enough for casual "write my LinkedIn posts roughly in my voice" use cases.

**Limitations:** Collapses under topic change. Cannot distinguish the author from other writers with similar tone. Would fail a Burrows' Delta test.

#### Tier 2: Lexical Profile (~2,000-10,000 words)

The user provides 5-25 documents. The system extracts function word distributions, type-token ratio, sentence length histograms, preferred transitions. This is where Burrows' Delta becomes meaningful. Better than what commercial brand voice tools (Writer, Jasper, Grammarly) offer today, because it's grounded in statistical features rather than LLM-extracted adjectives.

**Limitations:** Topic-dependent — shifts when writing about unfamiliar subjects. Cannot replicate argumentation style.

#### Tier 3: Syntactic + Rhetorical (~10,000-50,000 words)

Requires NLP beyond word frequencies — POS tagging and dependency parsing. Captures parse-tree depth, clause embedding patterns, paragraph structure, discourse markers, hedging language, argumentation sequencing. These features are substantially topic-independent: passive voice ratios stay stable whether you write about cooking or mergers.

**Limitations:** Requires domain-matched training text. Personal anecdote voice and fine-grained humor not captured.

#### Tier 4: Full Stylometric (~50,000+ words)

The full 129-feature treatment. Character n-grams, rare-word preference signatures, rhythmic cadence (sentence-length Markov chains), topic-invariant latent style. This is what the legal advocacy org needs — and what Joyus AI has already validated at 97.9% attribution accuracy on 9 authors.

**Limitations:** Data-hungry. Degrades when author's style evolves over time. Cannot capture truly novel creative ideas (style is the *how*, not the *what*).

#### Honest caveat

Attribution accuracy (97.9%) and generation fidelity are related but distinct metrics. No reliable mapping between them exists in published literature. The strongest defensible claim is "generation with higher stylometric alignment than any prompting-based approach" — not "indistinguishable from the human author." Sophisticated readers familiar with the author can still detect AI-generated content in an estimated 15-30% of cases even at Tier 4 (per EMNLP 2025 findings).

#### What to build vs. leverage

| Component | Build or leverage? | Rationale |
|---|---|---|
| Burrows' Delta computation | Leverage (`faststylometry` on PyPI) | Solved math, actively maintained Python library |
| NLP preprocessing (POS, parsing) | Leverage (spaCy) | Industry standard, production-grade |
| Multi-feature extraction pipeline (129+ features) | Build | No existing library combines function words, content markers, syntactic features, punctuation, and character-level signals in one production package |
| Style drift detection | Build | Not available commercially or open-source |
| Generation + verification closed loop | Build | The core gap: LLMs need external measurement to know if they matched the target style |
| MCP-native stylometric analysis | Build | Empty niche in the MCP ecosystem as of early 2026 |

---

## 6. System 3: Fidelity Monitoring & Repair

### 6.1 Purpose

Answer: "Is System 2 still working correctly?" — and if not, fix it.

### 6.2 Continuous Monitoring

Every output from System 2 is analyzed:

| Check | When | What it measures |
|-------|------|-----------------|
| **Tier 1: Inline** | Before delivery | Marker presence, basic stylometric distance, prohibited framing check. <500ms. |
| **Tier 2: Deep** | After delivery (async) | Full 129-feature Burrows' Delta, cross-document consistency, position accuracy |
| **Trend analysis** | Daily/weekly rollup | Fidelity score trends over time, per profile, per content type |

### 6.3 Drift Detection

Drift means the generated content is gradually diverging from the target profile. Causes include:
- **Model updates**: New Claude version writes differently
- **Corpus evolution**: The author has published new work that shifts their voice
- **Position changes**: The organization changed its stance on an issue
- **Vocabulary shifts**: New legal terminology entered the domain
- **Profile staleness**: The profile was built months ago and hasn't been updated

Detection signals:

| Signal | Measurement | Threshold |
|--------|-------------|-----------|
| **Fidelity score decline** | Rolling average of Tier 2 scores dropping | >5% decline over 2-week window |
| **Marker frequency shift** | Expected markers appearing less often | >20% decrease in signature phrase usage |
| **Stylometric distance increase** | Burrows' Delta trending away from baseline | Distance exceeding 1.5x the self-distance std |
| **Negative marker increase** | Prohibited framings appearing more often | Any increase from zero baseline |
| **Cross-document inconsistency** | Recent outputs diverging from each other | Variance exceeding 2x historical variance |

### 6.4 Diagnosis

When drift is detected, the system identifies **what** drifted:

```python
class DriftDiagnosis:
    profile_id: str
    detection_date: datetime
    severity: Literal["low", "medium", "high", "critical"]

    # What drifted
    affected_features: list[DriftedFeature]
    #   e.g., "vocabulary.signature_phrases: usage dropped 35%"
    #   e.g., "voice.formality: shifted from 7.2 to 5.8"
    #   e.g., "positions: generated content contradicts org position on [topic]"

    # Probable cause
    probable_cause: Literal[
        "model_update",       # New model version
        "corpus_evolution",   # Author's actual writing has changed
        "position_change",    # Org changed its stance
        "vocabulary_shift",   # Domain terminology evolved
        "profile_staleness",  # Profile hasn't been updated
        "unknown"             # Needs human investigation
    ]

    # Recommended repair
    recommended_action: RepairAction
```

### 6.5 Repair Actions

| Cause | Repair action | Automated? |
|-------|--------------|------------|
| **Profile staleness** | Re-run profile building on expanded corpus (include recent publications) | Semi-automated: rebuild runs automatically, human reviews the diff |
| **Vocabulary shift** | Update marker lists — add new domain terms, retire obsolete ones | Semi-automated: system proposes additions/removals, human approves |
| **Model update** | Recalibrate Tier 1 thresholds against known-good samples | Automated: run regression suite, adjust thresholds if accuracy drops |
| **Position change** | Update positions in profile hierarchy (may cascade: org → dept → person) | Manual: organization must declare the new position; system updates profiles |
| **Corpus evolution** | Rebuild profile from updated corpus (author published new work) | Semi-automated: detect new publications, propose profile update |
| **Unknown** | Escalate to human with full diagnostic report | Manual: human investigates with passage-level comparison |

### 6.6 Repair Verification

After any repair, the system must verify:

1. **Regression test**: Run the attribution accuracy suite against known-good samples — accuracy must not drop below baseline (94.6% for 4-author, 97.9% for 9-author)
2. **Forward test**: Generate new content with the updated profile and verify fidelity score meets threshold
3. **Cross-profile check**: Verify the repair didn't accidentally shift another profile (e.g., updating the org position shouldn't break person-level attribution)

```
Drift detected → Diagnose → Propose repair → Human approves
    → Apply repair → Regression test → Forward test → Cross-profile check
        → If all pass: deploy updated profiles
        → If any fail: revert repair, escalate to human
```

---

## 7. Access Control & Paywalled Content

### 7.1 The Core Tension

The organization's treatises are their primary revenue source (subscriber-only content). The AI systems are trained on this content, but cannot become a backdoor around the paywall.

### 7.2 Principles

1. **Profiles are derived knowledge, not content.** A profile that captures "this author uses 'rent-a-bank scheme' frequently" is a statistical pattern — safe to use without access restrictions. A profile that contains verbatim paragraphs from a subscriber treatise is content — not safe.

2. **Generated content inherits the highest access level of its sources.** If a treatise update references subscriber-only analysis, the output is subscriber-level. The system must track source provenance.

3. **Attribution explanations come in two tiers:**
   - **Pattern-level** (marker matches, stylometric scores) — any authorized system user
   - **Passage-level** (quoting source text for comparison) — requires access to source content

4. **The system must never synthesize paywalled content into free-tier responses.** A user without a subscription cannot use the AI to get treatise content they haven't paid for.

5. **The treatise update pipeline operates entirely within the subscriber boundary.** Attorneys reviewing drafts already have access. Generated drafts inherit subscriber status. Published updates go behind the same paywall.

6. **Partial access, full awareness.** When the system has access to some sources but not others, it must provide what it knows from accessible sources AND explicitly reference relevant content in inaccessible sources. For example: if the system has access to Book 1 but relevant information also exists in Book 2, the output should include the substance from Book 1 and then say "there is also relevant material in [Book 2, Chapter X], but you'll need a subscription to access it." The system never silently omits relevant content — it either delivers it or tells the user where to find it and what access they need.

7. **Audit trail tracks source provenance.** Every output records which source documents influenced it, enabling access control verification and ensuring the organization can audit for accidental content leakage.

8. **Voice profiles carry independent access levels.** Statistical patterns (markers, stylometrics) within any voice profile remain unrestricted — they are derived knowledge. However, positions, analytical frameworks, strategic approaches, and example outputs within restricted voice profiles inherit the voice's access level. This enables Layer 2 voices (e.g., the "Priest" voice containing privileged legal strategies) to be access-gated without restricting the underlying stylometric infrastructure. See `profile-engine-spec.md §3.1` for the `VoiceAccessLevel` model.

### 7.3 Access Control Integration

```python
class ContentAccessLevel(Enum):
    PUBLIC = "public"           # Free articles, blog posts, press releases
    SUBSCRIBER = "subscriber"   # Treatise content, practice aids
    GROUP = "group"             # Shared with specific user groups
    INTERNAL = "internal"       # Staff-only content

class GeneratedContent:
    text: str
    target_profile: str                     # Who it was written as
    fidelity_score: float                   # System 1 validation
    source_provenance: list[SourceRef]      # What influenced this output
    access_level: ContentAccessLevel        # Inherited from highest source
    access_justification: str               # Why this access level was assigned
```

### 7.4 What's Safe at Each Level

| Output type | Contains paywalled content? | Access restriction |
|---|---|---|
| Profile patterns (markers, stylometrics, vocabulary lists) | No — statistical patterns | Unrestricted within the system |
| Attribution scores and pattern-level explanations | No — aggregate metrics | Any authorized system user |
| Attribution passage-level comparisons | Potentially — may quote source | Requires access to the source |
| Generated treatise updates | Yes — derived from subscriber content | Subscriber-level |
| Generated blog posts from public sources only | No — if provenance is clean | Public |
| Fidelity reports with diagnostic detail | Potentially — may reference sources | Matches highest source access level |
| "What does the org say about X?" answers | Depends on which sources are retrieved | Access-filtered per user; content from accessible sources delivered in full, inaccessible sources referenced with subscribe-to-access pointers (Principle 6) |

---

## 8. Integration with Joyus AI Platform

### 8.1 Platform Component Mapping

| Content Intelligence component | Platform layer | Constitution principle |
|---|---|---|
| Profile hierarchy | Skill files (SKILL.md + markers.json + stylometrics.json) per person/dept/org | §2.2 Skills as Encoded Knowledge |
| Attribution engine | Verification service (standalone + platform-integrated) | §2.4 Monitor Everything (Output Accuracy) |
| Writing generation | Skill-mediated content generation pipeline | §2.6 Mediated AI Access |
| Treatise update pipeline | Automated pipeline with regulatory trigger | §2.7 Automated Pipelines |
| Fidelity monitoring | Monitoring layer (Tier 2 deep analysis) | §2.4 + §2.5 Feedback Loops |
| Drift detection | Assumption awareness — profile assumptions can go stale | §2.9 Assumption Awareness |
| Repair process | Feedback loop: drift → diagnose → repair → verify → deploy | §2.5 Feedback Loops |
| Access control | Data governance — source provenance + access level inheritance | §3.2 Compliance Framework Awareness |

### 8.2 Skill File Structure Per Profile

Each profile in the hierarchy produces platform-consumable skill files:

```
skills/
├── org/
│   ├── SKILL.md                    # Organizational voice, positions, prohibited framings
│   ├── markers.json                # Org-level content markers
│   ├── stylometrics.json           # Org-level stylometric baseline
│   └── voices.json                 # Voice catalog (VoiceDefinitions — audience keys + access levels)
├── departments/
│   ├── credit-reporting/
│   │   ├── SKILL.md
│   │   ├── markers.json
│   │   └── stylometrics.json
│   └── banking-and-payments/
│       ├── SKILL.md
│       ├── markers.json
│       └── stylometrics.json
└── people/
    ├── author-001/
    │   ├── SKILL.md                # Base voice (Layer 0)
    │   ├── markers.json
    │   ├── stylometrics.json
    │   └── voices/                 # Per-audience voice contexts (Layer 1-2)
    │       ├── litigator.json      # VoiceContext overrides for courts audience
    │       ├── advocate.json       # VoiceContext overrides for legislators
    │       ├── educator.json       # VoiceContext overrides for public
    │       └── expert.json         # VoiceContext overrides for peers/academics
    └── author-002/
        ├── SKILL.md
        ├── markers.json
        ├── stylometrics.json
        └── voices/                 # Only populated if author has multi-audience voices
            └── ...
```

### 8.3 What's Platform vs. What's Org-Specific

| Component | Public repo (platform) | Private repo (org-specific) |
|---|---|---|
| Profile engine library (ingest, analyze, profile, emit, verify) | Yes | — |
| Composite profile builder (dept + org level) | Yes | — |
| Attribution engine (cascade logic, scoring) | Yes | — |
| Fidelity monitoring service (drift detection, repair framework) | Yes | — |
| Treatise update pipeline framework (trigger → map → route → draft → review) | Yes | — |
| Legal advocacy domain template (`profile/templates/legal_advocacy.yaml`) | Yes (generic) | Customized version |
| Actual person/dept/org profiles | — | Yes (organizational IP) |
| Marker lists, stylometric baselines | — | Yes (derived from private corpus) |
| Treatise content, regulatory mappings | — | Yes (paywalled content) |
| Access control integration (Drupal-specific) | — | Yes (deployment-specific) |

---

## 9. Regulatory Change Detection (Pipeline Trigger)

### 9.1 Sources

| Source | What it provides | Update frequency |
|---|---|---|
| **Federal Register** | Final rules, proposed rules, notices | Daily |
| **Congress.gov** | Bill text, status changes, enacted laws | As events occur |
| **State legislatures** | State law changes (50 states) | Varies by state |
| **Court decisions** | Case law affecting consumer protections | As decisions are published |
| **CFPB / FTC / OCC** | Enforcement actions, guidance, bulletins | As published |

### 9.2 Detection Pipeline

```
Source feed (RSS/API/scraper)
    │
    ▼
Relevance filter: Does this affect consumer law topics we cover?
  - Check against organization's topic taxonomy
  - Check against treatise subject index
  - If not relevant: discard
    │
    ▼
Impact assessment: What does this change?
  - Extract the specific legal change (new provision, amendment, repeal)
  - Severity classification: minor update / significant change / major overhaul
    │
    ▼
Treatise mapping: Which sections need updating?
  - Search treatise content for references to the affected law/regulation
  - Identify specific sections, with change type (factual, analytical, positional)
    │
    ▼
Notification: Alert appropriate staff + queue for treatise update pipeline
```

### 9.3 Initial Scope

Start with Federal Register monitoring for final rules affecting:
- CFPB regulations (TILA, FCRA, FDCPA, EFTA, ECOA)
- FTC regulations (UDAP, Holder Rule, Used Car Rule)
- State-level monitoring deferred to later phase

---

## 10. Success Criteria

| Metric | Target | Measured by |
|--------|--------|-------------|
| Person-level attribution accuracy | >= 97.9% (maintain NCLC 9-author baseline) | Regression suite |
| Department-level attribution accuracy | >= 90% | Cross-validated on department-grouped corpus |
| Organization-level attribution accuracy | >= 85% (distinguish org from external text) | Validated against org + non-org samples |
| Outsider detection rate | >= 95% (flag text not from the org) | Tested with external legal writing |
| Tier 1 inline verification latency | < 500ms per 1000-word document | Performance test suite |
| Tier 2 deep analysis latency | < 60 seconds per document | Performance test |
| Drift detection time | < 48 hours from onset to alert | Simulated drift scenarios |
| Treatise update pipeline: regulatory change → draft | < 24 hours | End-to-end pipeline test |
| Generated content fidelity score | >= 0.80 for person-level, >= 0.75 for dept/org | Averaged across outputs |
| Access control: zero paywalled content leakage | 0 incidents | Audit + automated provenance checking |
| Profile rebuild time | < 30 minutes per person (10+ document corpus) | Performance test |
| Tier 1 profile generation | < 30 seconds from 300+ words input | Performance test |
| Tier 2 profile generation | < 5 minutes from 2,000+ words input | Performance test |
| Tier 3 profile generation | < 15 minutes from 10,000+ words input | Performance test |
| Tier 4 profile generation | < 30 minutes from 50,000+ words input | Performance test |
| Self-service profile building | User can upload samples and receive a usable writing skill with no manual intervention | End-to-end test |

---

## 11. Open Questions

| Question | Context | Priority |
|----------|---------|----------|
| How should department boundaries be defined? | Some attorneys work across multiple areas. Departments could be formal org chart divisions or topic-based expertise areas. | High — affects hierarchy design |
| What's the minimum corpus size for department-level profiles? | Person profiles need 5-10 documents. Department composites aggregate across people, so fewer per person may suffice. | Medium — needs empirical testing |
| Should the org profile include an editorial "house style" layer separate from the statistical composite? | Statistical composite of all authors gives the average voice. But the org's editorial voice (press releases, official statements) may be distinct from any individual's voice. | High — affects org profile construction |
| How to handle co-authored documents? | Current attribution assigns to the dominant voice. For profile building, co-authored works could be assigned to both authors (diluting individual signal) or excluded. | Medium |
| How to handle position conflicts? | Person X may disagree with the org's official position. When generating as Person X, use their position or the org's? Need a precedence model. | High — affects generation accuracy and org policy |
| ~~Integration point with Drupal for access control?~~ | **Resolved (Feb 19):** Platform-agnostic auth provider interface. First implementation: JWT token exchange (Drupal issues scoped JWT on login, platform validates stateless). Interface supports any IdP (OAuth2, SAML, API keys) — Drupal is not the only deployment target. See spec/plan.md Decision #20. | ~~Medium~~ **Resolved** |
| Federal Register API reliability? | The FR API is public but has had availability issues. Need fallback/caching strategy. | Low — operational concern |
| Self-service tier boundaries — should the system auto-detect the achievable tier? | Given N words of input, the system could say "you have enough data for Tier 2; Tier 3 would require ~8,000 more words." Should this be automatic guidance or user-selected? | Medium — affects UX |
| Should Tier 1-2 profiles use `faststylometry` directly or wrap it? | faststylometry handles Burrows' Delta well. The question is whether to depend on it directly or wrap it for consistent interface across tiers. | Medium — architecture decision |
| Feature ablation study for the 129-feature set? | The literature shows diminishing returns beyond top 200-500 MFW. Are all 129 features carrying signal, or are some redundant? An ablation study would validate the feature set. | Medium — affects Tier 4 quality claims |
| How does the closed-loop generation + verification actually work at inference time? | The 129-feature vector could be used as a classifier, a reward signal, or a constraint beam search. The specific mechanism matters enormously for output quality. | High — core architecture |
| ~~How should multi-audience voices be modeled?~~ | **Resolved (Feb 19):** VoiceContext as first-class entity with 3-layer opt-in. RegisterShift (parameter deltas on voice/tone) is insufficient — NCLC voices differ across all 12 profile sections. VoiceContext provides per-section overrides, per-voice fidelity tiers, and optional access control. See profile-engine-spec §3.1. | ~~High~~ **Resolved** |
| Pricing model for self-service tiers? | Tier 1 could be free/low-cost (attract users), Tier 4 is premium (high value, high compute). How does this map to the platform's pricing? | Medium — business decision |

---

## 12. Phased Delivery

### Phase A: Profile Engine Library (Weeks 1-3)
*Covered by spec/profile-engine-spec.md — extract, generalize, emit, verify*
- Person-level profiles from corpus analysis
- Skill file emission (SKILL.md + markers.json + stylometrics.json)
- Two-tier verification (inline + deep)
- NCLC regression suite passing

### Phase B: Hierarchical Profiles (Weeks 3-5)
- Department-level composite profile builder
- Organization-level composite profile builder
- Profile inheritance (org rules cascade to dept and person)
- Cascade attribution logic
- Outsider detection

### Phase C: Fidelity Monitoring Service (Weeks 5-7)
- Continuous Tier 2 analysis pipeline
- Drift detection with trend analysis
- Diagnosis engine (identify what drifted and probable cause)
- Repair action framework (propose, approve, apply, verify)
- Regression verification after repair

### Phase D: Treatise Update Pipeline (Weeks 7-10)
- Federal Register monitoring (CFPB/FTC regulations)
- Impact mapping (regulatory change → affected treatise sections)
- Author routing (System 1 identifies whose voice each section is in)
- Draft generation with fidelity checking
- Expert review queue
- Access control enforcement throughout

### Phase E: Self-Service Profile Building (Weeks 8-10)
- Upload-and-profile web interface (provide samples, get a writing skill)
- Automatic tier detection: "you have enough data for Tier 2; Tier 3 needs ~8,000 more words"
- Tier 1-2 profiles generated in under 5 minutes
- Skill file output usable immediately in any Joyus AI deployment
- Tier progression: users can upgrade their profile by providing more samples over time

### Phase F: Regulatory Change Detection (Weeks 10-12)
- Federal Register daily monitoring
- Relevance filtering against topic taxonomy
- Impact severity classification
- Automated pipeline triggering
- State-level monitoring (deferred — scoped for future)

---

*Spec created: February 18, 2026*
*Updated: February 19, 2026 — Added VoiceContext architecture: VoiceDefinition in §3.3 OrganizationProfile, voice resolution step in §5.3 generation workflow, Principle 8 (voice-level access control) in §7.2, voices/ directory in §8.2 skill file structure. Resolved open questions: auth integration (platform-agnostic, JWT first impl), multi-audience voice model (VoiceContext). Based on architecture research report (5 parallel agents + cross-validation).*
*Updated: February 18, 2026 — Added profile fidelity tiers (§5.6), self-service profile building, build-vs-leverage analysis, and honest caveats on attribution accuracy vs. generation fidelity. Research basis: EMNLP 2025 (Wang et al.), Oxford DSH 2025, MDPI 2024 survey, faststylometry ecosystem analysis.*
*For: Joyus AI Platform — Feature 005*
*References: NCLC author-identification-research, spec/profile-engine-spec.md, Constitution v1.5*
