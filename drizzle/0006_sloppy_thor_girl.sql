UPDATE `annual_investments` SET `amountUsdM` = 0;--> statement-breakpoint
ALTER TABLE `annual_investments` RENAME COLUMN `amountUsdM` TO `amountSarM`;
