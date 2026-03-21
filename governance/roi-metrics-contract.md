# ROI Metrics Contract

**Version**: 1.0
**Date**: 2026-03-21
**Collection Owner**: Engineering Operations
**Review Owner**: Platform Lead
**Baseline Period**: 2 weeks pre-rollout for each participating team

## Metrics

### M01: Lead Time for Standard Tasks
- **Definition**: Elapsed time from task assignment to PR merge for a defined set of standard task types
- **Measurement method**: PR open timestamp to merge timestamp via GitHub API or project tracker
- **Data source**: GitHub API or project management tool
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M02: Throughput per Sprint
- **Definition**: Count of completed story points or tasks per sprint per team
- **Measurement method**: Sprint report from project tracker
- **Data source**: Project management tool (Jira or equivalent)
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M03: Suggestion Acceptance Proxy
- **Definition**: Ratio of AI-generated code blocks retained in final PR vs total AI-generated blocks
- **Measurement method**: Diff analysis on PRs tagged with AI-assist label
- **Data source**: GitHub PR diffs + AI-assist label
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead
- **Note**: Requires tooling to tag and track AI-generated code blocks. Until tooling is available, use self-reported acceptance rates as an interim proxy.

### M04: Spend per Active User and Task Type
- **Definition**: Monthly AI platform spend divided by active users; segmented by task type where tooling permits
- **Measurement method**: Platform billing API + user activity log
- **Data source**: Anthropic API billing + internal usage logs
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M05: Onboarding Time-to-Productivity
- **Definition**: Time from first platform access to first independently completed AI-assisted task
- **Measurement method**: User onboarding log; define "productive task" threshold before rollout
- **Data source**: Platform activity logs + self-report
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead

### M06: Measured vs Perceived Productivity Delta
- **Definition**: Difference between M01/M02 trend and self-reported productivity score (weekly survey, 1–5 scale)
- **Measurement method**: M01/M02 normalized trend vs weekly pulse survey
- **Data source**: Metric calculations + survey tool
- **Collection owner**: Engineering Operations
- **Review owner**: Platform Lead
- **Special rule**: Persistent divergence (measured flat or declining while perceived is positive for ≥2 consecutive weeks) triggers mandatory remediation before scale-up. Remediation actions must be logged and reviewed before proceeding.

## Review Cadence

| Period | Frequency | Forum | Trigger for Remediation |
|--------|-----------|-------|------------------------|
| Weeks 1–8 | Weekly | Platform sync | Any M01/M02 regression OR M06 divergence ≥2 weeks |
| Week 9+ | Monthly | Platform review | M01/M02 regression >10% from week-8 baseline |

## Baseline Validity Criteria

A baseline is valid when:
1. At least 10 business days of data collected before rollout
2. At least 3 team members contributing to data (single-contributor baselines are invalid)
3. No major concurrent process changes during baseline period (releases, reorgs, major incidents)

## Sign-off

| Role | Responsibility |
|------|--------------|
| Engineering Operations | Metric collection, data source maintenance, weekly reporting |
| Platform Lead | Review ownership, remediation trigger calls, escalation |

*Both roles must confirm readiness before rollout begins for any new team cohort.*

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-03-21 | Initial publication |
