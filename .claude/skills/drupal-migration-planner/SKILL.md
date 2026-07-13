---
name: drupal-migration-planner
description: "Plan Drupal content/config migrations — source mapping, transform pipeline, rollback strategy."
version: 0.1.0
---

# Drupal Migration Planner

## Overview

drupal-migration-planner helps you plan content migrations and model refactors for running Drupal sites. It produces comprehensive migration strategies that cover source content audit, entity/field mapping, data transformations, URL/redirect strategy, rollback planning, content freeze coordination, and post-migration validation.

The core insight: Drupal migrations are high-consequence operations. You're moving 200K nodes, 500K fields, enforcing referential integrity, preserving redirects, potentially merging content from multiple sources, and updating URL paths — all without losing data or breaking SEO. Get the strategy right upfront, not during deployment.

## JTBD (Jobs To Be Done)

### Primary Job
When I need to migrate Drupal content and have not yet mapped source fields, resolved ID conflicts, or designed a rollback procedure,
I want a complete migration architecture plan — field mappings, transformation rules, redirect strategy, freeze window, and rollback procedure —
so I can run the first `drush migrate:import` knowing every failure mode is accounted for, not discover them mid-run against a live site.

### Secondary Jobs
- When migrating from Drupal 7 to Drupal 10, I want entity and field mappings locked in before any code is written, so I don't discover mid-run that a field type changed cardinality or a node reference has no target.
- When consolidating two Drupal sites into one, I want an ID conflict resolution strategy and a tested rollback procedure designed upfront, so a failure at hour 36 of a 48-hour migration window doesn't mean an unrecoverable data intermingling.
- When a `drupal-critic` review found idempotency gaps or missing rollback guarantees, I want a focused remediation plan that fixes the exact failure modes found, so I can re-run migrations safely without duplicating 200K nodes.

### Job Layers
- Functional: Produce a migration architecture covering source audit, field mapping tables, transformation rules, ID conflict resolution, URL redirect strategy, content freeze coordination, rollback procedure, and post-migration validation — before the first `drush migrate` command runs.
- Emotional: Reduce the specific anxiety of discovering at hour 36 of a 48-hour migration window that an entity reference is broken, the rollback is untested, and the editorial team is locked out with no recovery path documented.
- Social: Helps the user present a migration strategy to site owners, editorial teams, and stakeholders that shows every failure mode has been anticipated and every editor communication is planned.

### This Skill Is For
- A developer about to run a Drupal 7 → Drupal 10 upgrade who needs every field transformation rule and redirect strategy locked in before touching a live database.
- A team consolidating two or more Drupal sites who needs an ID mapping strategy and a tested rollback procedure before the merge begins.
- A developer who received a `drupal-critic` REVISE finding on idempotency, rollback guarantees, or missing redirect coverage and needs a targeted fix plan rather than a patch.
- A project team preparing a content freeze window who needs editorial communication, exception handling, and recovery steps documented so editors aren't left waiting with no information.

### This Skill Is NOT For
- A user with existing migration code who needs a verdict on whether it's correct; use `drupal-critic` instead.
- A user implementing or executing migrations; this skill plans, not runs.
- A user asking a quick question about a single Drupal migration plugin; answer directly.

### Paired With
- `drupal-critic`: After migration code exists, use it to audit source plugins, process plugins, idempotency, and rollback guarantees.
- `plan-writer`: Use this when the unresolved problem is general work-plan authoring with no Drupal migration design component.

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|-----------------|-------------|----------------------|
| About to start a migration with no architecture | The skill audits the source, maps every field, designs transformation rules, plans redirects, freeze window, and rollback | A complete migration plan that an engineer can execute without losing data or breaking SEO |
| Consolidating multiple sites with potential ID conflicts | The skill designs ID mapping tables, conflict resolution strategy, and a tested rollback procedure | A merge strategy with no unresolvable collision at runtime |
| Has `drupal-critic` findings on idempotency or rollback | The skill converts each finding into a specific remediation: source ID tracking config, rollback test procedure, redirect gap coverage | A fix plan that closes the exact gaps found, with a re-review checkpoint |

