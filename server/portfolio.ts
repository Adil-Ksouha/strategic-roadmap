import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  annualInvestments,
  capabilities,
  capabilityKpis,
  executionMilestones,
  financialPlanningYears,
  kpiDefinitions,
  planningItems,
  portfolioTeams,
  teamAccessGrants,
  teamMemberships,
  useCaseCapabilities,
  useCases,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import type { User } from "../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { KPI_CATALOGUE } from "./kpiCatalog";

export type CapabilityInput = {
  name: string;
  domain: string;
  description: string;
  owner: string;
  maturity: "emerging" | "evolving" | "established";
  criticality: "critical" | "high" | "medium" | "low";
  targetYear: number;
  teamId: number;
};

export type UseCaseInput = {
  name: string;
  theme: string;
  description: string;
  outcome: string;
  sponsor: string;
  status: "prioritized" | "in_flight" | "planned" | "watchlist";
  priority: "p1" | "p2" | "p3";
  startYear: number;
  endYear: number;
  teamId: number | null;
  scope: "team" | "shared";
};

export type ExecutionMilestoneInput = {
  useCaseId: number;
  planningYear: number;
  phase: "discover" | "foundation" | "scale" | "optimize" | "run";
  title: string;
  status: "planned" | "in_progress" | "complete";
};

export type PlanningItemInput = {
  type: "feature_enhancement" | "eos" | "capacity_forecast";
  title: string;
  description: string;
  owner: string;
  status: "assess" | "planned" | "in_progress" | "monitoring";
  impact: "critical" | "high" | "medium" | "low";
  targetYear: number;
  relatedCapabilityId?: number | null;
};

export type BudgetType = "internal" | "external";

export type KpiDefinitionInput = {
  code: string;
  name: string;
  strategicPillar: string;
  theme: string;
  unit: string;
};

async function requireDb() {
  const database = await getDb();
  if (!database) throw new Error("The portfolio database is unavailable.");
  return database;
}

function amount(value: unknown) {
  return Number(value ?? 0);
}

const INITIAL_FINANCIAL_PLANNING_YEARS = [2026, 2027, 2028, 2029, 2030];

const TEAM_SEED = [
  {
    slug: "core-cloud",
    name: "Core & Cloud",
    description:
      "Cloud platform, telco core, and cloud-native network foundations.",
    accent: "purple",
  },
  {
    slug: "mobile-access",
    name: "Mobile Access",
    description:
      "Mobile radio access, 5G standalone, spectrum, and mobile service evolution.",
    accent: "red",
  },
  {
    slug: "fixed-transport",
    name: "Fixed & Transport",
    description:
      "Fixed access, transport networks, edge connectivity, and end-to-end operations.",
    accent: "purple",
  },
  {
    slug: "application-architecture",
    name: "Application Architecture",
    description:
      "Digital platforms, integration, operational applications, and solution architecture.",
    accent: "purple",
  },
  {
    slug: "data-architecture",
    name: "Data Architecture",
    description:
      "Data products, intelligence, governance, analytics, and AI foundations.",
    accent: "red",
  },
] as const;

let teamBootstrap: Promise<
  Awaited<ReturnType<typeof seedPortfolioTeams>>
> | null = null;
let kpiBootstrap: Promise<void> | null = null;

export async function ensurePortfolioTeams() {
  if (!teamBootstrap) teamBootstrap = seedPortfolioTeams();
  return teamBootstrap;
}

export async function ensureKpiCatalogue() {
  if (!kpiBootstrap) kpiBootstrap = seedKpiCatalogue();
  return kpiBootstrap;
}

async function seedKpiCatalogue() {
  const database = await requireDb();
  await Promise.all(
    KPI_CATALOGUE.map(kpi =>
      database
        .insert(kpiDefinitions)
        .values(kpi)
        .onDuplicateKeyUpdate({
          set: {
            code: kpi.code,
          },
        })
    )
  );
}

export async function ensureFinancialPlanningYears() {
  const database = await requireDb();
  await Promise.all(
    INITIAL_FINANCIAL_PLANNING_YEARS.map(planningYear =>
      database
        .insert(financialPlanningYears)
        .values({ planningYear })
        .onDuplicateKeyUpdate({ set: { planningYear } })
    )
  );
}

