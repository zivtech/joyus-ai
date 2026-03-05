# Session Context

## User Prompts

### Prompt 1

Implement the following plan:

# Issue #5: Persist Export Download Tokens to Database

## Context

GitHub issue #5 (grndlvl): `exports/service.ts` stores export jobs and download tokens in in-memory JavaScript `Map`s. Any server restart wipes active download links, breaking the 15-minute TTL promise to users. Solution: persist to PostgreSQL via Drizzle ORM.

**Current state:** Two Maps in `service.ts`:
- `exportJobs: Map<string, ExcelExportJob>` — job records
- `downloadTokenToJob: Map<string,...

