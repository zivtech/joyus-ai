# Skill Registry — All Known Skills

This registry catalogs every planner, critic, executor, perspective module, and workflow skill across all repos. The meta-plan and meta-critic agents use this to route requests to the right skill(s).

## How to Use This Registry

1. Match user request keywords/context against the **Trigger Signals** column
2. Select the strongest signal matches: up to 4 independent skills at one step, with the 4th requiring signal score >= 7
3. Check **Dependencies** to determine invocation order; sequential dependency chains have no arbitrary length cap
4. Invoke selected skills, sequencing dependent ones

## Planners

| Skill | Command | Trigger Signals | Plans For | Companion Critic | Source Repo | Dependencies |
|-------|---------|----------------|-----------|-----------------|-------------|--------------|
| drupal-planner | `/drupal-planner` | drupal, module, permissions, cache, migration, hook, service, plugin, drupal site, drupal feature | Full Drupal implementations (entity, config, permissions, cache, migration, theme) | drupal-critic | drupal-planner | None |
| drupal-content-model-planner | `/drupal-planner.content-model` | content type, entity type, bundle, paragraph, field, composition, layout builder, editorial workflow, content model | Drupal entity types, bundles, paragraphs, fields, composition patterns | content-model-critic | drupal-planner | None |
| drupal-taxonomy-planner | `/drupal-planner.taxonomy` | taxonomy, vocabulary, term, category, tag, classification, hierarchy, facet navigation | Drupal vocabularies, term hierarchies, faceted navigation | taxonomy-critic | drupal-planner | None |
| drupal-theme-planner | `/drupal-planner.theme` | theme, frontend, CSS, Twig, template, component, SDC, design system, base theme, responsive, preprocess | Drupal theme architecture, components, CSS, templates | drupal-theme-critic | drupal-planner | None |
| drupal-search-planner | `/drupal-planner.search` | search, Search API, Solr, Elasticsearch, indexing, facet, autocomplete, discovery | Drupal search architecture, Search API, facets, autocomplete | search-discovery-critic | drupal-planner | None |
| drupal-canvas-planner | `/drupal-planner.canvas` | Canvas, Canvas Code Component, component definition, component metadata, component props, component composability, component upload, Canvas styling, Canvas data fetching, Experience Builder | Canvas Code Component architecture — component definition, props, data fetching, composability, styling, upload/deploy | drupal-critic (Canvas skills) | drupal-planner | None |
| drupal-migration-planner | `/drupal-migration-planner` | migration, migrate, D7 to D10, upgrade, content migration, data migration, migrate API | Drupal content model refactors and migrations (D7→D10, config splits) | drupal-critic | meta-skills | None |
| react-planner | `/react-planner` | react, next.js, React Native, component, hook, state management, JSX, TSX, frontend app | React/Next.js/React Native implementations with architectural correctness | react-critic, next-critic, react-native-critic | meta-skills | None |
| a11y-planner | `/a11y-planner` | accessibility, a11y, WCAG, ARIA, screen reader, keyboard, focus management, assistive technology | Accessible implementations — semantic HTML, ARIA, focus, keyboard | a11y-critic | meta-skills | None |
| content-model-planner | `/content-model-planner` | content model, entity design, content architecture, CMS modeling, content types, fields (non-Drupal) | CMS-agnostic content model architectures | content-model-critic | meta-skills | None |
| wordpress-migration-planner | `/wordpress-migration-planner` | WordPress migration, wordpress contentful migration, Contentful to WordPress, Gutenberg import, block editor migration, WP-CLI import, WordPress manifest, post meta, CPT mapping, attachment import, MCP abilities | WordPress/Gutenberg Contentful migration runtimes - manifest schema, native content model, CLI/MCP gates, idempotency, rollback, and editor validity | wordpress-migration-critic | meta-router (wordpress-skills) | content-model-planner (optional) |
| taxonomy-planner | `/taxonomy-planner` | taxonomy, classification, vocabulary, controlled vocabulary, tagging system (non-Drupal) | CMS-agnostic taxonomy and classification systems | taxonomy-critic | meta-skills | None |
| search-discovery-planner | `/search-discovery-planner` | search architecture, search design, discovery, search UX (non-Drupal) | CMS-agnostic search and discovery architectures | search-discovery-critic | meta-skills | None |
| copy-planner | `/copy-planner` | copy brief, content brief, copywriting plan, messaging, content strategy | Strategic content briefs and copy specifications | copy-critic | meta-skills | None |
| ai-optimization-planner | `/ai-optimization-planner` | AI Overview, AIO, AI search readiness, E-E-A-T, RAG retrievability, query fan-out, semantic HTML for agents, schema markup, agentic search, Merchant Center, Google Business Profile, Universal Commerce Protocol | AI Overview and agentic-search readiness plans — RAG retrievability, E-E-A-T signals, fan-out coverage, semantic HTML, schema, and agentic channel setup | ai-optimization-critic | meta-skills (content-skills) | seo-advisor (recommended first/parallel) |
| dataviz-planner | `/dataviz-planner` | data visualization, chart, graph, dashboard design, visual data | Data visualization design before creation | dataviz-critic | meta-skills | None |
| dashboard-planner | `/dashboard-planner` | dashboard, KPI, metrics dashboard, analytics dashboard, data dashboard | Interactive dashboard architecture — KPIs, data pipelines, interaction design | dashboard-critic | meta-skills | None |
| email-campaign-planner | `/email-campaign-planner` | email campaign, email marketing, newsletter, drip campaign, email sequence | Email marketing campaigns before creative execution | email-campaign-critic | meta-skills | None |
| manuscript-planner | `/manuscript-planner` | manuscript, academic paper, research paper, journal submission, publication | Academic manuscript structure before writing | manuscript-critic | meta-skills | None |
| lit-review-planner | `/lit-review-planner` | literature review, systematic review, evidence synthesis, meta-analysis, research protocol | Systematic literature review protocols and evidence synthesis | research-critic | meta-skills | None |
| study-design-planner | `/study-design-planner` | study design, epidemiology, clinical trial, cohort, RCT, case-control, research design | Epidemiological and clinical research designs | sap-critic | meta-skills | None |
| stem-cell-research-planner | `/stem-cell-research-planner` | stem cell, hPSC, iPSC, beta cell, pancreatic differentiation, megakaryocyte, platelet model, reporter line, single-cell differentiation, cell line provenance | hPSC/iPSC model-system planning - controls, assay/readout evidence, omics metadata, QC, and provenance without bench protocols | stem-cell-research-critic | meta-skills (research-skills) | None |
| genomics-pipeline-planner | `/genomics-pipeline-planner` | scRNA-seq, single-cell RNA, bulk RNA-seq, ATAC-seq, multiome, spatial transcriptomics, genomics pipeline, bioinformatics pipeline, Cell Ranger, Seurat, Scanpy, batch correction, clustering, cell type annotation, differential expression, trajectory inference, QC thresholds | Computational genomics pipeline design — scRNA-seq/bulk/ATAC/multiome/spatial, tool selection with biological rationale, QC checkpoints, iPSC-specific traps, reproducibility contracts | genomics-pipeline-critic | meta-skills (research-skills) | None |
| differential-abundance-planner | `/differential-abundance-planner` | differential abundance, compositional analysis, cell type proportion, cell state proportion, proportion shift, more or fewer of population, scCODA, Milo, propeller, sccomp, abundance shift, composition change | Differential abundance / compositional analyses — whether cell-type/cell-state proportions shift between conditions; scCODA/Milo/propeller/sccomp selection, replicate-level testing over pooled cells, relative-vs-absolute framing, iPSC differentiation-efficiency confounds | differential-abundance-critic | meta-skills (research-skills) | None |
| cell-cell-communication-planner | `/cell-cell-communication-planner` | cell-cell communication, ligand-receptor, ligand receptor interaction, signaling analysis, niche signaling, CellChat, CellPhoneDB, NicheNet, LIANA, Squidpy, CCC | Cell-cell communication (ligand-receptor) analyses from scRNA-seq/spatial — tool + database selection, statistical testing, iPSC media-signaling and contamination confounds | cell-cell-communication-critic | meta-skills (research-skills) | None |
| rna-velocity-planner | `/rna-velocity-planner` | RNA velocity, spliced unspliced, cell directionality, fate direction, scVelo, veloVI, RegVelo, UniTVelo, LatentVelo, CellRank, velocity | RNA velocity analyses from spliced/unspliced counts — veloVI/scVelo/RegVelo/UniTVelo model selection, steady-state and splice-ratio checks, CellRank 2 fate mapping, iPSC differentiation considerations | rna-velocity-critic | meta-skills (research-skills) | None |
| cnv-detection-planner | `/cnv-detection-planner` | CNV, copy number variation, copy number, InferCNV, CopyKAT, Numbat, SCEVAN, karyotype, aneuploidy, chromosomal aberration, iPSC QC | Computational CNV detection from scRNA-seq for iPSC/hPSC QC — InferCNV/CopyKAT/Numbat/SCEVAN selection, reference-normal strategy, ploidy-aware validation, passage-drift/karyotype traps | cnv-detection-critic | meta-skills (research-skills) | None |
| gene-regulatory-network-planner | `/gene-regulatory-network-planner` | gene regulatory network, GRN, regulon, transcription factor network, TF activity, regulatory inference, SCENIC, pySCENIC, SCENIC+, CellOracle, Dictys | GRN inference from scRNA-seq/scATAC — SCENIC+/pySCENIC/CellOracle selection by modality, correlation-vs-causation boundaries, GATA1 isoform regulon disambiguation, iPSC stage confounds | gene-regulatory-network-critic | meta-skills (research-skills) | None |
| dataset-integration-planner | `/dataset-integration-planner` | batch correction, dataset integration, integrate datasets, batch effect, atlas construction, reference mapping, label transfer, Harmony, scVI, scANVI, BBKNN, Scanorama | Cross-dataset integration and batch correction — Harmony/scVI/scANVI/BBKNN/Scanorama selection, biological-vs-technical variance preservation, integration metrics, iPSC clone/passage over-integration traps | dataset-integration-critic | meta-skills (research-skills) | None |
| trajectory-inference-planner | `/trajectory-inference-planner` | trajectory inference, pseudotime, developmental trajectory, lineage trajectory, optimal transport, fate probability, moscot, scEGOT, CellOT, Monocle3, DPT, PAGA, CellRank | Developmental trajectory analysis — optimal transport (moscot/scEGOT/CellOT) vs pseudotime (Monocle3/DPT/PAGA) vs fate probability (CellRank 2), time-series-vs-snapshot design fit, iPSC trajectory traps | trajectory-inference-critic | meta-skills (research-skills) | None |
| causal-inference-planner | `/causal-inference-planner` | causal inference, causal claim, causal vs correlational, isogenic comparison, perturbation effect, knockout effect, confounding, pseudo-replication, instrumental variable, CausalGRN | Causal inference for single-cell experimental designs — causal-vs-correlational claim scoping, method identification (isogenic comparisons, IV-based discovery, CausalGRN), iPSC confounding and pseudo-replication traps | causal-inference-critic | meta-skills (research-skills) | None |
| foundation-model-advisor | `/foundation-model-advisor` | foundation model, single-cell foundation model, pretrained model, cell embedding, zero-shot annotation, scGPT, Geneformer, UCE, C2S-Scale, should I use a foundation model | Single-cell foundation model selection (UCE/scGPT/Geneformer v2/C2S-Scale) vs traditional approaches — honest fit assessment, then routes to the right domain planner | — | meta-skills (research-skills) | None |
| impact-report-planner | `/impact-report-planner` | impact report, annual report, nonprofit report, outcomes, program impact | Annual impact reports for nonprofits and universities | proposal-critic | meta-skills | None |
| policy-brief-writer | `/policy-brief-writer` | policy brief, policy memo, policy recommendation, legislation, regulation | Evidence-based policy briefs (information, issue, policy option, advocacy) | policy-brief-critic | meta-skills | None |
| stakeholder-report-writer | `/stakeholder-report-writer` | stakeholder report, board report, executive summary, technical to executive | Translates technical findings into executive/board-ready reports | proposal-critic | meta-skills | None |
| chna-planner | `/chna-planner` | CHNA, community health, needs assessment, nonprofit hospital, health equity, IRS 990 | Community Health Needs Assessments for nonprofit hospitals | health-equity-analyzer | meta-skills | None |
| design-partner | `/design-partner` | design direction, design system, UI design, interface design, visual design, design guidance | Proactive design direction, system guidance, implementation-ready UI specs | ui-critic | meta-skills (zivtech-design-skills) | None |
| web-design-planner | `/web-design-planner` | website design, web app design, responsive design, web interface, landing page design | Web interface architecture — responsive, interaction, token, and testing strategy | web-design-critic | meta-skills (zivtech-design-skills) | None |
| mobile-design-planner | `/mobile-design-planner` | mobile design, iOS design, Android design, mobile app design, mobile UI | Mobile UI — platform-aware interaction and implementation sequencing | mobile-design-critic | meta-skills (zivtech-design-skills) | None |
| graphic-design-planner | `/graphic-design-planner` | graphic design, print design, campaign asset, brand system, infographic, one-pager, visual summary, data poster, fact sheet, pictogram, poster, brochure | Graphic assets, campaign systems, infographics, and production-ready handoff specs | graphic-design-critic | meta-skills (zivtech-design-skills) | None |
| ai-readiness-assessor | `/ai-readiness-assessor` | AI readiness, ML adoption, AI assessment, organizational AI, AI strategy | AI/ML adoption readiness assessments for organizations | — | meta-skills | None |
| plan-writer | `/plan-writer` | implementation plan, project plan, technical plan, plan with risk analysis | Detailed plans with competing alternatives, pre-mortem, backcasting | proposal-critic | meta-skills (zivtech-proposal-skills) | None |
| data-planner | `/data-planner` | data pipeline, data analysis, numerical implementation, ETL, data processing | Data pipelines and numerical implementations with correctness guarantees | data-critic | meta-skills | None |
| test-planner | `/test-planner` | testing strategy, test plan, what to test, test layers, CI gates, refactor safety, testing before implementation | Risk-based testing strategy — test layers, coverage architecture, CI gates, acceptance criteria | qa-critic | meta-skills (zivtech-testing-skills) | None |
| jtbd-interviewer | `/jtbd-interviewer` | JTBD interview, user research, switching story, discovery interview, purchase story, why did they switch, why did someone hire, qualitative product discovery | Live JTBD switching-story interviews — Moesta timeline, Four Forces model, Job Statement synthesis | interview-critic | meta-skills (zivtech-research-skills) | None |
| security-threat-model-planner | `/security-threat-model-planner` | threat model, security posture, trust boundaries, STRIDE, attack surface, AppSec, security architecture | Structured threat models grounded in actual code — STRIDE enumeration, trust boundaries, risk-prioritized mitigations | proposal-critic | meta-skills (zivtech-security-skills) | None |
| content-measurement-planner | `/content-measurement-planner` | content measurement, measure content quality, GABRIEL, qualitative coding, content scoring, LLM as instrument, rate content, classify content, measurement protocol | LLM-as-measurement-instrument protocols — construct operationalization, GABRIEL types, calibration, bias detection | measurement-critic (planned) | meta-skills (zivtech-instrument-skills) | None |
| meeting-intelligence-planner | `/meeting-intelligence-planner` | meeting prep, prepare for meeting, meeting agenda, meeting brief, 1:1 prep, sprint planning prep, decision meeting | Pre-meeting preparation — context assembly, stakes-proportional agendas, decision frameworks, 6 meeting types | copy-critic | meta-skills (standalone) | None |
| input-guardrail-planner | `/input-guardrail-planner` | guardrail, input validation, agent safety, tripwire, content filter, prompt injection filter, toxicity filter, PII filter | AI agent input guardrail design — 5 risk categories (topic drift, toxicity, PII, injection, adversarial), tripwire patterns, YAML config, evaluation benchmarks | output-guardrail-critic | meta-skills (guardrail-skills) | None |
| stitch-planner | `/stitch-planner` | Stitch, Google Stitch, AI screen generation, UI prototype, multi-page prototype, design system extraction, export Stitch components | Google Stitch prototyping workflows, screen generation plans, design system extraction, and component export strategy | web-design-critic (optional), design-token-critic (optional) | meta-skills (zivtech-design-skills) | None |
| spec-kitty-bridge | `/spec-kitty-bridge` | spec-kitty, spec driven development, work package, failed review, route spec, specialist routing, remediation path | Spec-driven planning, review, and remediation routing to the right specialist skills | proposal-critic (optional) | meta-skills (integration) | None |