async function ensureRoadmapPlanningYears(...scheduledYears: number[]) {
  const requestedYears = scheduledYears.filter(Number.isInteger);
  if (!requestedYears.length) return;

  const database = await requireDb();
  const existingYears = await database
    .select({ planningYear: financialPlanningYears.planningYear })
    .from(financialPlanningYears);
  const firstYear = Math.min(
    ...INITIAL_FINANCIAL_PLANNING_YEARS,
    ...existingYears.map(item => item.planningYear),
    ...requestedYears
  );
  const finalYear = Math.max(
    ...INITIAL_FINANCIAL_PLANNING_YEARS,
    ...existingYears.map(item => item.planningYear),
    ...requestedYears
  );

  await Promise.all(
    Array.from(
      { length: finalYear - firstYear + 1 },
      (_, offset) => firstYear + offset
    ).map(planningYear =>
      database
        .insert(financialPlanningYears)
        .values({ planningYear })
        .onDuplicateKeyUpdate({ set: { planningYear } })
    )
  );
}

async function ensureRoadmapYearsFromExistingSchedules() {
  const database = await requireDb();
  const [capabilityRows, objectiveRows, milestoneRows] = await Promise.all([
    database.select({ targetYear: capabilities.targetYear }).from(capabilities),
    database
      .select({ startYear: useCases.startYear, endYear: useCases.endYear })
      .from(useCases),
    database
      .select({ planningYear: executionMilestones.planningYear })
      .from(executionMilestones),
  ]);
  await ensureRoadmapPlanningYears(
    ...capabilityRows.map(item => item.targetYear),
    ...objectiveRows.flatMap(item => [item.startYear, item.endYear]),
    ...milestoneRows.map(item => item.planningYear)
  );
}

async function seedPortfolioTeams() {
  const database = await requireDb();
  await Promise.all(
    TEAM_SEED.map(team =>
      database
        .insert(portfolioTeams)
        .values(team)
        .onDuplicateKeyUpdate({
          set: {
            name: team.name,
            description: team.description,
            accent: team.accent,
          },
        })
    )
  );
  const teams = await database.select().from(portfolioTeams);
  const teamId = (slug: string) => teams.find(team => team.slug === slug)?.id;
  const capabilityAssignments = [
    ["Core & Telco Cloud", "core-cloud"],
    ["Network Orchestration & Automation", "fixed-transport"],
    ["AIOps & Self-Healing", "application-architecture"],
    ["5G Standalone & Slicing", "mobile-access"],
    ["Edge Cloud Foundation", "fixed-transport"],
    ["Data & Decision Intelligence", "data-architecture"],
  ] as const;
  await Promise.all(
    capabilityAssignments.map(([name, slug]) => {
      const id = teamId(slug);
      return id
        ? database
            .update(capabilities)
            .set({ teamId: id })
            .where(eq(capabilities.name, name))
        : Promise.resolve();
    })
  );
  const useCaseAssignments = [
    ["5G Leadership", "mobile-access"],
    ["Autonomous Network Operations", "fixed-transport"],
    ["Cloud Native Network Modernization", "core-cloud"],
    ["Enterprise Edge Services", "fixed-transport"],
    ["Proactive Capacity Optimization", "data-architecture"],
  ] as const;
  await Promise.all(
    useCaseAssignments.map(([name, slug]) => {
      const id = teamId(slug);
      return id
        ? database
            .update(useCases)
            .set({ teamId: id })
            .where(eq(useCases.name, name))
        : Promise.resolve();
    })
  );
  return teams;
}

function isExecutive(user: User) {
  return user.role === "admin";
}
async function membershipsFor(userId: number) {
  const database = await requireDb();
  return database
    .select()
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));
}
export async function getPortfolioAccess(user: User) {
  const teams = await ensurePortfolioTeams();
  return {
    isExecutive: isExecutive(user),
    teams,
    memberships: await membershipsFor(user.id),
  };
}
export async function requireExecutive(user: User) {
  if (!isExecutive(user))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Executive administrator access is required.",
    });
}
export async function requireTeamEditor(user: User, teamId: number) {
  if (isExecutive(user)) return;
  const memberships = await membershipsFor(user.id);
  if (!memberships.some(item => item.teamId === teamId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only change records owned by your assigned team.",
    });
}
async function ownerTeam(
  table: typeof capabilities | typeof useCases,
  recordId: number
) {
  const database = await requireDb();
  return (
    await database
      .select({ teamId: table.teamId })
      .from(table)
      .where(eq(table.id, recordId))
      .limit(1)
  )[0]?.teamId;
}
export async function requireCapabilityEditor(
  user: User,
  capabilityId: number
) {
  const teamId = await ownerTeam(capabilities, capabilityId);
  if (!teamId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Capability not found.",
    });
  await requireTeamEditor(user, teamId);
}
export async function requireUseCaseEditor(user: User, useCaseId: number) {
  const database = await requireDb();
  const record = (
    await database
      .select({ teamId: useCases.teamId, scope: useCases.scope })
      .from(useCases)
      .where(eq(useCases.id, useCaseId))
      .limit(1)
  )[0];
  if (!record)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Strategic Objective not found.",
    });
  if (record.scope === "shared") return requireExecutive(user);
  if (!record.teamId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A team-owned Strategic Objective must have an owning team.",
    });
  return requireTeamEditor(user, record.teamId);
}
export async function requireMilestoneEditor(user: User, milestoneId: number) {
  const database = await requireDb();
  const milestone = (
    await database
      .select({ useCaseId: executionMilestones.useCaseId })
      .from(executionMilestones)
      .where(eq(executionMilestones.id, milestoneId))
      .limit(1)
  )[0];
  if (!milestone)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Execution milestone not found.",
    });
  await requireUseCaseEditor(user, milestone.useCaseId);
}

