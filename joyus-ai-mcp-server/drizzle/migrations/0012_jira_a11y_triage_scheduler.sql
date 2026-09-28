-- IF NOT EXISTS added in #96: the journal `when` repair (1778505114112 ->
-- 1779724808298) can re-apply this file on environments that recorded it under
-- the old timestamp.
ALTER TYPE "public"."task_type" ADD VALUE IF NOT EXISTS 'JIRA_A11Y_TRIAGE';--> statement-breakpoint
