CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start" text NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"last_used_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apikey_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apikey_userId_idx" ON "apikey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");