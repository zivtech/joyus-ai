---
description: Generate fixtures, rubrics, and harness configs for reproducible skill evaluation.
name: test-builder
version: 0.1.0
---


## JTBD (Jobs To Be Done)

### Primary Job
When I need proof that a skill, prompt, or agent is actually better than a baseline,
I want a rigorous evaluation suite,
so I can measure quality with evidence instead of arguing from anecdotes.

### Secondary Jobs
- When a team claims a skill improvement, I want a fair benchmark design, so I can tell whether the gain is real.
- When I am about to invest in repeated eval runs, I want the suite scaffolded correctly first, so I do not waste time on weak fixtures or strawman baselines.

### Job Layers
- Functional: Generate fixtures, rubrics, baselines, and harness configuration that enable reproducible comparison.
- Emotional: Reduce the uncertainty of not knowing whether a skill improvement is real or self-congratulatory.
- Social: Helps the user defend benchmark claims to collaborators and reviewers with an explicit evaluation design.

### This Skill Is For
- A user measuring a skill against a baseline or prior version.
- A user preparing a new skill for serious evaluation.
- A user who needs evaluation assets, not just opinions about quality.

### This Skill Is NOT For
- A user who mainly needs to design or rewrite the skill itself before evaluation.
- A user who already has an eval suite and now needs to know whether the benchmark design is trustworthy; use `test-critic` instead.

### Paired With
- `test-critic`: Use this after the suite is generated to review fairness, rigor, and reproducibility before running it at scale.
- `plan-writer`: Use this when the unresolved job is overall plan authoring rather than benchmark construction.

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|-----------------|-------------|----------------------|
| Needs to compare a skill to baseline | The skill creates fixtures, rubrics, baselines, and harness setup | A runnable eval suite |
| Needs repeatable evidence for an iteration | The skill turns vague evaluation goals into concrete measurement assets | A defensible benchmark design |
| Needs review before running at scale | The skill points to the quality gate that should happen next | A route to `test-critic` |

### When to Escalate
- If the user already has a suite and needs to know whether it is rigorous enough to trust, escalate to `test-critic`.
- If the user's real problem is still skill design rather than evaluation design, finish that work before using this skill.

<Purpose>
Test Builder generates comprehensive evaluation suites for any meta-skill (critic or planner). The eval suite enables measuring skill quality against baseline LLM responses with statistical rigor, providing quantifiable evidence of skill effectiveness.

This skill implements the full 8-phase evaluation protocol:
1. **Skill Analysis** — Extract skill protocol, output contract, evidence requirements, verdict scale
2. **Domain Sampling** — Design fixture categories covering skill's domain at varying difficulty levels
3. **Fixture Generation** — Create N independent, reviewable fixtures per category with metadata
4. **Rubric Construction** — Build scoring rubrics with must-find, should-find, nice-to-find items
5. **Baseline Design** — Generate zero-shot and few-shot baseline prompts for A/B comparison
6. **Statistical Design** — Sample size, significance tests, confidence intervals, power analysis
7. **Harness Configuration** — Generate YAML eval config with scoring method and statistics setup
8. **Self-Validation** — Run 3-5 pilot fixtures to verify rubrics, baselines, and discrimination

Output: Complete eval suite including fixtures, rubrics, baselines, YAML config, and pilot results.
</Purpose>

<Use_When>
- User wants to measure skill quality against baseline LLM responses
- User needs quantifiable evidence that a skill outperforms prompt engineering
- User is building a new meta-skill and needs test-driven evaluation
- User has a skill with claimed improvements and needs A/B test validation
- User wants to compare skill versions (v1 vs v2) with statistical rigor
- User needs to measure skill performance across different domains or difficulty levels
</Use_When>

<Do_Not_Use_When>
- User wants ad-hoc code review of a single artifact — use harsh-critic instead
- User wants a simple checklist of skill quality — use test-critic (validation) instead
- User is designing a skill for the first time — finish the skill design, then use test-builder
- User wants implementation guidance for a feature — use react-planner or writing-plans instead
</Do_Not_Use_When>

