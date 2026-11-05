import { describe, expect, it } from "vitest";
import {
  createExcelExport,
  createPortfolioExport,
  createPowerPointExport,
  type PortfolioExportSnapshot,
} from "./portfolioExport";

const snapshot: PortfolioExportSnapshot = {
  capabilities: [
    {
      id: 1,
      name: "Cloud platform",
      domain: "Core",
      description: "Cloud-native network foundation",
      owner: "Core team",
      maturity: "evolving",
      criticality: "high",
      targetYear: 2031,
      teamId: 1,
    },
  ],
  useCases: [
    {
      id: 2,
      name: "Resilient network",
      theme: "Resilience",
      description: "Improve resilience",
      outcome: "Resilient delivery",
      sponsor: "CTO",
      status: "prioritized",
      priority: "p1",
      startYear: 2026,
      endYear: 2031,
      teamId: 1,
      scope: "team",
    },
  ],
  relationships: [
    { id: 3, useCaseId: 2, capabilityId: 1, contribution: "enabling" },
  ],
  milestones: [
    {
      id: 4,
      useCaseId: 2,
      planningYear: 2031,
      phase: "foundation",
      title: "Cloud platform enablement",
      status: "planned",
      sourceCapabilityId: 1,
    },
  ],
  investments: [
    {
      useCaseId: 2,
      planningYear: 2031,
      budgetType: "internal",
      amountSarM: 6,
    },
    {
      useCaseId: 2,
      planningYear: 2031,
      budgetType: "external",
      amountSarM: 4,
    },
  ],
  teams: [{ id: 1, name: "Core & Cloud" }],
  financialYears: [2026, 2027, 2028, 2029, 2030, 2031],
  kpis: [
    {
      id: 5,
      code: "A2.1",
      name: "Network virtualization",
      strategicPillar: "Accelerate emerging technology adoption",
      theme: "Network cloudification",
      unit: "%",
    },
  ],
  capabilityKpis: [{ capabilityId: 1, kpiId: 5 }],
};

describe("formatted portfolio exports", () => {
  it("creates an Excel workbook and PowerPoint deck for the provisioned portfolio", async () => {
    const [workbook, deck] = await Promise.all([
      createExcelExport(snapshot),
      createPowerPointExport(snapshot),
    ]);
    expect(workbook.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(deck.subarray(0, 2).toString("utf8")).toBe("PK");
  }, 20_000);

  it("returns downloadable metadata for both supported formats", async () => {
    const excel = await createPortfolioExport("excel", snapshot);
    const powerpoint = await createPortfolioExport("powerpoint", snapshot);
    expect(excel).toMatchObject({
      filename: expect.stringContaining(".xlsx"),
      mimeType: expect.stringContaining("spreadsheet"),
    });
    expect(powerpoint).toMatchObject({
      filename: expect.stringContaining(".pptx"),
      mimeType: expect.stringContaining("presentation"),
    });
  }, 20_000);
});
