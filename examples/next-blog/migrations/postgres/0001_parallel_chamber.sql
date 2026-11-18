ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'author' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "user_role_idx" ON "user" USING btree ("role");
--> statement-breakpoint
UPDATE "user" SET "role" = 'author';
--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1);
