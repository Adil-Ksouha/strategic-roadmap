import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { TRPCError } from "@trpc/server";

const portfolioMocks = vi.hoisted(() => ({
  addFinancialPlanningYear: vi.fn(),
  bulkLinkCapabilitiesToUseCase: vi.fn(),
  createCapability: vi.fn(),
  createExecutionMilestone: vi.fn(),
  createKpiDefinition: vi.fn(),
  createUseCase: vi.fn(),
  deleteCapability: vi.fn(),
  deleteExecutionMilestone: vi.fn(),
  deleteKpiDefinition: vi.fn(),
  deleteUseCase: vi.fn(),
  getPortfolioAccess: vi.fn(),
  getPortfolioSnapshot: vi.fn(),
  linkCapabilityToUseCase: vi.fn(),
  listTeamDirectory: vi.fn(),
  removeTeamAccessGrant: vi.fn(),
  requireCapabilityEditor: vi.fn(),
  requireExecutive: vi.fn(),
  requireMilestoneEditor: vi.fn(),
  requireTeamEditor: vi.fn(),
  requireUseCaseEditor: vi.fn(),
  setCapabilityKpis: vi.fn(),
  setTeamAccessGrant: vi.fn(),
  unlinkCapabilityFromUseCase: vi.fn(),
  updateCapability: vi.fn(),
  updateExecutionMilestone: vi.fn(),
  updateKpiDefinition: vi.fn(),
  updateUseCase: vi.fn(),
  upsertInvestment: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  createPortfolioExport: vi.fn(),
}));

vi.mock("./portfolio", () => portfolioMocks);
vi.mock("./portfolioExport", () => exportMocks);
const { appRouter } = await import("./routers");

function caller(userOverrides: Record<string, unknown> = {}) {
  const ctx = {
    user: {
      id: 1,
      openId: "test-user",
      name: "Test Planner",
      email: "planner@example.com",
      loginMethod: "local",
      passwordHash: "test-hash",
      isActive: "active",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...userOverrides,
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: vi.fn() },
  } as unknown as TrpcContext;
  return appRouter.createCaller(ctx);
}

const capability = {
  name: "Domain automation",
  domain: "Operations",
  description:
    "Automated workflows that move operating teams from manual tasks to reliable service delivery.",
  owner: "Network Operations",
  maturity: "evolving" as const,
  criticality: "high" as const,
  targetYear: 2028,
  teamId: 1,
};
const useCase = {
  name: "Zero-touch service assurance",
  theme: "Resilience",
  description:
    "Use intelligence and automation to shorten incident resolution across strategic services.",
  outcome:
    "Improve service continuity and reduce operational effort through automated assurance.",
  sponsor: "Chief Network Officer",
  status: "planned" as const,
  priority: "p1" as const,
  startYear: 2026,
  endYear: 2029,
  teamId: 2,
  scope: "team" as const,
};
const milestone = {
  useCaseId: 2,
  planningYear: 2028,
  phase: "scale" as const,
  title: "Cross-domain service automation",
  status: "planned" as const,
};

