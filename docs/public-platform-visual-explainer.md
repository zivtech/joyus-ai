# Joyus AI Public Platform Visual Explainer

This explainer shows the public-core boundary and the strategy the repository is currently following as of April 5, 2026.

## 1. Public Core vs Private Companions

```mermaid
flowchart TB
    subgraph Surfaces["User and Client Surfaces"]
        CD["Claude Desktop / MCP clients"]
        WC["web-chat"]
        JD["joyus-desktop (private)"]
    end

    subgraph Public["Public Core in joyus-ai"]
        STATE["joyus-ai-state<br/>Feature 002 + 004"]
        MCP["joyus-ai-mcp-server<br/>Feature 006 + 009 + 010/011 path"]
        GOV["governance + specs<br/>Feature 003 + 007 + 008 + 011 + 012"]
    end

    subgraph Private["Private Companions"]
        ENGINE["joyus-profile-engine<br/>Feature 005 implementation"]
        SKILLS["org/client skill repos"]
        OPS["ops / deployment repos"]
    end

    CD --> STATE
    CD --> MCP
    WC --> MCP
    JD --> MCP
    GOV --> STATE
    GOV --> MCP
    MCP --> ENGINE
    MCP --> SKILLS
    MCP --> OPS
```

## 2. Strategy Sequencing

```mermaid
flowchart LR
    A["Public foundation already in repo<br/>002 state/context<br/>004 workflow enforcement<br/>006 content infrastructure"] --> B["Current public runtime<br/>009 automated pipelines"]
    B --> C["Public validation complete<br/>010 Inngest evaluation spike"]
    C --> D["Next public cleanup / cutover<br/>011 Inngest migration"]
    A --> E["Parallel public governance work<br/>007 org-scale governance"]
    A --> F["Parallel public planning work<br/>008 profile isolation and scale"]
    F --> G["Tenant-safe profile infrastructure around a private engine"]
    H["Private companion implementation<br/>005 joyus-profile-engine"] --> G
```

## 3. Reading the Boundary Correctly

- Public here means platform core, governance artifacts, and work-package definitions live in this repository.
- Private here means proprietary skills, real corpora, deployment hardening, and the current profile-engine implementation stay outside this repository.
- Feature `005` is public as a specification and private as an implementation surface.
- Features `007`, `008`, and `011` are the next public planning/governance streams already visible in this repository.

## 4. Future Lanes

### Public-leaning roadmap lanes

- Platform Framework
- Regulatory Change Detection Pipeline
- Knowledge Base Ingestion
- Code Execution Sandbox
- Plugin compatibility layer
- Compliance Modules
- Compliance framework extensions
- Visual Regression and Accessibility Testing Service

### Private-leaning companion lanes

- Asset Sharing Pipeline
- Managed hosting
- Multi-Location Operations Module
- Content Staging and Deployment Pipeline
- Structured knowledge capture and artifact lifecycle management
- AI-assisted research and decision documentation tooling
- Expert Voice Routing
- Self-Service Profile Building
- AI-Assisted Generation
- Profile Engine at Scale
- Attribution Service
