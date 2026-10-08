CREATE TABLE "guides" (
	"id" serial PRIMARY KEY NOT NULL,
	"char" text NOT NULL,
	"token_id" integer NOT NULL,
	"title" text NOT NULL,
	"request" jsonb NOT NULL,
	"doc" jsonb NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guides_token_idx" ON "guides" USING btree ("token_id","deleted_at");--> statement-breakpoint
CREATE INDEX "guides_char_idx" ON "guides" USING btree ("char");