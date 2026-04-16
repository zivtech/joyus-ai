ALTER TABLE "content"."mediation_sessions" ADD COLUMN "total_input_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD COLUMN "total_output_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD COLUMN "total_cache_write_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD COLUMN "total_cache_read_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD COLUMN "total_estimated_cost_usd" numeric(14, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD COLUMN "cache_miss_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD COLUMN "max_idle_gap_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content"."operation_logs" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE INDEX "content_op_logs_tenant_session_idx" ON "content"."operation_logs" USING btree ("tenant_id","session_id") WHERE session_id IS NOT NULL;