ALTER TABLE "api_tokens" ADD COLUMN "helper_status" text;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "helper_of" integer;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "fetch_daily_budget" integer;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "fetch_hourly_budget" integer;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "fetch_sites" text[];