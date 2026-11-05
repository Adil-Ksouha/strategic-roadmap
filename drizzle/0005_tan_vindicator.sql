ALTER TABLE `use_cases` MODIFY COLUMN `teamId` int;--> statement-breakpoint
ALTER TABLE `use_cases` ADD `scope` enum('team','shared') DEFAULT 'team' NOT NULL;--> statement-breakpoint
CREATE INDEX `use_cases_scope_idx` ON `use_cases` (`scope`);