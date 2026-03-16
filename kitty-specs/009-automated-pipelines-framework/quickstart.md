# Quickstart: Automated Pipelines Framework

## 1) Create a pipeline

```bash
curl -X POST /api/pipelines \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Newsletter",
    "concurrencyPolicy": "skip_if_running"
  }'
```

## 2) Add a trigger

```bash
curl -X POST /api/pipelines/:id/triggers \
  -H "Content-Type: application/json" \
  -d '{
    "triggerType": "schedule",
    "config": { "cron": "0 9 * * 1", "timezone": "America/New_York" }
  }'
```

## 3) Add steps

```bash
# Step 1: Generate profile
curl -X POST /api/pipelines/:id/steps \
  -d '{"stepType": "profile_generation", "name": "Refresh CEO Profile", "order": 1}'

# Step 2: Review gate (depends on step 1)
curl -X POST /api/pipelines/:id/steps \
  -d '{"stepType": "review_gate", "name": "Approve Profile", "order": 2, "dependsOn": ["<step1Id>"]}'

# Step 3: Content generation (depends on step 2)
curl -X POST /api/pipelines/:id/steps \
  -d '{"stepType": "content_generation", "name": "Draft Newsletter", "order": 3, "dependsOn": ["<step2Id>"]}'
```

## 4) Execute the pipeline manually

```bash
curl -X POST /api/pipelines/:id/trigger \
  -H "Content-Type: application/json" \
  -d '{"triggerType": "manual_request"}'
# Returns: { executionId: "exec_01", status: "pending" }
```

## 5) Handle a review gate

```bash
# Check execution — paused at review gate
curl /api/pipelines/:id/executions/:executionId
# Returns: { status: "paused", currentStep: "Approve Profile" }

# Submit review decision
curl -X POST /api/pipelines/review/:reviewDecisionId \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved", "feedback": "Profile looks accurate."}'

# Execution resumes automatically
```

## 6) Check analytics

```bash
curl /api/pipelines/:id/analytics
# Returns: {
#   totalExecutions: 12,
#   successfulExecutions: 11,
#   averageDurationMs: 4200,
#   p95DurationMs: 8100,
#   rejectionRate: 0.08
# }
```
