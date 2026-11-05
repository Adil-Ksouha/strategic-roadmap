import { describe, expect, it } from "vitest";
import { buildCapabilityEnablementMilestone } from "./portfolio";

describe("capability-derived Executive Roadmap milestones", () => {
  it("uses the capability execution year and retains relationship identity", () => {
    expect(
      buildCapabilityEnablementMilestone({
        useCaseId: 14,
        capabilityId: 42,
        capabilityName: "Cloud automation",
        objectiveStartYear: 2026,
        objectiveEndYear: 2030,
        capabilityTargetYear: 2028,
      })
    ).toMatchObject({
      useCaseId: 14,
      sourceCapabilityId: 42,
      planningYear: 2028,
      title: "Cloud automation enablement",
      phase: "foundation",
      status: "planned",
    });
  });

  it("keeps a rescheduled capability in its actual future execution year", () => {
    expect(
      buildCapabilityEnablementMilestone({
        useCaseId: 14,
        capabilityId: 42,
        capabilityName: "Cloud automation",
        objectiveStartYear: 2026,
        objectiveEndYear: 2030,
        capabilityTargetYear: 2033,
      }).planningYear
    ).toBe(2033);
  });
});
