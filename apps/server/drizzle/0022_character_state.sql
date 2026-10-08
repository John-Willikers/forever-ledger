CREATE TABLE "character_state" (
	"char" text PRIMARY KEY NOT NULL,
	"build" integer NOT NULL,
	"level" integer,
	"xp" integer,
	"xp_max" integer,
	"completed" integer[],
	"completed_at" timestamp with time zone,
	"log" jsonb,
	"pos" jsonb,
	"bind" jsonb,
	"hearth_ready_at" timestamp with time zone,
	"taxi" jsonb,
	"mount" jsonb,
	"observed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"char" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"build" integer NOT NULL,
	"seconds" real NOT NULL,
	"from" jsonb,
	"to" jsonb,
	"from_node" jsonb,
	"to_node" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_char_kind_started_at_pk" PRIMARY KEY("char","kind","started_at")
);
--> statement-breakpoint
CREATE TABLE "xp_curve" (
	"build" integer NOT NULL,
	"level" integer NOT NULL,
	"xp_max" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_curve_build_level_pk" PRIMARY KEY("build","level")
);
--> statement-breakpoint
CREATE INDEX "trips_kind_idx" ON "trips" USING btree ("kind","build");