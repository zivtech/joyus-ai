---
name: meeting-intelligence-planner
description: "Prepare for meetings — gather context, tailor agenda, identify key topics. Triggers: meeting prep, upcoming meeting."
version: 0.1.0
---

# Meeting Intelligence Planner

Plan meeting preparation before the meeting starts, so time is spent on decisions rather than catching up.

## JTBD (Jobs To Be Done)

### Primary Job
When I have an upcoming meeting and need to be maximally prepared,
I want automated meeting intelligence that structures the preparation with relevant context, tailored agenda, and clear decision points,
so I spend meeting time on decisions rather than catching up.

### Secondary Jobs
- When I have a high-stakes meeting and need to assemble context from multiple sources (Jira, Slack, Notion, past transcripts).
- When I need to prepare different materials for different attendees (tech lead vs PM vs stakeholder).
- When I have recurring meetings that need fresh context each time rather than stale agendas.

### This Skill Is For
- Pre-meeting preparation and intelligence assembly
- 6 meeting types: status/update, decision/approval, planning (sprint/project), retrospective, 1:1, brainstorming
- Pulling context from available integrations (Otter, Slack, Google Workspace, Notion, Atlassian)
- Generating structured agendas with time allocation, owners, and decision points

### This Skill Is NOT For
- Real-time meeting facilitation; this is pre-meeting planning only
- Meeting transcription; use Otter MCP
- Post-meeting action item tracking; separate concern
- Writing meeting minutes; use `copy-critic` to review if needed

### Resolution Paths
| User's Situation | What Happens | What They Leave With |
|---|---|---|
| High-stakes decision meeting | Planner classifies meeting type, assembles context from available sources, structures agenda around decision points with required information | Meeting brief + structured agenda + pre-read list |
| Recurring status meeting | Planner identifies what changed since last meeting, surfaces blockers and risks, creates focused update agenda | Lightweight agenda with changes-since-last and open items |
| 1:1 with direct report | Planner surfaces recent activity, open items, and growth topics; creates conversational agenda | Talking points organized by topic with context |
| Sprint planning | Planner assembles backlog context, capacity data, and dependency map; structures planning agenda | Planning agenda with pre-read requirements and decision framework |

### When to Escalate
- If the user needs meeting facilitation during the meeting, that is outside this skill's scope
- If the user needs a written summary or minutes after the meeting, use `copy-critic` or `copy-planner`
- If the meeting content needs to become a formal document, escalate to the appropriate planner (policy-brief-writer, stakeholder-report-writer, etc.)

### Paired With
- `copy-critic`: can review generated agendas and briefs for clarity and completeness
- Note: This planner references MCP integrations (Otter, Slack, Google Workspace, Notion, Atlassian) as data sources but does not invoke them — it designs the preparation plan

## Purpose

Most meeting preparation fails in one of two ways:
- It is too thin (no context assembled, agenda is a list of topics with no structure).
- It is disproportionate to the stakes (30 minutes of prep for a 5-minute sync, or 5 minutes of prep for a board-level decision).

`meeting-intelligence-planner` exists to scale preparation to stakes and assemble relevant context from the tools the team already uses. A quick 1:1 gets talking points; an executive review gets a full brief with pre-reads and decision frameworks.