## Critics

| Skill | Command | Trigger Signals | Reviews | Companion Planner | Source Repo | Read-Only |
|-------|---------|----------------|---------|------------------|-------------|-----------|
| drupal-critic | `/drupal-critic` | drupal code, drupal module, drupal implementation, hook, plugin, service, drupal PR | Full Drupal implementations (permissions, cache, hooks, migrations) | drupal-planner | drupal-critic (external) | Yes |
| drupal-theme-critic | `/drupal-theme-critic` | drupal theme, preprocess, twig template, drupal CSS, drupal frontend, .theme file | Drupal theme architecture — preprocess, templates, CSS, render pipeline | drupal-theme-planner | meta-skills | Yes |
| content-model-critic | `/content-model-critic` | content model, entity type design, field architecture, content type review | Content model architecture — entity proliferation, field duplication, composition | content-model-planner | meta-skills | Yes |
| taxonomy-critic | `/taxonomy-critic` | taxonomy review, vocabulary review, classification review, term hierarchy | Taxonomy — hierarchy depth, mutual exclusivity, term naming, governance | taxonomy-planner | meta-skills | Yes |
| search-discovery-critic | `/search-discovery-critic` | search review, search architecture review, index design, facet review | Search architecture — index design, facets, relevance, zero-result handling | search-discovery-planner | meta-skills | Yes |
| wordpress-migration-critic | `/wordpress-migration-critic` | WordPress migration review, Gutenberg import review, Contentful migration review, WP-CLI migration review, contentful_migration_wp, Contentful manifest, block serialization, rollback review, MCP abilities review | WordPress/Gutenberg migration runtimes - manifest accuracy, content model conflicts, block validity, idempotency, rollback, asset/user/locale safety, and MCP permissions | wordpress-migration-planner | meta-router (wordpress-skills) | Yes |
| react-critic | `/react-critic` | react code, react component, JSX review, react PR, hooks review | React implementations — component patterns, hooks, state, performance | react-planner | meta-skills (external) | Yes |
| next-critic | `/next-critic` | next.js code, app router, server component, next.js PR | Next.js App Router implementations | react-planner | meta-skills (external) | Yes |
| react-native-critic | `/react-native-critic` | react native, expo, mobile app code, react native PR | React Native and Expo implementations | react-planner | meta-skills (external) | Yes |
| a11y-critic | `/a11y-critic` | accessibility review, ARIA review, a11y audit, WCAG compliance, keyboard nav review | Accessibility — reviews plans before implementation and implementations after testing. ARIA patterns, focus management, state communication | a11y-planner | meta-skills | Yes |
| proposal-critic | `/proposal-critic` | proposal review, plan review, strategy review, design review, vendor lock-in, dependency risk, license sustainability, escape hatch | Plans and proposals — gap analysis, competing hypotheses, cognitive bias; conditional strategic dependency-risk lens (vendor lock-in, license sustainability, escape-hatch; defers bus-factor to security-ownership-mapper, CVE to security-threat-model-planner) | plan-writer | meta-skills | Yes |
| harsh-critic | `/harsh-critic` | thorough review, harsh review, critical review, deep review | General-purpose — structured gap analysis, multi-perspective investigation | — | meta-skills | Yes |
| copy-critic | `/copy-critic` | copy review, content review, brand voice, tone review, copywriting review | Copywriting — brand voice, tone, clarity, engagement, SEO | copy-planner | meta-skills | Yes |
| ai-optimization-critic | `/ai-optimization-critic` | AI Overview review, AIO readiness review, AI search eligibility, E-E-A-T review, RAG eligibility, query fan-out coverage, semantic HTML for agents, schema review, agentic search review | AI Overview eligibility — RAG retrievability, E-E-A-T signal completeness, fan-out coverage, semantic HTML, schema markup, and agentic search readiness | ai-optimization-planner | meta-skills (content-skills) | Yes |
| dataviz-critic | `/dataviz-critic` | chart review, visualization review, graph review, data viz review | Data visualizations — statistical honesty, chart type, accessibility | dataviz-planner | meta-skills | Yes |
| perf-critic | `/perf-critic` | performance review, bottleneck, scalability, latency review, performance audit | Performance — bottlenecks, scalability, cost, observability | — | meta-skills | Yes |
| seo-advisor | `/seo-advisor` | SEO review, heading hierarchy, meta tags, search intent, internal linking | Structural SEO — headings, titles, meta, linking, search intent | — | meta-skills | Yes |
| policy-brief-critic | `/policy-brief-critic` | policy brief review, policy analysis review, policy document review | Policy briefs — structure, evidence quality, recommendations, equity | policy-brief-writer | meta-skills | Yes |
| manuscript-critic | `/manuscript-critic` | manuscript review, paper review, submission review, journal review | Academic manuscripts — submission readiness, reporting standards | manuscript-planner | meta-skills | Yes |
| research-critic | `/research-critic` | research review, methodology review, study design review, statistical review | Research methodology — study design, statistics, evidence quality | lit-review-planner | meta-skills | Yes |
| stem-cell-research-critic | `/stem-cell-research-critic` | stem cell review, hPSC review, iPSC review, beta-cell claim, platelet model review, reporter line review, single-cell lineage review, cell line provenance review | Stem-cell research artifacts - model-system fit, controls, assays, omics, QC, provenance, and overclaim risk | stem-cell-research-planner | meta-skills (research-skills) | Yes |
| genomics-pipeline-critic | `/genomics-pipeline-critic` | pipeline review, scRNA-seq review, bioinformatics review, QC report review, analysis notebook review, methods section review, pseudo-replication, batch confounding, annotation overclaim, iPSC pipeline review | Computational genomics pipelines — architecture, QC rigor, statistical validity, annotation boundaries, iPSC-specific traps, reproducibility | genomics-pipeline-planner | meta-skills (research-skills) | Yes |
| differential-abundance-critic | `/differential-abundance-critic` | differential abundance review, compositional analysis review, proportion shift review, scCODA review, Milo review, abundance claim, collapse artifact, pooled-cell pseudo-replication | Differential abundance / compositional analyses — compositional-constraint handling, replicate-level vs pooled-cell pseudo-replication, relative-vs-absolute collapse artifact, method fit, iPSC confounds, overclaim | differential-abundance-planner | meta-skills (research-skills) | Yes |
| cell-cell-communication-critic | `/cell-cell-communication-critic` | cell-cell communication review, ligand-receptor review, CellChat review, CellPhoneDB review, NicheNet review, LIANA review, CCC analysis review, signaling overclaim | CCC analysis plans/results/notebooks/methods — tool + database choice, statistical rigor, overclaim boundaries, iPSC media-confound and contamination traps | cell-cell-communication-planner | meta-skills (research-skills) | Yes |
| rna-velocity-critic | `/rna-velocity-critic` | RNA velocity review, scVelo review, velocity plot review, splice ratio, steady-state assumption, velocity direction overclaim | RNA velocity analyses/plots/methods — model selection, preprocessing, steady-state assumption validity, uncertainty handling, overclaim boundaries, iPSC traps | rna-velocity-planner | meta-skills (research-skills) | Yes |
| cnv-detection-critic | `/cnv-detection-critic` | CNV review, InferCNV review, CopyKAT review, copy number review, karyotype claim, subclone review, CNV artifact | CNV detection analyses — reference-normal strategy validity, resolution overclaim, clone-vs-artifact discrimination, iPSC karyotype/passage artifact awareness, reproducibility | cnv-detection-planner | meta-skills (research-skills) | Yes |
| gene-regulatory-network-critic | `/gene-regulatory-network-critic` | GRN review, regulon review, SCENIC review, pySCENIC review, CellOracle review, TF network review, regulatory network overclaim, causality overclaim | GRN inference analyses — motif database fit, regulon statistical validity, correlation-vs-causation overclaim, iPSC stage-confound traps, reproducibility | gene-regulatory-network-planner | meta-skills (research-skills) | Yes |
| dataset-integration-critic | `/dataset-integration-critic` | integration review, batch correction review, Harmony review, scVI review, over-integration, overcorrection, integration metric review, biological signal loss | Cross-dataset integration analyses — batch correction quality, biological signal preservation, integration metric reporting, iPSC over-correction traps | dataset-integration-planner | meta-skills (research-skills) | Yes |
| trajectory-inference-critic | `/trajectory-inference-critic` | trajectory review, pseudotime review, Monocle review, CellRank review, optimal transport review, trajectory topology, pseudotime-real-time conflation, fate probability overclaim | Trajectory inference analyses — design-to-method match (OT vs pseudotime), transition probability validity, pseudotime/real-time conflation, branching topology robustness, iPSC confounds | trajectory-inference-planner | meta-skills (research-skills) | Yes |
| causal-inference-critic | `/causal-inference-critic` | causal inference review, causal claim review, confounding review, pseudo-replication review, isogenic design review, causal overclaim, correlation vs causation | Causal inference analyses — design-claim alignment, confounding control, pseudo-replication, iPSC-specific traps, overclaim boundaries | causal-inference-planner | meta-skills (research-skills) | Yes |
| research-comms-critic | `/research-comms-critic` | research communication, science communication, public summary, lay summary | Research-to-public communication — simplification accuracy, hedging | — | meta-skills | Yes |
| email-campaign-critic | `/email-campaign-critic` | email review, campaign review, subject line review, email marketing review | Email campaigns — subject lines, CTAs, deliverability, flow | email-campaign-planner | meta-skills | Yes |
| health-equity-analyzer | `/health-equity-analyzer` | health equity, disparity, social determinants, SDOH, health impact, equity review | Health equity — disparity measurement, SDOH, intersectionality | chna-planner | meta-skills | Yes |
| sap-critic | `/sap-critic` | SAP review, statistical analysis plan, clinical trial statistics, pre-specification | Statistical Analysis Plans — pre-specification rigor, regulatory compliance | study-design-planner | meta-skills | Yes |
| data-critic | `/data-critic` | math review, formula review, numerical review, data logic, calculation review | Math and data logic — formulas, assumptions, numerical correctness | data-planner | meta-skills | Yes |
| qa-critic | `/qa-critic` | test suite review, are tests good enough, false confidence, misleading green, missing coverage, flaky tests, over-mocked | Test suites — false confidence, missing risk coverage, weak assertions, flake patterns | test-planner | meta-skills (zivtech-testing-skills) | Yes |
| interview-critic | `/interview-critic` | interview review, JTBD transcript, job statement valid, Four Forces coverage, interview quality, critique the interview, independent quality score | JTBD switching-story transcripts — Four Forces coverage, job statement validity, interviewer technique | jtbd-interviewer | meta-skills (zivtech-research-skills) | Yes |
| test-critic | `/test-critic` | test review, eval suite review, test design review, test fairness | Evaluation suites — statistical design, fairness, completeness | — | meta-skills | Yes |
| measurement-critic | `/measurement-critic` | measurement review, measurement quality, validate scores, measurement validity, inter-rater reliability, construct validity, bias detection, composite score, weighted scorer, scoring function, ranking function, is this score a valid proxy, Goodhart | Two modes (Phase 0 auto-selects): (1) LLM-as-instrument content scoring — construct validity, inter-rater reliability, bias (position, length, anchoring, style), calibration; (2) hand-tuned composite/weighted scoring functions that rank candidates in a search space — component proxy validity, weighting sensitivity, Goodhart-under-search, falsifiability | content-measurement-planner | meta-skills (instrument-skills) | Yes |
| output-guardrail-critic | `/output-guardrail-critic` | review guardrails, guardrail review, output safety, guardrail coverage, output quality gates, safety gates | AI agent guardrail configurations and execution results — output quality gates, safety gates, coverage gaps, false positive risks | input-guardrail-planner | meta-skills (guardrail-skills) | Yes |
| ui-critic | `/ui-critic` | UI review, UX review, interface review, usability review, heuristic evaluation | UI/UX design — heuristic evaluation, visual consistency, accessibility | design-partner | meta-skills (zivtech-design-skills) | Yes |
| web-design-critic | `/web-design-critic` | website review, web design review, responsive review, web UI review | Web design — responsive, interaction, and accessibility quality | web-design-planner | meta-skills (zivtech-design-skills) | Yes |
| mobile-design-critic | `/mobile-design-critic` | mobile design review, mobile UX review, mobile app review, platform conventions | Mobile UX — platform conventions, accessibility, and flow reliability | mobile-design-planner | meta-skills (zivtech-design-skills) | Yes |
| graphic-design-critic | `/graphic-design-critic` | graphic design review, print review, campaign review, infographic review, poster review, layout review | Graphic assets — hierarchy, brand consistency, production readiness, infographic accuracy | graphic-design-planner | meta-skills (zivtech-design-skills) | Yes |
| design-token-critic | `/design-token-critic` | design token review, token audit, design system tokens, CSS variables, Figma variables, Tailwind tokens, token naming | Design token systems — naming consistency, value coverage, math relationships, accessibility, cross-platform parity | design-system-documenter | meta-skills (zivtech-design-skills) | Yes |
| dashboard-critic | `/dashboard-critic` | dashboard review, critique dashboard, dashboard architecture review, evaluate dashboard, check dashboard KPIs, dashboard filter review | Dashboard architecture — KPI hierarchy, information density, filter logic, drill-down coherence, responsive layout, cross-chart consistency | dashboard-planner | meta-skills (zivtech-viz-skills) | Yes |
| review-skill | `/review-skill` | skill review, skill health, observation log, eval results, protocol drift, amend skill, improve skill prompt | Skill health — observation logs, eval correlation, protocol analysis, and targeted amendment proposals | test-builder | meta-skills (meta) | No |

