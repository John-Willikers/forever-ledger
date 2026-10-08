CREATE TABLE "quest_objective_progress" (
	"char" text NOT NULL,
	"quest_id" integer NOT NULL,
	"idx" integer NOT NULL,
	"have" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"need" integer,
	"build" integer NOT NULL,
	"text" text,
	"map_id" integer,
	"zone" text,
	"subzone" text,
	"x" real,
	"y" real,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_objective_progress_char_quest_id_idx_have_at_pk" PRIMARY KEY("char","quest_id","idx","have","at")
);
--> statement-breakpoint
CREATE INDEX "quest_objective_progress_quest_idx" ON "quest_objective_progress" USING btree ("quest_id","idx");