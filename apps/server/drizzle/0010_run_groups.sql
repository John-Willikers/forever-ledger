ALTER TABLE "runs" ADD COLUMN "group_id" text;--> statement-breakpoint
CREATE INDEX "runs_group_idx" ON "runs" USING btree ("group_id");