## Executors (Generate Artifacts from Planner Specs)

| Skill | Command | Trigger Signals | Generates | Upstream Planner | Downstream Critic | Source Repo |
|-------|---------|----------------|-----------|-----------------|-------------------|-------------|
| drupal-config-executor | `/drupal-config-executor` | generate drupal config, scaffold content type, create drupal fields, generate config yaml, drupal config from plan | Drupal config YAML (node.type, field.storage, field.field, form/view displays) | drupal-planner.content-model, .taxonomy, .search | content-model-critic, drupal-critic | drupal-planner |
| dataviz-executor | `/dataviz-executor` | generate chart, create visualization, build chart, plot data, generate dataviz, create plotly chart, visualize this data | Self-contained HTML with Plotly.js charts | dataviz-planner | dataviz-critic | meta-skills (zivtech-viz-skills) |
| marp-executor | `/marp-executor` | make slides, create presentation, build deck, markdown slides, marp slides, turn into presentation, slide deck | Marp markdown + HTML/PDF/PPTX via marp-cli | copy-planner (optional) | copy-critic | meta-skills (standalone) |
| dashboard-executor | `/dashboard-executor` | generate dashboard, create dashboard, build dashboard, generate KPI dashboard, create interactive dashboard, execute dashboard plan | Self-contained interactive HTML dashboards with KPI cards, filters, cross-filtering | dashboard-planner | dashboard-critic, dataviz-critic | meta-skills (zivtech-viz-skills) |
| scientific-viz-executor | `/scientific-viz-executor` | 3D plot, surface plot, network graph, force graph, function plot, vector field, phase diagram, contour plot, scientific visualization, mathematical plot, LaTeX plot | Self-contained HTML scientific visualizations (3D, network, math, vector fields) | dataviz-planner | dataviz-critic | meta-skills (zivtech-viz-skills) |
| web-design-executor | `/web-design-executor` | generate page, build layout, implement design, create landing page, generate HTML CSS, execute web design, build responsive page | Production-ready HTML/CSS with token-driven custom properties | web-design-planner | web-design-critic | meta-skills (zivtech-design-skills) |
| design-system-documenter | `/design-system-documenter` | document design system, extract design tokens, generate DESIGN.md, token inventory, design system docs, CSS custom properties, Tailwind config | DESIGN.md documentation from existing tokens, theme files, CSS custom properties, Tailwind config, and design direction | design-partner (optional) | design-token-critic | meta-skills (zivtech-design-skills) |
| infographic-executor | `/infographic-executor` | create infographic, generate fact sheet, build visual summary, make one-pager, create process diagram, generate comparison infographic, visual explainer, data summary graphic | SVG-based infographic HTML pages (fact sheets, visual explainers, data summaries) | graphic-design-planner | graphic-design-critic | meta-skills (zivtech-design-skills) |
| mobile-design-executor | `/mobile-design-executor` | generate mobile UI, create React Native, build Expo app, implement mobile design, mobile code from plan | React Native/Expo/SwiftUI/Compose code from mobile-design-planner specs | mobile-design-planner | mobile-design-critic | meta-skills (zivtech-design-skills) |
| graphic-design-executor | `/graphic-design-executor` | create print design, build brand guidelines, generate SVG graphic, precision graphic, editable graphic, vector asset, brand reference page, icon design | SVG-in-HTML graphic assets (brand guidelines, precision layouts, editable graphics, icons) | graphic-design-planner | graphic-design-critic | meta-skills (zivtech-design-skills) |
| gemini-image-executor | `/gemini-image-executor` | create social media graphic, generate event poster, hero image, marketing visual, atmospheric graphic, raster graphic, Instagram post, conference poster, product showcase | Production-quality raster PNG via Gemini native image generation (social cards, event posters, hero images, atmospheric visuals) | graphic-design-planner | graphic-design-critic | meta-skills (zivtech-design-skills) |
| ci-fix-executor | `/ci-fix-executor` | CI failed, fix CI, build broken, test failing, lint error, deploy failure, dependency conflict, fix pipeline | Targeted minimal fixes for CI failures (lint, test, build, deploy, dependency) | test-planner (optional) | qa-critic | meta-skills (testing-skills) |
| test-builder | `/test-builder` | build eval suite, generate fixtures, skill evaluation, benchmark skill, rubric, harness config, compare skill to baseline | Reproducible skill evaluation suites with fixtures, rubrics, baselines, and harness configuration | review-skill (optional) | test-critic | meta-skills (meta) |
| content-measurement-executor | `/content-measurement-executor` | measure content, apply rubric, score items, content scoring, measurement execution, rate content batch, classify content batch | Scored content batches with per-item audit trails (rate, rank, classify, extract, discover, codify, bucket) | content-measurement-planner | measurement-critic | meta-skills (instrument-skills) |
| wordpress-migration-executor | `/wordpress-migration-executor` | run WordPress migration, contentful-migration import, wp contentful-migration, wp-env smoke, apply model, import export, verify run, rollback run, MCP ability smoke, Gutenberg migration smoke | Operates and verifies WordPress Contentful migration runtimes through WP-CLI/wp-env: analyze, apply-model, import, verify, report, rollback, idempotency, and acceptance smoke gates | wordpress-migration-planner | wordpress-migration-critic, qa-critic | meta-router (wordpress-skills) |
| research-synthesis-executor | `/research-synthesis-executor` | synthesize research, research synthesis, literature synthesis, evidence summary, create research brief | Structured research synthesis documents (quick brief, summary, comparison matrix, comprehensive report) | lit-review-planner | research-critic | meta-skills (research-skills) |
| security-ownership-mapper | `/security-ownership-mapper` | ownership map, bus factor, code ownership, orphaned code, who owns, git ownership, contributor risk | Code ownership maps, bus factor analysis, orphaned security-sensitive code detection (Bash-enabled, uses git CLI) | security-threat-model-planner | proposal-critic | meta-skills (security-skills) |
| discovery-investigation | `/discovery-investigation` | discovery audit, Drupal site audit, editorial UX audit, proposal evidence, content type audit, discovery findings | Evidence-backed Drupal discovery findings with config analysis, browser checks, scored findings, and proposal-ready evidence | — | proposal-critic | meta-skills (zivtech-proposal-skills) |
| proposal-draft | `/proposal-draft` | draft proposal, proposal package, client proposal, technical proposal, discovery findings to proposal, proposal review loop | Client-ready proposal packages from discovery findings with technical and client-facing drafts plus multi-critic review | discovery-investigation (optional) | proposal-critic, copy-critic | meta-skills (zivtech-proposal-skills) |
| discovery-proposal | `/discovery-proposal` | discovery to proposal, full discovery workflow, site audit to proposal, proposal orchestration, resume discovery session | Full discovery-to-proposal workflow orchestration across investigation, drafting, critique, and delivery | discovery-investigation, proposal-draft | proposal-critic, copy-critic | meta-skills (zivtech-proposal-skills) |

