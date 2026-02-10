# Presentation Toolkit Refactoring Design

**Date:** January 29, 2026
**Purpose:** Complete redesign of content extraction, layout selection, and assembly
**Implementation:** Claude Code

---

## 1. New Architecture

```
Source PPTX/PDF
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: EXTRACTION                                            │
│                                                                  │
│  extract.py (NEW)                                               │
│  ├── extract_presentation(path) → Presentation                  │
│  ├── extract_slide(slide_xml) → Slide                          │
│  ├── extract_shapes(slide_xml) → List[Shape]                   │
│  └── extract_tables(slide_xml) → List[Table]                   │
│                                                                  │
│  Output: Structured Presentation object with full fidelity      │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: ANALYSIS (Claude-assisted)                            │
│                                                                  │
│  analyze.py (ENHANCED)                                          │
│  ├── classify_slide(slide) → ContentType                       │
│  ├── analyze_content_fit(slide, layout) → FitScore             │
│  └── suggest_layout(slide, available_layouts) → LayoutChoice   │
│                                                                  │
│  Uses Claude for intelligent classification instead of regex    │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: TEMPLATE ANALYSIS                                     │
│                                                                  │
│  template.py (NEW)                                              │
│  ├── analyze_template(path) → TemplateInfo                     │
│  ├── get_available_layouts() → List[Layout]                    │
│  ├── get_layout_capabilities(idx) → LayoutCapabilities         │
│  └── validate_template(path, config) → ValidationResult        │
│                                                                  │
│  Discovers what the template actually offers                    │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: TRANSFORMATION                                        │
│                                                                  │
│  transform.py (NEW)                                             │
│  ├── plan_migration(slides, template_info) → MigrationPlan     │
│  ├── transform_slide(slide, layout) → TransformedSlide         │
│  └── fit_content_to_layout(content, layout) → FittedContent    │
│                                                                  │
│  Maps source content to target layouts with content fitting     │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: ASSEMBLY                                              │
│                                                                  │
│  assemble.py (NEW)                                              │
│  ├── create_presentation(plan, template) → Path                │
│  ├── populate_slide(slide_xml, content) → None                 │
│  └── insert_media(slide_xml, images) → None                    │
│                                                                  │
│  Builds the output PPTX from transformation plan                │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 6: VALIDATION                                            │
│                                                                  │
│  validate.py (NEW)                                              │
│  ├── validate_output(output_path) → ValidationResult           │
│  ├── compare_content(source, output) → ContentDiff             │
│  └── check_brand_compliance(output, config) → ComplianceResult │
│                                                                  │
│  Ensures nothing was lost and brand is applied                  │
└─────────────────────────────────────────────────────────────────┘
      │
      ▼
Output PPTX (validated)
```

---

## 2. Data Models

### Core Models (`models.py` - NEW)

