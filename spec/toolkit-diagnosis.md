# Presentation Toolkit Diagnosis

**Date:** January 29, 2026
**Repo:** `claude-presentation-toolkit`
**Status:** Issues identified, recommendations provided

---

## Executive Summary

The toolkit has a solid foundation but struggles with four core issues:

| Problem | Root Cause | Severity |
|---------|-----------|----------|
| **P1: Wrong layouts** | Content detection relies on fragile regex heuristics | High |
| **P2: Lost content** | Extraction flattens structure, loses relationships | Critical |
| **P3: Template ignored** | No master slide parsing, hardcoded indices | High |
| **P4: Unreliable** | Silent failures, structure assumptions | Medium |

---

## Architecture Overview

```
Source PPTX/PDF
      │
      ▼
┌─────────────────────────────────────────┐
│  parse_pptx() / parse_pdf()            │  ← Content extraction
│  • Extracts all <a:t> text elements    │
│  • First text → title                   │
│  • Next 4 texts → body                  │
│  • Images extracted separately          │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  detect_content_type()                  │  ← Content classification
│  • Regex pattern matching               │
│  • Keyword detection                    │
│  • Returns: 'statistic', 'quote', etc.  │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  LayoutSelector.select_layout()         │  ← Layout selection
│  • Maps content type → template indices │
│  • Tracks recent slides (avoid repeats) │
│  • Rotates colors/orientations          │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│  replace_text_in_slide()                │  ← Content insertion
│  • Finds placeholders by type           │
│  • Falls back to text boxes, any <a:t>  │
│  • Truncates to capacity limits         │
└─────────────────────────────────────────┘
      │
      ▼
Output PPTX
```

---

## Issue 1: Wrong Layout Choices (P1)

### Symptoms
- Content placed poorly on slides
- Bad visual hierarchy
- Weird spacing and alignment

### Root Causes

**1.1 Content detection is regex-based**

```python
# From detect_content_type() - lines 54-182
stat_number_patterns = [
    r'\b\d+%',
    r'\b\d+[KMB]\+?\b',
    ...
]
stat_count = 0
for pattern in stat_number_patterns:
    stat_count += len(re.findall(pattern, combined, re.IGNORECASE))

if stat_count >= 4:
    return 'stats_dashboard'
```

**Problem:** This misclassifies content. A slide mentioning "10% increase" in passing gets classified as a statistic slide.

**1.2 Layout selection assumes config categories exist**

```python
# From _get_candidates() - hardcoded category names
if content_type == 'statistic':
    return ['stat_coral_filled', 'stat_outline_gui', 'stat_default']
```

**Problem:** If the brand config doesn't define these exact category names, the toolkit falls back to defaults that may not exist in the actual template.

**1.3 No understanding of visual composition**

The toolkit doesn't analyze:
- How much content will fit in each layout
- Whether images are present and need space
- The actual visual balance of the result

### Recommendations

1. **Use Claude for content classification** instead of regex
2. **Validate layout fit** before committing (content length vs capacity)
3. **Parse template to discover available layouts** rather than assuming indices

---

## Issue 2: Lost/Mangled Content (P2) — CRITICAL

### Symptoms
- Text missing entirely
- Bullets merged or reordered
- Tables broken or flattened

### Root Causes

**2.1 Extraction loses structure**

```python
# From parse_pptx() - lines 517-574
texts = []
for t in root.xpath('.//a:t', namespaces=NSMAP):
    if t.text:
        texts.append(clean_text(t.text))

slide = {
    'title': texts[0] if texts else '',
    'body': '\n'.join(texts[1:5]) if len(texts) > 1 else '',  # ← Only 5 texts!
}
```

**Problems:**
- All text elements flattened into a list
- No understanding of which shape each text belongs to
- Title is just "first text found" — could be a footer or annotation
- Body limited to next 4 texts — complex slides lose content
- Paragraph/bullet structure not preserved

**2.2 Body content flattened during insertion**

```python
# From migrate_presentation() - line 1069
new_body = slide['body'].replace('\n', ' ')[:body_max]
```

**Problem:** All newlines (including bullet separators) become spaces.

**2.3 Tables and charts not handled**

The extraction code only looks for `<a:t>` text elements. Tables (`<a:tbl>`) and charts are completely ignored.

### Recommendations

1. **Extract content with structure preserved:**
   ```python
   # Instead of flat text list, extract per-shape:
   {
       'shapes': [
           {'type': 'title', 'text': '...', 'position': {...}},
           {'type': 'body', 'paragraphs': ['bullet 1', 'bullet 2']},
           {'type': 'table', 'data': [[...]]},
       ]
   }
   ```

2. **Use python-pptx for extraction** — it handles structure better than raw XML
3. **Preserve bullet structure** in body text representation
4. **Add table extraction** for data-heavy slides

---

## Issue 3: Template Not Respected (P3)

