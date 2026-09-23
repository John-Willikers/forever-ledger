CREATE TABLE "api_samples" (
	"api" text NOT NULL,
	"build" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"sample" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_samples_api_build_pk" PRIMARY KEY("api","build")
);
--> statement-breakpoint
CREATE TABLE "crafts" (
	"recipe_id" integer NOT NULL,
	"build" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"session" text NOT NULL,
	"casts" integer NOT NULL,
	"qty" integer NOT NULL,
	"procs" integer NOT NULL,
	"skill_ups" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crafts_recipe_id_build_uploader_id_account_session_pk" PRIMARY KEY("recipe_id","build","uploader_id","account","session")
);
--> statement-breakpoint
CREATE TABLE "node_loot" (
	"item_id" integer NOT NULL,
	"object_id" integer NOT NULL,
	"build" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"session" text NOT NULL,
	"count" integer NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_loot_item_id_object_id_build_uploader_id_account_session_pk" PRIMARY KEY("item_id","object_id","build","uploader_id","account","session")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"object_id" integer NOT NULL,
	"build" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"session" text NOT NULL,
	"opened" integer NOT NULL,
	"name" text,
	"rank_min" integer,
	"skill_line_id" integer,
	"spots" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_object_id_build_uploader_id_account_session_pk" PRIMARY KEY("object_id","build","uploader_id","account","session")
);
--> statement-breakpoint
CREATE TABLE "recipe_difficulty" (
	"recipe_id" integer NOT NULL,
	"build" integer NOT NULL,
	"char" text NOT NULL,
	"difficulty" text NOT NULL,
	"min_rank" integer NOT NULL,
	"max_rank" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_difficulty_recipe_id_build_char_difficulty_pk" PRIMARY KEY("recipe_id","build","char","difficulty")
);
--> statement-breakpoint
CREATE TABLE "recipe_snapshots" (
	"recipe_id" integer NOT NULL,
	"build" integer NOT NULL,
	"output_item_id" integer,
	"qty_min" integer,
	"qty_max" integer,
	"reagents" jsonb NOT NULL,
	"max_trivial" integer,
	"source_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_snapshots_recipe_id_build_pk" PRIMARY KEY("recipe_id","build")
);
--> statement-breakpoint
CREATE TABLE "recipe_status" (
	"recipe_id" integer NOT NULL,
	"build" integer NOT NULL,
	"char" text NOT NULL,
	"learned" boolean NOT NULL,
	"difficulty" text,
	"rank" integer,
	"seen_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_status_recipe_id_build_char_pk" PRIMARY KEY("recipe_id","build","char")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"recipe_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"skill_line_id" integer,
	"category_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes_learned" (
	"char" text NOT NULL,
	"recipe_id" integer NOT NULL,
	"build" integer NOT NULL,
	"learned_at" timestamp with time zone NOT NULL,
	"via" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipes_learned_char_recipe_id_learned_at_pk" PRIMARY KEY("char","recipe_id","learned_at")
);
--> statement-breakpoint
CREATE TABLE "skill_ups" (
	"char" text NOT NULL,
	"skill_line_id" integer NOT NULL,
	"from_rank" integer NOT NULL,
	"to_rank" integer NOT NULL,
	"build" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recipe_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_ups_char_skill_line_id_observed_at_to_rank_pk" PRIMARY KEY("char","skill_line_id","observed_at","to_rank")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"char" text NOT NULL,
	"skill_line_id" integer NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"max_rank" integer NOT NULL,
	"modifier" integer,
	"parent_id" integer,
	"last_seen" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_char_skill_line_id_pk" PRIMARY KEY("char","skill_line_id")
);
--> statement-breakpoint
CREATE TABLE "trainers" (
	"npc_id" integer NOT NULL,
	"build" integer NOT NULL,
	"name" text,
	"loc" jsonb,
	"skill_line_id" integer,
	"seen_at" timestamp with time zone NOT NULL,
	"services" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainers_npc_id_build_pk" PRIMARY KEY("npc_id","build")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"npc_id" integer NOT NULL,
	"build" integer NOT NULL,
	"name" text,
	"loc" jsonb,
	"seen_at" timestamp with time zone NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_npc_id_build_pk" PRIMARY KEY("npc_id","build")
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "class_id" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "subclass_id" integer;--> statement-breakpoint
CREATE INDEX "node_loot_object_idx" ON "node_loot" USING btree ("object_id","build");--> statement-breakpoint
CREATE INDEX "nodes_build_idx" ON "nodes" USING btree ("build");--> statement-breakpoint
CREATE INDEX "recipes_skill_line_idx" ON "recipes" USING btree ("skill_line_id");--> statement-breakpoint
CREATE INDEX "recipes_learned_recipe_idx" ON "recipes_learned" USING btree ("recipe_id");