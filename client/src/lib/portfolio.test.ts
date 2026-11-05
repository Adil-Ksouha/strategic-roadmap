import { describe, expect, it } from "vitest";
import {
  classifiedYearlyTotals,
  filterStrategicObjectivesByIds,
  kpiCoverageSummary,
  relationshipFocusView,
  roadmapPlanningYears,
  sarM,
  yearlyTotals,
} from "./portfolio";

describe("Saudi Riyal monetary formatting", () => {
  it("presents direct Saudi Riyal amounts in millions", () => {
    expect(sarM(46.5)).toBe("SAR 46.5M");
    expect(sarM(10, 0)).toBe("SAR 10M");
  });
});

describe("Strategic Objective budget filtering", () => {
  const objectives = [
    { id: 1, name: "Leadership" },
    { id: 2, name: "Autonomous network" },
    { id: 3, name: "Modernization" },
  ];

  it("keeps all objectives without a selection and supports multiple selected objectives", () => {
    expect(filterStrategicObjectivesByIds(objectives, [])).toEqual(objectives);
    expect(filterStrategicObjectivesByIds(objectives, [1, 3])).toEqual([
      objectives[0],
      objectives[2],
    ]);
  });
});

describe("Relationship Map connected-item focus", () => {
  const capabilities = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const strategicObjectives = [{ id: 10 }, { id: 20 }];
  const relationships = [
    { capabilityId: 1, useCaseId: 10 },
    { capabilityId: 2, useCaseId: 10 },
    { capabilityId: 3, useCaseId: 20 },
  ];

  it("keeps only a selected node and its direct linked context", () => {
    expect(
      relationshipFocusView({
        capabilities,
        strategicObjectives,
        relationships,
        selected: { kind: "useCase", id: 10 },
      })
    ).toEqual({
      capabilities: [capabilities[0], capabilities[1]],
      strategicObjectives: [strategicObjectives[0]],
      relationships: [relationships[0], relationships[1]],
    });
  });
});

describe("Capability KPI coverage", () => {
  it("separates mapped and unmapped capabilities without counting duplicate KPI links twice", () => {
    const capabilities = [
      { id: 1, name: "Cloud" },
      { id: 2, name: "Automation" },
      { id: 3, name: "Data" },
    ];
    const summary = kpiCoverageSummary(capabilities, [
      { capabilityId: 1, kpiId: 10 },
      { capabilityId: 1, kpiId: 11 },
      { capabilityId: 2, kpiId: 12 },
    ]);
    expect(summary.mapped).toEqual([capabilities[0], capabilities[1]]);
    expect(summary.unmapped).toEqual([capabilities[2]]);
    expect(summary.coveragePercent).toBe(67);
    expect(summary.idsByCapability[1]).toEqual([10, 11]);
  });
});

describe("Financial Roadmap planning years", () => {
  it("keeps Internal and External budget totals separate while retaining their combined annual total", () => {
    expect(
      classifiedYearlyTotals(
        [
          { planningYear: 2030, amountSarM: 4.5, budgetType: "internal" },
          { planningYear: 2030, amountSarM: 7, budgetType: "external" },
          { planningYear: 2031, amountSarM: 2, budgetType: "external" },
        ],
        [2030, 2031]
      )
    ).toEqual([
      { year: 2030, internal: 4.5, external: 7, amount: 11.5 },
      { year: 2031, internal: 0, external: 2, amount: 2 },
    ]);
  });

  it("calculates totals for administrator-added years without a fixed five-year limit", () => {
    expect(
      yearlyTotals(
        [
          { planningYear: 2030, amountSarM: 4.5 },
          { planningYear: 2031, amountSarM: 7 },
        ],
        [2030, 2031]
      )
    ).toEqual([
      { year: 2030, amount: 4.5 },
      { year: 2031, amount: 7 },
    ]);
  });

  it("extends both roadmap timelines through a future capability execution year", () => {
    expect(
      roadmapPlanningYears({
        financialYears: [2026, 2027, 2028, 2029, 2030],
        capabilityTargetYears: [2031, 2035],
        objectiveYears: [2026, 2030],
        milestoneYears: [2028],
      })
    ).toEqual([2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035]);
  });
});
