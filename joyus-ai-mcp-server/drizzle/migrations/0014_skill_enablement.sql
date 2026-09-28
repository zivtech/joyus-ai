CREATE TABLE "skill_enablement" (
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"skill_name" text NOT NULL,
	"enabled_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_enablement" ADD CONSTRAINT "skill_enablement_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_enablement_user_session_skill_unique" ON "skill_enablement" USING btree ("user_id","session_id","skill_name");--> statement-breakpoint
CREATE INDEX "skill_enablement_expires_at_idx" ON "skill_enablement" USING btree ("expires_at");