export async function ensureInitialPortfolioData() {
  const database = await requireDb();
  const [existingCapabilities, existingUseCases] = await Promise.all([
    database.select({ count: sql<number>`count(*)` }).from(capabilities),
    database.select({ count: sql<number>`count(*)` }).from(useCases),
  ]);
  if (
    Number(existingCapabilities[0]?.count ?? 0) > 0 ||
    Number(existingUseCases[0]?.count ?? 0) > 0
  ) {
    await Promise.all([
      ensurePortfolioTeams(),
      ensureKpiCatalogue(),
      ensureFinancialPlanningYears(),
      ensureRoadmapYearsFromExistingSchedules(),
    ]);
    return;
  }

  await database.insert(capabilities).values([
    {
      name: "Core & Telco Cloud",
      domain: "Cloud foundation",
      description:
        "Cloud-native platform for converged core workloads, network functions, and lifecycle operations.",
      owner: "Cloud Platform",
      maturity: "evolving",
      criticality: "critical",
      targetYear: 2028,
    },
    {
      name: "Network Orchestration & Automation",
      domain: "Operations",
      description:
        "Intent-led service orchestration with closed-loop workflow automation across domains.",
      owner: "Network Automation",
      maturity: "evolving",
      criticality: "critical",
      targetYear: 2029,
    },
    {
      name: "AIOps & Self-Healing",
      domain: "Operations",
      description:
        "Predictive observability, anomaly correlation, and automated remediation for service assurance.",
      owner: "Service Assurance",
      maturity: "emerging",
      criticality: "high",
      targetYear: 2030,
    },
    {
      name: "5G Standalone & Slicing",
      domain: "Network innovation",
      description:
        "Service-based 5G core, differentiated slices, and programmable exposure for enterprise services.",
      owner: "Mobile Core",
      maturity: "evolving",
      criticality: "critical",
      targetYear: 2028,
    },
    {
      name: "Edge Cloud Foundation",
      domain: "Cloud foundation",
      description:
        "Distributed edge compute, workload placement, and resilient connectivity at strategic locations.",
      owner: "Edge Engineering",
      maturity: "emerging",
      criticality: "high",
      targetYear: 2029,
    },
    {
      name: "Data & Decision Intelligence",
      domain: "Data & AI",
      description:
        "Trusted telemetry, analytics products, and decision intelligence for portfolio and network outcomes.",
      owner: "Data Office",
      maturity: "evolving",
      criticality: "high",
      targetYear: 2028,
    },
  ]);

  await database.insert(useCases).values([
    {
      name: "5G Leadership",
      theme: "Growth",
      description:
        "Launch differentiated 5G standalone services and enterprise network slicing.",
      outcome: "Accelerate premium 5G adoption and enterprise service revenue.",
      sponsor: "Chief Commercial Officer",
      status: "prioritized",
      priority: "p1",
      startYear: 2026,
      endYear: 2029,
    },
    {
      name: "Autonomous Network Operations",
      theme: "Resilience",
      description:
        "Evolve to intent-driven operations with automated remediation and assurance.",
      outcome:
        "Improve service reliability while reducing manual operations effort.",
      sponsor: "Chief Network Officer",
      status: "in_flight",
      priority: "p1",
      startYear: 2026,
      endYear: 2030,
    },
    {
      name: "Cloud Native Network Modernization",
      theme: "Modernization",
      description:
        "Migrate strategic network functions to a repeatable cloud-native operating model.",
      outcome:
        "Increase delivery velocity and lower technology lifecycle risk.",
      sponsor: "Chief Technology Officer",
      status: "in_flight",
      priority: "p1",
      startYear: 2026,
      endYear: 2029,
    },
    {
      name: "Enterprise Edge Services",
      theme: "Growth",
      description:
        "Create scalable edge propositions for industrial, public sector, and campus customers.",
      outcome:
        "Develop an addressable edge services portfolio with dependable delivery.",
      sponsor: "Enterprise Business",
      status: "planned",
      priority: "p2",
      startYear: 2027,
      endYear: 2030,
    },
    {
      name: "Proactive Capacity Optimization",
      theme: "Efficiency",
      description:
        "Use demand forecasts and engineering constraints to steer network and cloud investments.",
      outcome:
        "Protect customer experience while improving capital allocation quality.",
      sponsor: "Network Strategy",
      status: "planned",
      priority: "p2",
      startYear: 2026,
      endYear: 2028,
    },
  ]);

  const capabilityRows = await database.select().from(capabilities);
  const useCaseRows = await database.select().from(useCases);
  const capabilityId = (name: string) => {
    const id = capabilityRows.find(item => item.name === name)?.id;
    if (!id) throw new Error(`Missing capability: ${name}`);
    return id;
  };
  const useCaseId = (name: string) => {
    const id = useCaseRows.find(item => item.name === name)?.id;
    if (!id) throw new Error(`Missing use case: ${name}`);
    return id;
  };

  const coreCloud = capabilityId("Core & Telco Cloud");
  const orchestration = capabilityId("Network Orchestration & Automation");
  const selfHealing = capabilityId("AIOps & Self-Healing");
  const fiveG = capabilityId("5G Standalone & Slicing");
  const edge = capabilityId("Edge Cloud Foundation");
  const data = capabilityId("Data & Decision Intelligence");

  const leadership = useCaseId("5G Leadership");
  const autonomous = useCaseId("Autonomous Network Operations");
  const modernization = useCaseId("Cloud Native Network Modernization");
  const enterpriseEdge = useCaseId("Enterprise Edge Services");
  const capacity = useCaseId("Proactive Capacity Optimization");

  await database.insert(useCaseCapabilities).values([
    { useCaseId: leadership, capabilityId: coreCloud, contribution: "anchor" },
    { useCaseId: leadership, capabilityId: fiveG, contribution: "anchor" },
    { useCaseId: leadership, capabilityId: edge, contribution: "supporting" },
    {
      useCaseId: autonomous,
      capabilityId: orchestration,
      contribution: "anchor",
    },
    {
      useCaseId: autonomous,
      capabilityId: selfHealing,
      contribution: "anchor",
    },
    { useCaseId: autonomous, capabilityId: data, contribution: "enabling" },
    {
      useCaseId: modernization,
      capabilityId: coreCloud,
      contribution: "anchor",
    },
    { useCaseId: modernization, capabilityId: edge, contribution: "enabling" },
    {
      useCaseId: modernization,
      capabilityId: orchestration,
      contribution: "supporting",
    },
    { useCaseId: enterpriseEdge, capabilityId: edge, contribution: "anchor" },
    {
      useCaseId: enterpriseEdge,
      capabilityId: coreCloud,
      contribution: "enabling",
    },
    {
      useCaseId: enterpriseEdge,
      capabilityId: fiveG,
      contribution: "supporting",
    },
    { useCaseId: capacity, capabilityId: data, contribution: "anchor" },
    {
      useCaseId: capacity,
      capabilityId: selfHealing,
      contribution: "enabling",
    },
    {
      useCaseId: capacity,
      capabilityId: orchestration,
      contribution: "supporting",
    },
  ]);

  await database.insert(planningItems).values([
    {
      type: "feature_enhancement",
      title: "Network slice exposure API",
      description:
        "Productize standards-based API exposure for enterprise slice ordering and assurance.",
      owner: "Digital Products",
      status: "planned",
      impact: "high",
      targetYear: 2027,
      relatedCapabilityId: fiveG,
    },
    {
      type: "feature_enhancement",
      title: "Intent catalog expansion",
      description:
        "Add service-assurance and provisioning intents for cross-domain automation journeys.",
      owner: "Network Automation",
      status: "in_progress",
      impact: "high",
      targetYear: 2026,
      relatedCapabilityId: orchestration,
    },
    {
      type: "eos",
      title: "Legacy packet core EoS",
      description:
        "Retire the hardware-centric packet core estate before vendor support expiry.",
      owner: "Mobile Core",
      status: "in_progress",
      impact: "critical",
      targetYear: 2027,
      relatedCapabilityId: coreCloud,
    },
    {
      type: "eos",
      title: "Service assurance platform EoS",
      description:
        "Replace unsupported alarm correlation tooling with the target observability stack.",
      owner: "Service Assurance",
      status: "assess",
      impact: "high",
      targetYear: 2028,
      relatedCapabilityId: selfHealing,
    },
    {
      type: "capacity_forecast",
      title: "5G core throughput outlook",
      description:
        "Forecast data-plane throughput and cloud footprint for urban 5G growth scenarios.",
      owner: "Network Strategy",
      status: "monitoring",
      impact: "high",
      targetYear: 2027,
      relatedCapabilityId: fiveG,
    },
    {
      type: "capacity_forecast",
      title: "Edge location demand plan",
      description:
        "Prioritize edge locations using enterprise demand signals and latency requirements.",
      owner: "Edge Engineering",
      status: "assess",
      impact: "medium",
      targetYear: 2028,
      relatedCapabilityId: edge,
    },
  ]);

  await database.insert(executionMilestones).values([
    {
      useCaseId: leadership,
      planningYear: 2026,
      phase: "discover",
      title: "Segment and offer blueprint",
      status: "in_progress",
    },
    {
      useCaseId: leadership,
      planningYear: 2027,
      phase: "foundation",
      title: "5G SA and slice foundation",
      status: "planned",
    },
    {
      useCaseId: leadership,
      planningYear: 2028,
      phase: "scale",
      title: "Priority market rollout",
      status: "planned",
    },
    {
      useCaseId: leadership,
      planningYear: 2029,
      phase: "optimize",
      title: "Enterprise offer expansion",
      status: "planned",
    },
    {
      useCaseId: autonomous,
      planningYear: 2026,
      phase: "foundation",
      title: "Observability data foundation",
      status: "in_progress",
    },
    {
      useCaseId: autonomous,
      planningYear: 2027,
      phase: "scale",
      title: "Closed-loop remediation pilots",
      status: "planned",
    },
    {
      useCaseId: autonomous,
      planningYear: 2028,
      phase: "scale",
      title: "Cross-domain automation",
      status: "planned",
    },
    {
      useCaseId: autonomous,
      planningYear: 2030,
      phase: "run",
      title: "Autonomous operations at scale",
      status: "planned",
    },
    {
      useCaseId: modernization,
      planningYear: 2026,
      phase: "discover",
      title: "Application rationalization",
      status: "complete",
    },
    {
      useCaseId: modernization,
      planningYear: 2027,
      phase: "foundation",
      title: "Target platform landing zone",
      status: "in_progress",
    },
    {
      useCaseId: modernization,
      planningYear: 2028,
      phase: "scale",
      title: "Network function migration wave",
      status: "planned",
    },
    {
      useCaseId: modernization,
      planningYear: 2029,
      phase: "optimize",
      title: "Legacy retirement completion",
      status: "planned",
    },
    {
      useCaseId: enterpriseEdge,
      planningYear: 2027,
      phase: "discover",
      title: "Lighthouse customer design",
      status: "planned",
    },
    {
      useCaseId: enterpriseEdge,
      planningYear: 2028,
      phase: "foundation",
      title: "Edge platform enablement",
      status: "planned",
    },
    {
      useCaseId: enterpriseEdge,
      planningYear: 2029,
      phase: "scale",
      title: "Regional service launch",
      status: "planned",
    },
    {
      useCaseId: enterpriseEdge,
      planningYear: 2030,
      phase: "run",
      title: "Portfolio scale-up",
      status: "planned",
    },
    {
      useCaseId: capacity,
      planningYear: 2026,
      phase: "discover",
      title: "Demand signal integration",
      status: "in_progress",
    },
    {
      useCaseId: capacity,
      planningYear: 2027,
      phase: "foundation",
      title: "Planning cockpit pilot",
      status: "planned",
    },
    {
      useCaseId: capacity,
      planningYear: 2028,
      phase: "scale",
      title: "Investment governance rollout",
      status: "planned",
    },
  ]);

  const investmentRows = [
    [leadership, 0, 0, 0, 0, 0],
    [autonomous, 0, 0, 0, 0, 0],
    [modernization, 0, 0, 0, 0, 0],
    [enterpriseEdge, 0, 0, 0, 0, 0],
    [capacity, 0, 0, 0, 0, 0],
  ].flatMap(([useCase, ...amounts]) =>
    amounts.map((investment, offset) => ({
      useCaseId: Number(useCase),
      planningYear: 2026 + offset,
      amountSarM: String(investment),
    }))
  );
  await database.insert(annualInvestments).values(investmentRows);
  await Promise.all([
    ensurePortfolioTeams(),
    ensureKpiCatalogue(),
    ensureFinancialPlanningYears(),
    ensureRoadmapYearsFromExistingSchedules(),
  ]);
}

