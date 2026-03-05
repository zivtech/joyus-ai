CREATE TYPE "public"."control_plane_approval_status" AS ENUM('requested', 'approved', 'denied', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."control_plane_tenant_role" AS ENUM('owner', 'admin', 'operator', 'reviewer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."control_plane_tenant_member_status" AS ENUM('active', 'invited', 'revoked');--> statement-breakpoint

ALTER TABLE "control_plane_artifacts" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "control_plane_artifacts_expires_idx" ON "control_plane_artifacts" USING btree ("expires_at");--> statement-breakpoint

CREATE TABLE "control_plane_tenant_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "control_plane_tenant_role" NOT NULL,
	"status" "control_plane_tenant_member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_tenant_memberships" ADD CONSTRAINT "control_plane_tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "control_plane_tenant_memberships_tenant_user_unique" ON "control_plane_tenant_memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "control_plane_tenant_memberships_tenant_role_idx" ON "control_plane_tenant_memberships" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX "control_plane_tenant_memberships_user_status_idx" ON "control_plane_tenant_memberships" USING btree ("user_id","status");--> statement-breakpoint

CREATE TABLE "control_plane_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text DEFAULT '' NOT NULL,
	"session_id" text NOT NULL,
	"action_type" text NOT NULL,
	"risk_level" "control_plane_risk_level" NOT NULL,
	"policy_decision_jti" text NOT NULL,
	"status" "control_plane_approval_status" DEFAULT 'requested' NOT NULL,
	"request_reason" text,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"metadata" json
);
--> statement-breakpoint
ALTER TABLE "control_plane_approvals" ADD CONSTRAINT "control_plane_approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_approvals" ADD CONSTRAINT "control_plane_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_plane_approvals_tenant_session_idx" ON "control_plane_approvals" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "control_plane_approvals_policy_jti_idx" ON "control_plane_approvals" USING btree ("policy_decision_jti");--> statement-breakpoint
CREATE INDEX "control_plane_approvals_status_expires_idx" ON "control_plane_approvals" USING btree ("status","expires_at");--> statement-breakpoint
