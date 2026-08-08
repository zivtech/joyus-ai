-- Guarded for stale-environment catch-up (#96): environments whose migration
-- position predates the chain rewrite have no "pipelines"."pipelines" table yet.
-- For them this swap is a no-op; 0013_pipelines_baseline_repair creates the
-- final-state index instead.
DO $$
BEGIN
  IF to_regclass('pipelines.pipelines') IS NOT NULL THEN
    DROP INDEX IF EXISTS "pipelines"."pipelines_tenant_name_unique";
    CREATE INDEX IF NOT EXISTS "pipelines_tenant_name_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","name");
  END IF;
END $$;--> statement-breakpoint
