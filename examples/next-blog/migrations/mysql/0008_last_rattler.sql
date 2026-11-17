CREATE TABLE `rateLimit` (
	`id` varchar(36) NOT NULL,
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`last_request` bigint NOT NULL,
	CONSTRAINT `rateLimit_id` PRIMARY KEY(`id`),
	CONSTRAINT `rateLimit_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE INDEX `rateLimit_key_idx` ON `rateLimit` (`key`);