export async function getPortfolioSnapshot() {
  await ensureInitialPortfolioData();
  await ensureKpiCatalogue();
  const database = await requireDb();
  const [
    capabilityRows,
    useCaseRows,
    itemRows,
    relationshipRows,
    milestoneRows,
    investmentRows,
    teams,
    financialYearRows,
    kpiRows,
    capabilityKpiRows,
  ] = await Promise.all([
    database
      .select()
      .from(capabilities)
      .orderBy(asc(capabilities.domain), asc(capabilities.name)),
    database
      .select()
      .from(useCases)
      .orderBy(asc(useCases.startYear), asc(useCases.name)),
    database
      .select()
      .from(planningItems)
      .orderBy(asc(planningItems.targetYear), asc(planningItems.title)),
    database.select().from(useCaseCapabilities),
    database
      .select()
      .from(executionMilestones)
      .orderBy(asc(executionMilestones.planningYear)),
    database
      .select()
      .from(annualInvestments)
      .orderBy(asc(annualInvestments.planningYear)),
    database.select().from(portfolioTeams).orderBy(asc(portfolioTeams.name)),
    database
      .select()
      .from(financialPlanningYears)
      .orderBy(asc(financialPlanningYears.planningYear)),
    database
      .select()
      .from(kpiDefinitions)
      .orderBy(
        asc(kpiDefinitions.strategicPillar),
        asc(kpiDefinitions.theme),
        asc(kpiDefinitions.code)
      ),
    database.select().from(capabilityKpis),
  ]);
  return {
    capabilities: capabilityRows,
    useCases: useCaseRows,
    planningItems: itemRows,
    relationships: relationshipRows,
    milestones: milestoneRows,
    investments: investmentRows.map(item => ({
      ...item,
      amountSarM: amount(item.amountSarM),
    })),
    teams,
    financialYears: financialYearRows.map(item => item.planningYear),
    kpis: kpiRows,
    capabilityKpis: capabilityKpiRows,
  };
}

