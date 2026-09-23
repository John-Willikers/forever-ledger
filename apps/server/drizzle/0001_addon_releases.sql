CREATE TABLE "addon_pins" (
	"id" serial PRIMARY KEY NOT NULL,
	"build_min" integer NOT NULL,
	"build_max" integer,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addon_releases" (
	"version" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addon_pins" ADD CONSTRAINT "addon_pins_version_addon_releases_version_fk" FOREIGN KEY ("version") REFERENCES "public"."addon_releases"("version") ON DELETE no action ON UPDATE no action;