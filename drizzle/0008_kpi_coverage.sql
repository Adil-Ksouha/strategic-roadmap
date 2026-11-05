CREATE TABLE `kpi_definitions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `code` varchar(32) NOT NULL,
  `name` varchar(240) NOT NULL,
  `strategicPillar` varchar(140) NOT NULL,
  `theme` varchar(160) NOT NULL,
  `unit` varchar(40) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `kpi_definitions_id` PRIMARY KEY(`id`),
  CONSTRAINT `kpi_code_name_unique` UNIQUE(`code`,`name`),
  KEY `kpi_pillar_idx` (`strategicPillar`),
  KEY `kpi_theme_idx` (`theme`)
);
--> statement-breakpoint
CREATE TABLE `capability_kpis` (
  `id` int AUTO_INCREMENT NOT NULL,
  `capabilityId` int NOT NULL,
  `kpiId` int NOT NULL,
  CONSTRAINT `capability_kpis_id` PRIMARY KEY(`id`),
  CONSTRAINT `capability_kpi_unique` UNIQUE(`capabilityId`,`kpiId`),
  KEY `capability_kpi_capability_idx` (`capabilityId`),
  KEY `capability_kpi_kpi_idx` (`kpiId`)
);
