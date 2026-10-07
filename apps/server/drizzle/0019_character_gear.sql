CREATE TABLE "character_gear" (
	"char" text NOT NULL,
	"build" integer NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"slots" jsonb NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_gear_char_build_pk" PRIMARY KEY("char","build")
);