## Perspective Modules (Not Standalone — Invoked by Other Skills)

| Module | Trigger Signals | Perspective | Used By |
|--------|----------------|-------------|---------|
| brand-voice-guide | brand voice, tone of voice, brand guidelines | Brand voice reference for copy skills | copy-critic, copy-planner |

## Multi-Skill Routing Patterns

### Drupal Feature Request
Signals: "drupal" + feature description
- Simple feature → `/drupal-planner`
- Content model focus → `/drupal-planner.content-model` then `/drupal-planner`
- Canvas component architecture → `/drupal-planner.canvas`
- Full site build → `/drupal-planner.content-model` → `/drupal-planner.taxonomy` → `/drupal-planner.search` → `/drupal-planner.canvas` → `/drupal-planner.theme` → `/drupal-planner`

### Drupal Code Review
Signals: "drupal" + code/PR
- Module code → `/drupal-critic`
- Theme code → `/drupal-theme-critic`
- Content model config → `/content-model-critic`
- Mixed → `/drupal-critic` + `/drupal-theme-critic`

### React Feature Request
Signals: "react" / "next.js" / "react native" + feature
- React app → `/react-planner`
- With accessibility → `/react-planner` + `/a11y-planner`

### WordPress Contentful Migration Request
Signals: "WordPress" + "Contentful" / "Gutenberg" / "WP-CLI" / "MCP" / "rollback" / "manifest"
- Plan a migration runtime → `/wordpress-migration-planner`
- Implement or operate the runtime → `/wordpress-migration-executor`
- Review migration plugin/code/plan/evidence → `/wordpress-migration-critic`
- Full loop → `/wordpress-migration-planner` → `/wordpress-migration-executor` → `/wordpress-migration-critic`
- With broad CMS model ambiguity → add `/content-model-planner` only after the WordPress-specific planner scopes native WP modeling
- With test adequacy concern → add `/qa-critic`

