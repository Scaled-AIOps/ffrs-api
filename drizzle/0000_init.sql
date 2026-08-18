CREATE TYPE "public"."feedback_kind" AS ENUM('bug', 'feature', 'contact');--> statement-breakpoint
CREATE TYPE "public"."feedback_outcome" AS ENUM('fixed', 'shipped', 'answered', 'declined', 'wontfix', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."feedback_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('new', 'routed', 'responded', 'closed', 'spam', 'duplicate');--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ref" text NOT NULL,
	"idempotency_key" text,
	"kind" "feedback_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"page_url" text,
	"severity" "feedback_severity",
	"screenshot_key" text,
	"meta" jsonb,
	"email" text,
	"consent" boolean DEFAULT false NOT NULL,
	"status" "feedback_status" DEFAULT 'new' NOT NULL,
	"outcome" "feedback_outcome",
	"github_issue_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"routed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "side_effects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "side_effects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"feedback_id" bigint NOT NULL,
	"type" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_try_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "side_effects" ADD CONSTRAINT "side_effects_feedback_id_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_ref_idx" ON "feedback" USING btree ("ref");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_idempotency_idx" ON "feedback" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "feedback_kind_status_created_idx" ON "feedback" USING btree ("kind","status","created_at");--> statement-breakpoint
CREATE INDEX "side_effects_pending_idx" ON "side_effects" USING btree ("next_try_at") WHERE "side_effects"."done_at" is null;