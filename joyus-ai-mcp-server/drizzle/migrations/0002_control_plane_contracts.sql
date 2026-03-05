CREATE TYPE "public"."control_plane_risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."control_plane_policy_outcome" AS ENUM('allow', 'deny', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."control_plane_runtime_target" AS ENUM('local', 'remote');--> statement-breakpoint
CREATE TYPE "public"."control_plane_event_outcome" AS ENUM('pass', 'fail', 'warn');--> statement-breakpoint
CREATE TYPE "public"."control_plane_workspace_mode" AS ENUM('managed_remote', 'local');--> statement-breakpoint
CREATE TYPE "public"."control_plane_workspace_status" AS ENUM('ready');--> statement-breakpoint

CREATE TABLE "control_plane_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"mode" "control_plane_workspace_mode" NOT NULL,
	"created_by" text NOT NULL,
	"label" text,
	"status" "control_plane_workspace_status" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_workspaces" ADD CONSTRAINT "control_plane_workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "control_plane_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"artifact_type" text NOT NULL,
	"uri" text NOT NULL,
	"policy_decision_jti" text NOT NULL,
	"skill_ids" json DEFAULT '[]'::json NOT NULL,
	"metadata" json,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_artifacts" ADD CONSTRAINT "control_plane_artifacts_workspace_id_control_plane_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."control_plane_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_artifacts" ADD CONSTRAINT "control_plane_artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "control_plane_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"risk_level" "control_plane_risk_level" NOT NULL,
	"policy_result" "control_plane_policy_outcome" NOT NULL,
	"runtime_target" "control_plane_runtime_target" NOT NULL,
	"skill_ids" json DEFAULT '[]'::json NOT NULL,
	"artifact_ids" json DEFAULT '[]'::json NOT NULL,
	"outcome" "control_plane_event_outcome" DEFAULT 'pass' NOT NULL,
	"error_code" text,
	"latency_ms" integer,
	"details" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_events" ADD CONSTRAINT "control_plane_events_workspace_id_control_plane_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."control_plane_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_events" ADD CONSTRAINT "control_plane_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "control_plane_workspaces_tenant_idx" ON "control_plane_workspaces" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "control_plane_workspaces_created_by_idx" ON "control_plane_workspaces" USING btree ("created_by");--> statement-breakpoint

CREATE INDEX "control_plane_artifacts_tenant_idx" ON "control_plane_artifacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "control_plane_artifacts_workspace_idx" ON "control_plane_artifacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "control_plane_artifacts_session_idx" ON "control_plane_artifacts" USING btree ("session_id");--> statement-breakpoint

CREATE INDEX "control_plane_events_tenant_idx" ON "control_plane_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "control_plane_events_workspace_idx" ON "control_plane_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "control_plane_events_session_idx" ON "control_plane_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "control_plane_events_created_at_idx" ON "control_plane_events" USING btree ("created_at");--> statement-breakpoint
