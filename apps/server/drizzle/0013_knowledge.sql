CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_key" text NOT NULL,
	"entity_id" integer,
	"entity_name" text,
	"attribute" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_hash" text NOT NULL,
	"label" text NOT NULL,
	"observed_build" integer,
	"quote" text,
	"parser" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_label_check" CHECK ("claims"."label" in ('VERIFIED', 'CLASSIC', 'ANECDOTE', 'UNVERIFIED', 'FALSE'))
);
--> statement-breakpoint
CREATE TABLE "fetch_targets" (
	"url" text PRIMARY KEY NOT NULL,
	"site" text NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"lease_token_id" integer,
	"lease_worker" text,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"last_outcome" text,
	"last_error" text,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"added_by" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fetch_targets_state_check" CHECK ("fetch_targets"."state" in ('queued', 'leased', 'done', 'needs_human', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "field_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"character" text,
	"faction" text,
	"race" text,
	"class" text,
	"level" integer,
	"build" integer,
	"game_version" text DEFAULT 'forever' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"duration_mins" integer,
	"location" jsonb,
	"method" text NOT NULL,
	"setup" jsonb,
	"result" jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_observations_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"site" text NOT NULL,
	"tier" integer NOT NULL,
	"game_version" text NOT NULL,
	"build" integer,
	"title" text,
	"page_updated_at" timestamp with time zone,
	"snapshot_id" integer,
	"fetched_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_key_unique" UNIQUE("key"),
	CONSTRAINT "sources_tier_check" CHECK ("sources"."tier" between 1 and 7),
	CONSTRAINT "sources_kind_check" CHECK ("sources"."kind" in ('web', 'seed', 'first_party')),
	CONSTRAINT "sources_game_version_check" CHECK ("sources"."game_version" in ('forever', 'classic', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "web_comments" (
	"site" text NOT NULL,
	"comment_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"entity_type" text,
	"entity_id" integer,
	"posted_at" timestamp with time zone,
	"rating" integer,
	"body" text NOT NULL,
	CONSTRAINT "web_comments_pk" PRIMARY KEY("site","comment_id")
);
--> statement-breakpoint
CREATE TABLE "web_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"final_url" text NOT NULL,
	"http_status" integer,
	"fetched_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"html_gz" "bytea" NOT NULL,
	"worker" text NOT NULL,
	"fetcher" text NOT NULL,
	"token_id" integer
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "can_fetch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_targets" ADD CONSTRAINT "fetch_targets_lease_token_id_api_tokens_id_fk" FOREIGN KEY ("lease_token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_snapshot_id_web_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."web_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_comments" ADD CONSTRAINT "web_comments_snapshot_id_web_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."web_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_snapshots" ADD CONSTRAINT "web_snapshots_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_natural_idx" ON "claims" USING btree ("source_id","entity_type","entity_key","attribute","value_hash");--> statement-breakpoint
CREATE INDEX "claims_entity_idx" ON "claims" USING btree ("entity_type","entity_key","attribute");--> statement-breakpoint
CREATE INDEX "fetch_targets_due_idx" ON "fetch_targets" USING btree ("state","next_due_at");--> statement-breakpoint
CREATE INDEX "fetch_targets_entity_idx" ON "fetch_targets" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sources_url_idx" ON "sources" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "web_snapshots_url_sha_idx" ON "web_snapshots" USING btree ("url","sha256");--> statement-breakpoint
CREATE INDEX "web_snapshots_fetched_idx" ON "web_snapshots" USING btree ("fetched_at");