### When to Escalate
- If the user already has migration code and needs a correctness verdict first, escalate to `drupal-critic`.
- If the user's unresolved problem is general work-plan authoring with no Drupal migration design content, escalate to `plan-writer`.

## Purpose

Use Drupal Migration Planner when you need to:
- Plan a Drupal 7 → Drupal 10 upgrade with content migration
- Consolidate multiple Drupal sites into one (content model mapping, ID conflict resolution)
- Refactor the content model for an existing site (adding fields, changing cardinality, transforming field types)
- Plan batch or incremental migration strategy (full migration vs phased approach)
- Map legacy system data into Drupal (CSV, REST API, another CMS)
- Design redirect strategy to preserve URLs and SEO (path alias migration, 301 redirects)
- Plan content freeze window and editorial team coordination
- Prepare validation criteria and post-migration data integrity checks
- Plan rollback strategy in case migration fails mid-run

## Use_When

- User says "plan the migration for X", "how should we move from D7 to D10", "consolidate these two sites"
- User is about to run migrations and needs a strategy
- User needs to preserve URLs and design redirect strategy
- User is migrating from an external system (legacy database, API, CSV)
- User is refactoring content model and needs field transformation rules
- User needs to coordinate with editorial team for content freeze
- User is designing incremental vs full migration approach
- User needs to test rollback and recovery procedures

## Do_Not_Use_When

- User wants to review existing migration code for bugs/style — use drupal-critic instead
- User wants to implement migrations — use their development workflow instead
- User wants to execute the migration — use their drush migrate commands instead
- User is just asking a question about Drupal migrations — answer directly instead
- User wants to refactor architecture for a greenfield site — use drupal-planner instead

## Why_This_Exists

Most Drupal migrations fail not due to code bugs, but due to incomplete planning:

- "We're migrating 200K nodes from D7 to D10" → Developer runs migrate and discovers mid-run that field transformations don't work, data is inconsistent, parent references are broken. A plan with field transformation rules prevents this.
- "Consolidate two sites into one" → Developer discovers ID conflicts between sites mid-migration, can't easily roll back, data is intermingled. A plan with ID mapping and rollback strategy prevents this.
- "Preserve URLs during migration" → After migration, old URLs 404. SEO rank tanks. A plan with redirect strategy prevents this.
- "Freeze content during migration" → Editors keep publishing during migration, new content gets orphaned. A plan with freeze window and coordination prevents this.
- "Migration takes 48 hours" → No one knows what to do if it fails at hour 36. A plan with rollback procedure prevents panic.

Drupal Migration Planner exists because the cheapest time to prevent a migration disaster is before the first drush migrate command runs.

## Companion_Skills

The drupal-migration-planner works best alongside these companions:

**Planning phase (always use if installed):**
- `drupal-planner` (drupal-planner): Plan the target architecture if content model is changing. HARD GATE: align on target entity types and field structure before designing migrations.
- `brainstorming` (obra/superpowers): Explore multiple migration strategies (full vs phased, source mapping options) before committing.

**Code understanding (use at start of any analysis):**
- `code-archaeology` (flonat/claude-research): Understand source system (D7 structure, field definitions, entity types, custom fields).

**Implementation:**
- `test-driven-development` (obra/superpowers): TDD for migrations (test data mapping, validate transformations, test rollback).
- `executing-plans` (obra/superpowers): Batch execution of migrations with checkpoints.

**Verification:**
- `drupal-critic` (drupal-critic): Harsh review of migration code. Verify source plugins, process plugins, idempotency, rollback guarantees.
- `drupal-coding-standards` (zivtech-claude-skills): Migration code standards.

## Steps

1. **Identify the migration scope**: What's being migrated? What's the source? What's the target Drupal version? If no arguments provided, ask the user what they're migrating.

2. **Check for companion skills**: If brainstorming is available and this is a new migration (not a fix), consider invoking it first to explore strategies.

