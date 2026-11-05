import {
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

/** Core user table backing the existing OAuth flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  isActive: mysqlEnum("isActive", ["active", "disabled"])
    .notNull()
    .default("active"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const portfolioTeams = mysqlTable("portfolio_teams", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description").notNull(),
  accent: varchar("accent", { length: 24 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const teamMemberships = mysqlTable(
  "team_memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    teamId: int("teamId").notNull(),
    role: mysqlEnum("role", ["lead", "contributor"])
      .notNull()
      .default("contributor"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    unique("team_membership_unique").on(table.userId, table.teamId),
    index("team_membership_user_idx").on(table.userId),
    index("team_membership_team_idx").on(table.teamId),
  ]
);

export const teamAccessGrants = mysqlTable(
  "team_access_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    teamId: int("teamId").notNull(),
    role: mysqlEnum("role", ["lead", "contributor"])
      .notNull()
      .default("contributor"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("team_access_grant_team_idx").on(table.teamId)]
);

export const capabilities = mysqlTable(
  "capabilities",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    domain: varchar("domain", { length: 80 }).notNull(),
    description: text("description").notNull(),
    owner: varchar("owner", { length: 120 }).notNull(),
    maturity: mysqlEnum("maturity", ["emerging", "evolving", "established"])
      .notNull()
      .default("emerging"),
    criticality: mysqlEnum("criticality", ["critical", "high", "medium", "low"])
      .notNull()
      .default("medium"),
    targetYear: int("targetYear").notNull(),
    teamId: int("teamId").notNull().default(1),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("capabilities_domain_idx").on(table.domain)]
);

export const useCases = mysqlTable(
  "use_cases",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    theme: varchar("theme", { length: 100 }).notNull(),
    description: text("description").notNull(),
    outcome: text("outcome").notNull(),
    sponsor: varchar("sponsor", { length: 120 }).notNull(),
    status: mysqlEnum("status", [
      "prioritized",
      "in_flight",
      "planned",
      "watchlist",
    ])
      .notNull()
      .default("planned"),
    priority: mysqlEnum("priority", ["p1", "p2", "p3"]).notNull().default("p2"),
    startYear: int("startYear").notNull(),
    endYear: int("endYear").notNull(),
    teamId: int("teamId"),
    scope: mysqlEnum("scope", ["team", "shared"]).notNull().default("team"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("use_cases_theme_idx").on(table.theme),
    index("use_cases_scope_idx").on(table.scope),
  ]
);

export const useCaseCapabilities = mysqlTable(
  "use_case_capabilities",
  {
    id: int("id").autoincrement().primaryKey(),
    useCaseId: int("useCaseId").notNull(),
    capabilityId: int("capabilityId").notNull(),
    contribution: mysqlEnum("contribution", [
      "anchor",
      "enabling",
      "supporting",
    ])
      .notNull()
      .default("supporting"),
  },
  table => [
    unique("use_case_capability_unique").on(
      table.useCaseId,
      table.capabilityId
    ),
    index("ucc_use_case_idx").on(table.useCaseId),
    index("ucc_capability_idx").on(table.capabilityId),
  ]
);

export const kpiDefinitions = mysqlTable(
  "kpi_definitions",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    name: varchar("name", { length: 240 }).notNull(),
    strategicPillar: varchar("strategicPillar", { length: 140 }).notNull(),
    theme: varchar("theme", { length: 160 }).notNull(),
    unit: varchar("unit", { length: 40 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    unique("kpi_code_name_unique").on(table.code, table.name),
    index("kpi_pillar_idx").on(table.strategicPillar),
    index("kpi_theme_idx").on(table.theme),
  ]
);

export const capabilityKpis = mysqlTable(
  "capability_kpis",
  {
    id: int("id").autoincrement().primaryKey(),
    capabilityId: int("capabilityId").notNull(),
    kpiId: int("kpiId").notNull(),
  },
  table => [
    unique("capability_kpi_unique").on(table.capabilityId, table.kpiId),
    index("capability_kpi_capability_idx").on(table.capabilityId),
    index("capability_kpi_kpi_idx").on(table.kpiId),
  ]
);

export const planningItems = mysqlTable(
  "planning_items",
  {
    id: int("id").autoincrement().primaryKey(),
    type: mysqlEnum("type", [
      "feature_enhancement",
      "eos",
      "capacity_forecast",
    ]).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    owner: varchar("owner", { length: 120 }).notNull(),
    status: mysqlEnum("status", [
      "assess",
      "planned",
      "in_progress",
      "monitoring",
    ])
      .notNull()
      .default("assess"),
    impact: mysqlEnum("impact", ["critical", "high", "medium", "low"])
      .notNull()
      .default("medium"),
    targetYear: int("targetYear").notNull(),
    relatedCapabilityId: int("relatedCapabilityId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("planning_items_type_idx").on(table.type),
    index("planning_items_year_idx").on(table.targetYear),
  ]
);

export const executionMilestones = mysqlTable(
  "execution_milestones",
  {
    id: int("id").autoincrement().primaryKey(),
    useCaseId: int("useCaseId").notNull(),
    sourceCapabilityId: int("sourceCapabilityId"),
    planningYear: int("planningYear").notNull(),
    phase: mysqlEnum("phase", [
      "discover",
      "foundation",
      "scale",
      "optimize",
      "run",
    ]).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    status: mysqlEnum("status", ["planned", "in_progress", "complete"])
      .notNull()
      .default("planned"),
  },
  table => [
    index("milestones_use_case_idx").on(table.useCaseId),
    index("milestones_year_idx").on(table.planningYear),
    unique("milestone_capability_link_unique").on(
      table.useCaseId,
      table.sourceCapabilityId
    ),
  ]
);

export const financialPlanningYears = mysqlTable("financial_planning_years", {
  planningYear: int("planningYear").primaryKey(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const annualInvestments = mysqlTable(
  "annual_investments",
  {
    id: int("id").autoincrement().primaryKey(),
    useCaseId: int("useCaseId").notNull(),
    planningYear: int("planningYear").notNull(),
    budgetType: mysqlEnum("budgetType", ["internal", "external"])
      .notNull()
      .default("internal"),
    amountSarM: decimal("amountSarM", { precision: 12, scale: 2 }).notNull(),
  },
  table => [
    unique("annual_investment_budget_type_unique").on(
      table.useCaseId,
      table.planningYear,
      table.budgetType
    ),
    index("investments_use_case_idx").on(table.useCaseId),
    index("investments_year_idx").on(table.planningYear),
    index("investments_budget_type_idx").on(table.budgetType),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type PortfolioTeam = typeof portfolioTeams.$inferSelect;
export type TeamMembership = typeof teamMemberships.$inferSelect;
export type TeamAccessGrant = typeof teamAccessGrants.$inferSelect;
export type Capability = typeof capabilities.$inferSelect;
export type UseCase = typeof useCases.$inferSelect;
export type PlanningItem = typeof planningItems.$inferSelect;
export type ExecutionMilestone = typeof executionMilestones.$inferSelect;
export type FinancialPlanningYear = typeof financialPlanningYears.$inferSelect;
export type AnnualInvestment = typeof annualInvestments.$inferSelect;