```python
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum
from pathlib import Path


class ContentType(Enum):
    """Slide content classification."""
    TITLE = "title"
    SECTION_HEADER = "section_header"
    BULLET_LIST = "bullet_list"
    STATISTIC = "statistic"
    STATS_DASHBOARD = "stats_dashboard"
    QUOTE = "quote"
    CASE_STUDY = "case_study"
    COMPARISON = "comparison"
    IMAGE_FOCUSED = "image_focused"
    FEATURE = "feature"
    CLOSING = "closing"
    UNKNOWN = "unknown"


class ShapeType(Enum):
    """Shape classification."""
    TITLE = "title"
    SUBTITLE = "subtitle"
    BODY = "body"
    BULLET_LIST = "bullet_list"
    IMAGE = "image"
    TABLE = "table"
    CHART = "chart"
    FOOTER = "footer"
    SLIDE_NUMBER = "slide_number"
    LOGO = "logo"
    DECORATIVE = "decorative"
    UNKNOWN = "unknown"


@dataclass
class TextRun:
    """A run of text with consistent formatting."""
    text: str
    bold: bool = False
    italic: bool = False
    font_size: Optional[int] = None  # In hundredths of point
    font_name: Optional[str] = None
    color: Optional[str] = None  # Hex color


@dataclass
class Paragraph:
    """A paragraph containing text runs."""
    runs: List[TextRun]
    level: int = 0  # Bullet indent level (0 = no bullet)
    bullet_char: Optional[str] = None

    @property
    def text(self) -> str:
        return ''.join(run.text for run in self.runs)

    @property
    def is_bullet(self) -> bool:
        return self.level > 0 or self.bullet_char is not None


@dataclass
class Shape:
    """A shape extracted from a slide."""
    id: str
    shape_type: ShapeType
    paragraphs: List[Paragraph]
    position: Dict[str, int]  # x, y, width, height in EMUs
    placeholder_type: Optional[str] = None
    placeholder_idx: Optional[str] = None
    name: Optional[str] = None

    @property
    def text(self) -> str:
        return '\n'.join(p.text for p in self.paragraphs)

    @property
    def bullet_items(self) -> List[str]:
        return [p.text for p in self.paragraphs if p.is_bullet]


@dataclass
class TableCell:
    """A cell in a table."""
    text: str
    row: int
    col: int
    rowspan: int = 1
    colspan: int = 1


@dataclass
class Table:
    """A table extracted from a slide."""
    cells: List[TableCell]
    rows: int
    cols: int
    position: Dict[str, int]

    def to_grid(self) -> List[List[str]]:
        """Convert to 2D grid."""
        grid = [[''] * self.cols for _ in range(self.rows)]
        for cell in self.cells:
            grid[cell.row][cell.col] = cell.text
        return grid


@dataclass
class Image:
    """An image extracted from a slide."""
    path: Path
    position: Dict[str, int]
    width: int
    height: int
    relationship_id: str


@dataclass
class Slide:
    """A fully extracted slide."""
    number: int
    shapes: List[Shape]
    tables: List[Table]
    images: List[Image]
    layout_index: Optional[int] = None
    notes: Optional[str] = None

    @property
    def title(self) -> Optional[str]:
        for shape in self.shapes:
            if shape.shape_type == ShapeType.TITLE:
                return shape.text
        return None

    @property
    def body_shapes(self) -> List[Shape]:
        return [s for s in self.shapes if s.shape_type == ShapeType.BODY]

    @property
    def body_text(self) -> str:
        return '\n\n'.join(s.text for s in self.body_shapes)

    @property
    def all_bullets(self) -> List[str]:
        bullets = []
        for shape in self.shapes:
            bullets.extend(shape.bullet_items)
        return bullets


@dataclass
class Presentation:
    """A fully extracted presentation."""
    slides: List[Slide]
    source_path: Path
    slide_width: int  # EMUs
    slide_height: int  # EMUs

    @property
    def slide_count(self) -> int:
        return len(self.slides)


# Layout/Template Models

@dataclass
class PlaceholderInfo:
    """Info about a placeholder in a layout."""
    type: str  # 'title', 'body', 'picture', etc.
    idx: Optional[str]
    position: Dict[str, int]
    has_text_capacity: bool
    max_chars_estimate: int


@dataclass
class LayoutInfo:
    """Info about a single layout in the template."""
    index: int
    name: str
    placeholders: List[PlaceholderInfo]
    has_title: bool
    has_body: bool
    has_picture: bool
    body_count: int  # Number of body placeholders

    @property
    def capabilities(self) -> Dict[str, bool]:
        return {
            'title': self.has_title,
            'body': self.has_body,
            'picture': self.has_picture,
            'multiple_body': self.body_count > 1,
        }


@dataclass
class TemplateInfo:
    """Complete template analysis."""
    path: Path
    layouts: List[LayoutInfo]
    slide_count: int
    master_count: int
    color_scheme: Dict[str, str]
    fonts: List[str]

    def get_layout(self, index: int) -> Optional[LayoutInfo]:
        for layout in self.layouts:
            if layout.index == index:
                return layout
        return None

    def layouts_with_capability(self, **caps) -> List[LayoutInfo]:
        """Find layouts matching capability requirements."""
        results = []
        for layout in self.layouts:
            match = True
            for cap, required in caps.items():
                if layout.capabilities.get(cap, False) != required:
                    match = False
                    break
            if match:
                results.append(layout)
        return results


# Migration Planning Models

@dataclass
class LayoutChoice:
    """A layout selection decision."""
    layout_index: int
    layout_name: str
    confidence: float
    reason: str
    alternatives: List[int] = field(default_factory=list)


@dataclass
class ContentMapping:
    """How content maps to a layout."""
    source_shape_id: str
    target_placeholder_type: str
    target_placeholder_idx: Optional[str]
    content_truncated: bool
    truncation_point: Optional[int] = None


@dataclass
class SlideTransformation:
    """Plan for transforming one slide."""
    source_slide: int
    target_layout: LayoutChoice
    content_type: ContentType
    content_mappings: List[ContentMapping]
    images_to_insert: List[str]
    warnings: List[str] = field(default_factory=list)


@dataclass
class MigrationPlan:
    """Complete migration plan."""
    source: Presentation
    template: TemplateInfo
    transformations: List[SlideTransformation]

    @property
    def warnings(self) -> List[str]:
        all_warnings = []
        for t in self.transformations:
            for w in t.warnings:
                all_warnings.append(f"Slide {t.source_slide}: {w}")
        return all_warnings


# Validation Models

@dataclass
class ContentDiff:
    """Difference between source and output content."""
    source_text: str
    output_text: str
    missing_text: List[str]
    extra_text: List[str]
    match_percentage: float


@dataclass
class ValidationResult:
    """Result of validating output."""
    valid: bool
    content_diffs: List[ContentDiff]
    brand_issues: List[str]
    structural_issues: List[str]

    @property
    def summary(self) -> str:
        if self.valid:
            return "Validation passed"
        issues = len(self.content_diffs) + len(self.brand_issues) + len(self.structural_issues)
        return f"Validation failed: {issues} issues found"
```

---

## 3. Module Designs

