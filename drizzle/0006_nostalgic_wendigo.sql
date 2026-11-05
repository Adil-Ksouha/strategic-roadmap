ALTER TABLE `annual_investments` DROP INDEX `annual_investment_unique`;--> statement-breakpoint
ALTER TABLE `annual_investments` ADD `teamId` int;--> statement-breakpoint
ALTER TABLE `execution_milestones` ADD `teamId` int;--> statement-breakpoint
UPDATE `annual_investments` AS investment INNER JOIN `use_cases` AS objective ON objective.`id` = investment.`useCaseId` SET investment.`teamId` = objective.`teamId` WHERE objective.`scope` = 'team' AND objective.`teamId` IS NOT NULL;--> statement-breakpoint
UPDATE `execution_milestones` AS milestone INNER JOIN `use_cases` AS objective ON objective.`id` = milestone.`useCaseId` SET milestone.`teamId` = objective.`teamId` WHERE objective.`scope` = 'team' AND objective.`teamId` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `annual_investments` MODIFY COLUMN `teamId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `execution_milestones` MODIFY COLUMN `teamId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `annual_investments` ADD CONSTRAINT `annual_investment_team_unique` UNIQUE(`useCaseId`,`teamId`,`planningYear`);--> statement-breakpoint
CREATE INDEX `investments_team_idx` ON `annual_investments` (`teamId`);--> statement-breakpoint
CREATE INDEX `milestones_team_idx` ON `execution_milestones` (`teamId`);
