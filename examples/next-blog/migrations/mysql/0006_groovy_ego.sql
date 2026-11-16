ALTER TABLE `session` ADD `impersonated_by` text;--> statement-breakpoint
ALTER TABLE `user` ADD `role` varchar(50) DEFAULT 'editor' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` timestamp;--> statement-breakpoint
CREATE INDEX `user_role_idx` ON `user` (`role`);
--> statement-breakpoint
UPDATE `user` SET `role` = 'editor';
--> statement-breakpoint
UPDATE `user` SET `role` = 'admin' ORDER BY `created_at` ASC LIMIT 1;
