CREATE TABLE "zone_maps" (
	"ui_map_id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"build" integer,
	"uploaded_by" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_maps_mime_check" CHECK ("zone_maps"."mime" in ('image/png', 'image/webp', 'image/jpeg')),
	CONSTRAINT "zone_maps_size_check" CHECK ("zone_maps"."width" between 1 and 4096 and "zone_maps"."height" between 1 and 4096)
);
--> statement-breakpoint
ALTER TABLE "zone_maps" ADD CONSTRAINT "zone_maps_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;