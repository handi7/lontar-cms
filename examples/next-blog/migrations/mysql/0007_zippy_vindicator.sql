CREATE TABLE `apikey` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`start` varchar(32) NOT NULL,
	`key` varchar(255) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`expires_at` timestamp,
	`last_used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `apikey_id` PRIMARY KEY(`id`),
	CONSTRAINT `apikey_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
ALTER TABLE `apikey` ADD CONSTRAINT `apikey_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `apikey_userId_idx` ON `apikey` (`user_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);