### Content / Copy Request
Signals: "content" / "copy" / "writing"
- Plan copy → `/copy-planner`
- Review copy → `/copy-critic`
- With SEO → add `/seo-advisor`
- With AI Overview / AIO / agentic search readiness → `/seo-advisor` first or parallel, then `/ai-optimization-planner`
- Review AI Overview eligibility on existing content → `/ai-optimization-critic`
- With brand voice → include brand-voice-guide

### JTBD / User Research Request
Signals: "JTBD" / "switching story" / "why did they switch" / "job to be done" / "discovery interview"
- Conduct a JTBD interview → `/jtbd-interviewer`
- Review a completed JTBD transcript → `/interview-critic`
- Full loop → `/jtbd-interviewer` then `/interview-critic`

### Research / Academic Request
Signals: "research" / "study" / "manuscript" / "paper" / "literature synthesis" / "evidence summary"
- Stem-cell, hPSC/iPSC, beta-cell, platelet, reporter-line, single-cell differentiation, or cell-line provenance plan → `/stem-cell-research-planner` then `/stem-cell-research-critic`
- Review a stem-cell artifact, assay/data package, or collaborator/core handoff → `/stem-cell-research-critic`
- scRNA-seq, bulk RNA-seq, ATAC-seq, multiome, spatial, genomics pipeline, bioinformatics pipeline, Cell Ranger, Seurat, Scanpy, batch correction, clustering, annotation, DE, trajectory → `/genomics-pipeline-planner` then `/genomics-pipeline-critic`
- Review a genomics pipeline plan, analysis notebook, methods section, or QC report → `/genomics-pipeline-critic`
- Stem-cell experiment needing computational analysis → `/stem-cell-research-planner` (Phase 7 routes to `/genomics-pipeline-planner`)
- Cell-type / cell-state proportion shift, compositional analysis, "does the mutant have more/fewer of population X", abundance change → `/differential-abundance-planner` then `/differential-abundance-critic`
- Cell-cell communication, ligand-receptor signaling (CellChat/CellPhoneDB/NicheNet/LIANA/Squidpy) → `/cell-cell-communication-planner` then `/cell-cell-communication-critic`
- RNA velocity, spliced/unspliced dynamics, cell-fate direction (scVelo/veloVI/RegVelo/CellRank 2) → `/rna-velocity-planner` then `/rna-velocity-critic`
- CNV / copy-number / karyotype QC from scRNA-seq (InferCNV/CopyKAT/Numbat/SCEVAN) → `/cnv-detection-planner` then `/cnv-detection-critic`
- Gene regulatory network / regulon / TF activity (SCENIC+/pySCENIC/CellOracle/Dictys) → `/gene-regulatory-network-planner` then `/gene-regulatory-network-critic`
- Batch correction / dataset integration / atlas / label transfer (Harmony/scVI/scANVI/BBKNN/Scanorama) → `/dataset-integration-planner` then `/dataset-integration-critic`
- Developmental trajectory / pseudotime / optimal transport (moscot/Monocle3/PAGA/CellRank 2) → `/trajectory-inference-planner` then `/trajectory-inference-critic`
- Causal claim from an iPSC/isogenic design, confounding, or pseudo-replication → `/causal-inference-planner` then `/causal-inference-critic`
- Choosing a single-cell foundation model vs a traditional approach (scGPT/Geneformer/UCE/C2S-Scale) → `/foundation-model-advisor` (then routes to the domain planner)
- Review a single-cell analysis (abundance, CCC, velocity, CNV, GRN, integration, trajectory, causal) → the matching domain critic above
- Plan a study → `/study-design-planner`
- Plan a literature review → `/lit-review-planner`
- Generate a research synthesis → `/research-synthesis-executor`
- Plan a manuscript → `/manuscript-planner`
- Review a manuscript → `/manuscript-critic`
- Review methodology → `/research-critic`
- Full lit review loop → `/lit-review-planner` → `/research-synthesis-executor` → `/research-critic`

