ALTER TABLE `annual_investments` ADD `budgetType` enum('internal','external') NOT NULL DEFAULT 'internal';
--> statement-breakpoint
ALTER TABLE `annual_investments` DROP INDEX `annual_investment_unique`, ADD CONSTRAINT `annual_investment_budget_type_unique` UNIQUE(`useCaseId`,`planningYear`,`budgetType`), ADD INDEX `investments_budget_type_idx` (`budgetType`);
