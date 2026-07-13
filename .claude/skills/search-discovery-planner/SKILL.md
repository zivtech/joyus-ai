---
name: search-discovery-planner
description: "Plan search/discovery features — architecture, indexing, faceting, autocomplete, ranking."
version: 0.2.0
---

# Search Discovery Planner

Planner skill for designing search and discovery systems *before* implementing them.

Use this skill to design search architectures that help users find content quickly, support content authors, scale with growth, and serve business goals.

## JTBD (Jobs To Be Done)

### Primary Job
When I need to build or redesign search but haven't yet decided how fields map to the index, what facets to expose, or how to handle the queries that return nothing,
I want a complete search and discovery architecture plan before implementation starts,
so I can avoid the cascade of problems that come from discovering field mapping errors or missing zero-result handling after launch.

### Secondary Jobs
- When the content model, search backend, and user-facing facets all need to work together but aren't yet aligned, I want an architecture that connects them, so I can prevent each layer from making assumptions that break the others.
- When a search system is live but underperforming and I need to redesign it, I want a plan that targets the root causes — index structure, ranking weights, analytics gaps — rather than just tuning individual boost values.
- When building for a greenfield platform without existing user data, I want a design grounded in content structure and competitor analysis, so I can instrument analytics from day one and refine once real queries arrive.

### Job Layers
- Functional: Produce a complete search architecture specification covering field-to-index mapping, analyzer strategy, facet design, relevance ranking, zero-result handling, autocomplete, non-search discovery paths, analytics instrumentation, and scaling plan.
- Emotional: Reduce the anxiety of launching search that users immediately find broken — zero results everywhere, irrelevant rankings, facets that don't match what users want to filter by.
- Social: Helps the user present a technically defensible architecture to developers, content authors, and product stakeholders who each need different things from the same search system.

### This Skill Is For
- A user planning a new search system who needs to lock the field mapping, facet strategy, and relevance logic before a developer touches the index configuration.
- A user rebuilding underperforming search who needs a root-cause redesign, not just boost-value adjustments.
- A user building on a greenfield platform who wants analytics instrumented from day one so the search can improve on real data.
- A user whose search works technically but fails users: facets that don't help, zero results with no fallback, content authors who can't tell if their content is findable.

### This Skill Is NOT For
- A user with an existing search design or live implementation who needs a quality verdict rather than a new plan; use `search-discovery-critic` instead.
- A user needing quick ad hoc synonym additions or boost value tweaks with no architecture question in scope.

### Paired With
- `search-discovery-critic`: Use after the search design exists to audit relevance, facets, zero-result handling, and analytics gaps before launch.
- `taxonomy-planner`: Use when the unresolved problem is vocabulary structure for faceted navigation, not the end-to-end search architecture.
- `content-model-planner`: Use when the content model needs to be designed or redesigned to provide the fields the search system requires.

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|-----------------|-------------|----------------------|
| Building new search with no existing architecture | The skill maps content fields to index, designs facets, specifies zero-result handling and analytics | A complete architecture spec an implementer can configure from |
| Rebuilding underperforming search | The skill identifies root causes in index structure, ranking, and discovery gaps, then redesigns | A targeted redesign plan with phased rollout and rollback strategy |
| Greenfield platform with no user data yet | The skill designs based on content structure and competitor analysis, with analytics built in from day one | A launch-ready architecture with a post-launch refinement plan |
| Search works technically but users still can't find things | The skill surfaces non-search discovery gaps: missing taxonomy nav, no related content, authors with no visibility into indexing | A discovery system plan, not just a search tuning guide |

### When to Escalate
- If the user already has a working search design or live system and needs it reviewed rather than redesigned, escalate to `search-discovery-critic`.
- If the unresolved problem is vocabulary structure and classification rather than field mapping and relevance, escalate to `taxonomy-planner`.

## Purpose

Design search strategically, not reactively:

- **Define the scope**: What content is being searched? What are the business/user goals?
- **Map content to index**: Which fields should be searchable? Which faceted? What analyzers per field?
- **Design relevance**: What ranking algorithm? What boosts? How do business priorities drive ranking?
- **Plan discoverability**: Search alone isn't enough. Plan taxonomy navigation, related content, browsing paths.
- **Handle failures**: When searches return zero results, what happens? Did-you-mean? Fallback search?
- **Design for authors**: Can content authors see if their content is discoverable?
- **Plan analytics**: What searches are failing? What do users refine by? How do insights drive improvements?
- **Scale for growth**: What happens when content grows 10x? Will the architecture hold?
- **Support multi-perspective alignment**: End-users, content-authors, developers, and product-owners have different needs — design for all four.

This skill produces a detailed search architecture specification that guides implementation.

## Use_When

