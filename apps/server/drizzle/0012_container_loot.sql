CREATE TABLE "container_loot" (
	"item_id" integer NOT NULL,
	"build" integer NOT NULL,
	"container_id" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"session" text NOT NULL,
	"count" integer NOT NULL,
	"quantity" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "container_loot_pk" PRIMARY KEY("item_id","build","container_id","uploader_id","account","session")
);
--> statement-breakpoint
CREATE TABLE "container_opens" (
	"container_id" integer NOT NULL,
	"build" integer NOT NULL,
	"uploader_id" text NOT NULL,
	"account" text NOT NULL,
	"session" text NOT NULL,
	"opened" integer NOT NULL,
	"copper" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "container_opens_pk" PRIMARY KEY("container_id","build","uploader_id","account","session")
);
--> statement-breakpoint
CREATE INDEX "container_loot_container_idx" ON "container_loot" USING btree ("container_id","build");--> statement-breakpoint
CREATE INDEX "container_opens_build_idx" ON "container_opens" USING btree ("build");