describe("portfolio router", () => {
  beforeEach(() => {
    Object.values(portfolioMocks).forEach(mock => mock.mockReset());
  });

  it("serves the portfolio snapshot only to an active private account", async () => {
    portfolioMocks.getPortfolioSnapshot.mockResolvedValue({
      capabilities: [],
      useCases: [],
      planningItems: [],
      relationships: [],
      milestones: [],
      investments: [],
    });
    await expect(caller().portfolio.snapshot()).resolves.toMatchObject({
      useCases: [],
    });
    expect(portfolioMocks.getPortfolioSnapshot).toHaveBeenCalledOnce();
  });

  it("rejects non-local and disabled sessions before the portfolio snapshot is read", async () => {
    await expect(
      caller({ loginMethod: "google" }).portfolio.snapshot()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller({ isActive: "disabled" }).portfolio.snapshot()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(portfolioMocks.getPortfolioSnapshot).not.toHaveBeenCalled();
  });

  it("delegates create and update actions with validated portfolio values", async () => {
    await caller().portfolio.addCapability(capability);
    await caller().portfolio.updateCapability({
      id: 10,
      ...capability,
      targetYear: 2029,
    });
    await caller().portfolio.addUseCase(useCase);
    await caller().portfolio.updateUseCase({
      id: 11,
      ...useCase,
      status: "in_flight",
    });
    expect(portfolioMocks.createCapability).toHaveBeenCalledWith(capability);
    expect(portfolioMocks.updateCapability).toHaveBeenCalledWith(10, {
      ...capability,
      targetYear: 2029,
    });
    expect(portfolioMocks.createUseCase).toHaveBeenCalledWith(useCase);
    expect(portfolioMocks.updateUseCase).toHaveBeenCalledWith(11, {
      ...useCase,
      status: "in_flight",
    });
  });

  it("creates an export from the complete portfolio only after executive authorization", async () => {
    const snapshot = {
      capabilities: [],
      useCases: [],
      relationships: [],
      milestones: [],
      investments: [],
      teams: [],
      financialYears: [2026, 2027, 2028, 2029, 2030],
    };
    const exportFile = {
      filename: "strategic-roadmap-portfolio.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBase64: "UEs=",
    };
    portfolioMocks.getPortfolioSnapshot.mockResolvedValue(snapshot);
    exportMocks.createPortfolioExport.mockResolvedValue(exportFile);

    await expect(
      caller().portfolio.exportPortfolio({ format: "excel" })
    ).resolves.toEqual(exportFile);
    expect(portfolioMocks.requireExecutive).toHaveBeenCalledWith(
      expect.any(Object)
    );
    expect(exportMocks.createPortfolioExport).toHaveBeenCalledWith(
      "excel",
      snapshot
    );

    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller({ role: "user" }).portfolio.exportPortfolio({
        format: "powerpoint",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(exportMocks.createPortfolioExport).toHaveBeenCalledTimes(1);
  });

  it("delegates relationship, financial, status, and deletion actions", async () => {
    await caller().portfolio.linkCapability({
      useCaseId: 2,
      capabilityId: 3,
      contribution: "anchor",
    });
    await caller().portfolio.unlinkCapability({
      useCaseId: 2,
      capabilityId: 3,
    });
    await caller().portfolio.bulkLinkCapabilities({
      useCaseId: 2,
      capabilityIds: [3, 4],
      contribution: "enabling",
    });
    await caller().portfolio.setCapabilityKpis({
      capabilityId: 3,
      kpiIds: [11, 12],
    });
    await caller().portfolio.addFinancialPlanningYear({ planningYear: 2031 });
    await caller().portfolio.setInvestment({
      useCaseId: 2,
      planningYear: 2028,
      budgetType: "external",
      amountSarM: 3.5,
    });
    await caller().portfolio.deleteCapability({ id: 3 });
    await caller().portfolio.deleteUseCase({ id: 2 });
    expect(portfolioMocks.linkCapabilityToUseCase).toHaveBeenCalledWith({
      useCaseId: 2,
      capabilityId: 3,
      contribution: "anchor",
    });
    expect(portfolioMocks.unlinkCapabilityFromUseCase).toHaveBeenCalledWith({
      useCaseId: 2,
      capabilityId: 3,
    });
    expect(portfolioMocks.bulkLinkCapabilitiesToUseCase).toHaveBeenCalledWith({
      useCaseId: 2,
      capabilityIds: [3, 4],
      contribution: "enabling",
    });
    expect(portfolioMocks.requireCapabilityEditor).toHaveBeenCalledWith(
      expect.any(Object),
      3
    );
    expect(portfolioMocks.setCapabilityKpis).toHaveBeenCalledWith({
      capabilityId: 3,
      kpiIds: [11, 12],
    });
    expect(portfolioMocks.addFinancialPlanningYear).toHaveBeenCalledWith(2031);
    expect(portfolioMocks.upsertInvestment).toHaveBeenCalledWith({
      useCaseId: 2,
      planningYear: 2028,
      budgetType: "external",
      amountSarM: 3.5,
    });
    expect(portfolioMocks.deleteCapability).toHaveBeenCalledWith(3);
    expect(portfolioMocks.deleteUseCase).toHaveBeenCalledWith(2);
  });

  it("delegates validated milestone create, update, and delete actions", async () => {
    await caller().portfolio.addMilestone(milestone);
    await caller().portfolio.updateMilestone({
      id: 21,
      ...milestone,
      status: "in_progress",
    });
    await caller().portfolio.deleteMilestone({ id: 21 });
    expect(portfolioMocks.createExecutionMilestone).toHaveBeenCalledWith(
      milestone
    );
    expect(portfolioMocks.updateExecutionMilestone).toHaveBeenCalledWith(21, {
      ...milestone,
      status: "in_progress",
    });
    expect(portfolioMocks.deleteExecutionMilestone).toHaveBeenCalledWith(21);
    expect(portfolioMocks.requireMilestoneEditor).toHaveBeenCalledWith(
      expect.any(Object),
      21
    );
  });

  it("allows only executive administrators to govern the KPI catalogue", async () => {
    const kpi = {
      code: "A2.2",
      name: "Telco cloud automation use cases",
      strategicPillar: "Emerging technology adoption",
      theme: "Network cloudification",
      unit: "#",
    };
    await caller().portfolio.createKpiDefinition(kpi);
    await caller().portfolio.updateKpiDefinition({ id: 11, ...kpi });
    await caller().portfolio.deleteKpiDefinition({ id: 11 });
    expect(portfolioMocks.createKpiDefinition).toHaveBeenCalledWith(kpi);
    expect(portfolioMocks.updateKpiDefinition).toHaveBeenCalledWith(11, kpi);
    expect(portfolioMocks.deleteKpiDefinition).toHaveBeenCalledWith(11);

    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller({ role: "user" }).portfolio.createKpiDefinition(kpi)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects invalid execution horizons before calling a procedure delegate", async () => {
    await expect(
      caller().portfolio.addUseCase({ ...useCase, endYear: 2025 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller().portfolio.addMilestone({ ...milestone, title: "x" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(portfolioMocks.createUseCase).not.toHaveBeenCalled();
    expect(portfolioMocks.createExecutionMilestone).not.toHaveBeenCalled();
  });

  it("permits only executive administrators to create Shared Strategic Objectives", async () => {
    const shared = {
      ...useCase,
      name: "Enterprise resilience",
      scope: "shared" as const,
      teamId: null,
    };
    await caller().portfolio.addUseCase(shared);
    expect(portfolioMocks.requireExecutive).toHaveBeenCalledWith(
      expect.any(Object)
    );
    expect(portfolioMocks.createUseCase).toHaveBeenCalledWith(shared);

    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller({ role: "user" }).portfolio.addUseCase(shared)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(portfolioMocks.createUseCase).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-executive attempt to convert an existing objective into a Shared Strategic Objective", async () => {
    const shared = { ...useCase, scope: "shared" as const, teamId: null };
    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller({ role: "user" }).portfolio.updateUseCase({ id: 11, ...shared })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(portfolioMocks.updateUseCase).not.toHaveBeenCalled();
  });

  it("rejects cross-team capability, use-case, milestone, and investment writes before changing data", async () => {
    portfolioMocks.requireTeamEditor.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.addCapability(capability)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireUseCaseEditor.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.setInvestment({
        useCaseId: 2,
        planningYear: 2028,
        budgetType: "internal",
        amountSarM: 3.5,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireMilestoneEditor.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.deleteMilestone({ id: 21 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireUseCaseEditor.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.unlinkCapability({ useCaseId: 2, capabilityId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireUseCaseEditor.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.bulkLinkCapabilities({
        useCaseId: 2,
        capabilityIds: [3, 4],
        contribution: "supporting",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireCapabilityEditor.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.setCapabilityKpis({ capabilityId: 3, kpiIds: [11] })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(portfolioMocks.createCapability).not.toHaveBeenCalled();
    expect(portfolioMocks.upsertInvestment).not.toHaveBeenCalled();
    expect(portfolioMocks.deleteExecutionMilestone).not.toHaveBeenCalled();
    expect(portfolioMocks.unlinkCapabilityFromUseCase).not.toHaveBeenCalled();
    expect(portfolioMocks.setCapabilityKpis).not.toHaveBeenCalled();
  });

  it("protects private account administration with the executive authorization guard", async () => {
    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.createAccount({
        email: "engineer@example.com",
        name: "Example Engineer",
        password: "A secure private password",
        teamId: 1,
        teamRole: "contributor",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.resetAccountPassword({
        userId: 2,
        password: "A secure private password",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    portfolioMocks.requireExecutive.mockRejectedValueOnce(
      new TRPCError({ code: "FORBIDDEN" })
    );
    await expect(
      caller().portfolio.setAccountStatus({ userId: 2, isActive: "disabled" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
