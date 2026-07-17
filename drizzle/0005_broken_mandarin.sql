CREATE TABLE "content_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"rrule" text NOT NULL,
	"channels" text[] NOT NULL,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "post_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"guest_name" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"channels" text[] NOT NULL,
	"body" text,
	"channel_overrides" jsonb DEFAULT '{}'::jsonb,
	"media" uuid[] DEFAULT '{}',
	"scheduled_at" timestamp with time zone,
	"status" text DEFAULT 'idea' NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"ghl_post_id" text,
	"published_at" timestamp with time zone,
	"permalinks" jsonb DEFAULT '{}'::jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_slots" ADD CONSTRAINT "content_slots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_approvals" ADD CONSTRAINT "post_approvals_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_approvals" ADD CONSTRAINT "post_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_calendar" ON "posts" USING btree ("account_id","scheduled_at");