ALTER TABLE `users` ADD COLUMN `passwordHash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `isActive` enum('active','disabled') DEFAULT 'active' NOT NULL;