- Planning a new search system for a content platform
- Redesigning search that's underperforming or hard to maintain
- Adding faceted navigation or advanced search features
- Scaling search for larger content volume or user base
- Designing search for a knowledge base, documentation system, or content hub
- Building e-commerce or product search with complex filtering
- Establishing search for a multilingual platform
- Planning search alongside content model design (content-model-planner partnership)
- Designing how non-search discovery (browse, taxonomy, related content) complements search

## Do_Not_Use_When

- You've already designed search architecture and want critique (use search-discovery-critic instead)
- You need quick ad-hoc search tuning (adjust boost values, add synonyms)
- The search system is already built and you're debugging performance
- You're just learning search architecture basics (use search-discovery-critic for reference examples)

## Companion_Skills

- **search-discovery-critic**: Use AFTER designing search to review completeness, multi-perspective alignment, and gaps
- **taxonomy-planner**: Use to design the category taxonomy that powers faceted navigation
- **content-model-planner** (if exists): Use to ensure content model provides all fields needed for search
- **drupal-planner**: Use when implementing search in Drupal Search API
- **performance-planner** (if exists): Use to design caching and scaling strategies for search performance

## Steps

1. **Define the scope and goals**: Provide context about:
   - What content is being searched? (Blog posts, products, documentation, courses, etc.)
   - What's the search backend? (Solr, Elasticsearch, Algolia, Typesense, Drupal Search API, custom?)
   - What are the primary discovery goals? (Search, browse, filter, recommendation, etc.)
   - Current state: greenfield build, redesign of existing search, or migration?

2. **Share user research and analytics** (if available):
   - What do users search for? Common queries?
   - What do users want to filter by (facets)?
   - What causes searches to fail? Zero-result query patterns?
   - What terminology do users use? (Different from content terminology?)

3. **Provide content model overview**:
   - What content types exist?
   - What fields are available?
   - Approximate volume and growth rate?
   - Multilingual content?

4. **Share constraints and requirements**:
   - Performance targets (latency acceptable? e.g., <100ms for instant search?)
   - Scale: current vs. 10x growth projection?
   - Budget/infrastructure constraints?
   - Integration requirements (CMS, analytics, recommendation engines)?

5. **Invoke the search-discovery-planner subagent**: Delegate to subagent with the full planning protocol:
   - **Local routing authority (default)**: Use `search-discovery-planner` through the catalog/meta-router; otherwise use a host general-purpose worker with the full protocol embedded. The local router owns route and model selection.
   - **Optional OMC worker**: The local router may delegate the already-selected protocol to OMC. OMC does not choose the route or model policy.
   - **Error handling**: If all routing attempts fail, surface error to user with guidance: "The search-discovery-planner agent is not available. Please use the standalone agent file (.claude/agents/search-discovery-planner.md) instead."

6. **Return planning output**: Present the structured search design with:
   - Search scope and discovery goals
   - Content-to-index mapping (fields, analyzers, boosts)
   - Facet specification (which facets, hierarchy, ordering, performance)
   - Relevance and ranking strategy (base algorithm, boost rules, synonyms)
   - Zero-result handling design (did-you-mean, fallback, suggestions)
   - Autocomplete specification (indexed fields, matching type, performance target)
   - Result presentation template (snippet generation, highlighting, metadata)
   - Non-search discovery plan (taxonomy nav, related content, collections)
   - Performance and scaling plan (latency targets, caching, 10x growth)
   - Search analytics framework (metrics, dashboards, privacy, actionability)
   - Implementation roadmap with checkpoints for search-discovery-critic review

The plan guides implementation. Use search-discovery-critic to review the completed search design.

## Tool_Usage

When invoking search-discovery-planner:

- **Read**: Load existing content models, field definitions, current search configuration, or analytics reports
- **Grep**: Analyze current search patterns, field usage, content structure, or common query types
- **Read/Grep**: Inspect provided content inventories, analytics reports, field definitions, and index statistics. If the needed measurements require command execution, record the exact data request or verification task for an executor; do not run shell commands from this planner.
- **Interview/Research**: Conduct interviews with content-authors, end-users, product managers to understand:
  - What do users search for? (Common queries, terminology)
  - What do users want to filter by? (Facet preferences)
  - What causes search to fail? (Zero-result queries, refinement patterns)
  - What's the content landscape? (Volume, types, freshness rate)
- **Analytics Collection**: If system already exists, collect:
  - Top search queries (last 30 days)
  - Zero-result query patterns
  - Facet usage (which facets do users interact with?)
  - Click-through patterns (which results get clicked?)
  - Refinement patterns (how do users narrow results?)
- **User Research**: Understand user mental models before designing facet hierarchy and field mappings. Don't assume content organization matches user mental models.

## Related_Skills

- **search-discovery-critic**: Post-design review of search architecture, facet strategy, relevance tuning, zero-result handling, analytics
- **taxonomy-planner**: Design category taxonomy that powers faceted navigation and browsing
- **content-model-critic**: Validate content model provides all fields needed for search
- **drupal-planner**: Implement search in Drupal Search API
- **performance-planner** (if exists): Design caching and scaling for search performance
