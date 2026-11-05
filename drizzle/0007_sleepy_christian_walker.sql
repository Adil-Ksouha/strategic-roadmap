CREATE TABLE `financial_planning_years` (
  `planningYear` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `financial_planning_years_planningYear` PRIMARY KEY(`planningYear`)
);
--> statement-breakpoint
INSERT IGNORE INTO `financial_planning_years` (`planningYear`) VALUES (2026), (2027), (2028), (2029), (2030);
--> statement-breakpoint
ALTER TABLE `execution_milestones` ADD `sourceCapabilityId` int;
--> statement-breakpoint
ALTER TABLE `execution_milestones` ADD CONSTRAINT `milestone_capability_link_unique` UNIQUE(`useCaseId`,`sourceCapabilityId`);
