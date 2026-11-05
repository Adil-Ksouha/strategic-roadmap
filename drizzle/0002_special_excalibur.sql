CREATE TABLE `portfolio_teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text NOT NULL,
	`accent` varchar(24) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `portfolio_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `portfolio_teams_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `team_memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`teamId` int NOT NULL,
	`role` enum('lead','contributor') NOT NULL DEFAULT 'contributor',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_membership_unique` UNIQUE(`userId`,`teamId`)
);
--> statement-breakpoint
ALTER TABLE `capabilities` ADD `teamId` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `use_cases` ADD `teamId` int DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `team_membership_user_idx` ON `team_memberships` (`userId`);--> statement-breakpoint
CREATE INDEX `team_membership_team_idx` ON `team_memberships` (`teamId`);