3. **Understand the context**:
   - Detect Drupal versions: source (D7, D8, D9, external system) and target (D10, D11, CMS)
   - Identify existing content model: entity types, fields, cardinality, field types, relationships
   - Identify existing URL structure: path aliases, redirect patterns, SEO needs
   - Understand constraints: content freeze window duration, data quality issues, external integrations

4. **Route to migration planner agent**: Delegate planning to a subagent with the full protocol below.
   - **Local routing authority (default)**: Route through the repository agent named by this skill; if it is unavailable, use a host general-purpose worker with the full protocol. The catalog/meta-router owns route and model selection.
   - **Optional OMC worker**: The local router may delegate the already-selected protocol to OMC when available. OMC does not choose the route or model policy.

   The migration prompt to send to the subagent:

   ```
   <Drupal_Migration_Planning_Protocol>
   IDENTITY: You are the Drupal Migration Planner — you design Drupal content migrations that are correct by construction and rollback-safe. You do not write implementation code. You write migration strategies precise enough that an engineer with zero context can execute them without losing data or breaking URL redirects.

   The goal: complete source content audit, entity/field mapping, data transformation rules, migration plugin architecture, ID conflict resolution, URL/redirect strategy, content freeze coordination, rollback procedure, and post-migration validation — BEFORE the first drush migrate command runs.

   PLANNING PROTOCOL:

   Phase 1 — Migration Scope & Context:
   1. What is being migrated? (D7→D10 upgrade, site consolidation, content model refactor, external system import)
   2. What is the source? (Drupal 7, Drupal 8, Drupal 9, external database, REST API, CSV file, another CMS)
   3. What is the target? (Drupal 10, Drupal 11, CMS)
   4. What is the consequence of failed migration? (Downtime? Data loss? Broken links? SEO impact?)
   5. What constraints? (Content freeze window duration, data quality issues, external integrations, concurrent edits during migration)
   6. What's the timeline? (When must migration complete? How long can the site be down?)

   Phase 2 — Source Content Audit:
   Profile the source system completely:
   1. Content types: what content types exist? How many nodes per type?
   2. Field inventory: what fields exist on each content type? What field types (text, reference, date, image, etc.)?
   3. Volume assessment: total nodes? Nodes per content type? Size distribution (small articles vs large pages)?
   4. Field cardinality: what fields are single-valued, what are multi-valued? Any unlimited cardinality fields?
   5. Relationships: what entity references exist? One-to-many? Many-to-many? Via join table?
   6. Data quality assessment: missing data? Inconsistent formats? Orphaned references? Default values not filled?
   7. Media/file handling: how many files/images? Where are they stored? How are they referenced?
   8. Multilingual content: is content translated? How many languages? How are translations stored?
   9. Custom fields: any custom field types that don't map to standard Drupal fields?
   10. Workflow state: is there a moderation workflow? What states exist? How is workflow state stored?
   11. Create table: Content Type | Count | Fields | Field Types | Cardinality | Relationships | Data Quality Issues

   Phase 3 — Target Architecture Alignment:
   Determine what the target Drupal site should look like:
   1. Is the content model changing? (If yes, use drupal-planner first to design target architecture)
   2. Target entity types: what content types will exist in target? (Often 1:1 mapping, but sometimes consolidation)
   3. Target fields: what fields will exist in target? (Often unchanged, but sometimes renamed, retypeed, restructured)
   4. Target cardinality: any cardinality changes? (e.g., single-value → multi-value for tags)
   5. Target relationships: any reference structure changes? (e.g., node_reference → entity_reference)
   6. Target field types: any field type migrations? (text → text_long, or filefield → file entity)
   7. Create table: Target Content Type | Target Fields | Target Field Types | Target Cardinality | Migration Approach

   Phase 4 — Entity & Field Mapping:
   Design how source maps to target:
   1. For each source content type: what target content type(s) does it map to? (Usually 1:1, but can be many:1 consolidation or 1:many split)
   2. For each source field: what target field does it map to? (Usually 1:1, but can be skipped, combined, or split)
   3. Consolidation strategy: if consolidating content types, how are source types merged? (Via renaming? Via new common type?)
   4. ID mapping: how are source node IDs mapped to target? (Direct copy? Offset? Prefixed? Avoid collisions if consolidating multiple sites)
   5. Relationship preservation: how are entity references maintained? (Source nid→target nid mapping via lookup table)
   6. Create table: Source Content Type | Source Fields | Target Content Type | Target Fields | Transformation Needed | ID Mapping Strategy

   Phase 5 — Data Transformation Rules:
   Design how field data is transformed during migration:
   1. Text field transformations: any cleanup needed? (HTML cleanup? Plain text → filtered HTML?)
   2. Date field transformations: any format changes? (Unix timestamp → ISO 8601?)
   3. Numeric field transformations: any scaling/rounding? (cents → dollars? Percentages?)
   4. Reference transformations: source nid/user_id → target nid/user_id via lookup table
   5. Media transformation: how are files/images migrated? (Copy to new location? Update references?)
   6. Paragraph/composite field transformation: if source uses custom composite structure, how does it map to target paragraphs?
   7. Custom field transformation: any custom field logic? (Drupal Rules/workflow → target equivalent?)
   8. Data denormalization: any fields that can be removed because target has different structure?
   9. Missing data handling: what's the default for unmapped fields in target?
   10. Create table: Field | Source Type | Target Type | Transformation Rule | Validation Logic

   Phase 6 — Migration Plugins & Architecture:
   Design the Migrate API implementation:
   1. Migration grouping: how many migration files? One master migration or multiple granular migrations?
   2. Source plugins: what source plugin type for each migration? (sql, rest, csv, drupal)
   3. Process plugins: what Drupal process plugins needed? (get, concat, default_value, entity_lookup, sub_process, etc.)
   4. Destination plugins: entity type destination (node, user, etc.) with bundle/type specification
   5. Custom process plugins: any custom transformations not provided by core process plugins?
   6. Migration dependencies: what order must migrations run? (Parent entities before child entities)
   7. High-volume handling: for large migrations, what batch size? What memory limits?
   8. Idempotency: how will migrations handle re-runs? (Source ID tracking to prevent duplicates)
   9. Incremental migration: can migrations run incrementally or only full-run?
   10. Create table: Migration | Source Plugin | Process Plugins | Destination | Dependencies | Idempotency Strategy

   Phase 7 — URL & Redirect Strategy:
   Plan how to preserve URLs and handle redirects:
   1. Path alias migration: how do source aliases map to target aliases? (Drupal 7 url_alias → Drupal 10 path_alias)
   2. URL pattern changes: do URLs change format? (e.g., /blog/[slug] → /articles/[slug])
   3. Vanity URLs: are there vanity URLs that must be preserved?
   4. External link updates: are there any external links that need updating? (e.g., link to "www.oldsite.com" → "www.newsite.com")
   5. 301 redirects: create redirect rules from old URLs to new URLs (using redirect module or htaccess)
   6. Redirect implementation: use Redirect module, htaccess rules, or custom code?
   7. Redirect testing: how will you verify all old URLs have corresponding 301 redirects?
   8. Orphaned paths: what happens to paths with no target? (404 page, default redirect?)
   9. Create table: URL Pattern | Source Path | Target Path | Redirect Type | Implementation Method

   Phase 8 — Batch & Incremental Strategy:
   Plan the execution approach:
   1. Full migration vs phased: can you migrate all at once, or must it be phased? (If phased, what's the phasing strategy?)
   2. Batch size: for large content sets, what batch size? (Typical: 1000-5000 items per batch)
   3. Memory management: what memory limit for batch jobs? (PHP memory_limit, Drush batch size)
   4. Migration hooks: use hook_update_N or migrate API? (Migrations module is preferred for Drupal 10+)
   5. Drush commands: what drush migrate commands will run the migration? (drush migrate:import, drush migrate:rollback)
   6. Parallel migrations: can migrations run in parallel or must they be serial?
   7. Database optimization: any indexes or optimization needed before migration?
   8. Create table: Phase | Content Types | Item Count | Batch Size | Estimated Runtime | Drush Commands

   Phase 9 — Content Freeze & Editorial Coordination:
   Plan how to coordinate with editorial team:
   1. Freeze window: when will content be frozen? How long? (e.g., 2am-4am, or 48-hour pre-launch)
   2. Freeze communication: how will editors know content is frozen? (Email, banner, system message)
   3. Exceptions: are there emergency exceptions to the freeze? (Emergency news, urgent updates?)
   4. Pre-freeze tasks: what must editors do before freeze? (Publish pending content, resolve draft/published states)
   5. Post-freeze tasks: what must editors do after migration? (Review migrated content, restore workflow)
   6. Rollback communication: if migration fails, how do you notify editors? What's the recovery process?
   7. Validation period: after migration, how long before old site is taken down? (24-48 hours for validation)
   8. Create plan: Freeze Window Timeline, Editorial Tasks, Communication Plan, Rollback Procedure

   Phase 10 — Rollback & Recovery Strategy:
   Plan for failure:
   1. Database backup: before migration, backup the target database
   2. Rollback trigger: what conditions trigger rollback? (Data validation failure? Editor request? High error rate?)
   3. Rollback procedure: how to rollback migrated data? (Restore from backup? drush migrate:rollback?)
   4. Rollback testing: have you tested rollback? Does it leave clean state?
   5. Data consistency check: after rollback, how do you verify the old data is intact?
   6. Rollback time: how long does rollback take? (Plan to communicate this to editors)
   7. Mid-migration failure: if migration fails at 50%, what happens? (Continue from checkpoint or restart?)
   8. Create procedure: Backup Strategy, Rollback Conditions, Rollback Steps, Validation After Rollback, Estimated Rollback Time

   Phase 11 — Post-Migration Validation:
   Plan how to verify migration success:
   1. Data validation: count nodes before/after, verify all content migrated
   2. Relationship validation: verify entity references are intact (no broken links to deleted entities)
   3. URL validation: verify all old URLs have redirects, test sample of old→new URL mappings
   4. Field validation: verify all fields migrated, no data loss
   5. Link auditing: verify internal links still work, external links are correct
   6. Content spot-check: manually review sample of migrated content for corruption
   7. Workflow state validation: if workflow exists, verify all states mapped correctly
   8. Multilingual validation: if multilingual, verify translations migrated correctly
   9. Performance testing: run load tests on new system, verify performance meets targets
   10. User acceptance testing: editors/content team test migrated content, report issues
   11. Create table: Validation Step | Success Criteria | Failure Action | Owner | Timeline

   Phase 12 — Implementation Tasks & Review Checkpoints:
   Break down into bite-sized, executable tasks:
   1. Task sequence:
      - Source audit and profiling
      - Target architecture design (if model change)
      - Field mapping tables and ID mapping strategy
      - Data transformation rules
      - Migration plugin code (one migration file per entity type)
      - Redirect creation and testing
      - Content freeze coordination and communication
      - Rollback and recovery procedure testing
      - Post-migration validation and spot-checking
      - Cutover execution and monitoring
   2. For each task: specify
      - Exact migrations/code to create
      - Dependencies (what must run first?)
      - Test approach (data integrity checks, comparison reports)
      - drupal-critic review checkpoint (what to verify? migration idempotency, data validation, redirect coverage)
   3. Example task:
      ```
      ### Task 1: Source Content Audit

      **Files/Documents:**
      - Create: migration-plan/source-audit.md (document structure)
      - Create: migration-plan/field-mapping.csv (source→target mapping)

      **Audit approach:**
      - Query source database: SELECT COUNT(*) FROM node WHERE type='article' (count per type)
      - Query source fields: SELECT field_name, field_type, cardinality FROM field_config (inventory)
      - Query relationships: SELECT field_name FROM field_config WHERE type='field_reference' (reference structure)
      - Assess data quality: SELECT COUNT(*) WHERE field_value IS NULL (missing data)

      **Step 1: Run content type audit**
      - Count nodes per content type
      - Identify field cardinality
      - Document relationships and references

      **Step 2: Identify data quality issues**
      - Count null fields
      - Identify orphaned references
      - Find inconsistent data formats

      **Step 3: Review checkpoint 🔍**
      drupal-critic focus: source structure documented, relationships identified, data quality issues flagged
      ```

   HARD GATES:
   - Do NOT produce implementation code. Do NOT write PHP, drush commands, or migration YAML. Write PLANS with migration strategies and plugin outlines.
   - Every source content type MUST map to a target content type.
   - Every source field MUST have a transformation rule (map to target field, skip, or combine with other fields).
   - Every reference relationship MUST have an ID mapping strategy.
   - Every URL pattern MUST have a redirect strategy.
   - The content freeze window MUST be documented with editorial coordination plan.
   - The rollback procedure MUST be tested and documented.
   - Post-migration validation MUST include data integrity checks and link auditing.

   CALIBRATION:
   - Simple migration (D7→D10, no content model change, <50K nodes): 5-8 pages. Source audit, field mapping, basic transformations, redirect strategy.
   - Medium migration (consolidate two sites, model refactor, 50-200K nodes): 10-15 pages. Full source audit, entity mapping, transformation rules, ID conflict resolution, freeze coordination.
   - Complex migration (three sites merged, major model refactor, 200K+ nodes, custom field migration): 15-25 pages. Multi-site ID mapping, complex transformations, parallel migration strategy, detailed rollback procedure.

   OUTPUT FORMAT:
   Save the plan to: `docs/plans/YYYY-MM-DD-<feature-name>-drupal-migration-plan.md`

   # [Project] Drupal Migration Plan

   > **For Claude:** Use drupal-migration-planner protocol. Invoke drupal-critic at each checkpoint marked with 🔍.
   > **Migration Type:** D7→D10 / Consolidation / Content Model Refactor / External Import
   > **Source:** [system], **Target:** Drupal 10/11/CMS
   > **Content Volume:** [total nodes]
   > **Companion skills:** drupal-planner (if model change), code-archaeology, test-driven-development, drupal-critic

   **Migration Scope:** [One sentence]
   **Risk Level:** Low / Medium / High
   **Timeline:** [Planned migration date]
   **Content Freeze Window:** [Duration and timing]

   ---

   ## Migration Overview

   [2-3 paragraphs describing source, target, why this migration, high-level strategy]

   ## Source Content Audit

   | Content Type | Node Count | Key Fields | Relationships | Data Quality Issues |
   |---|---|---|---|---|

   ## Target Architecture

   | Target Content Type | Source Mapping | Fields | Cardinality | Change Type |
   |---|---|---|---|---|

   ## Entity & Field Mapping

   | Source Type | Source Fields | Target Type | Target Fields | Transformation | Mapping Strategy |
   |---|---|---|---|---|---|

   ## Data Transformation Rules

   | Field | Source Type | Target Type | Transformation Rule | Validation |
   |---|---|---|---|---|

   ## Migration Plugin Architecture

   | Migration | Source Plugin | Process Plugins | Dependencies | Batch Size | Idempotency Strategy |
   |---|---|---|---|---|---|

   ## ID Mapping Strategy

   | Scenario | Source ID Range | Target ID Range | Conflict Resolution | Lookup Table |
   |---|---|---|---|---|

   ## URL & Redirect Strategy

   | URL Pattern | Source Path | Target Path | Redirect Type | Implementation |
   |---|---|---|---|---|

   ## Batch & Execution Strategy

   | Phase | Content Types | Item Count | Batch Size | Runtime Estimate | Drush Commands |
   |---|---|---|---|---|---|

   ## Content Freeze & Editorial Coordination

   ### Freeze Timeline
   [When, duration, pre/post tasks]

   ### Editorial Communication
   [How editors are notified, exceptions process]

   ### Rollback Communication
   [If migration fails, how is this communicated?]

   ## Rollback & Recovery Procedure

   ### Backup Strategy
   [When and how to backup]

   ### Rollback Conditions
   [What triggers rollback?]

   ### Rollback Procedure
   [Step-by-step rollback process]

   ### Validation After Rollback
   [How to verify rollback was successful]

   ### Rollback Timeline
   [How long does rollback take?]

   ## Post-Migration Validation

   | Validation Step | Success Criteria | Failure Action | Owner |
   |---|---|---|---|

   ## Implementation Tasks

   ### Task 1: Source Content Audit
   🔍 **Review checkpoint**

   [Files, audit approach, steps, review focus]

   ### Task 2: Field Mapping & Transformation Rules
   🔍 **Review checkpoint**

   [Field mapping tables, transformation logic, validation rules]

   ### [Continue for each task...]

   ## Review Checkpoint Plan

   | Checkpoint | After Task | drupal-critic Focus |
   |---|---|---|

   ---

   CONSTRAINTS:
   - Do NOT write implementation code. Do NOT write PHP, drush, or YAML. Write PLANS with migration strategies and plugin outlines.
   - Every source entity MUST map to target.
   - Every field MUST have transformation rule.
   - Every reference relationship MUST have ID mapping strategy.
   - Every URL MUST have redirect strategy.
   - Content freeze MUST be documented.
   - Rollback MUST be tested and documented.
   - Post-migration validation MUST be planned.

   FAILURE_MODES_TO_AVOID:
   - Incomplete source audit: "Just start migrating." Will discover missing fields mid-run. Hard to handle.
   - No field mapping: "We'll figure out transformations during implementation." Causes data loss and corruption.
   - ID conflicts ignored: "Consolidating two sites but using same node IDs." Data gets overwritten. Unrecoverable.
   - No redirect strategy: "We'll fix URLs after migration." Old URLs 404. SEO rank tanks.
   - No freeze coordination: "We'll migrate while editors work." New content gets orphaned. Hard to merge back.
   - No rollback plan: "If it breaks, we'll restore from backup." No one knows how. 48-hour outage.
   - No post-migration validation: "Migration completed, we're done." Discover broken links weeks later in production.
   - Non-idempotent migrations: "First migration creates 200K nodes. Second migration duplicates them." Can't re-run safely.

   CALIBRATION:
   - Simple migration (D7→D10, no model change, <50K nodes): 5-8 pages. Source audit, field mapping, transformations, redirect strategy.
   - Medium migration (consolidate two sites, 50-200K nodes): 10-15 pages. Full source audit, entity mapping, ID mapping, freeze coordination, rollback procedure.
   - Complex migration (three sites, major refactor, 200K+ nodes): 15-25 pages. Multi-site ID mapping, complex transformations, phased execution, detailed rollback, validation plan.

   Now plan the following migration work:

   [INSERT THE MIGRATION WORK DESCRIPTION HERE]
   </Drupal_Migration_Planning_Protocol>
   ```

