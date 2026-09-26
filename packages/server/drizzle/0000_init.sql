CREATE TABLE "api_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"request_hash" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"jev_model" text NOT NULL,
	"question_set" text NOT NULL,
	"question_key" text NOT NULL,
	"method" text NOT NULL,
	"params" jsonb NOT NULL,
	"n" integer NOT NULL,
	"ece_before" double precision,
	"ece_after" double precision,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmed_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"issue_number" integer NOT NULL,
	"issue_content_hash" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"corpus" text NOT NULL,
	"split" text NOT NULL,
	"git_sha" text NOT NULL,
	"question_set" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"report_path" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"unit_uid" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"line" integer,
	"detail" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"finding_id" text NOT NULL,
	"content_key" text NOT NULL,
	"github_login" text NOT NULL,
	"label" text NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"fid" text NOT NULL,
	"content_key" text NOT NULL,
	"type" text NOT NULL,
	"target_id" text NOT NULL,
	"status" text,
	"priority" text NOT NULL,
	"route" text NOT NULL,
	"confidence" double precision NOT NULL,
	"answers" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"locations" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installations" (
	"id" bigint PRIMARY KEY NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text DEFAULT 'Organization' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"config_hash" text
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"rid" text NOT NULL,
	"issue_ref" text NOT NULL,
	"issue_content_hash" text NOT NULL,
	"text_hash" text NOT NULL,
	"kind" text NOT NULL,
	"explicitness" text NOT NULL,
	"priority" text NOT NULL,
	"ambiguous" boolean DEFAULT false NOT NULL,
	"checkable" boolean DEFAULT true NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"text" text,
	"quote" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"issue_refs" jsonb NOT NULL,
	"link_strength" text NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"question_set" text NOT NULL,
	"extraction_prompt" text NOT NULL,
	"jev_model" text NOT NULL,
	"llm_model" text,
	"calibration_id" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"has_p0" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"uid" text NOT NULL,
	"file" text NOT NULL,
	"symbol" text,
	"kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"line_ranges" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_calls" ADD CONSTRAINT "api_calls_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmed_checklists" ADD CONSTRAINT "confirmed_checklists_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payloads" ADD CONSTRAINT "payloads_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checklists_repo_issue" ON "confirmed_checklists" USING btree ("repository_id","issue_number");--> statement-breakpoint
CREATE INDEX "feedback_content_key" ON "feedback" USING btree ("content_key");--> statement-breakpoint
CREATE INDEX "feedback_repo_pr" ON "feedback" USING btree ("repo","pr_number");--> statement-breakpoint
CREATE INDEX "findings_review" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "findings_content_key" ON "findings" USING btree ("content_key");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_full_name" ON "repositories" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "reviews_repo_pr" ON "reviews" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE INDEX "reviews_created" ON "reviews" USING btree ("created_at");