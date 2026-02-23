# Idea Intake Lane

Use this lane to move fast on ideas without redirecting active specs.

## Rules

1. Idea-only changes live under `ideas/`.
2. Do not edit governed spec files until approval:
   - `spec/**`
   - `kitty-specs/**`
   - `.claude/commands/**`
   - `.kittify/**`
   - `README.md`
   - `ROADMAP.md`
3. Any PR touching governed spec files requires approval by `@grndlvl` on the current head commit.

## Workflow

1. Capture idea in `ideas/YYYY-MM-DD-short-title.md` using `ideas/TEMPLATE.md`.
2. Open an idea-only PR (optional) for async feedback and refinement.
3. After approval, promote the idea into governed spec files in a follow-up PR.

This keeps ideation velocity high while protecting the active specification baseline.