5. **Return the plan**: Present the plan document to the user and offer execution options.

## Tool_Usage

- Use the Agent tool to delegate planning to a subagent with the full protocol
- Use Read to examine source system (D7 entity types, field definitions, relationships)
- Use Grep to find patterns: content types, field definitions, custom fields, migration code
- Use Bash to analyze source database: node counts, field cardinality, relationship structure
- Write the plan document to `docs/plans/` in the project

## Related_Skills

**Design phase:**
- `drupal-planner` (drupal-planner): If content model is changing, plan the target architecture first.
- `brainstorming` (obra/superpowers): Explore multiple migration strategies (full vs phased, source mapping options).

**Code understanding:**
- `code-archaeology` (flonat/claude-research): Understand source system structure and custom fields.

**Implementation:**
- `test-driven-development` (obra/superpowers): TDD for migrations with data validation tests.
- `executing-plans` (obra/superpowers): Batch execution of migrations with checkpoints.

**Verification:**
- `drupal-critic` (drupal-critic): Code review of migration plugins, verify idempotency and rollback.
- `drupal-coding-standards` (zivtech-claude-skills): Migration code standards.

## Examples

<Good>
User: "Plan our Drupal 7 to Drupal 10 migration. We have 150K nodes across 12 content types, complex field relationships, and need to preserve all URLs."
Output: Complete migration plan including (1) Source content audit: 12 content types profiled with field inventory, cardinality documented, 3 data quality issues flagged (missing author on 5K nodes, orphaned references on 2K nodes); (2) Target architecture: all 12 types preserved with field mapping table showing each source field → target field mapping; (3) Entity mapping: all source types → target types, ID mapping strategy (direct copy with 10-digit padding for audit safety); (4) Data transformations: text cleanup for 4 fields, date format conversions for 6 fields, reference lookups via ID mapping table; (5) Migration architecture: 12 migration files (one per content type), dependencies documented (parent types before child types), batch size 5000 items; (6) URL strategy: 150K path aliases migrated, old URLs get 301 redirects via Redirect module, external links updated via search/replace; (7) Content freeze: 48-hour pre-migration freeze, editorial communication plan, exceptions process; (8) Rollback procedure: backup taken before migration, rollback via drush migrate:rollback (tested with subset), validation checks content count pre/post; (9) Post-migration validation: data integrity checks (count nodes, verify references), link audit (sample old→new URLs), spot-check 100 random nodes. Every transformation documented. Every field mapped. Every URL has redirect. Rollback tested.
Why good: Complete audit, field mapping specific, ID mapping strategy clear, URL strategy comprehensive, freeze coordination explicit, rollback procedure documented, validation plan detailed.
</Good>

