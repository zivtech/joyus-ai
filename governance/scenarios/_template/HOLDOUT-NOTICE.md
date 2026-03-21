# Holdout Notice

**This directory contains holdout scenario content.**

The files in this scenario set must **not** be provided to any agent during workflow implementation, modification, or debugging.

Providing scenario content to an agent invalidates the holdout property of the scenario set. An invalidated scenario set cannot serve as an external correctness signal and must be replaced before the next evaluation cycle.

## What This Means in Practice

- Do not include this directory or its contents in agent context windows
- Do not paste scenario descriptions into spec files, plan files, or task files
- Do not reference specific scenario IDs or expected outcomes in implementation prompts
- Do not summarize scenario content to an agent, even informally

## If Scenario Content Has Been Exposed

1. Stop using the affected scenarios as evaluation criteria immediately
2. Notify the Platform Lead
3. Mark the affected scenarios `"deprecated": true` in `scenarios.json`
4. Create replacement scenarios before the next evaluation cycle

## Authority

This notice is enforced by `governance/scenario-policy.md`. Questions about what constitutes exposure should be directed to the Platform Lead.