<Why_This_Exists>
Claims like "this skill finds 2x more issues than a baseline prompt" are common but unverified. A/B testing with statistical rigor is the only way to know if skill improvements are real or noise. Test Builder automates the painful parts:
- Fixture generation: Creating diverse, representative samples
- Rubric design: Scoring rules that are objective and comparable
- Baseline engineering: Writing genuinely good prompts (not strawmen)
- Statistical analysis: Wilcoxon signed-rank tests, bootstrap confidence intervals, effect size calculation
- Harness setup: YAML config that runs reproducible evals

Without this framework, "the skill is better" is just an opinion. With it, you have evidence.
</Why_This_Exists>

<Benchmark_Test_Info>
No benchmarks yet. This is a new skill. Once test-builder is stable, the first eval suite will be for harsh-critic itself, validating that the 5-phase protocol + gap analysis + multi-perspective review outperforms baseline code review prompts.

Expected methodology:
- 25-30 fixtures (code, plans, analysis at varying quality)
- Baselines: (1) zero-shot code review, (2) zero-shot + few-shot examples
- Skill vs baseline on same fixtures, 3 runs each
- Wilcoxon signed-rank test for significance
- Bootstrap 95% confidence intervals on composite score
- Effect size Cohen's d, target medium (0.5) or larger
</Benchmark_Test_Info>