### 3.1 `extract.py` - Content Extraction

```python
"""
Structured content extraction from PPTX files.

Preserves:
- Shape relationships and positions
- Paragraph/bullet structure
- Tables with cell positions
- Images with metadata
"""

from pathlib import Path
from typing import List, Optional
import zipfile
import tempfile
from lxml import etree

from .models import (
    Presentation, Slide, Shape, ShapeType,
    Paragraph, TextRun, Table, TableCell, Image
)
from .pptx_utils import NSMAP


def extract_presentation(pptx_path: Path, extract_images: bool = True) -> Presentation:
    """
    Extract complete presentation with full structure.

    Args:
        pptx_path: Path to source PPTX
        extract_images: Whether to extract images to temp directory

    Returns:
        Presentation object with all slides, shapes, tables, images
    """
    # Implementation:
    # 1. Unzip PPTX to temp directory
    # 2. Parse presentation.xml for dimensions
    # 3. For each slide in order:
    #    - Parse slide XML
    #    - Extract all shapes with classify_shape()
    #    - Extract all tables with extract_table()
    #    - Extract images if requested
    # 4. Return structured Presentation
    pass


def extract_slide(slide_xml: Path, slide_num: int, media_dir: Optional[Path]) -> Slide:
    """
    Extract single slide with all content.
    """
    tree = etree.parse(str(slide_xml))
    root = tree.getroot()

    shapes = extract_shapes(root)
    tables = extract_tables(root)
    images = extract_images(root, media_dir) if media_dir else []

    return Slide(
        number=slide_num,
        shapes=shapes,
        tables=tables,
        images=images,
    )


def extract_shapes(root: etree._Element) -> List[Shape]:
    """
    Extract all shapes with proper classification.
    """
    shapes = []

    for sp in root.xpath('.//p:sp', namespaces=NSMAP):
        shape = extract_single_shape(sp)
        if shape:
            shapes.append(shape)

    # Sort by position (top-to-bottom, left-to-right)
    shapes.sort(key=lambda s: (s.position.get('y', 0), s.position.get('x', 0)))

    return shapes


def extract_single_shape(sp: etree._Element) -> Optional[Shape]:
    """
    Extract a single shape with type classification.
    """
    # Get shape ID and name
    nvSpPr = sp.find('.//p:nvSpPr', namespaces=NSMAP)
    cNvPr = nvSpPr.find('p:cNvPr', namespaces=NSMAP) if nvSpPr else None

    shape_id = cNvPr.get('id', '') if cNvPr else ''
    shape_name = cNvPr.get('name', '') if cNvPr else ''

    # Get placeholder info
    ph = sp.find('.//p:ph', namespaces=NSMAP)
    ph_type = ph.get('type') if ph is not None else None
    ph_idx = ph.get('idx') if ph is not None else None

    # Get position
    position = extract_position(sp)

    # Extract paragraphs
    paragraphs = extract_paragraphs(sp)

    # Classify shape type
    shape_type = classify_shape(ph_type, shape_name, paragraphs, position)

    return Shape(
        id=shape_id,
        shape_type=shape_type,
        paragraphs=paragraphs,
        position=position,
        placeholder_type=ph_type,
        placeholder_idx=ph_idx,
        name=shape_name,
    )


def classify_shape(
    ph_type: Optional[str],
    name: str,
    paragraphs: List[Paragraph],
    position: Dict[str, int]
) -> ShapeType:
    """
    Classify shape based on placeholder type, name, content, and position.
    """
    # Priority 1: Placeholder type
    if ph_type:
        type_map = {
            'title': ShapeType.TITLE,
            'ctrTitle': ShapeType.TITLE,
            'subTitle': ShapeType.SUBTITLE,
            'body': ShapeType.BODY,
            'pic': ShapeType.IMAGE,
            'tbl': ShapeType.TABLE,
            'chart': ShapeType.CHART,
            'ftr': ShapeType.FOOTER,
            'sldNum': ShapeType.SLIDE_NUMBER,
        }
        if ph_type in type_map:
            return type_map[ph_type]

    # Priority 2: Shape name patterns
    name_lower = name.lower()
    if 'title' in name_lower:
        return ShapeType.TITLE
    if 'footer' in name_lower:
        return ShapeType.FOOTER
    if 'logo' in name_lower:
        return ShapeType.LOGO
    if 'slide number' in name_lower or 'sldnum' in name_lower:
        return ShapeType.SLIDE_NUMBER

    # Priority 3: Position heuristics
    # Shapes in top 15% of slide are likely titles
    # Shapes in bottom 10% are likely footers
    slide_height = 6858000  # Default EMU height
    y = position.get('y', 0)

    if y < slide_height * 0.15 and paragraphs:
        # Top of slide with text - likely title
        return ShapeType.TITLE

    if y > slide_height * 0.90:
        # Bottom of slide - likely footer
        return ShapeType.FOOTER

    # Priority 4: Content analysis
    if paragraphs:
        has_bullets = any(p.is_bullet for p in paragraphs)
        if has_bullets:
            return ShapeType.BULLET_LIST
        return ShapeType.BODY

    return ShapeType.UNKNOWN


def extract_paragraphs(sp: etree._Element) -> List[Paragraph]:
    """
    Extract paragraphs with bullet structure preserved.
    """
    paragraphs = []

    for p_elem in sp.xpath('.//a:p', namespaces=NSMAP):
        runs = extract_text_runs(p_elem)

        if not runs:
            continue

        # Get bullet level
        pPr = p_elem.find('a:pPr', namespaces=NSMAP)
        level = int(pPr.get('lvl', 0)) if pPr is not None else 0

        # Check for bullet
        buChar = p_elem.find('.//a:buChar', namespaces=NSMAP)
        bullet_char = buChar.get('char') if buChar is not None else None

        # Also check for buAutoNum (numbered lists)
        buAutoNum = p_elem.find('.//a:buAutoNum', namespaces=NSMAP)
        if buAutoNum is not None:
            bullet_char = '#'  # Marker for numbered list

        paragraphs.append(Paragraph(
            runs=runs,
            level=level,
            bullet_char=bullet_char,
        ))

    return paragraphs


def extract_text_runs(p_elem: etree._Element) -> List[TextRun]:
    """
    Extract text runs with formatting.
    """
    runs = []

    for r_elem in p_elem.xpath('.//a:r', namespaces=NSMAP):
        t_elem = r_elem.find('a:t', namespaces=NSMAP)
        if t_elem is None or not t_elem.text:
            continue

        rPr = r_elem.find('a:rPr', namespaces=NSMAP)

        bold = False
        italic = False
        font_size = None
        font_name = None
        color = None

        if rPr is not None:
            bold = rPr.get('b') == '1'
            italic = rPr.get('i') == '1'
            font_size = int(rPr.get('sz')) if rPr.get('sz') else None

            # Font name
            latin = rPr.find('a:latin', namespaces=NSMAP)
            if latin is not None:
                font_name = latin.get('typeface')

            # Color
            solidFill = rPr.find('a:solidFill', namespaces=NSMAP)
            if solidFill is not None:
                srgbClr = solidFill.find('a:srgbClr', namespaces=NSMAP)
                if srgbClr is not None:
                    color = srgbClr.get('val')

        runs.append(TextRun(
            text=t_elem.text,
            bold=bold,
            italic=italic,
            font_size=font_size,
            font_name=font_name,
            color=color,
        ))

    return runs


def extract_tables(root: etree._Element) -> List[Table]:
    """
    Extract all tables from slide.
    """
    tables = []

    for tbl in root.xpath('.//a:tbl', namespaces=NSMAP):
        cells = []
        rows = 0
        cols = 0

        for row_idx, tr in enumerate(tbl.xpath('.//a:tr', namespaces=NSMAP)):
            rows = max(rows, row_idx + 1)
            for col_idx, tc in enumerate(tr.xpath('.//a:tc', namespaces=NSMAP)):
                cols = max(cols, col_idx + 1)

                # Extract text from cell
                text_parts = []
                for t in tc.xpath('.//a:t', namespaces=NSMAP):
                    if t.text:
                        text_parts.append(t.text)

                cells.append(TableCell(
                    text=' '.join(text_parts),
                    row=row_idx,
                    col=col_idx,
                ))

        # Get table position from parent graphic frame
        # (implementation details omitted for brevity)
        position = {'x': 0, 'y': 0, 'width': 0, 'height': 0}

        tables.append(Table(
            cells=cells,
            rows=rows,
            cols=cols,
            position=position,
        ))

    return tables


def extract_position(sp: etree._Element) -> Dict[str, int]:
    """
    Extract shape position in EMUs.
    """
    xfrm = sp.find('.//a:xfrm', namespaces=NSMAP)
    if xfrm is None:
        return {'x': 0, 'y': 0, 'width': 0, 'height': 0}

    off = xfrm.find('a:off', namespaces=NSMAP)
    ext = xfrm.find('a:ext', namespaces=NSMAP)

    return {
        'x': int(off.get('x', 0)) if off is not None else 0,
        'y': int(off.get('y', 0)) if off is not None else 0,
        'width': int(ext.get('cx', 0)) if ext is not None else 0,
        'height': int(ext.get('cy', 0)) if ext is not None else 0,
    }
```