### Design / UI Request
Signals: "design" / "UI" / "interface" / "website design" / "mobile design" / "graphic design"
- Design direction or system → `/design-partner`
- Plan a website design → `/web-design-planner`
- Plan a mobile UI → `/mobile-design-planner`
- Plan a graphic asset / infographic / poster → `/graphic-design-planner`
- Prototype screens in Google Stitch → `/stitch-planner`
- Document design tokens / generate DESIGN.md → `/design-system-documenter`
- Generate an infographic from plan → `/infographic-executor`
- Generate graphic assets (SVG, brand guides, precision) from plan → `/graphic-design-executor`
- Generate graphic assets (raster, social, posters, atmospheric) from plan → `/gemini-image-executor`
- Generate mobile UI code from plan → `/mobile-design-executor`
- Generate HTML/CSS from web design plan → `/web-design-executor`
- Review UI/UX → `/ui-critic`
- Review web design → `/web-design-critic`
- Review mobile design → `/mobile-design-critic`
- Review graphic design / infographic → `/graphic-design-critic`
- Review design token architecture → `/design-token-critic`
- With accessibility → add `/a11y-planner` or `/a11y-critic`

### Data / Visualization Request
Signals: "data" / "chart" / "dashboard" / "visualization"
- Plan a dashboard → `/dashboard-planner`
- Plan a visualization → `/dataviz-planner`
- Generate a chart from plan or data → `/dataviz-executor`
- Generate a scientific visualization (3D, network, math) → `/scientific-viz-executor`
- Generate a dashboard from plan or data → `/dashboard-executor`
- Review a visualization → `/dataviz-critic`
- Review a dashboard → `/dashboard-critic`
- Review data logic → `/data-critic`
- Full chart loop → `/dataviz-planner` → `/dataviz-executor` → `/dataviz-critic`
- Full dashboard loop → `/dashboard-planner` → `/dashboard-executor` → `/dashboard-critic`
- Scientific viz loop → `/dataviz-planner` → `/scientific-viz-executor` → `/dataviz-critic`

