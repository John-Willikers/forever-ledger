CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"build" integer PRIMARY KEY NOT NULL,
	"version" text,
	"interface" integer,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"realm" text NOT NULL,
	"class" text,
	"race" text,
	"faction" text,
	"level" integer,
	"last_seen" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drops" (
	"item_id" integer NOT NULL,
	"build" integer NOT NULL,
	"npc_id" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drops_item_id_build_npc_id_uploader_id_account_pk" PRIMARY KEY("item_id","build","npc_id","uploader_id","account")
);
--> statement-breakpoint
CREATE TABLE "item_snapshots" (
	"item_id" integer NOT NULL,
	"build" integer NOT NULL,
	"link" text,
	"ilvl" integer,
	"req_level" integer,
	"sell_price" integer,
	"stats" jsonb NOT NULL,
	"tooltip" jsonb NOT NULL,
	"first_seen" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_snapshots_item_id_build_pk" PRIMARY KEY("item_id","build")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality" integer,
	"type" text,
	"subtype" text,
	"equip_loc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quest_observations" (
	"quest_id" integer NOT NULL,
	"build" integer NOT NULL,
	"stage" text NOT NULL,
	"char" text NOT NULL,
	"level" integer,
	"observed_at" timestamp with time zone,
	"xp" integer,
	"money" integer,
	"npc_id" integer,
	"npc_name" text,
	"npc_loc" jsonb,
	"loc" jsonb,
	"choices" jsonb,
	"rewards" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quest_observations_quest_id_build_stage_char_pk" PRIMARY KEY("quest_id","build","stage","char")
);
--> statement-breakpoint
CREATE TABLE "quest_reward_options" (
	"quest_id" integer NOT NULL,
	"build" integer NOT NULL,
	"item_id" integer NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "quest_reward_options_quest_id_build_item_id_kind_pk" PRIMARY KEY("quest_id","build","item_id","kind")
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"quest_id" integer PRIMARY KEY NOT NULL,
	"title" text,
	"level" integer,
	"category" text,
	"suggested_group" integer,
	"objectives" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"schema_version" integer NOT NULL,
	"client_build" integer NOT NULL,
	"record_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_bosses" (
	"run_id" text NOT NULL,
	"ord" integer NOT NULL,
	"encounter_id" integer,
	"name" text,
	"killed" boolean NOT NULL,
	"at_secs" integer NOT NULL,
	CONSTRAINT "run_bosses_run_id_ord_pk" PRIMARY KEY("run_id","ord")
);
--> statement-breakpoint
CREATE TABLE "run_party" (
	"run_id" text NOT NULL,
	"slot" integer NOT NULL,
	"class" text,
	"level" integer,
	CONSTRAINT "run_party_run_id_slot_pk" PRIMARY KEY("run_id","slot")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"build" integer NOT NULL,
	"char" text NOT NULL,
	"char_level" integer,
	"instance" text,
	"instance_id" integer NOT NULL,
	"difficulty" integer,
	"max_players" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"end_reason" text,
	"away_secs" integer NOT NULL,
	"active_secs" integer,
	"xp_total" integer NOT NULL,
	"quest_xp" integer NOT NULL,
	"mob_xp" integer,
	"deaths" integer NOT NULL,
	"loot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_ins" (
	"id" text PRIMARY KEY NOT NULL,
	"quest_id" integer NOT NULL,
	"build" integer NOT NULL,
	"char" text NOT NULL,
	"xp" integer,
	"money" integer,
	"level" integer,
	"turned_in_at" timestamp with time zone NOT NULL,
	"run_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_uploads" ADD CONSTRAINT "raw_uploads_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_bosses" ADD CONSTRAINT "run_bosses_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_party" ADD CONSTRAINT "run_party_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drops_npc_idx" ON "drops" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "raw_uploads_received_idx" ON "raw_uploads" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "runs_instance_idx" ON "runs" USING btree ("instance_id","build");--> statement-breakpoint
CREATE INDEX "turn_ins_quest_idx" ON "turn_ins" USING btree ("quest_id","build");--> statement-breakpoint
CREATE INDEX "turn_ins_run_idx" ON "turn_ins" USING btree ("run_id");