CREATE TABLE "fetch_budget" (
	"token_id" integer NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"leased" integer NOT NULL,
	CONSTRAINT "fetch_budget_pk" PRIMARY KEY("token_id","hour")
);
--> statement-breakpoint
ALTER TABLE "fetch_budget" ADD CONSTRAINT "fetch_budget_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;