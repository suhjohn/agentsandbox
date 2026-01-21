DROP INDEX IF EXISTS "agents_image_id_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_image_idx" ON "agents" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_parent_agent_id_idx" ON "agents" USING btree ("parent_agent_id");
