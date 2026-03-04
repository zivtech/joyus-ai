# Quickstart: Org-Scale Agentic Governance

## 1) Run baseline checks
```bash
python scripts/spec-governance-check.py
```

## 2) Review pride status with integrity details
```bash
python scripts/pride-status.py --registry ~/.config/kitty-pride/joyus.yaml
```

## 3) Update governance docs and metadata
- Apply required doc and metadata remediations from backlog.

## 4) Re-run checks
```bash
python scripts/spec-governance-check.py --strict
```

## 5) Validate in CI
- Push changes and verify the governance workflow passes.
