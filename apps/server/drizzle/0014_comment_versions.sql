ALTER TABLE "web_comments" ADD COLUMN "data_tree" integer;--> statement-breakpoint
ALTER TABLE "web_comments" ADD COLUMN "game_version" text DEFAULT 'unknown' NOT NULL;