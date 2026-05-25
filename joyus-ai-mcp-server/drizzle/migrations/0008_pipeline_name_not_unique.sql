DROP INDEX IF EXISTS "pipelines"."pipelines_tenant_name_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipelines_tenant_name_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","name");--> statement-breakpoint
