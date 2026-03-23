#!/usr/bin/env python3
"""Generate a professional PDF proposal for Automatic/Velvet Tiger founder."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, mm
from reportlab.lib.colors import HexColor, white, Color
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.graphics.shapes import Drawing, Rect, Circle, Line, String, Group, Polygon
from reportlab.graphics import renderPDF
from reportlab.platypus.flowables import Flowable
import math


# ── Color Palette ──────────────────────────────────────────────
DEEP_NAVY    = HexColor("#0B1D3A")
BRIGHT_BLUE  = HexColor("#2E86DE")
TEAL         = HexColor("#0ABAB5")
CORAL        = HexColor("#FF6B6B")
GOLD         = HexColor("#F7B731")
SOFT_GRAY    = HexColor("#F0F2F5")
MID_GRAY     = HexColor("#8395A7")
DARK_TEXT     = HexColor("#1A1A2E")
LIGHT_TEXT    = HexColor("#576574")
WHITE         = HexColor("#FFFFFF")
GRADIENT_START = HexColor("#2E86DE")
GRADIENT_END   = HexColor("#0ABAB5")


class GradientRect(Flowable):
    """A horizontal gradient rectangle."""
    def __init__(self, width, height, color1, color2, corner_radius=0):
        Flowable.__init__(self)
        self.width = width
        self.height = height
        self.color1 = color1
        self.color2 = color2
        self.corner_radius = corner_radius

    def draw(self):
        steps = 80
        step_w = self.width / steps
        for i in range(steps):
            r = self.color1.red + (self.color2.red - self.color1.red) * i / steps
            g = self.color1.green + (self.color2.green - self.color1.green) * i / steps
            b = self.color1.blue + (self.color2.blue - self.color1.blue) * i / steps
            self.canv.setFillColor(Color(r, g, b))
            self.canv.rect(i * step_w, 0, step_w + 1, self.height, stroke=0, fill=1)


class CircleIcon(Flowable):
    """A colored circle with a letter or symbol inside."""
    def __init__(self, size, bg_color, text, text_color=WHITE):
        Flowable.__init__(self)
        self.size = size
        self.bg_color = bg_color
        self.text = text
        self.text_color = text_color
        self.width = size
        self.height = size

    def draw(self):
        r = self.size / 2
        self.canv.setFillColor(self.bg_color)
        self.canv.circle(r, r, r, stroke=0, fill=1)
        self.canv.setFillColor(self.text_color)
        self.canv.setFont("Helvetica-Bold", self.size * 0.4)
        self.canv.drawCentredString(r, r - self.size * 0.14, self.text)


class NetworkDiagram(Flowable):
    """Visual diagram showing two platforms connecting."""
    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        cx = self.width / 2
        cy = self.height / 2

        # Left cluster — Automatic
        lx, ly = cx - 140, cy
        c.setFillColor(BRIGHT_BLUE)
        c.circle(lx, ly, 32, stroke=0, fill=1)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 22)
        c.drawCentredString(lx, ly - 8, "A")

        # Satellite nodes for Automatic
        auto_nodes = [
            (lx - 60, ly + 40, "MCP", BRIGHT_BLUE),
            (lx - 65, ly - 35, "Sync", BRIGHT_BLUE),
            (lx + 10, ly + 55, "Skills", BRIGHT_BLUE),
        ]
        for nx, ny, label, color in auto_nodes:
            lighter = HexColor("#5DADE2")
            c.setFillColor(lighter)
            c.circle(nx, ny, 16, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont("Helvetica", 7)
            c.drawCentredString(nx, ny - 3, label)
            # connector line
            c.setStrokeColor(HexColor("#C8E6FF"))
            c.setLineWidth(1.2)
            c.line(lx, ly, nx, ny)

        # Right cluster — Joyus AI
        rx, ry = cx + 140, cy
        c.setFillColor(TEAL)
        c.circle(rx, ry, 32, stroke=0, fill=1)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 18)
        c.drawCentredString(rx, ry - 7, "Joy")

        # Satellite nodes for Joyus
        joy_nodes = [
            (rx + 60, ry + 40, "Voice", TEAL),
            (rx + 65, ry - 35, "Gov", TEAL),
            (rx - 10, ry + 55, "Pipes", TEAL),
        ]
        for nx, ny, label, color in joy_nodes:
            lighter = HexColor("#48D1CC")
            c.setFillColor(lighter)
            c.circle(nx, ny, 16, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont("Helvetica", 7)
            c.drawCentredString(nx, ny - 3, label)
            c.setStrokeColor(HexColor("#B2F0EE"))
            c.setLineWidth(1.2)
            c.line(rx, ry, nx, ny)

        # Central connecting bridge
        # Dashed gradient line between the two
        c.setStrokeColor(GOLD)
        c.setLineWidth(2.5)
        c.setDash(6, 4)
        c.line(lx + 34, ly, rx - 34, ry)
        c.setDash()

        # Bridge label
        c.setFillColor(GOLD)
        c.roundRect(cx - 42, cy + 18, 84, 22, 11, stroke=0, fill=1)
        c.setFillColor(DEEP_NAVY)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(cx, cy + 25, "Complementary")

        # Labels under clusters
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica-Bold", 11)
        c.drawCentredString(lx, ly - 50, "Automatic")
        c.drawCentredString(rx, ry - 50, "Joyus AI")
        c.setFont("Helvetica", 8)
        c.setFillColor(LIGHT_TEXT)
        c.drawCentredString(lx, ly - 63, "Config Layer")
        c.drawCentredString(rx, ry - 63, "Knowledge Layer")


class LayerDiagram(Flowable):
    """Stacked layer diagram showing where each platform sits."""
    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        lw = self.width - 40
        x0 = 20
        layer_h = 44
        gap = 6
        corner = 8

        layers = [
            ("Business Users & Operations Teams", DEEP_NAVY, WHITE, None),
            ("Joyus AI — Organizational Knowledge Platform", TEAL, WHITE,
             "Voice profiles  |  Compliance  |  Workflows  |  Content fidelity  |  Multi-tenant governance"),
            ("Automatic — Agent Configuration Layer", BRIGHT_BLUE, WHITE,
             "Skills sync  |  MCP config  |  Project instructions  |  Agent memory  |  Templates"),
            ("AI Coding Agents", MID_GRAY, WHITE,
             "Claude Code  |  Cursor  |  Copilot  |  Cline  |  Kiro  |  Gemini CLI"),
        ]

        y = self.height - 20
        for i, (title, bg, fg, subtitle) in enumerate(layers):
            y -= layer_h + gap
            # Shadow
            c.setFillColor(HexColor("#E0E0E0"))
            c.roundRect(x0 + 2, y - 2, lw, layer_h, corner, stroke=0, fill=1)
            # Main rect
            c.setFillColor(bg)
            c.roundRect(x0, y, lw, layer_h, corner, stroke=0, fill=1)
            # Title
            c.setFillColor(fg)
            if subtitle:
                c.setFont("Helvetica-Bold", 11)
                c.drawCentredString(x0 + lw/2, y + layer_h - 18, title)
                c.setFont("Helvetica", 7.5)
                c.setFillColor(Color(fg.red, fg.green, fg.blue, 0.75))
                c.drawCentredString(x0 + lw/2, y + 8, subtitle)
            else:
                c.setFont("Helvetica-Bold", 11)
                c.drawCentredString(x0 + lw/2, y + layer_h/2 - 5, title)

            # Arrow between layers
            if i < len(layers) - 1:
                ax = x0 + lw / 2
                ay = y - gap / 2
                c.setFillColor(GOLD)
                c.setFont("Helvetica-Bold", 14)
                # down arrow
                arrow_path = c.beginPath()
                arrow_path.moveTo(ax - 8, ay + 3)
                arrow_path.lineTo(ax + 8, ay + 3)
                arrow_path.lineTo(ax, ay - 4)
                arrow_path.close()
                c.drawPath(arrow_path, fill=1, stroke=0)


class VennDiagram(Flowable):
    """Venn diagram showing overlap areas."""
    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def draw(self):
        c = self.canv
        cx = self.width / 2
        cy = self.height / 2 + 5

        # Left circle — Automatic
        c.setFillColor(Color(0.18, 0.53, 0.87, 0.15))  # BRIGHT_BLUE transparent
        c.circle(cx - 55, cy, 85, stroke=0, fill=1)
        c.setStrokeColor(BRIGHT_BLUE)
        c.setLineWidth(2)
        c.circle(cx - 55, cy, 85, stroke=1, fill=0)

        # Right circle — Joyus AI
        c.setFillColor(Color(0.04, 0.73, 0.71, 0.15))  # TEAL transparent
        c.circle(cx + 55, cy, 85, stroke=0, fill=1)
        c.setStrokeColor(TEAL)
        c.setLineWidth(2)
        c.circle(cx + 55, cy, 85, stroke=1, fill=0)

        # Labels
        c.setFillColor(BRIGHT_BLUE)
        c.setFont("Helvetica-Bold", 12)
        c.drawCentredString(cx - 90, cy + 95, "Automatic")

        c.setFillColor(TEAL)
        c.drawCentredString(cx + 90, cy + 95, "Joyus AI")

        # Left-only items
        c.setFillColor(DARK_TEXT)
        c.setFont("Helvetica", 8)
        items_left = ["Multi-agent sync", "Editor configs", "Config drift", "Templates", "skills.sh"]
        for i, item in enumerate(items_left):
            c.drawCentredString(cx - 95, cy + 25 - i * 14, item)

        # Right-only items
        items_right = ["Voice profiles", "Compliance", "Multi-tenant", "Pipelines", "Content fidelity"]
        for i, item in enumerate(items_right):
            c.drawCentredString(cx + 95, cy + 25 - i * 14, item)

        # Overlap items
        c.setFillColor(DEEP_NAVY)
        c.setFont("Helvetica-Bold", 8)
        overlap = ["MCP tools", "Skills concept", "Agent memory"]
        for i, item in enumerate(overlap):
            c.drawCentredString(cx, cy + 12 - i * 14, item)


# ── Styles ─────────────────────────────────────────────────────
styles = getSampleStyleSheet()

style_title = ParagraphStyle(
    'CustomTitle', parent=styles['Title'],
    fontName='Helvetica-Bold', fontSize=28, leading=34,
    textColor=DEEP_NAVY, alignment=TA_LEFT, spaceAfter=6
)

style_subtitle = ParagraphStyle(
    'CustomSubtitle', parent=styles['Normal'],
    fontName='Helvetica', fontSize=14, leading=18,
    textColor=LIGHT_TEXT, alignment=TA_LEFT, spaceAfter=20
)

style_h1 = ParagraphStyle(
    'H1', parent=styles['Heading1'],
    fontName='Helvetica-Bold', fontSize=20, leading=26,
    textColor=DEEP_NAVY, spaceBefore=24, spaceAfter=10
)

style_h2 = ParagraphStyle(
    'H2', parent=styles['Heading2'],
    fontName='Helvetica-Bold', fontSize=14, leading=18,
    textColor=BRIGHT_BLUE, spaceBefore=16, spaceAfter=6
)

style_body = ParagraphStyle(
    'Body', parent=styles['Normal'],
    fontName='Helvetica', fontSize=10.5, leading=15,
    textColor=DARK_TEXT, alignment=TA_JUSTIFY, spaceAfter=8
)

style_body_bold = ParagraphStyle(
    'BodyBold', parent=style_body,
    fontName='Helvetica-Bold'
)

style_bullet = ParagraphStyle(
    'Bullet', parent=style_body,
    leftIndent=20, bulletIndent=8, spaceAfter=4,
    bulletFontName='Helvetica', bulletFontSize=10
)

style_quote = ParagraphStyle(
    'Quote', parent=style_body,
    fontName='Helvetica-Oblique', fontSize=11, leading=16,
    textColor=BRIGHT_BLUE, leftIndent=20, rightIndent=20,
    spaceBefore=10, spaceAfter=10
)

style_small = ParagraphStyle(
    'Small', parent=styles['Normal'],
    fontName='Helvetica', fontSize=8.5, leading=11,
    textColor=MID_GRAY
)

style_footer = ParagraphStyle(
    'Footer', parent=styles['Normal'],
    fontName='Helvetica', fontSize=8, leading=10,
    textColor=MID_GRAY, alignment=TA_CENTER
)

style_card_title = ParagraphStyle(
    'CardTitle', parent=styles['Normal'],
    fontName='Helvetica-Bold', fontSize=12, leading=15,
    textColor=DEEP_NAVY, spaceAfter=4
)

style_card_body = ParagraphStyle(
    'CardBody', parent=styles['Normal'],
    fontName='Helvetica', fontSize=9.5, leading=13,
    textColor=LIGHT_TEXT
)


# ── Helper: colored card ───────────────────────────────────────
class CardBox(Flowable):
    """A rounded rectangle card with accent color bar."""
    def __init__(self, width, content_flowables, accent_color=BRIGHT_BLUE, padding=12):
        Flowable.__init__(self)
        self.card_width = width
        self.content = content_flowables
        self.accent = accent_color
        self.padding = padding
        # Pre-calculate height
        from reportlab.platypus.doctemplate import LayoutError
        from reportlab.lib.units import inch
        self._frame_width = width - 2 * padding - 6  # account for accent bar
        total_h = 0
        for f in content_flowables:
            w, h = f.wrap(self._frame_width, 1000)
            total_h += h
        self.height = total_h + 2 * padding
        self.width = width

    def draw(self):
        c = self.canv
        p = self.padding
        # Shadow
        c.setFillColor(HexColor("#E8E8E8"))
        c.roundRect(2, -2, self.card_width, self.height, 6, stroke=0, fill=1)
        # Background
        c.setFillColor(WHITE)
        c.roundRect(0, 0, self.card_width, self.height, 6, stroke=0, fill=1)
        # Accent bar
        c.setFillColor(self.accent)
        c.roundRect(0, 0, 4, self.height, 2, stroke=0, fill=1)
        # Content
        y = self.height - p
        for f in self.content:
            w, h = f.wrap(self._frame_width, 1000)
            y -= h
            f.drawOn(c, p + 6, y)


# ── Build PDF ──────────────────────────────────────────────────
def build():
    doc = SimpleDocTemplate(
        "/home/user/joyus-ai/joyus-automatic-proposal.pdf",
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
    )

    story = []
    page_w = letter[0] - 1.5 * inch  # usable width

    # ── PAGE 1: Cover ──────────────────────────────────────────
    story.append(Spacer(1, 30))
    story.append(GradientRect(page_w, 6, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 30))

    story.append(Paragraph("Joyus AI + Automatic", style_title))
    story.append(Paragraph(
        "Exploring Complementary Platforms for the AI Agent Ecosystem",
        style_subtitle
    ))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Prepared for <b>Christopher Skene</b>, Founder & CTO at Velvet Tiger",
        ParagraphStyle('To', parent=style_body, fontName='Helvetica', fontSize=11,
                       textColor=LIGHT_TEXT)
    ))
    story.append(Paragraph(
        "From <b>Alex</b> at Joyus AI (Zivtech)  &bull;  March 2026",
        ParagraphStyle('From', parent=style_body, fontName='Helvetica', fontSize=11,
                       textColor=LIGHT_TEXT)
    ))

    story.append(Spacer(1, 30))
    story.append(NetworkDiagram(page_w, 180))
    story.append(Spacer(1, 30))

    story.append(Paragraph(
        '"The only way we find a joyous future with AI is by ensuring it works for the joy of all of us."',
        style_quote
    ))

    story.append(Spacer(1, 20))
    story.append(GradientRect(page_w, 2, BRIGHT_BLUE, TEAL))

    # ── PAGE 2: The Opportunity ────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("The Opportunity", style_h1))
    story.append(GradientRect(60, 3, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 10))

    story.append(Paragraph(
        "We've been watching Automatic evolve and are impressed by what you're building. "
        "As we develop Joyus AI, we see a natural fit between our platforms\u2014not as competitors, "
        "but as <b>complementary layers in the AI agent stack</b>.",
        style_body
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Automatic solves <b>agent configuration fragmentation</b>\u2014keeping skills, MCP servers, "
        "and project rules in sync across Claude Code, Cursor, Copilot, and more. "
        "Joyus AI solves <b>organizational knowledge encoding</b>\u2014turning business rules, "
        "voice profiles, compliance requirements, and workflows into enforceable AI skills.",
        style_body
    ))

    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Together, we could offer something neither can alone: a full stack from "
        "<b>configuration management</b> through <b>organizational intelligence</b>.",
        style_body
    ))

    story.append(Spacer(1, 16))
    story.append(Paragraph("Where Each Platform Lives", style_h2))
    story.append(Spacer(1, 6))
    story.append(LayerDiagram(page_w, 240))

    # ── PAGE 3: Side-by-Side ───────────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("Platform Comparison", style_h1))
    story.append(GradientRect(60, 3, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 12))

    story.append(VennDiagram(page_w, 230))
    story.append(Spacer(1, 12))

    # Comparison table
    header_style = ParagraphStyle('TH', parent=style_body, fontName='Helvetica-Bold',
                                   fontSize=9.5, textColor=WHITE)
    cell_style = ParagraphStyle('TD', parent=style_body, fontSize=9, leading=12, spaceAfter=2)
    cell_bold = ParagraphStyle('TDB', parent=cell_style, fontName='Helvetica-Bold')

    data = [
        [Paragraph("Capability", header_style),
         Paragraph("Automatic", header_style),
         Paragraph("Joyus AI", header_style)],
        [Paragraph("Skills", cell_bold),
         Paragraph("Coding agent prompts & rules synced across editors", cell_style),
         Paragraph("Encoded org knowledge: voice, compliance, workflows", cell_style)],
        [Paragraph("MCP", cell_bold),
         Paragraph("Central config & env vars for connecting to MCP servers", cell_style),
         Paragraph("IS an MCP server exposing business tools", cell_style)],
        [Paragraph("Memory", cell_bold),
         Paragraph("Shared persistent memory across local coding agents", cell_style),
         Paragraph("Session state, audit logs, content fidelity tracking", cell_style)],
        [Paragraph("Multi-tenancy", cell_bold),
         Paragraph("Single-team tool", cell_style),
         Paragraph("Core architecture with tenant isolation", cell_style)],
        [Paragraph("Content Intelligence", cell_bold),
         Paragraph("\u2014", cell_style),
         Paragraph("Stylometric analysis, voice profiles, drift detection", cell_style)],
        [Paragraph("Integrations", cell_bold),
         Paragraph("11+ AI agents (Claude, Cursor, Copilot\u2026)", cell_style),
         Paragraph("Jira, Slack, GitHub, Google, Playwright", cell_style)],
    ]

    col_w = [page_w * 0.18, page_w * 0.41, page_w * 0.41]
    t = Table(data, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DEEP_NAVY),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('BACKGROUND', (0, 1), (-1, -1), SOFT_GRAY),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, SOFT_GRAY]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#DDE1E6")),
        ('ROUNDEDCORNERS', [6, 6, 6, 6]),
    ]))
    story.append(t)

    # ── PAGE 4: Synergies & Ideas ──────────────────────────────
    story.append(PageBreak())
    story.append(Paragraph("Potential Synergies", style_h1))
    story.append(GradientRect(60, 3, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 14))

    cards = [
        (BRIGHT_BLUE, "1", "Team Onboarding Acceleration",
         "We're deploying Claude Code across our team via WSL2 on Windows. "
         "Automatic could standardize our MCP server configs and project instructions "
         "so every developer connects to the Joyus AI MCP server with identical settings from day one."),
        (TEAL, "2", "Organizational Skills Distribution",
         "Joyus AI packages business knowledge as MCP-native skills. Automatic's sync engine "
         "could become the <b>distribution channel</b> that pushes these skills to every agent "
         "a team member uses\u2014not just Claude, but Cursor, Copilot, and beyond."),
        (CORAL, "3", "skills.sh as a Marketplace Layer",
         "The skills.sh registry is currently focused on coding skills. Imagine expanding it "
         "to include organizational skill templates\u2014voice profiles, compliance checks, "
         "workflow rules\u2014that teams discover and install via Automatic."),
        (GOLD, "4", "Unified Agent Memory + Org Context",
         "Automatic's agent memory system stores developer decisions. Joyus AI tracks "
         "organizational context, audit trails, and content fidelity. A bridge between these "
         "could give agents both <b>personal</b> and <b>institutional</b> memory."),
    ]

    for color, num, title, body in cards:
        card_content = [
            Paragraph(title, style_card_title),
            Paragraph(body, style_card_body),
        ]
        story.append(CardBox(page_w, card_content, accent_color=color, padding=14))
        story.append(Spacer(1, 10))

    # ── PAGE 5: About Joyus AI + Next Steps ────────────────────
    story.append(PageBreak())
    story.append(Paragraph("About Joyus AI", style_h1))
    story.append(GradientRect(60, 3, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 10))

    story.append(Paragraph(
        "Joyus AI is a <b>multi-tenant AI agent platform</b> built by Zivtech, an open source "
        "technology firm. Our platform encodes organizational knowledge\u2014business rules, "
        "brand voice, compliance requirements, operational workflows\u2014as testable, enforceable "
        "AI skills exposed via the Model Context Protocol (MCP).",
        style_body
    ))

    story.append(Spacer(1, 4))

    capabilities = [
        "<b>Content Intelligence</b> \u2014 Stylometric analysis engine (129 features) that extracts "
        "writing profiles and monitors content fidelity with two-tier verification",
        "<b>Pipeline Engine</b> \u2014 Event-driven workflows with DAG execution, approval gates, "
        "and compliance enforcement",
        "<b>Integration Hub</b> \u2014 MCP tools for Jira, Slack, GitHub, Google Suite, and browser automation",
        "<b>Multi-Tenant Governance</b> \u2014 Tenant-scoped isolation, audit logging, and configurable "
        "compliance modules (HIPAA, FERPA, and more)",
        "<b>Open Core Model</b> \u2014 Platform is open source; client-specific skills live in private repos",
    ]
    for cap in capabilities:
        story.append(Paragraph(cap, style_bullet, bulletText="\u2022"))

    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "We've validated across food manufacturing, healthcare, legal services, higher education, "
        "cultural institutions, and credentialing organizations.",
        style_body
    ))

    story.append(Spacer(1, 20))
    story.append(GradientRect(page_w, 2, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 16))

    story.append(Paragraph("Next Steps", style_h1))
    story.append(Spacer(1, 6))

    story.append(Paragraph(
        "We'd love to explore how Automatic and Joyus AI can work together. A few ideas for a first conversation:",
        style_body
    ))

    next_steps = [
        "<b>Demo exchange</b> \u2014 We show you our MCP server and content intelligence engine; "
        "you walk us through Automatic's sync architecture",
        "<b>Integration pilot</b> \u2014 Use Automatic to distribute Joyus AI MCP configs to our "
        "growing dev team as a real-world test case",
        "<b>Skills ecosystem brainstorm</b> \u2014 Explore expanding skills.sh to support "
        "organizational/business skills alongside coding skills",
    ]
    for step in next_steps:
        story.append(Paragraph(step, style_bullet, bulletText="\u2022"))

    story.append(Spacer(1, 24))

    # Contact box
    contact_content = [
        Paragraph("Let's Connect", ParagraphStyle('CT', parent=style_card_title, fontSize=14)),
        Spacer(1, 4),
        Paragraph(
            "We'd be happy to set up a call at your convenience. "
            "Reach out and let's explore what we can build together.",
            style_card_body
        ),
        Spacer(1, 6),
        Paragraph(
            "<b>Joyus AI</b> &bull; joyus.ai &bull; github.com/zivtech/joyus-ai",
            ParagraphStyle('CL', parent=style_card_body, fontSize=9)
        ),
    ]
    story.append(CardBox(page_w, contact_content, accent_color=TEAL, padding=16))

    story.append(Spacer(1, 30))
    story.append(GradientRect(page_w, 3, BRIGHT_BLUE, TEAL))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Joyus AI by Zivtech  &bull;  March 2026  &bull;  Confidential",
        style_footer
    ))

    doc.build(story)
    print("PDF generated: /home/user/joyus-ai/joyus-automatic-proposal.pdf")


if __name__ == "__main__":
    build()
