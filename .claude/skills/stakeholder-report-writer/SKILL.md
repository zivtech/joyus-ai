---
name: stakeholder-report-writer
description: "Create stakeholder-facing reports — translate complex work into clear narrative for decision-makers."
version: 0.1.0
---

# Stakeholder Report Writer

Planner skill for translating technical, research, or data findings into executive/board-ready reports.

Use this to transform complex technical findings into reports that inform decision-making by non-technical audiences. This skill bridges the gap between technical teams and executive/board stakeholders who need to understand findings but may lack domain expertise.

## JTBD (Jobs To Be Done)

### Primary Job
When I have technical findings, research data, or complex analysis that a non-expert audience needs to act on,
I want a clear translation strategy before writing starts,
so I can avoid the trap of a technically accurate report that decision-makers cannot follow or use.

### Secondary Jobs
- When the report must serve multiple audiences (board, funders, community, legislators) with different levels of expertise, I want each audience's needs mapped explicitly, so I can write the right version for the right reader without rewriting from scratch for each one.
- When equity findings are buried in aggregated statistics, I want a plan that surfaces disparities by population, so the report does not obscure who is being helped and who is being missed.
- When an earlier draft was rejected for being too technical or too vague, I want a concrete translation plan for each major finding, so the next draft lands for the audience it was written for.

### Job Layers
- Functional: Design the audience analysis, narrative arc, content translation strategy, and section-by-section structure that guides a writer from raw findings to a board-ready report.
- Emotional: Reduce the frustration of writing a thorough report that still fails to drive a decision because the "so what?" was never made explicit for the audience.
- Social: Helps the user demonstrate command of the material to executives, funders, and boards — not by dumbing it down but by making it legible to people who will act on it.

### This Skill Is For
- A user with technical research, clinical trial results, operational metrics, or program evaluation data who needs a board, funder, or legislative audience to understand and act on the findings.
- A user who has been told their report is "too dense," "too technical," or "unclear on the recommendation" and needs to redesign the translation strategy before rewriting.
- A user coordinating across programs or populations where equity findings exist but risk being hidden in aggregate statistics.

### This Skill Is NOT For
- A user who needs to plan the impact story and select which metrics to highlight; use `impact-report-planner` first to design what the report will say before using this skill to design how to say it.
- A user whose audience is domain experts or technical peers who need full methodological detail intact; this skill is specifically for non-expert audience translation.
- A user looking for writing quality review on a completed draft; use `copy-critic` for that.

### Paired With
- `impact-report-planner`: Use first when the unresolved problem is choosing metrics, narrative arc, and impact story — then bring the plan here for audience-specific translation.
- `copy-critic`: After the report is written, use it to review writing quality, tone, and clarity.
- `health-equity-analyzer`: Use during the equity translation phase when the findings involve health disparities or population-specific outcomes.

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|-----------------|-------------|----------------------|
| Has findings but no translation strategy | The skill designs audience analysis, message distillation, and section structure | A report plan a writer can follow without further architectural questions |
| Report serves multiple audiences with different expertise | The skill maps each audience's needs and specifies how content differs by version | A differentiated content plan with version-specific guidance |
| Equity findings are buried in aggregates | The skill makes population-specific outcomes explicit and plans where they appear prominently | A report structure that surfaces disparities rather than hiding them |
| Draft was rejected for being too technical | The skill redesigns the translation strategy for each major finding | A plain-language plan that preserves accuracy while eliminating inaccessible jargon |

### When to Escalate
- If the user does not yet know what metrics or outcomes to report and needs to plan the impact story first, escalate to `impact-report-planner`.
- If the user's primary need is writing quality review on a completed draft, escalate to `copy-critic`.
- If equity analysis is the core unresolved problem rather than audience translation, escalate to `health-equity-analyzer`.

## Purpose

Convert technical findings, research data, or complex analysis into clear, audience-appropriate reports:

- **Technical findings** → plain language with "so what?" for business impact
- **Statistical results** → meaningful context rather than raw numbers
- **Data tables** → highlighted key insights with visual emphasis
- **Methodology** → "How we know this" (1-2 sentences, not technical deep dives)
- **Limitations** → honest context without undermining conclusions
- **Equity findings** → prominent, specific to populations, not buried in aggregates

## Use_When

- You have technical/research findings and need an executive summary
- Building reports for board presentations, funder meetings, legislative testimony
- Translating clinical trial results, operational metrics, or research analysis
- Creating reports for community stakeholders, policymakers, or non-expert audiences
- Determining what decisions a report should inform (budget, strategy, policy)
- Needing to ensure equity findings are visible and contextualized

## Do_Not_Use_When

- You need to create highly specialized technical documentation
- The audience is primarily domain experts or technical peers (use copy-critic instead)
- You want to keep all technical detail intact (this skill simplifies for readability)
- Planning a report from scratch without research/findings (use general-purpose planner instead)

## Companion_Skills

- **copy-critic**: After writing, use for writing quality review and clarity
- **health-equity-analyzer**: Reference when translating equity-related findings
- **dataviz-planner**: Use before creating visualizations for the report

## Steps

1. **Gather findings and context**: Provide technical findings, data, research results, or complex analysis that needs translation

2. **Determine audience and format**: Clarify:
   - Who is the audience? (Board, executives, funders, community, legislators, mixed)
   - What decision will this inform? (Budget, strategy, program continuation, policy vote)
   - Audience's technical sophistication? (None, moderate, high)
   - Desired format? (Executive summary, full report, presentation deck, one-pager, dashboard brief)
   - Time constraint? (5-min read, 15-min read, 30-min deep dive)

3. **Invoke the stakeholder-report-writer subagent**: Delegate to subagent with the full planning protocol below using the routing strategy:
   - **Local routing authority (default)**: Route through the repository agent named by this skill; if it is unavailable, use a host general-purpose worker with the full protocol. The catalog/meta-router owns route and model selection.
   - **Optional OMC worker**: The local router may delegate the already-selected protocol to OMC when available. OMC does not choose the route or model policy.

4. **Return planning output**: Present the structured report plan with:
   - Audience/context analysis
   - Message distillation (key takeaways, narrative arc)
   - Content translation strategy
   - Equity translation approach
   - Output structure with checkpoints

The report plan guides actual writing. Use copy-critic to review the written report for clarity and tone.

## Tool_Usage

When invoking stakeholder-report-writer:
- Use Read to load technical findings, research files, data summaries
- Use Grep to verify claims in technical documents
- Understand the source material thoroughly before planning translation
- Reference existing reports in similar domains for structure patterns

## Related_Skills

- **copy-critic**: Writing quality, clarity, tone, audience-appropriateness
- **health-equity-analyzer**: For reports involving health equity, disparities, or population-specific findings
- **dataviz-planner**: For planning charts, graphs, and visual elements in reports
