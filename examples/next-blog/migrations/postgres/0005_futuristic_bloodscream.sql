ALTER TABLE "pages" DROP CONSTRAINT "pages_slug_unique";
--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "title" TO "title_en";
--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "title_en" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "slug" TO "slug_en";
--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "seo__metaTitle" TO "seo__metaTitle_en";
--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "seo__metaDescription" TO "seo__metaDescription_en";
--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "seo__reviewNotes" TO "seo__reviewNotes_en";
--> statement-breakpoint
ALTER TABLE "pages" RENAME COLUMN "layout" TO "layout_en";
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT "posts_slug_unique";
--> statement-breakpoint
ALTER TABLE "posts" RENAME COLUMN "title" TO "title_en";
--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "title_en" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" RENAME COLUMN "slug" TO "slug_en";
--> statement-breakpoint
ALTER TABLE "posts" RENAME COLUMN "content" TO "content_en";
--> statement-breakpoint
ALTER TABLE "media" RENAME COLUMN "alt" TO "alt_en";
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "alt_en" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "alt_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "title_id" varchar(120);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "slug_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "seo__metaTitle_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "seo__metaDescription_id" text;
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "seo__reviewNotes_id" text;
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "layout_id" jsonb;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "title_id" varchar(120);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "slug_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "excerpt_en" text;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "excerpt_id" text;
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_id" jsonb;
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_slug_en_unique" UNIQUE("slug_en");
--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_slug_id_unique" UNIQUE("slug_id");
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_slug_en_unique" UNIQUE("slug_en");
--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_slug_id_unique" UNIQUE("slug_id");