### Security / Threat Modeling Request
Signals: "threat model" / "security posture" / "trust boundaries" / "attack surface" / "STRIDE" / "AppSec" / "code ownership" / "bus factor"
- Plan a threat model → `/security-threat-model-planner`
- Map code ownership and bus factor → `/security-ownership-mapper`
- Review a threat model plan → `/proposal-critic`
- Full security assessment → `/security-threat-model-planner` → `/security-ownership-mapper` → `/proposal-critic`
- With performance concerns → add `/perf-critic`

### Content Measurement Request
Signals: "measure content" / "content quality scoring" / "GABRIEL" / "rate content" / "classify content" / "measurement protocol" / "LLM as instrument"
- Design a measurement instrument → `/content-measurement-planner`
- Execute measurement on content batch → `/content-measurement-executor`
- Review measurement validity → `/measurement-critic`
- Full measurement loop → `/content-measurement-planner` → `/content-measurement-executor` → `/measurement-critic`
- With research methodology → add `/research-critic`

### Meeting Preparation Request
Signals: "meeting prep" / "prepare for meeting" / "meeting agenda" / "meeting brief" / "1:1 prep" / "sprint planning prep"
- Plan meeting preparation → `/meeting-intelligence-planner`
- Review agenda/brief quality → `/copy-critic`

### CI Failure Request
Signals: "CI failed" / "fix CI" / "build broken" / "test failing" / "lint error" / "deploy failure"
- Diagnose and fix CI failure → `/ci-fix-executor`

