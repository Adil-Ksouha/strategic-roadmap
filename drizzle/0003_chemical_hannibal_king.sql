CREATE TABLE `team_access_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`teamId` int NOT NULL,
	`role` enum('lead','contributor') NOT NULL DEFAULT 'contributor',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_access_grants_id` PRIMARY KEY(`id`),
	CONSTRAINT `team_access_grants_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `team_access_grant_team_idx` ON `team_access_grants` (`teamId`);