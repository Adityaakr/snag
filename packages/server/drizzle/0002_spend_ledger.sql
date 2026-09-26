CREATE TABLE "spend_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"review_id" text NOT NULL,
	"amount_usd" double precision NOT NULL,
	"settled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "spend_installation_day" ON "spend_ledger" USING btree ("installation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_review" ON "spend_ledger" USING btree ("review_id");