### Skill Quality / Meta-Skill Request
Signals: "skill evaluation" / "review this skill" / "benchmark skill" / "eval suite" / "rubric" / "protocol drift"
- Review skill health and propose amendments → `/review-skill`
- Build a reproducible eval suite → `/test-builder`
- Review eval suite rigor → `/test-critic`

### Discovery / Proposal Request
Signals: "discovery audit" / "proposal package" / "site audit to proposal" / "client proposal" / "proposal evidence"
- Investigate a Drupal site for proposal evidence → `/discovery-investigation`
- Draft a proposal from discovery findings → `/proposal-draft`
- Run the full discovery-to-proposal loop → `/discovery-proposal`

### Spec-Kitty Workflow Request
Signals: "spec-kitty" / "spec driven" / "work package" / "failed review" / "route spec" / "remediation"
- Route a spec, work package, or failed review → `/spec-kitty-bridge`

### Guardrail / Agent Safety Request
Signals: "guardrail" / "input validation" / "output safety" / "agent safety" / "content filter" / "tripwire" / "prompt injection filter"
- Design input guardrails → `/input-guardrail-planner`
- Review guardrail configuration → `/output-guardrail-critic`
- Full guardrail loop → `/input-guardrail-planner` → `/output-guardrail-critic`
- With threat modeling → add `/security-threat-model-planner`
- Review the fix → `/qa-critic`
- Plan testing strategy after fix → `/test-planner`

### Drupal Config Generation
Signals: "generate drupal config" / "scaffold content type" / "generate config yaml"
- Generate config from content model plan → `/drupal-config-executor`
- Generate config from taxonomy plan → `/drupal-config-executor`
- Generate config from search plan → `/drupal-config-executor`
- Full loop → `/drupal-planner.content-model` → `/drupal-config-executor` → `/content-model-critic`

### Live-Testing Review (Runnable Artifacts)
Signals: executor-generated HTML, self-contained dashboard, Marp slides
- Executor produced `.html` with Plotly/D3/Chart.js → `/dataviz-critic` (live-testing if Playwright MCP available)
- Executor produced dashboard HTML with filters/KPIs → `/dashboard-critic` (live-testing if Playwright MCP available)
- Executor produced Marp slides → `/copy-critic` (slide preview if available)
- Live-testing supplements file-based review — critics remain read-only for source code
- If Playwright MCP not available → standard file-based review only

### Executor Completeness Gate
All executors validate planner specs before handoff via a Completeness Gate:
- Executor enumerates every spec item → marks DONE/PARTIAL/SKIPPED with justification
- SKIPPED items require explicit rationale
- Completeness Gate must emit before critic review begins
- This prevents premature completion (executor declares "done" when spec items are missing)

## Threshold-Capable Critics

These critics support optional quantitative threshold violations in their output:

| Critic | Measurable Thresholds | Example |
|--------|----------------------|---------|
| perf-critic | LCP, CLS, FID, TTFB | LCP > 2.5s → THRESHOLD VIOLATION |
| a11y-critic | WCAG Level A violation count | Violations > 0 → THRESHOLD VIOLATION |
| dataviz-critic | Data-ink ratio, label truncation, axis distortion | Truncated labels > 20% → THRESHOLD VIOLATION |
| seo-advisor | Missing meta tags, heading hierarchy violations | No H1 → THRESHOLD VIOLATION |

Threshold violations force the verdict severity to match or exceed the violation severity. A critic cannot emit a threshold violation and ACCEPT the artifact.

## Concurrency and Chain Limits

Two separate caps govern how many skills run per invocation:

**Parallel width (max 4 concurrent):**
- At any single step, invoke at most 4 independent skills in parallel.
- The 4th concurrent skill requires a signal score ≥ 7 (strong match). Skills 1-3 require score > 5.
- Common 4-critic case: primary domain critic + a11y + perf + SEO for frontend code.

**Sequential chain length (no arbitrary cap):**
- Dependency chains follow the routing pattern as long as needed.
- A "Full site build" may chain 6+ planners — that's correct, not over-routing.
- Each step must have a clear dependency on the previous step's output.

## Agent File Name Cross-References

Some skills use dot-notation slash commands but have kebab-case agent file names. When dispatching via the Agent tool (not Skill tool), use the agent file name:

| Slash Command | Agent File Name | Notes |
|---------------|----------------|-------|
| `/drupal-planner.content-model` | `drupal-content-model-planner` | |
| `/drupal-planner.taxonomy` | `drupal-taxonomy-planner` | |
| `/drupal-planner.search` | `drupal-search-planner` | |
| `/drupal-planner.theme` | `drupal-theme-planner` | |
| `/drupal-planner.canvas` | `drupal-canvas-planner` | |

## Agents Intentionally Excluded from Routing

These agents exist globally but are NOT routed to by meta-planner/meta-critic. They are either routers themselves, utilities, or superseded:

| Agent | Reason Excluded |
|-------|----------------|
| `meta-planner` | IS the router — routing to itself creates infinite loop |
| `meta-critic` | IS the router — routing to itself creates infinite loop |
| `js-critic-router` | Router that dispatches to react-critic / next-critic / react-native-critic |
| `design-router` | Router that dispatches to design-partner or ui-critic |
| `codex-implementer` | OpenAI Codex CLI wrapper — not a meta-router skill |
| `codex-tester` | OpenAI Codex CLI wrapper — not a meta-router skill |
| `ui-design-critic` | Superseded by `ui-critic` (same role, `ui-critic` is the registry entry) |
| `gadue-lab-meta-skill` | Lab-specific router — dispatches biological questions to the research-skills domain planners/critics (the Gadue lab's analog of `meta-planner`). Its routing targets are all independently registered above, so `meta-planner` reaches them directly; routing to it would be router→router. Invoke directly via `/gadue-lab-meta-skill` for lab-scoped orchestration. |

## Signal Priority Rules

When multiple skills match:
1. **Specificity wins**: `/drupal-planner.content-model` beats `/drupal-planner` for content model requests
2. **Framework-specific beats generic**: `/drupal-planner.taxonomy` beats `/taxonomy-planner` for Drupal taxonomy
3. **Planner vs critic**: Match the intent — "plan", "design", "build" → planner; "review", "check", "audit" → critic
4. **Companion pairing**: When planning, mention the companion critic for post-implementation review
5. **Specific single-cell analysis beats general pipeline**: When a request names a specific single-cell analysis (trajectory, RNA velocity, CNV, GRN, batch correction / integration, differential abundance, cell-cell communication, causal inference), the specific planner/critic beats the general `/genomics-pipeline-planner` / `/genomics-pipeline-critic`, whose trigger list overlaps them.