export async function createCapability(input: CapabilityInput) {
  const database = await requireDb();
  const result = await database.insert(capabilities).values(input);
  await ensureRoadmapPlanningYears(input.targetYear);
  return result;
}

export async function createUseCase(input: UseCaseInput) {
  const database = await requireDb();
  const result = await database.insert(useCases).values(input);
  await ensureRoadmapPlanningYears(input.startYear, input.endYear);
  return result;
}

export async function createExecutionMilestone(input: ExecutionMilestoneInput) {
  const database = await requireDb();
  const result = await database.insert(executionMilestones).values(input);
  await ensureRoadmapPlanningYears(input.planningYear);
  return result;
}

export async function createPlanningItem(input: PlanningItemInput) {
  const database = await requireDb();
  return database.insert(planningItems).values({
    ...input,
    relatedCapabilityId: input.relatedCapabilityId ?? null,
  });
}

export async function linkCapabilityToUseCase(input: {
  useCaseId: number;
  capabilityId: number;
  contribution: "anchor" | "enabling" | "supporting";
}) {
  const database = await requireDb();
  const relationship = await database
    .insert(useCaseCapabilities)
    .values(input)
    .onDuplicateKeyUpdate({ set: { contribution: input.contribution } });
  await ensureCapabilityEnablementMilestone(
    input.useCaseId,
    input.capabilityId
  );
  return relationship;
}

