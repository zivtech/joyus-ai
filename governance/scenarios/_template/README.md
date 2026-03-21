# Scenario Set Template Directory

This directory is the template for new workflow scenario sets.

When creating a scenario set for a workflow, copy this directory to:

```
governance/scenarios/{workflow-name}/
```

Then populate:
- `scenarios.json` — scenario definitions (see scenario-policy.md for format)
- `README.md` — update with workflow name, scenario count, and review history
- `HOLDOUT-NOTICE.md` — keep as-is; do not modify the notice content

## Naming Convention

Use the workflow's canonical identifier as the directory name. If no canonical identifier exists, use a lowercase hyphenated name that matches how the workflow is referenced in the Team Classification Register.

## Before Activating a Scenario Set

- [ ] Scenario content has not appeared in any spec, plan, or task file
- [ ] At least one scenario is marked `"critical": true`
- [ ] At least two failure scenarios are included
- [ ] A second senior engineer has reviewed the scenario set
- [ ] Platform Lead has approved the set and recorded it in the Team Classification Register
- [ ] `HOLDOUT-NOTICE.md` is present in the directory

See `governance/scenario-policy.md` for the full lifecycle and format specification.
