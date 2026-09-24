DROP INDEX "runs_instance_idx";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "group_id" text;--> statement-breakpoint
CREATE INDEX "runs_group_idx" ON "runs" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "runs_instance_idx" ON "runs" USING btree ("instance_id","build","started_at");