export function buildCapabilityEnablementMilestone(input: {
  useCaseId: number;
  capabilityId: number;
  capabilityName: string;
  objectiveStartYear: number;
  objectiveEndYear: number;
  capabilityTargetYear: number;
}) {
  return {
    useCaseId: input.useCaseId,
    sourceCapabilityId: input.capabilityId,
    planningYear: Math.max(
      input.objectiveStartYear,
      input.capabilityTargetYear
    ),
    phase: "foundation" as const,
    title: `${input.capabilityName} enablement`,
    status: "planned" as const,
  };
}

async function ensureCapabilityEnablementMilestone(
  useCaseId: number,
  capabilityId: number
) {
  const database = await requireDb();
  const [objectiveRows, capabilityRows] = await Promise.all([
    database
      .select({ startYear: useCases.startYear, endYear: useCases.endYear })
      .from(useCases)
      .where(eq(useCases.id, useCaseId))
      .limit(1),
    database
      .select({ name: capabilities.name, targetYear: capabilities.targetYear })
      .from(capabilities)
      .where(eq(capabilities.id, capabilityId))
      .limit(1),
  ]);
  const objective = objectiveRows[0];
  const capability = capabilityRows[0];
  if (!objective || !capability) return;
  const milestone = buildCapabilityEnablementMilestone({
    useCaseId,
    capabilityId,
    capabilityName: capability.name,
    objectiveStartYear: objective.startYear,
    objectiveEndYear: objective.endYear,
    capabilityTargetYear: capability.targetYear,
  });
  await database
    .insert(executionMilestones)
    .values(milestone)
    .onDuplicateKeyUpdate({
      set: {
        planningYear: milestone.planningYear,
        title: milestone.title,
      },
    });
  await ensureRoadmapPlanningYears(milestone.planningYear);
}

