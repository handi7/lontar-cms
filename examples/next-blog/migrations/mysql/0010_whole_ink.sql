ALTER TABLE `pages` DROP INDEX `pages_slug_unique`;
--> statement-breakpoint
ALTER TABLE `pages` RENAME COLUMN `title` TO `title_en`;
--> statement-breakpoint
ALTER TABLE `pages` MODIFY COLUMN `title_en` varchar(120) NULL;
--> statement-breakpoint
ALTER TABLE `pages` RENAME COLUMN `slug` TO `slug_en`;
--> statement-breakpoint
ALTER TABLE `pages` RENAME COLUMN `seo__metaTitle` TO `seo__metaTitle_en`;
--> statement-breakpoint
ALTER TABLE `pages` RENAME COLUMN `seo__metaDescription` TO `seo__metaDescription_en`;
--> statement-breakpoint
ALTER TABLE `pages` RENAME COLUMN `seo__reviewNotes` TO `seo__reviewNotes_en`;
--> statement-breakpoint
ALTER TABLE `pages` RENAME COLUMN `layout` TO `layout_en`;
--> statement-breakpoint
ALTER TABLE `posts` DROP INDEX `posts_slug_unique`;
--> statement-breakpoint
ALTER TABLE `posts` RENAME COLUMN `title` TO `title_en`;
--> statement-breakpoint
ALTER TABLE `posts` MODIFY COLUMN `title_en` varchar(120) NULL;
--> statement-breakpoint
ALTER TABLE `posts` RENAME COLUMN `slug` TO `slug_en`;
--> statement-breakpoint
ALTER TABLE `posts` RENAME COLUMN `content` TO `content_en`;
--> statement-breakpoint
ALTER TABLE `media` RENAME COLUMN `alt` TO `alt_en`;
--> statement-breakpoint
ALTER TABLE `media` MODIFY COLUMN `alt_en` varchar(255) NULL;
--> statement-breakpoint
ALTER TABLE `media` ADD `alt_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `pages` ADD `title_id` varchar(120);
--> statement-breakpoint
ALTER TABLE `pages` ADD `slug_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `pages` ADD `seo__metaTitle_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `pages` ADD `seo__metaDescription_id` text;
--> statement-breakpoint
ALTER TABLE `pages` ADD `seo__reviewNotes_id` text;
--> statement-breakpoint
ALTER TABLE `pages` ADD `layout_id` json;
--> statement-breakpoint
ALTER TABLE `posts` ADD `title_id` varchar(120);
--> statement-breakpoint
ALTER TABLE `posts` ADD `slug_id` varchar(255);
--> statement-breakpoint
ALTER TABLE `posts` ADD `excerpt_en` text;
--> statement-breakpoint
ALTER TABLE `posts` ADD `excerpt_id` text;
--> statement-breakpoint
ALTER TABLE `posts` ADD `content_id` json;
--> statement-breakpoint
ALTER TABLE `pages` ADD CONSTRAINT `pages_slug_en_unique` UNIQUE(`slug_en`);
--> statement-breakpoint
ALTER TABLE `pages` ADD CONSTRAINT `pages_slug_id_unique` UNIQUE(`slug_id`);
--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_slug_en_unique` UNIQUE(`slug_en`);
--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_slug_id_unique` UNIQUE(`slug_id`);
