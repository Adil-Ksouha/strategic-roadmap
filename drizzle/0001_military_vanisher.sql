CREATE TABLE `annual_investments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`useCaseId` int NOT NULL,
	`planningYear` int NOT NULL,
	`amountUsdM` decimal(12,2) NOT NULL,
	CONSTRAINT `annual_investments_id` PRIMARY KEY(`id`),
	CONSTRAINT `annual_investment_unique` UNIQUE(`useCaseId`,`planningYear`)
);
--> statement-breakpoint
CREATE TABLE `capabilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`domain` varchar(80) NOT NULL,
	`description` text NOT NULL,
	`owner` varchar(120) NOT NULL,
	`maturity` enum('emerging','evolving','established') NOT NULL DEFAULT 'emerging',
	`criticality` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`targetYear` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `capabilities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `execution_milestones` (
	`id` int AUTO_INCREMENT NOT NULL,
	`useCaseId` int NOT NULL,
	`planningYear` int NOT NULL,
	`phase` enum('discover','foundation','scale','optimize','run') NOT NULL,
	`title` varchar(180) NOT NULL,
	`status` enum('planned','in_progress','complete') NOT NULL DEFAULT 'planned',
	CONSTRAINT `execution_milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `planning_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('feature_enhancement','eos','capacity_forecast') NOT NULL,
	`title` varchar(180) NOT NULL,
	`description` text NOT NULL,
	`owner` varchar(120) NOT NULL,
	`status` enum('assess','planned','in_progress','monitoring') NOT NULL DEFAULT 'assess',
	`impact` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`targetYear` int NOT NULL,
	`relatedCapabilityId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `planning_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `use_case_capabilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`useCaseId` int NOT NULL,
	`capabilityId` int NOT NULL,
	`contribution` enum('anchor','enabling','supporting') NOT NULL DEFAULT 'supporting',
	CONSTRAINT `use_case_capabilities_id` PRIMARY KEY(`id`),
	CONSTRAINT `use_case_capability_unique` UNIQUE(`useCaseId`,`capabilityId`)
);
--> statement-breakpoint
CREATE TABLE `use_cases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`theme` varchar(100) NOT NULL,
	`description` text NOT NULL,
	`outcome` text NOT NULL,
	`sponsor` varchar(120) NOT NULL,
	`status` enum('prioritized','in_flight','planned','watchlist') NOT NULL DEFAULT 'planned',
	`priority` enum('p1','p2','p3') NOT NULL DEFAULT 'p2',
	`startYear` int NOT NULL,
	`endYear` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `use_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `investments_use_case_idx` ON `annual_investments` (`useCaseId`);--> statement-breakpoint
CREATE INDEX `investments_year_idx` ON `annual_investments` (`planningYear`);--> statement-breakpoint
CREATE INDEX `capabilities_domain_idx` ON `capabilities` (`domain`);--> statement-breakpoint
CREATE INDEX `milestones_use_case_idx` ON `execution_milestones` (`useCaseId`);--> statement-breakpoint
CREATE INDEX `milestones_year_idx` ON `execution_milestones` (`planningYear`);--> statement-breakpoint
CREATE INDEX `planning_items_type_idx` ON `planning_items` (`type`);--> statement-breakpoint
CREATE INDEX `planning_items_year_idx` ON `planning_items` (`targetYear`);--> statement-breakpoint
CREATE INDEX `ucc_use_case_idx` ON `use_case_capabilities` (`useCaseId`);--> statement-breakpoint
CREATE INDEX `ucc_capability_idx` ON `use_case_capabilities` (`capabilityId`);--> statement-breakpoint
CREATE INDEX `use_cases_theme_idx` ON `use_cases` (`theme`);