async function syncCapabilityEnablementMilestones(capabilityId: number) {
  const database = await requireDb();
  const relationships = await database
    .select({ useCaseId: useCaseCapabilities.useCaseId })
    .from(useCaseCapabilities)
    .where(eq(useCaseCapabilities.capabilityId, capabilityId));
  await Promise.all(
    relationships.map(relationship =>
      ensureCapabilityEnablementMilestone(relationship.useCaseId, capabilityId)
    )
  );
}

async function syncUseCaseEnablementMilestones(useCaseId: number) {
  const database = await requireDb();
  const relationships = await database
    .select({ capabilityId: useCaseCapabilities.capabilityId })
    .from(useCaseCapabilities)
    .where(eq(useCaseCapabilities.useCaseId, useCaseId));
  await Promise.all(
    relationships.map(relationship =>
      ensureCapabilityEnablementMilestone(useCaseId, relationship.capabilityId)
    )
  );
}

export async function bulkLinkCapabilitiesToUseCase(input: {
  useCaseId: number;
  capabilityIds: number[];
  contribution: "anchor" | "enabling" | "supporting";
}) {
  const capabilityIds = Array.from(new Set(input.capabilityIds));
  await Promise.all(
    capabilityIds.map(capabilityId =>
      linkCapabilityToUseCase({
        useCaseId: input.useCaseId,
        capabilityId,
        contribution: input.contribution,
      })
    )
  );
  return { linkedCount: capabilityIds.length };
}

export async function setCapabilityKpis(input: {
  capabilityId: number;
  kpiIds: number[];
}) {
  const database = await requireDb();
  const kpiIds = Array.from(new Set(input.kpiIds));
  if (kpiIds.length) {
    const availableKpis = await database
      .select({ id: kpiDefinitions.id })
      .from(kpiDefinitions)
      .where(inArray(kpiDefinitions.id, kpiIds));
    if (availableKpis.length !== kpiIds.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "One or more selected KPIs do not exist in the KPI catalogue.",
      });
  }
  await database
    .delete(capabilityKpis)
    .where(eq(capabilityKpis.capabilityId, input.capabilityId));
  if (kpiIds.length)
    await database
      .insert(capabilityKpis)
      .values(
        kpiIds.map(kpiId => ({ capabilityId: input.capabilityId, kpiId }))
      );
  return { mappedCount: kpiIds.length };
}

export async function createKpiDefinition(input: KpiDefinitionInput) {
  const database = await requireDb();
  const result = await database.insert(kpiDefinitions).values(input);
  return { id: Number(result[0].insertId) };
}

export async function updateKpiDefinition(
  id: number,
  input: KpiDefinitionInput
) {
  const database = await requireDb();
  await database
    .update(kpiDefinitions)
    .set(input)
    .where(eq(kpiDefinitions.id, id));
}

export async function deleteKpiDefinition(id: number) {
  const database = await requireDb();
  await database.delete(capabilityKpis).where(eq(capabilityKpis.kpiId, id));
  await database.delete(kpiDefinitions).where(eq(kpiDefinitions.id, id));
}

export async function unlinkCapabilityFromUseCase(input: {
  useCaseId: number;
  capabilityId: number;
}) {
  const database = await requireDb();
  await database
    .delete(executionMilestones)
    .where(
      and(
        eq(executionMilestones.useCaseId, input.useCaseId),
        eq(executionMilestones.sourceCapabilityId, input.capabilityId)
      )
    );
  return database
    .delete(useCaseCapabilities)
    .where(
      and(
        eq(useCaseCapabilities.useCaseId, input.useCaseId),
        eq(useCaseCapabilities.capabilityId, input.capabilityId)
      )
    );
}

export async function upsertInvestment(input: {
  useCaseId: number;
  planningYear: number;
  budgetType: BudgetType;
  amountSarM: number;
}) {
  const database = await requireDb();
  await database
    .insert(financialPlanningYears)
    .values({ planningYear: input.planningYear })
    .onDuplicateKeyUpdate({ set: { planningYear: input.planningYear } });
  return database
    .insert(annualInvestments)
    .values({ ...input, amountSarM: String(input.amountSarM) })
    .onDuplicateKeyUpdate({
      set: { amountSarM: String(input.amountSarM) },
    });
}

