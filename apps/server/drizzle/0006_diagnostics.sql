CREATE TABLE "diagnostics" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer,
	"uploader_id" text NOT NULL,
	"app_version" text NOT NULL,
	"platform" text NOT NULL,
	"level" text NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_id" integer,
	"uploader_id" text,
	"account" text,
	"schema_version" integer,
	"status" integer NOT NULL,
	"error" text NOT NULL,
	"issues" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_errors" ADD CONSTRAINT "ingest_errors_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diagnostics_received_idx" ON "diagnostics" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "ingest_errors_received_idx" ON "ingest_errors" USING btree ("received_at");