### Symptoms
- Master slides ignored
- Layout placeholders not used
- Brand colors not applied to correct elements

### Root Causes

**3.1 No master slide parsing**

The toolkit copies template slides by index but doesn't:
- Parse the template's master slides
- Understand which layouts are available
- Map content to the correct placeholders in each layout

**3.2 Placeholder finding is fragile**

```python
# From find_placeholder() - looks for exact ph_type
xpath = f'.//p:sp[.//p:ph[@type="{ph_type}"]]'
shapes = root.xpath(xpath, namespaces=NSMAP)
```

**Problem:** If template uses different placeholder types or custom names, they won't be found.

**3.3 Fallback chain can hit wrong elements**

```python
# From replace_text_in_slide() - lines 943-953
if not title_replaced:
    for t_elem in root.xpath('.//a:t', namespaces=NSMAP):
        if t_elem.text and len(t_elem.text.strip()) > 2:
            t_elem.text = new_title  # ← Could be ANY text element
            title_replaced = True
            break
```

**Problem:** If placeholder not found, it replaces the first text element with >2 chars — could be a footer, logo text, or annotation.

### Recommendations

1. **Parse template structure first:**
   ```python
   def analyze_template(template_path):
       """Discover available layouts and their placeholders."""
       return {
           'layouts': [
               {'index': 1, 'name': 'Title Slide', 'placeholders': ['title', 'subtitle']},
               {'index': 2, 'name': 'Content', 'placeholders': ['title', 'body', 'picture']},
               ...
           ]
       }
   ```

2. **Match content to layout capabilities** — don't use a layout without a body placeholder for content with body text

3. **Fail visibly** when placeholder not found instead of silent fallback

---

## Issue 4: Unreliable Output (P4)

### Symptoms
- Same input produces different results
- Errors on certain decks
- Incomplete processing

### Root Causes

**4.1 Silent exception handling**

```python
# From parse_pptx() - line 567
except Exception:
    pass  # ← Silently ignores all errors
```

**Problem:** Errors during image extraction, text parsing, etc. are swallowed.

**4.2 Font size heuristic is rough**

```python
# From calculate_font_size()
char_width_at_100pt = 60000  # Conservative estimate
```

**Problem:** Actual character width varies by font, character, and style. This approximation can be very wrong.

**4.3 Index-based assumptions**

The toolkit assumes:
- Template slide 3 exists (fallback)
- Slide indices in config match actual template
- Relationship IDs follow a predictable pattern

### Recommendations

1. **Add structured error handling** — collect errors, report at end
2. **Validate template** before migration (check expected slides exist)
3. **Add output validation** — verify all content was placed
4. **Use python-pptx for font metrics** instead of heuristics

---

## Recommended Refactoring Approach

### Phase 1: Fix Critical Issues

**1. Replace extraction with structured approach**

```python
def extract_slide_content(slide_xml) -> SlideContent:
    """Extract content preserving structure."""
    return SlideContent(
        title=extract_title_shape(slide_xml),
        body_paragraphs=extract_body_paragraphs(slide_xml),
        images=extract_images(slide_xml),
        tables=extract_tables(slide_xml),
    )
```

**2. Use Claude for content classification**

Instead of regex, ask Claude:
```
Given this slide content:
Title: "10x faster deployments with our CI/CD pipeline"
Body: "• Automated testing\n• Zero-downtime deploys\n• Rollback in seconds"

What type of slide is this?
Options: statistic, feature, quote, case_study, bullet_list, section_header
```

**3. Add pre-flight validation**

Before migration, validate:
- Template has expected layouts
- Config categories map to real template indices
- All source slides can be processed

### Phase 2: Improve Quality

**4. Parse template structure**

Build a model of what layouts are available and their capabilities.

**5. Smart layout matching**

Match content to layouts based on:
- Content type (from Claude)
- Content volume (fits in capacity?)
- Image presence (needs image placeholder?)

**6. Post-migration validation**

After migration, verify:
- All source content appears in output
- No placeholder text remains
- File opens without errors

---

## Quick Wins (Can fix immediately)

| Fix | Impact | Effort |
|-----|--------|--------|
| Don't flatten body newlines | Preserves bullets | 1 line |
| Extract more than 5 text elements | Captures full content | 1 line |
| Log errors instead of `pass` | Visibility into failures | Easy |
| Validate template indices exist | Prevents silent failures | Easy |

---

## Files to Modify

| File | Changes Needed |
|------|----------------|
| `migrate.py` | Extraction, content detection, validation |
| `pptx_utils.py` | Structured extraction helpers |
| `config/schema.py` | Add template metadata model |
| `extract.py` | New module for robust extraction |
| `validate.py` | New module for pre/post validation |

---

*Diagnosis completed: January 29, 2026*
*For: Zivtech AI Agent Platform — Phase 1*