export async function addFinancialPlanningYear(planningYear: number) {
  const database = await requireDb();
  return database
    .insert(financialPlanningYears)
    .values({ planningYear })
    .onDuplicateKeyUpdate({ set: { planningYear } });
}

export async function updatePlanningItemStatus(input: {
  id: number;
  status: PlanningItemInput["status"];
}) {
  const database = await requireDb();
  return database
    .update(planningItems)
    .set({ status: input.status })
    .where(eq(planningItems.id, input.id));
}

export async function updateCapability(id: number, input: CapabilityInput) {
  const database = await requireDb();
  const result = await database
    .update(capabilities)
    .set(input)
    .where(eq(capabilities.id, id));
  await syncCapabilityEnablementMilestones(id);
  await ensureRoadmapPlanningYears(input.targetYear);
  return result;
}

export async function updateUseCase(id: number, input: UseCaseInput) {
  const database = await requireDb();
  const result = await database
    .update(useCases)
    .set(input)
    .where(eq(useCases.id, id));
  await syncUseCaseEnablementMilestones(id);
  await ensureRoadmapPlanningYears(input.startYear, input.endYear);
  return result;
}

export async function updateExecutionMilestone(
  id: number,
  input: ExecutionMilestoneInput
) {
  const database = await requireDb();
  const result = await database
    .update(executionMilestones)
    .set(input)
    .where(eq(executionMilestones.id, id));
  await ensureRoadmapPlanningYears(input.planningYear);
  return result;
}

export async function updatePlanningItem(id: number, input: PlanningItemInput) {
  const database = await requireDb();
  return database
    .update(planningItems)
    .set({ ...input, relatedCapabilityId: input.relatedCapabilityId ?? null })
    .where(eq(planningItems.id, id));
}

export async function deleteCapability(id: number) {
  const database = await requireDb();
  await database
    .delete(capabilityKpis)
    .where(eq(capabilityKpis.capabilityId, id));
  await database
    .delete(executionMilestones)
    .where(eq(executionMilestones.sourceCapabilityId, id));
  await database
    .delete(useCaseCapabilities)
    .where(eq(useCaseCapabilities.capabilityId, id));
  await database
    .update(planningItems)
    .set({ relatedCapabilityId: null })
    .where(eq(planningItems.relatedCapabilityId, id));
  return database.delete(capabilities).where(eq(capabilities.id, id));
}

export async function deleteUseCase(id: number) {
  const database = await requireDb();
  await database
    .delete(useCaseCapabilities)
    .where(eq(useCaseCapabilities.useCaseId, id));
  await database
    .delete(executionMilestones)
    .where(eq(executionMilestones.useCaseId, id));
  await database
    .delete(annualInvestments)
    .where(eq(annualInvestments.useCaseId, id));
  return database.delete(useCases).where(eq(useCases.id, id));
}

export async function deleteExecutionMilestone(id: number) {
  const database = await requireDb();
  return database
    .delete(executionMilestones)
    .where(eq(executionMilestones.id, id));
}

export async function deletePlanningItem(id: number) {
  const database = await requireDb();
  return database.delete(planningItems).where(eq(planningItems.id, id));
}

export async function listTeamDirectory() {
  const database = await requireDb();
  const teams = await ensurePortfolioTeams();
  const [memberships, grants, people] = await Promise.all([
    database.select().from(teamMemberships),
    database.select().from(teamAccessGrants),
    database
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        loginMethod: users.loginMethod,
        isActive: users.isActive,
        role: users.role,
      })
      .from(users),
  ]);
  return { teams, memberships, grants, people };
}

export async function setTeamAccessGrant(input: {
  email: string;
  teamId: number;
  role: "lead" | "contributor";
}) {
  const database = await requireDb();
  const email = input.email.trim().toLowerCase();
  await database
    .insert(teamAccessGrants)
    .values({ ...input, email })
    .onDuplicateKeyUpdate({ set: { teamId: input.teamId, role: input.role } });
  const people = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  for (const person of people) {
    await database
      .delete(teamMemberships)
      .where(eq(teamMemberships.userId, person.id));
    await database
      .insert(teamMemberships)
      .values({ userId: person.id, teamId: input.teamId, role: input.role });
  }
}

export async function removeTeamAccessGrant(email: string) {
  const database = await requireDb();
  const normalized = email.trim().toLowerCase();
  await database
    .delete(teamAccessGrants)
    .where(eq(teamAccessGrants.email, normalized));
  const people = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized));
  for (const person of people)
    await database
      .delete(teamMemberships)
      .where(eq(teamMemberships.userId, person.id));
}