### 3.2 `template.py` - Template Analysis

```python
"""
Template analysis - discover available layouts and their capabilities.
"""

from pathlib import Path
from typing import List, Optional
import zipfile
import tempfile
from lxml import etree

from .models import TemplateInfo, LayoutInfo, PlaceholderInfo
from .pptx_utils import NSMAP


def analyze_template(template_path: Path) -> TemplateInfo:
    """
    Analyze template to discover available layouts.

    Returns:
        TemplateInfo with all layouts and their capabilities
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        work_dir = Path(tmpdir)

        with zipfile.ZipFile(template_path, 'r') as zf:
            zf.extractall(work_dir)

        # Count slides and masters
        slides_dir = work_dir / 'ppt/slides'
        slide_count = len(list(slides_dir.glob('slide*.xml')))

        layouts_dir = work_dir / 'ppt/slideLayouts'
        master_count = len(list((work_dir / 'ppt/slideMasters').glob('slideMaster*.xml')))

        # Analyze each slide as a potential layout
        layouts = []
        for i in range(1, slide_count + 1):
            slide_xml = slides_dir / f'slide{i}.xml'
            if slide_xml.exists():
                layout_info = analyze_slide_as_layout(slide_xml, i)
                layouts.append(layout_info)

        # Extract color scheme
        color_scheme = extract_color_scheme(work_dir)

        # Extract fonts
        fonts = extract_fonts(work_dir)

        return TemplateInfo(
            path=template_path,
            layouts=layouts,
            slide_count=slide_count,
            master_count=master_count,
            color_scheme=color_scheme,
            fonts=fonts,
        )


def analyze_slide_as_layout(slide_xml: Path, index: int) -> LayoutInfo:
    """
    Analyze a slide to determine its layout capabilities.
    """
    tree = etree.parse(str(slide_xml))
    root = tree.getroot()

    placeholders = []
    has_title = False
    has_body = False
    has_picture = False
    body_count = 0

    # Analyze all shapes
    for sp in root.xpath('.//p:sp', namespaces=NSMAP):
        ph = sp.find('.//p:ph', namespaces=NSMAP)
        if ph is None:
            continue

        ph_type = ph.get('type', '')
        ph_idx = ph.get('idx')

        # Get position
        position = {}
        xfrm = sp.find('.//a:xfrm', namespaces=NSMAP)
        if xfrm is not None:
            off = xfrm.find('a:off', namespaces=NSMAP)
            ext = xfrm.find('a:ext', namespaces=NSMAP)
            if off is not None and ext is not None:
                position = {
                    'x': int(off.get('x', 0)),
                    'y': int(off.get('y', 0)),
                    'width': int(ext.get('cx', 0)),
                    'height': int(ext.get('cy', 0)),
                }

        # Estimate max chars based on width
        width_inches = position.get('width', 0) / 914400
        max_chars = int(width_inches * 15)  # ~15 chars per inch at typical font

        placeholders.append(PlaceholderInfo(
            type=ph_type,
            idx=ph_idx,
            position=position,
            has_text_capacity=ph_type in ['title', 'ctrTitle', 'body', 'subTitle'],
            max_chars_estimate=max_chars,
        ))

        # Track capabilities
        if ph_type in ['title', 'ctrTitle']:
            has_title = True
        elif ph_type == 'body':
            has_body = True
            body_count += 1
        elif ph_type == 'pic':
            has_picture = True

    # Also check for pictures (p:pic elements)
    pics = root.xpath('.//p:pic', namespaces=NSMAP)
    if pics:
        has_picture = True

    # Derive name from content or index
    name = f"Layout {index}"
    title_shape = root.xpath('.//p:sp[.//p:ph[@type="title" or @type="ctrTitle"]]//a:t', namespaces=NSMAP)
    if title_shape and title_shape[0].text:
        name = title_shape[0].text[:30]

    return LayoutInfo(
        index=index,
        name=name,
        placeholders=placeholders,
        has_title=has_title,
        has_body=has_body,
        has_picture=has_picture,
        body_count=body_count,
    )


def extract_color_scheme(work_dir: Path) -> Dict[str, str]:
    """Extract color scheme from theme."""
    colors = {}
    theme_path = work_dir / 'ppt/theme/theme1.xml'

    if theme_path.exists():
        tree = etree.parse(str(theme_path))
        # Extract dk1, lt1, accent1-6, etc.
        # (implementation details)

    return colors


def extract_fonts(work_dir: Path) -> List[str]:
    """Extract font list from theme."""
    fonts = []
    theme_path = work_dir / 'ppt/theme/theme1.xml'

    if theme_path.exists():
        tree = etree.parse(str(theme_path))
        for font in tree.xpath('.//a:latin/@typeface', namespaces=NSMAP):
            if font and font not in fonts:
                fonts.append(font)

    return fonts
```

