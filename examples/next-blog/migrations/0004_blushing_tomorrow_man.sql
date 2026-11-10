CREATE TABLE `pages_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int NOT NULL,
	`version_number` int NOT NULL,
	`snapshot` json NOT NULL,
	`_status` varchar(20) NOT NULL DEFAULT 'draft',
	`autosave` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(36),
	CONSTRAINT `pages_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `posts_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_id` int NOT NULL,
	`version_number` int NOT NULL,
	`snapshot` json NOT NULL,
	`_status` varchar(20) NOT NULL DEFAULT 'draft',
	`autosave` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(36),
	CONSTRAINT `posts_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `posts` RENAME COLUMN `status` TO `_status`;--> statement-breakpoint
ALTER TABLE `posts` MODIFY COLUMN `_status` varchar(20) NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `pages` ADD `_status` varchar(20) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages_versions` ADD CONSTRAINT `pages_versions_parent_id_pages_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `posts_versions` ADD CONSTRAINT `posts_versions_parent_id_posts_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `posts`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pages_versions_parent_id_idx` ON `pages_versions` (`parent_id`,`id`);--> statement-breakpoint
CREATE INDEX `pages_versions_parent_status_idx` ON `pages_versions` (`parent_id`,`_status`);--> statement-breakpoint
CREATE INDEX `posts_versions_parent_id_idx` ON `posts_versions` (`parent_id`,`id`);--> statement-breakpoint
CREATE INDEX `posts_versions_parent_status_idx` ON `posts_versions` (`parent_id`,`_status`);--> statement-breakpoint
CREATE INDEX `pages__status_idx` ON `pages` (`_status`);--> statement-breakpoint
CREATE INDEX `posts__status_idx` ON `posts` (`_status`);