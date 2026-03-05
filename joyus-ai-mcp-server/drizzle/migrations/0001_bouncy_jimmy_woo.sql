CREATE TYPE "public"."export_locations" AS ENUM('current', 'all_accessible');--> statement-breakpoint
CREATE TYPE "public"."export_scope" AS ENUM('current_view', 'full_period');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"scope" "export_scope" NOT NULL,
	"locations" "export_locations" NOT NULL,
	"date_start" text,
	"date_end" text,
	"scenario_id" text,
	"file_path" text,
	"file_name" text,
	"file_size_bytes" integer,
	"error" text,
	"download_token" text,
	"download_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_jobs_download_token_unique" UNIQUE("download_token")
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_user_id_idx" ON "export_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "export_jobs_tenant_id_idx" ON "export_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "export_jobs_download_expires_idx" ON "export_jobs" USING btree ("download_expires_at");