### 3.3 `classify.py` - Claude-Assisted Classification

```python
"""
Content classification using Claude for intelligent analysis.
"""

from typing import List, Tuple
import anthropic

from .models import Slide, ContentType, LayoutInfo


# Classification prompt template
CLASSIFICATION_PROMPT = """Analyze this presentation slide content and classify it.

**Title:** {title}

**Body Content:**
{body}

**Bullet Count:** {bullet_count}
**Has Table:** {has_table}
**Has Image:** {has_image}

Based on this content, what type of slide is this? Choose ONE:

- TITLE: Opening/title slide with just a title
- SECTION_HEADER: Section divider with minimal text
- BULLET_LIST: Multiple bullet points (3+)
- STATISTIC: Features a key number/metric prominently
- STATS_DASHBOARD: Multiple statistics (4+)
- QUOTE: Contains a quotation
- CASE_STUDY: Client story or testimonial
- COMPARISON: Two columns or before/after
- IMAGE_FOCUSED: Primary content is an image
- FEATURE: Describes a feature/capability
- CLOSING: Call to action or closing slide

Respond with just the type name, nothing else."""


def classify_slide_with_claude(slide: Slide, client: anthropic.Anthropic) -> ContentType:
    """
    Use Claude to classify slide content.
    """
    prompt = CLASSIFICATION_PROMPT.format(
        title=slide.title or "(no title)",
        body=slide.body_text[:500] or "(no body)",
        bullet_count=len(slide.all_bullets),
        has_table=len(slide.tables) > 0,
        has_image=len(slide.images) > 0,
    )

    response = client.messages.create(
        model="claude-3-5-haiku-20241022",  # Fast, cheap for classification
        max_tokens=50,
        messages=[{"role": "user", "content": prompt}]
    )

    type_str = response.content[0].text.strip().upper()

    try:
        return ContentType[type_str]
    except KeyError:
        return ContentType.UNKNOWN


def batch_classify_slides(
    slides: List[Slide],
    client: anthropic.Anthropic
) -> List[Tuple[Slide, ContentType]]:
    """
    Classify all slides efficiently.
    """
    results = []
    for slide in slides:
        content_type = classify_slide_with_claude(slide, client)
        results.append((slide, content_type))
    return results


def suggest_layout(
    slide: Slide,
    content_type: ContentType,
    available_layouts: List[LayoutInfo],
    recent_layouts: List[int],  # For variety tracking
) -> Tuple[LayoutInfo, str]:
    """
    Suggest best layout for slide based on content and variety.

    Returns:
        Tuple of (chosen layout, reason string)
    """
    # Filter to capable layouts
    candidates = []

    for layout in available_layouts:
        # Must have title if slide has title
        if slide.title and not layout.has_title:
            continue

        # Must have body if slide has body content
        if slide.body_text and not layout.has_body:
            continue

        # Prefer layouts with picture placeholder if slide has images
        if slide.images and layout.has_picture:
            candidates.insert(0, layout)  # Prioritize
        else:
            candidates.append(layout)

    if not candidates:
        # Fallback to any layout with body
        candidates = [l for l in available_layouts if l.has_body]

    if not candidates:
        # Ultimate fallback
        candidates = available_layouts[:1]

    # Avoid recently used layouts for variety
    for candidate in candidates:
        if candidate.index not in recent_layouts[-3:]:
            return candidate, f"Best match for {content_type.value}, provides variety"

    # If all were recent, just use the best match
    return candidates[0], f"Best match for {content_type.value}"
```

