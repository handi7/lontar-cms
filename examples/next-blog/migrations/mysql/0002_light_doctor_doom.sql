CREATE TABLE `authors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`bio` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `authors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename` varchar(255) NOT NULL,
	`url` varchar(1024) NOT NULL,
	`mimeType` varchar(255) NOT NULL,
	`filesize` int NOT NULL,
	`width` int,
	`height` int,
	`sizes` json,
	`alt` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `media_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `posts_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int NOT NULL,
	`target_id` int NOT NULL,
	`order` int NOT NULL DEFAULT 0,
	CONSTRAINT `posts_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `posts_categories_parent_target_unique` UNIQUE(`parent_id`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `site-settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`siteName` varchar(255),
	`footerText` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `site-settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `posts` MODIFY COLUMN `title` varchar(120) NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `slug` varchar(255);--> statement-breakpoint
ALTER TABLE `posts` ADD `status` varchar(120) DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `posts` ADD `cover` int;--> statement-breakpoint
ALTER TABLE `posts` ADD `author` int;--> statement-breakpoint
ALTER TABLE `posts` ADD `content` json;--> statement-breakpoint
ALTER TABLE `posts` ADD `publishedAt` datetime(3);--> statement-breakpoint
ALTER TABLE `posts` ADD CONSTRAINT `posts_slug_unique` UNIQUE(`slug`);--> statement-breakpoint
CREATE INDEX `posts_categories_parent_idx` ON `posts_categories` (`parent_id`);--> statement-breakpoint
CREATE INDEX `posts_categories_target_idx` ON `posts_categories` (`target_id`);--> statement-breakpoint
ALTER TABLE `posts` DROP COLUMN `views`;