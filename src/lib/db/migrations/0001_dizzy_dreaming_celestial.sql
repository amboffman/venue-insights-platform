CREATE TYPE "public"."span_status" AS ENUM('unset', 'ok', 'error');--> statement-breakpoint
CREATE TABLE "spans" (
	"span_id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"parent_span_id" text,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_ms" double precision NOT NULL,
	"status" "span_status" NOT NULL,
	"status_message" text,
	"attributes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "spans_trace_id_idx" ON "spans" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "spans_name_idx" ON "spans" USING btree ("name");--> statement-breakpoint
CREATE INDEX "spans_started_at_idx" ON "spans" USING btree ("started_at");