### 3.4 `transform.py` - Migration Planning

```python
"""
Transform source content to target layouts.
"""

from typing import List

from .models import (
    Presentation, Slide, TemplateInfo, LayoutInfo,
    MigrationPlan, SlideTransformation, LayoutChoice, ContentMapping,
    ContentType
)
from .classify import suggest_layout


def plan_migration(
    source: Presentation,
    template: TemplateInfo,
    classifications: List[ContentType],
) -> MigrationPlan:
    """
    Create complete migration plan.
    """
    transformations = []
    recent_layouts = []

    for slide, content_type in zip(source.slides, classifications):
        layout, reason = suggest_layout(
            slide,
            content_type,
            template.layouts,
            recent_layouts,
        )

        # Create content mappings
        mappings = create_content_mappings(slide, layout)

        # Track layout for variety
        recent_layouts.append(layout.index)

        # Collect warnings
        warnings = []
        if slide.title and not layout.has_title:
            warnings.append("Layout has no title placeholder, title may be lost")
        if slide.body_text and not layout.has_body:
            warnings.append("Layout has no body placeholder, body content may be lost")

        transformations.append(SlideTransformation(
            source_slide=slide.number,
            target_layout=LayoutChoice(
                layout_index=layout.index,
                layout_name=layout.name,
                confidence=0.8,  # Could be refined
                reason=reason,
            ),
            content_type=content_type,
            content_mappings=mappings,
            images_to_insert=[img.path for img in slide.images],
            warnings=warnings,
        ))

    return MigrationPlan(
        source=source,
        template=template,
        transformations=transformations,
    )


def create_content_mappings(slide: Slide, layout: LayoutInfo) -> List[ContentMapping]:
    """
    Map slide content to layout placeholders.
    """
    mappings = []

    # Find title placeholder
    title_ph = next((p for p in layout.placeholders if p.type in ['title', 'ctrTitle']), None)

    # Find body placeholders
    body_phs = [p for p in layout.placeholders if p.type == 'body']

    # Map title
    for shape in slide.shapes:
        if shape.shape_type.value == 'title' and title_ph:
            truncated = len(shape.text) > title_ph.max_chars_estimate
            mappings.append(ContentMapping(
                source_shape_id=shape.id,
                target_placeholder_type='title',
                target_placeholder_idx=title_ph.idx,
                content_truncated=truncated,
                truncation_point=title_ph.max_chars_estimate if truncated else None,
            ))

    # Map body content
    body_shapes = slide.body_shapes
    for i, shape in enumerate(body_shapes):
        if i < len(body_phs):
            ph = body_phs[i]
            truncated = len(shape.text) > ph.max_chars_estimate
            mappings.append(ContentMapping(
                source_shape_id=shape.id,
                target_placeholder_type='body',
                target_placeholder_idx=ph.idx,
                content_truncated=truncated,
                truncation_point=ph.max_chars_estimate if truncated else None,
            ))

    return mappings
```

