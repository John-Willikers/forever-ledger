CREATE TABLE "corpses" (
	"npc_id" integer NOT NULL,
	"build" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"session" text NOT NULL,
	"count" integer NOT NULL,
	"copper" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corpses_npc_id_build_uploader_id_account_session_pk" PRIMARY KEY("npc_id","build","uploader_id","account","session")
);
--> statement-breakpoint
ALTER TABLE "drops" ADD COLUMN "session" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "drops" ADD COLUMN "quantity" integer;--> statement-breakpoint
ALTER TABLE "drops" DROP CONSTRAINT "drops_item_id_build_npc_id_uploader_id_account_pk";--> statement-breakpoint
ALTER TABLE "drops" ADD CONSTRAINT "drops_item_id_build_npc_id_uploader_id_account_session_pk" PRIMARY KEY("item_id","build","npc_id","uploader_id","account","session");--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "loot_method" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "boss_loot" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "group_loot" jsonb;--> statement-breakpoint
CREATE INDEX "corpses_build_idx" ON "corpses" USING btree ("build");