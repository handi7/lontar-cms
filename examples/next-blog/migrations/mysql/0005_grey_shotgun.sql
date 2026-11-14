-- Note: If existing databases contain duplicate (parent_id, version_number) rows
-- from before #243, they must be deduplicated/renumbered before applying this unique constraint.
ALTER TABLE `pages_versions` ADD CONSTRAINT `pages_versions_parent_version_unique` UNIQUE(`parent_id`,`version_number`);--> statement-breakpoint
ALTER TABLE `posts_versions` ADD CONSTRAINT `posts_versions_parent_version_unique` UNIQUE(`parent_id`,`version_number`);