### 3.5 `assemble.py` - PPTX Assembly

```python
"""
Assemble output PPTX from migration plan.
"""

from pathlib import Path
import zipfile
import tempfile
import shutil
from lxml import etree

from .models import MigrationPlan, SlideTransformation
from .pptx_utils import NSMAP


def create_presentation(plan: MigrationPlan, output_path: Path) -> Path:
    """
    Create output PPTX from migration plan.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        work_dir = Path(tmpdir)

        # Extract template
        template_dir = work_dir / 'template'
        output_dir = work_dir / 'output'

        with zipfile.ZipFile(plan.template.path, 'r') as zf:
            zf.extractall(template_dir)

        shutil.copytree(template_dir, output_dir)

        slides_dir = output_dir / 'ppt/slides'

        # Process each transformation
        for transform in plan.transformations:
            process_transformation(
                transform,
                plan.source,
                template_dir,
                output_dir,
            )

        # Update package structure
        update_package_structure(output_dir, len(plan.transformations))

        # Create output PPTX
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for root_path, dirs, files in os.walk(output_dir):
                for file in files:
                    file_path = Path(root_path) / file
                    arc_path = file_path.relative_to(output_dir)
                    zf.write(file_path, arc_path)

        return output_path


def process_transformation(
    transform: SlideTransformation,
    source: 'Presentation',
    template_dir: Path,
    output_dir: Path,
) -> None:
    """
    Process single slide transformation.
    """
    src_slide_num = transform.target_layout.layout_index
    dst_slide_num = transform.source_slide

    # Copy template slide
    src_slide = template_dir / f'ppt/slides/slide{src_slide_num}.xml'
    dst_slide = output_dir / f'ppt/slides/slide{dst_slide_num}.xml'

    if not src_slide.exists():
        raise FileNotFoundError(f"Template slide {src_slide_num} not found")

    shutil.copy(src_slide, dst_slide)

    # Also copy relationships
    src_rels = template_dir / f'ppt/slides/_rels/slide{src_slide_num}.xml.rels'
    dst_rels = output_dir / f'ppt/slides/_rels/slide{dst_slide_num}.xml.rels'
    if src_rels.exists():
        shutil.copy(src_rels, dst_rels)

    # Get source slide content
    source_slide = source.slides[transform.source_slide - 1]

    # Populate content
    populate_slide_content(dst_slide, source_slide, transform)

    # Insert images if any
    if transform.images_to_insert:
        insert_images(dst_slide, dst_rels, transform.images_to_insert, output_dir)


def populate_slide_content(
    slide_path: Path,
    source_slide: 'Slide',
    transform: SlideTransformation,
) -> None:
    """
    Populate slide placeholders with source content.
    """
    tree = etree.parse(str(slide_path))
    root = tree.getroot()

    for mapping in transform.content_mappings:
        # Find source shape
        source_shape = next(
            (s for s in source_slide.shapes if s.id == mapping.source_shape_id),
            None
        )
        if not source_shape:
            continue

        # Find target placeholder
        if mapping.target_placeholder_idx:
            xpath = f'.//p:sp[.//p:ph[@type="{mapping.target_placeholder_type}" and @idx="{mapping.target_placeholder_idx}"]]'
        else:
            xpath = f'.//p:sp[.//p:ph[@type="{mapping.target_placeholder_type}"]]'

        target_shapes = root.xpath(xpath, namespaces=NSMAP)
        if not target_shapes:
            continue

        target_shape = target_shapes[0]

        # Get content (with possible truncation)
        content = source_shape.text
        if mapping.content_truncated and mapping.truncation_point:
            content = content[:mapping.truncation_point]

        # Replace text, preserving bullet structure
        replace_shape_content(target_shape, source_shape)

    tree.write(str(slide_path), xml_declaration=True, encoding='UTF-8', standalone=True)


def replace_shape_content(target: etree._Element, source: 'Shape') -> None:
    """
    Replace content in target shape with source content.
    Preserves bullet structure from source.
    """
    # Find text body
    txBody = target.find('.//p:txBody', namespaces=NSMAP)
    if txBody is None:
        return

    # Clear existing paragraphs except first (keep formatting)
    existing_ps = txBody.xpath('.//a:p', namespaces=NSMAP)
    template_p = existing_ps[0] if existing_ps else None

    for p in existing_ps[1:]:
        txBody.remove(p)

    # Add content paragraphs
    for i, para in enumerate(source.paragraphs):
        if i == 0 and template_p is not None:
            # Use first paragraph for first content
            set_paragraph_text(template_p, para)
        else:
            # Clone template paragraph for additional content
            new_p = clone_paragraph(template_p, para) if template_p else create_paragraph(para)
            txBody.append(new_p)


def set_paragraph_text(p_elem: etree._Element, para: 'Paragraph') -> None:
    """
    Set text in paragraph element.
    """
    # Find or create run
    r_elem = p_elem.find('.//a:r', namespaces=NSMAP)
    if r_elem is None:
        return

    t_elem = r_elem.find('a:t', namespaces=NSMAP)
    if t_elem is None:
        return

    # Set text
    t_elem.text = para.text

    # Set bullet level if applicable
    pPr = p_elem.find('a:pPr', namespaces=NSMAP)
    if pPr is not None and para.is_bullet:
        pPr.set('lvl', str(para.level))
```

