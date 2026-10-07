CREATE TABLE "character_aliases" (
	"alias_key" text PRIMARY KEY NOT NULL,
	"canonical_key" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fishing_casts" (
	"id" text PRIMARY KEY NOT NULL,
	"char" text NOT NULL,
	"build" integer NOT NULL,
	"cast_at" timestamp with time zone NOT NULL,
	"spell_id" integer,
	"map_id" integer,
	"zone" text,
	"subzone" text,
	"x" real,
	"y" real,
	"skill" integer,
	"skill_max" integer,
	"modifier" integer,
	"lure" integer,
	"lure_secs" integer,
	"outcome" text NOT NULL,
	"secs" integer,
	"loot" jsonb NOT NULL,
	"money" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fishing_casts_outcome_check" CHECK ("fishing_casts"."outcome" in ('loot', 'escaped', 'notHooked', 'none'))
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "guid" text;--> statement-breakpoint
CREATE INDEX "fishing_casts_zone_idx" ON "fishing_casts" USING btree ("zone","subzone","build");--> statement-breakpoint
CREATE INDEX "fishing_casts_char_idx" ON "fishing_casts" USING btree ("char","cast_at");--> statement-breakpoint
CREATE INDEX "fishing_casts_loot_idx" ON "fishing_casts" USING gin ("loot");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_guid_idx" ON "characters" USING btree ("guid");