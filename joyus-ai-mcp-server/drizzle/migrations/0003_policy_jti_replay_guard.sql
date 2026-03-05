CREATE TABLE "control_plane_policy_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workspace_id" text DEFAULT '' NOT NULL,
	"session_id" text NOT NULL,
	"action_name" text NOT NULL,
	"risk_level" "control_plane_risk_level" NOT NULL,
	"decision" "control_plane_policy_outcome" NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by" text
);
--> statement-breakpoint
ALTER TABLE "control_plane_policy_jtis" ADD CONSTRAINT "control_plane_policy_jtis_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane_policy_jtis" ADD CONSTRAINT "control_plane_policy_jtis_consumed_by_users_id_fk" FOREIGN KEY ("consumed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_plane_policy_jtis_tenant_session_idx" ON "control_plane_policy_jtis" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "control_plane_policy_jtis_expires_idx" ON "control_plane_policy_jtis" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "control_plane_policy_jtis_consumed_idx" ON "control_plane_policy_jtis" USING btree ("consumed_at");--> statement-breakpoint