### 3.6 `validate.py` - Output Validation

```python
"""
Validate migration output.
"""

from pathlib import Path
from typing import List
from difflib import SequenceMatcher

from .models import ValidationResult, ContentDiff, Presentation
from .extract import extract_presentation


def validate_output(
    source: Presentation,
    output_path: Path,
) -> ValidationResult:
    """
    Validate that output contains all source content.
    """
    # Extract output content
    output = extract_presentation(output_path, extract_images=False)

    content_diffs = []

    for src_slide, out_slide in zip(source.slides, output.slides):
        # Compare text content
        src_text = normalize_text(src_slide.body_text)
        out_text = normalize_text(out_slide.body_text)

        if src_text != out_text:
            diff = compute_diff(src_text, out_text)
            if diff.match_percentage < 0.9:  # Less than 90% match
                content_diffs.append(diff)

    # Check brand compliance (placeholder for future)
    brand_issues = []

    # Check structural issues
    structural_issues = []
    if len(output.slides) != len(source.slides):
        structural_issues.append(
            f"Slide count mismatch: source={len(source.slides)}, output={len(output.slides)}"
        )

    valid = (
        len(content_diffs) == 0 and
        len(brand_issues) == 0 and
        len(structural_issues) == 0
    )

    return ValidationResult(
        valid=valid,
        content_diffs=content_diffs,
        brand_issues=brand_issues,
        structural_issues=structural_issues,
    )


def normalize_text(text: str) -> str:
    """Normalize text for comparison."""
    # Remove extra whitespace, normalize bullets
    import re
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'[•▪■◦‣⁃]', '-', text)
    return text.strip().lower()


def compute_diff(source: str, output: str) -> ContentDiff:
    """Compute difference between source and output text."""
    matcher = SequenceMatcher(None, source, output)
    ratio = matcher.ratio()

    # Find missing text
    missing = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'delete':
            missing.append(source[i1:i2])

    # Find extra text
    extra = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'insert':
            extra.append(output[j1:j2])

    return ContentDiff(
        source_text=source[:100] + '...' if len(source) > 100 else source,
        output_text=output[:100] + '...' if len(output) > 100 else output,
        missing_text=missing,
        extra_text=extra,
        match_percentage=ratio,
    )
```

---

## 4. Implementation Order

### Week 1: Foundation

1. **Create `models.py`** — All data models
2. **Create `extract.py`** — Structured extraction
3. **Write tests for extraction** — Verify structure preserved

### Week 2: Template & Classification

4. **Create `template.py`** — Template analysis
5. **Create `classify.py`** — Claude-assisted classification
6. **Write tests for classification accuracy**

### Week 3: Transform & Assemble

7. **Create `transform.py`** — Migration planning
8. **Update `assemble.py`** — PPTX assembly from plan
9. **Write integration tests**

### Week 4: Validation & Polish

10. **Create `validate.py`** — Output validation
11. **Update `migrate.py`** — Wire everything together
12. **End-to-end testing with real decks**

---

## 5. Migration Path

### Keep
- `pptx_utils.py` — Low-level XML utilities (mostly unchanged)
- `config/` — Brand configuration (enhanced)
- CLI interface structure

### Replace
- Content extraction in `migrate.py` → `extract.py`
- Regex classification → `classify.py` with Claude
- Direct slide copying → `transform.py` + `assemble.py`

### Add
- `models.py` — Type-safe data models
- `template.py` — Template discovery
- `validate.py` — Output validation

---

## 6. Testing Strategy

```
tests/
├── test_extract.py      # Extraction preserves structure
├── test_template.py     # Template analysis correct
├── test_classify.py     # Classification accuracy
├── test_transform.py    # Mapping logic
├── test_assemble.py     # Output file valid
├── test_validate.py     # Validation catches issues
├── test_integration.py  # End-to-end
└── fixtures/
    ├── simple.pptx      # Basic test deck
    ├── complex.pptx     # Tables, images, charts
    └── template.pptx    # Test template
```

---

*Design completed: January 29, 2026*
*For: Zivtech AI Agent Platform — Phase 1*