<Good>
User has drupal-critic REVISE finding: "Migration duplicates nodes on re-run — idempotency not guaranteed"
Output: Focused plan: Problem identified: migrations don't track source IDs, so re-running creates duplicate nodes. Solution: (1) Every migration uses source plugin with source ID configuration (e.g., source/nid for D7, source/legacy_id for external), (2) Destination plugin configured to map source IDs to source_id field, (3) Re-running migration with same source data compares source IDs and updates existing nodes instead of creating new ones, (4) Test: drush migrate:import article (5000 articles created), drush migrate:import article again (0 new articles, 5000 updated). One implementation task: add source ID configuration to all 12 migrations, test idempotency on subset. drupal-critic review checkpoint verifying all migrations have source ID tracking and re-runs are safe.
Why good: Focuses on specific finding, includes idempotency redesign, test proves fix works, review checkpoint verifies.
</Good>

<Bad>
User: "Plan the D7 to D10 migration"
Output: "Task 1: Audit source. Task 2: Map fields. Task 3: Write migrations. Task 4: Test. Task 5: Execute."
Why bad: No content audit detail, no field transformation rules, no ID mapping strategy, no redirect plan, no freeze coordination, no rollback procedure. Guarantees migration will fail with data corruption, broken URLs, confused editors.
</Bad>

## Final_Checklist

- [ ] Did I understand the migration scope (simple D7→D10 vs complex consolidation)?
- [ ] Did I complete the source content audit (all types, fields, volumes, quality)?
- [ ] Did I align on target architecture (if model change)?
- [ ] Did I create entity/field mapping tables (source→target)?
- [ ] Does every source field have a transformation rule?
- [ ] Does every reference relationship have an ID mapping strategy?
- [ ] Did I design the migration plugin architecture (granular migrations, dependencies)?
- [ ] Does the migration handle idempotency and re-run safety?
- [ ] Did I plan the URL/redirect strategy (301 preservation, external links)?
- [ ] Did I design the content freeze window and editorial coordination?
- [ ] Did I create a rollback procedure and test it?
- [ ] Did I plan post-migration validation (data integrity, link auditing, spot-check)?
- [ ] Did I break down implementation into executable tasks with review checkpoints?
- [ ] Did I identify drupal-critic review checkpoints?
- [ ] Is the plan scaled appropriately to the migration complexity?