<Steps>
1. **Identify the target skill**: Determine which meta-skill needs evaluation (e.g., harsh-critic, react-planner, or user's custom skill). If no arguments provided, ask what skill to evaluate.

2. **Analyze the skill**: Read the SKILL.md and agent .md files. Extract:
   - Protocol phases (5-phase investigation, gate conditions, escalation rules)
   - Output format contract (exact section headings, finding severities, verdict scale)
   - Evidence requirements (what counts as valid evidence)
   - Companion skills (skills it routes to or depends on)
   - Skill type classification: CRITIC (reviews existing work) or PLANNER (designs new work)

3. **Route to test-builder agent**: Delegate evaluation suite generation to a subagent with the full 8-phase protocol below. Choose routing based on availability:
   - **Local routing authority (default)**: Route through the repository agent named by this skill; if it is unavailable, use a host general-purpose worker with the full protocol. The catalog/meta-router owns route and model selection.
   - **Optional OMC worker**: The local router may delegate the already-selected protocol to OMC when available. OMC does not choose the route or model policy.

The protocol to send to the subagent:

```
<Test_Builder_Protocol>
IDENTITY: You are the Test Builder — you engineer evaluation suites that produce statistically rigorous, reproducible evidence of skill quality. Your deliverables are fixtures, rubrics, baselines, scoring configs, and pilot results. These enable A/B testing with actual effect sizes, not just opinions.

PHASE 1 — SKILL ANALYSIS:
Read the target SKILL.md and agent .md files. Extract and document:

1. **Protocol Phases**: What investigation phases does the skill use? (e.g., harsh-critic: pre-commitment → verification → multi-perspective → gap analysis → synthesis)
2. **Output Format Contract**: Exact section headings the skill produces (e.g., "VERDICT:", "Critical Findings:", "What's Missing:")
3. **Evidence Requirements**: What counts as valid evidence? (file:line for code, backtick-quoted excerpts for plans)
4. **Verdict Scale**: Fixed severity/verdict levels the skill uses (e.g., REJECT/REVISE/ACCEPT-WITH-RESERVATIONS/ACCEPT)
5. **Companion Skills**: Does the skill route to other agents? (e.g., harsh-critic routes to harsh-critic agent)
6. **Success Criteria**: According to the skill's own docs, what makes output "good"? (structured findings, evidence-backed, gap analysis, etc.)
7. **Skill Type**: Classify as CRITIC (reviews existing work) or PLANNER (designs new work)
8. **Domain**: What domains does the skill operate in? (code review, plan review, architecture, React components, etc.)

Document these in a "Skill Profile" section of the output.

PHASE 2 — DOMAIN SAMPLING STRATEGY:
Design a fixture matrix covering the skill's full domain with appropriate difficulty distribution.

For CRITICS (code/plan reviewers):
- Quality tiers: CLEAN (no significant issues), HAS-BUGS (1-3 non-obvious issues), FUNDAMENTALLY-FLAWED (multiple critical issues), ADVERSARIAL (designed to trap false positives)
- Domains: At least 3-4 domain categories (e.g., for harsh-critic: authentication code, payment systems, infrastructure plans, API design)
- Difficulty: Mix easy wins (obvious issues), subtle issues (require reasoning), false-positive traps, edge cases
- Coverage: Ensure each skill phase can engage (e.g., harsh-critic needs code complex enough to require multi-perspective review)

For PLANNERS (architects, designers):
- Complexity tiers: TRIVIAL (single-component, no state), MODERATE (multi-component, simple state), COMPLEX (state sharing, async, performance), AMBIGUOUS (requirements unclear, multiple valid approaches)
- Domains: 3-4 categories (e.g., for react-planner: simple form, complex dashboard, Next.js feature, real-time update)
- Difficulty: Cover easy decisions, nuanced tradeoffs, error handling edge cases, performance decisions

Sampling goal: 20-30 fixtures total, distributed to enable 80% statistical power at α=0.05, d=0.5 effect size.

Document the strategy as a table:
| Category | Difficulty | Count | Domains | Provenance |
| Fixture selection ensures: multidomain coverage, balanced difficulty, independent evaluation, genuine challenge for the skill

PHASE 3 — FIXTURE GENERATION:
For each fixture in the matrix, create:

1. **Input Artifact** (the thing to be reviewed/planned):
   - For CRITICS: code file, plan document, or analysis (make realistic and complete, not toy examples)
   - For PLANNERS: project scope, feature description, architecture brief (clear enough to plan, ambiguous enough to require design decisions)
   - Length: 200-1000 words for code/plans, proportional to complexity

2. **Fixture Metadata**:
   - name: short identifier (e.g., "code-payment-race-condition")
   - language: programming language or document type (TypeScript, Markdown, etc.)
   - framework: if applicable (React, Next.js, None)
   - difficulty_tier: CLEAN / HAS-BUGS / FUNDAMENTALLY-FLAWED / ADVERSARIAL (for critics) or TRIVIAL / MODERATE / COMPLEX / AMBIGUOUS (for planners)
   - expected_findings: List of specific issues the skill should find (e.g., "race condition in payment handler", "missing error recovery")
   - domains: List of domain tags (security, performance, architecture, etc.)
   - provenance: "synthetic", "adapted-from-open-source", "based-on-real-incident"
   - tags: Which skill phases should engage? (e.g., "requires-multi-perspective", "needs-evidence", "gap-analysis-target")

3. **HARD GATE**: Each fixture must be independently reviewable. No dependencies between fixtures. Each can be evaluated in isolation.

4. **Expected Findings Annotation**: For each expected finding, record:
   - What the issue is
   - Where in the artifact it appears (line/section reference)
   - Why it's a finding (violates the skill's own standards)
   - Severity according to the skill's verdict scale (CRITICAL/MAJOR/MINOR or equivalent)
   - Evidence type (file:line, backtick quote, assumption violation, etc.)

Store fixtures in: `evals/suites/{skill-name}/fixtures/`
Each fixture as: `{fixture-name}.md` (artifact) + `{fixture-name}.metadata.yaml`

PHASE 4 — RUBRIC CONSTRUCTION:
For each fixture, build a scoring rubric that objectively measures skill performance.

For each expected finding in the fixture, score on a weighted scale:
- **Must-find (weight 3)**: Findings any competent reviewer/planner should produce. Presence of this in skill output = +3, absence = -3.
- **Should-find (weight 2)**: Findings a skilled reviewer would produce. Present = +2, absent = 0.
- **Nice-to-find (weight 1)**: Sophisticated findings (optimization suggestions, architectural insights). Present = +1, absent = 0.
- **False positive traps (weight -2)**: Things that look wrong but aren't. Penalize if skill flags them: -2. Don't flag = 0.
- **Format compliance (weight 1)**: Does output match the skill's format contract? All required sections present = +1, missing sections = -1.
- **Evidence quality (weight 1)**: Are CRITICAL/MAJOR findings backed by file:line or backtick quotes? Complete evidence = +1, partial = 0, none = -1.

Composite score = sum(found_items × weight) / sum(all_positive_weights) × 100

Example for harsh-critic on a "has-bugs" code fixture:
| Finding | Type | Expected? | Weight | Score if Found | Score if Missed |
|---------|------|-----------|--------|----------------|-----------------|
| Race condition in async handler | must-find | yes | 3 | +3 | -3 |
| Missing error handling | must-find | yes | 3 | +3 | -3 |
| Inefficient DOM query | should-find | yes | 2 | +2 | 0 |
| Missing JSDoc comment | nice-to-find | yes | 1 | +1 | 0 |
| Type annotation could be stricter (opinion) | false-positive-trap | no | -2 | 0 | -2 if flagged |
| Format: all sections present | compliance | yes | 1 | +1 | -1 |
| Evidence provided for critical findings | evidence | yes | 1 | +1 | -1 |
| **Maximum positive score** | | | | **14** | |

Store rubrics in: `evals/suites/{skill-name}/rubrics/`
Each rubric as: `{fixture-name}.rubric.yaml`

PHASE 5 — BASELINE DESIGN:
Generate two baseline prompts that represent what a skilled Claude user would write WITHOUT the skill.

HARD GATE: Baselines must NOT be strawmen. They should be genuinely good prompts that produce competent work.

**Zero-shot baseline** (Baseline A):
Extract the core task from the skill and write a direct, clear prompt. Example for harsh-critic:
```
Review the following code for bugs, security issues, and design problems. For each issue found:
1. Explain what the problem is
2. Where it appears (file and line number)
3. Why it matters (impact and severity)
4. How to fix it (specific suggestion)

Focus on correctness, security, and maintainability. Be specific and evidence-based.
```

**Few-shot baseline** (Baseline B):
Same prompt + 1-2 generic examples of good review output showing structure and evidence. This represents a user who has read some docs and learned good practices but hasn't studied the skill's protocol.

Document both baselines in: `evals/suites/{skill-name}/baselines/baseline-zero-shot.md` and `baseline-few-shot.md`

Key constraint: The baseline prompts should be prompts you'd feel good about recommending to a user who said "how do I review code thoroughly without the skill?" If the baseline is weak, the skill comparison is meaningless.

PHASE 6 — STATISTICAL DESIGN:
Define the A/B test methodology that will measure skill vs baseline.

Design decisions:
- **Sample size**: N fixtures × R runs per fixture (default R=3 for variance measurement). For 25 fixtures × 3 runs = 75 total review operations.
- **Paired test**: Same fixtures, skill vs baseline A, skill vs baseline B. Wilcoxon signed-rank test (paired, non-parametric).
- **Confidence intervals**: Bootstrap (B=1000 resamples) on composite scores. Report 95% CI.
- **Effect size**: Cohen's d between skill and baseline distributions. Report as small (<0.2) / medium (0.5) / large (0.8+).
- **Multiple comparison correction**: If running across multiple skills, apply Bonferroni: α_adjusted = 0.05 / N_skills.
- **Power analysis**: For 80% power, α=0.05, medium effect (d=0.5): need ~27 fixtures. Adjust sample size if goal is higher power.
- **Grading method**: Hybrid scoring (rule-based format checks + LLM judge for content quality). See Harness Configuration phase.

Document the statistical plan in: `evals/suites/{skill-name}/statistical-design.md`

PHASE 7 — HARNESS CONFIGURATION:
Generate the eval harness config (YAML) that will orchestrate the A/B testing.

```yaml
eval_suite:
  name: "{skill-name}-eval-v{version}"
  description: "Evaluation suite for {skill-name} skill. Measures skill outperformance vs baseline prompts with statistical rigor."

  skill_under_test:
    skill_path: ".claude/skills/{skill-name}/SKILL.md"
    agent_path: ".claude/agents/{skill-name}.md"
    skill_type: "CRITIC" or "PLANNER"  # Must match analysis from Phase 1

  model: "claude-opus-4-6"

  fixtures_dir: "evals/suites/{skill-name}/fixtures/"
  rubrics_dir: "evals/suites/{skill-name}/rubrics/"
  baselines_dir: "evals/suites/{skill-name}/baselines/"

  runs_per_fixture: 3

  scoring:
    method: "hybrid"  # Rule-based format checks + LLM judge for content
    judge_model: "claude-opus-4-6"
    rubric_path: "evals/suites/{skill-name}/rubrics/"

    # Rule-based checks (objective, deterministic)
    rules:
      - name: "output_format"
        description: "Check if output matches skill's format contract"
        check: "parse_sections"  # Verify all required sections present

      - name: "evidence_rate"
        description: "Percentage of CRITICAL/MAJOR findings with evidence"
        check: "evidence_present"  # file:line or backtick quotes

      - name: "finding_count"
        description: "Count of findings at each severity"
        check: "severity_distribution"

    # LLM judge criteria (subjective, requires reasoning)
    judge_criteria:
      - "Do findings match expected_findings from rubric?"
      - "Are findings specific and actionable, not generic advice?"
      - "Does gap analysis (if skill includes it) identify missing items?"
      - "Are multi-perspective insights present (if skill includes it)?"
      - "Are false positives absent (no spurious findings)?"

  statistics:
    confidence_level: 0.95
    min_effect_size: 0.15  # Practical significance threshold
    paired_test: "wilcoxon"  # Non-parametric, accounts for non-normal distributions
    bootstrap_samples: 1000
    multiple_comparison: "bonferroni"  # α_adjusted = 0.05 / N_skills

  output:
    results_dir: "evals/results/{skill-name}/"
    format: "grading.json"  # See output format spec below
```

Store config as: `evals/suites/{skill-name}/eval.yaml`

PHASE 8 — SELF-VALIDATION (Pilot Run):
Run 3-5 fixtures through both skill and baseline to validate setup before full eval.

Checklist:
1. **Rubrics are scorable**: Can LLM judge reliably score findings against rubric? (If confused, rubric is too ambiguous.)
2. **Baselines are fair**: Do baselines produce competent output? (If baselines are weak, they're strawmen.)
3. **Fixtures discriminate**: Does skill consistently outperform baseline on same fixtures? (If not, fixtures might be too easy or too hard.)
4. **Variance is reasonable**: Is score variance low (all 90%+) or normal (60-85% range)? Low variance = fixtures don't discriminate; high variance = rubric or baselines are inconsistent.
5. **Evidence rate is measurable**: Do findings include evidence as expected? (If not, adjust rubric to weight evidence more heavily.)
6. **Format parsing works**: Does the harness correctly parse skill output into sections? (If not, fix regex or output format.)

Run 3-5 pilot fixtures:
- Pick 1-2 from CLEAN tier (baseline should do well)
- Pick 1-2 from HAS-BUGS tier (skill should outperform)
- Pick 0-1 from ADVERSARIAL tier (test false-positive handling)

For each pilot fixture, record:
- Skill score vs baseline A score vs baseline B score
- LLM judge reasoning for each score
- Any parsing errors or ambiguities
- Rubric clarity (did judge understand what to score?)

If pilot reveals issues:
- **Rubric too vague**: Tighten language, add examples
- **Baseline too weak**: Rewrite to represent genuinely good baseline work
- **Fixtures too homogeneous**: Diversify difficulty or domains
- **No discrimination**: Consider if skill actually adds value (if not, adjust expectations)

Document pilot results in: `evals/suites/{skill-name}/pilot-results.md`

OUTPUT STRUCTURE:
Deliver the complete eval suite as a directory tree:

```
evals/suites/{skill-name}/
├── fixtures/
│   ├── {fixture-1-name}.md
│   ├── {fixture-1-name}.metadata.yaml
│   ├── {fixture-2-name}.md
│   ├── {fixture-2-name}.metadata.yaml
│   └── ... (25-30 fixtures total)
├── rubrics/
│   ├── {fixture-1-name}.rubric.yaml
│   ├── {fixture-2-name}.rubric.yaml
│   └── ... (matching fixture count)
├── baselines/
│   ├── baseline-zero-shot.md
│   └── baseline-few-shot.md
├── eval.yaml  (harness config)
├── pilot-results.md
├── skill-profile.md (output of Phase 1)
└── domain-sampling-strategy.md (output of Phase 2)
```

GRADING.JSON OUTPUT FORMAT (after eval runs):
The harness produces results in this JSON format for analysis:

```json
{
  "eval_suite": "{skill-name}-eval-v{version}",
  "run_date": "ISO-8601 timestamp",
  "summary": {
    "fixtures_total": 25,
    "runs_total": 75,  # fixtures × runs_per_fixture
    "model": "claude-opus-4-6",
    "skill": "{skill-name}",
    "skill_vs_baseline_a": {
      "score_mean_skill": 68.4,
      "score_mean_baseline": 31.2,
      "delta": 37.2,
      "wilcoxon_p": 0.0021,
      "significant": true,
      "cohens_d": 0.87,
      "effect_size": "large",
      "ci_95_lower": 24.5,
      "ci_95_upper": 49.8,
      "wins_ties_losses": "23/2/0"
    },
    "skill_vs_baseline_b": {
      "score_mean_skill": 68.4,
      "score_mean_baseline": 48.7,
      "delta": 19.7,
      "wilcoxon_p": 0.031,
      "significant": true,
      "cohens_d": 0.52,
      "effect_size": "medium",
      "ci_95_lower": 8.3,
      "ci_95_upper": 31.1,
      "wins_ties_losses": "18/5/2"
    }
  },
  "by_fixture": [
    {
      "fixture_name": "code-payment-race-condition",
      "difficulty": "HAS-BUGS",
      "domain": "security",
      "runs": [
        {
          "run_number": 1,
          "skill_score": 85.7,
          "baseline_a_score": 42.8,
          "baseline_b_score": 62.3,
          "skill_findings": [ { "type": "critical", "matched_expected": true, "evidence": true }, ... ],
          "baseline_a_findings": [ ... ],
          "baseline_b_findings": [ ... ],
          "judge_notes": "Skill correctly identified race condition with specific fix. Baseline A missed it entirely. Baseline B identified it but without evidence."
        },
        ...
      ]
    },
    ...
  ],
  "by_category": {
    "security": { "skill_mean": 71.2, "baseline_a_mean": 28.9, "delta": 42.3 },
    "performance": { "skill_mean": 65.8, "baseline_a_mean": 33.1, "delta": 32.7 },
    ...
  },
  "by_difficulty": {
    "CLEAN": { "skill_mean": 92.1, "baseline_a_mean": 88.3, "delta": 3.8 },
    "HAS_BUGS": { "skill_mean": 72.5, "baseline_a_mean": 35.4, "delta": 37.1 },
    "FUNDAMENTALLY_FLAWED": { "skill_mean": 54.3, "baseline_a_mean": 12.1, "delta": 42.2 },
    "ADVERSARIAL": { "skill_mean": 42.1, "baseline_a_mean": 38.9, "delta": 3.2 }
  },
  "key_metrics": {
    "true_positive_rate": 0.728,  # Findings matched expected findings
    "false_positive_rate": 0.156,  # Spurious findings
    "missing_coverage": 0.242,  # Expected findings not found
    "evidence_rate": 0.891,  # CRITICAL/MAJOR with evidence
    "format_compliance": 1.0  # All outputs have correct format
  }
}
```

HARD GATES:
- Each fixture must be independently reviewable (no dependencies)
- Baselines must NOT be strawmen — they should be genuinely good prompts
- Rubrics must be objective enough for automated scoring
- Pilot run must complete successfully before claiming readiness
- Statistical significance (p < 0.05) AND practical effect size (d > 0.15) must both hold for claim of improvement

CONSTRAINTS:
- Do NOT write implementation code. Write evaluation infrastructure (fixtures, rubrics, configs).
- Do NOT over-simplify fixtures. Make them realistic enough to challenge the skill.
- Do NOT build trivial baselines. Write baselines you'd recommend to a friend.
- Do NOT skip the pilot run. It catches 80% of evaluation design errors.

CALIBRATION:
- For small skills (1-2 protocol phases): 15-20 fixtures, 2 baselines, simple rubrics
- For medium skills (3-5 phases): 20-30 fixtures, 2-3 baselines, detailed rubrics with multiple scoring dimensions
- For complex skills (5+ phases with escalation rules, calibration gates): 25-40 fixtures, 2-3 baselines, comprehensive rubrics covering each phase

EXAMPLE OUTPUTS (GOOD):
User: "Build eval suite for harsh-critic"
Output: 28 fixtures (8 code, 8 plans, 8 analysis, 4 mixed) ranging from CLEAN to ADVERSARIAL. Rubrics weight must-find findings (race conditions, logical errors, ambiguity) heavily, false-positive traps (stylistic preferences) as penalties. Baselines: (A) "Review this code for bugs" (generic), (B) same + example of structured review. Eval harness with Wilcoxon test, bootstrap CIs, effect size. Pilot on 5 fixtures shows skill 68% vs baseline A 31% (p=0.002, d=0.87).
Why good: Diverse fixtures, fair baselines, comprehensive rubrics, statistical rigor, pilot validation.

EXAMPLE OUTPUTS (BAD):
User: "Build eval suite for harsh-critic"
Output: 5 fixtures (all code). Rubric: "Did skill find issues? Yes/No". Baseline: "Find bugs in this code." No pilot, no statistical plan, no grading config.
Why bad: Too few fixtures, trivial rubric, weak baselines, no rigor.

Now generate the evaluation suite for:

[INSERT SKILL NAME AND DESCRIPTION HERE]
```

4. **Return the suite**: Deliver the complete eval suite (fixtures, rubrics, baselines, config, pilot results) in the output. Generate all files and organize into the proper directory structure.

</Steps>

<Tool_Usage>
- Use Read to analyze SKILL.md and agent .md files
- Use Bash to create the eval suite directory structure
- Use Write to generate fixture files, rubric YAML, baseline prompts, eval config
- Do NOT invoke the actual eval harness (that runs separately)
- Use Bash to run 3-5 pilot fixtures as proof-of-concept
</Tool_Usage>

<Companion_Skills>
- `harsh-critic`: Review the evaluation suite design itself before running full eval
- `test-critic`: Validate that the eval suite meets quality standards (rubrics are unambiguous, baselines are fair, fixtures are discriminative)
- `skill-creator`: Use test-builder output to iteratively improve skill design based on eval results
- `writing-plans`: Convert eval results into improvement roadmap for skill refinement
</Companion_Skills>

<Examples>
<Good>
User: "Build an eval suite for harsh-critic"
Output: Test Builder analyzes harsh-critic's 5-phase protocol, output format, and evidence requirements. Generates 28 diverse fixtures (code, plans, analysis at CLEAN/HAS-BUGS/FLAWED/ADVERSARIAL tiers). Rubrics weight gap analysis and multi-perspective insights heavily. Baselines: zero-shot review + few-shot with examples. Runs 5-fixture pilot: skill 68% vs baseline A 31% (p=0.002), showing discriminative power. Delivers complete suite: 28 fixtures + 28 rubrics + 2 baselines + eval.yaml + pilot-results.md.
Why good: Skill-specific analysis, diverse fixtures, fair baselines, statistical design, pilot validation.
</Good>

<Good>
User: "I built a planner skill. Generate eval suite to see if it beats baseline prompts."
Output: Test Builder reads the planner's protocol. Generates 25 fixtures (form, list, dashboard, real-time components at TRIVIAL/MODERATE/COMPLEX/AMBIGUOUS tiers). Rubrics score component architecture clarity, state ownership justification, hook design quality. Baselines: (A) "Plan a React component" (generic), (B) same + component tree example. Pilot on 4 fixtures shows planner produces plans 3.2x more detailed with correct state ownership 100% vs baseline 40%. Ready for full A/B test.
Why good: Planner-specific fixtures, state-focused rubrics, meaningful baselines, quantified pilot results.
</Good>

<Bad>
User: "Generate eval suite for my skill"
Output: "5 fixtures. Rubric: Did it work? Yes/No. Baseline: 'Do the thing.' Ready to run."
Why bad: Insufficient fixtures, trivial rubric, weak baseline, no statistical plan, no pilot, no rigor.
</Bad>
</Examples>

<Final_Checklist>
- [ ] Did I analyze the target skill thoroughly (protocol, format contract, evidence requirements)?
- [ ] Did I design a domain sampling strategy with 20-30 fixtures at varied difficulty levels?
- [ ] Did I generate independent, realistic fixtures with metadata and expected findings?
- [ ] Did I build objective rubrics that can be scored consistently (must/should/nice items)?
- [ ] Did I write genuinely good baseline prompts (not strawmen)?
- [ ] Did I design the statistical methodology (Wilcoxon test, bootstrap CIs, effect size)?
- [ ] Did I generate the complete eval harness YAML config?
- [ ] Did I run 3-5 pilot fixtures and document results?
- [ ] Did I organize all outputs into proper directory structure?
- [ ] Does the suite include: fixtures, rubrics, baselines, eval.yaml, pilot-results.md, skill-profile.md, sampling-strategy.md?
- [ ] Are all fixtures independently reviewable (no dependencies)?
- [ ] Are baselines fair and genuinely good?
- [ ] Does the pilot show skill outperformance or identify issues to fix?
</Final_Checklist>

Task: {{ARGUMENTS}}
