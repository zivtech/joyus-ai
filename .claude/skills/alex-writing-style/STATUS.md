# alex-writing-style — Development Status

## Current State: v4 draft, 3 iterations tested (5 evals)

### What's Done
- SKILL.md written and revised through 3 rounds of feedback + v4 structural additions
- Reference file with voice examples (references/voice-examples.md) updated with parenthetical patterns
- 5 test prompts run through iteration 3 (with-skill vs without-skill baselines)
- Eval viewer generated for all 3 iterations
- v4 action items applied: parenthetical asides, conditional "leverage", trust-the-reader guidance, dual simple+technical descriptions

### Test Results Summary

**Eval 1 — Client email pushback:**
- v1: Too wordy, performative ("I'm not defensive"), AI-obvious
- v2: Too curt, disparaged other vendor's motives, presumptuous next steps ("Let's schedule...")
- v3/v4: Uses "I'm not convinced," no motive speculation, inviting next step ("Would you have time for a call next week?"), warm but firm. **Awaiting Alex's review.**

**Eval 2 — Listserv MVP advice:**
- v1: Condescending ("even someone junior"), dismissive signoff ("Good luck with it")
- v2: Much better but still tells reader what to think ("prioritize differently than you'd think")
- v3/v4: Shares concrete experience without prescribing. Uses "The pivot" pattern naturally. **Awaiting Alex's review.**

**Eval 3 — Conference session description (Joyus AI):**
- v1: "Perfect" ✓
- v2: "Perfect" ✓
- v3/v4: Now uses parenthetical asides for Milk Jawn and Zivtech context, parenthetical Joyus framing. **Awaiting Alex's review.**

**Eval 4 — LinkedIn post (Claude Consultancy):** NEW
- v3/v4: First run. Punchy, ~150 words, shows practical changes not just the badge. **Awaiting Alex's review.**

**Eval 5 — phillyceo board micromanagement reply:** NEW
- v3/v4: First run. Shares KPI/dashboard framework from experience. **Awaiting Alex's review.**

### What's Next
1. Get Alex's feedback on all 5 iteration-3 outputs via eval viewer
2. Apply any needed revisions based on feedback
3. Run description optimization (run_loop.py) to tune triggering
4. Package final .skill file

### Key Lessons Learned
- The #1 failure mode is **length** — the skill leads with "Be Short" as the top rule
- **Performative directness** ("I'm not defensive") is worse than no skill at all
- **Don't speculate on others' motives** — state facts, let reader draw conclusions
- **Don't tell people what to think** — share perspective, don't prescribe
- **Brief ≠ curt** — inviting language ("Would you like to...") is brief AND warm
- **Parenthetical asides** are a signature structural device — fold in secondary context mid-sentence
- **Dual framing** — name things simply AND technically ("Markdown files, as well as structured knowledge packages")
- **Trust the reader** — don't enumerate every detail, let the work speak for itself
- Conference descriptions worked great from v1; emails and listserv replies are harder
- Without-skill baselines consistently read as "obviously AI" — the skill adds genuine value when calibrated right

### v4 Changes Applied
- [x] Added parenthetical asides as a documented voice pattern (with examples from Alex's session description)
- [x] Moved "leverage" from banned list to conditional: OK when meaning "strategically use," not OK as empty filler
- [x] Added guidance: when referencing secondary businesses/context, fold in parenthetically, don't feature
- [x] Added guidance: for session descriptions and proposals, trust the reader — don't enumerate every detail
- [x] Added guidance: it's OK to describe things simply AND technically in the same breath
- [x] Updated voice-examples.md with parenthetical pattern and dual framing pattern

### Files
- Skill: `/alex-writing-style/SKILL.md`
- Voice examples: `/alex-writing-style/references/voice-examples.md`
- Test cases: `/alex-writing-style/evals/evals.json`
- Iteration 1 workspace: `alex-writing-style-workspace/iteration-1/`
- Iteration 2 workspace: `alex-writing-style-workspace/iteration-2/`
- Iteration 3 workspace: `alex-writing-style-workspace/iteration-3/`
- Eval viewer v1: `presentations/drupalcamp nj/` (was saved to mnt/claude/)
- Eval viewer v2: same location, `-v2.html` suffix
- Eval viewer v3: `presentations/alex-writing-style-eval-v3.html`
