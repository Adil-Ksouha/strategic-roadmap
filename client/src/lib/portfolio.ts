import { trpc } from "@/lib/trpc";
import { sarM } from "@shared/currency";

export { sarM };

export const YEARS = [2026, 2027, 2028, 2029, 2030] as const;

export function roadmapPlanningYears(input: {
  financialYears?: readonly number[];
  capabilityTargetYears?: readonly number[];
  objectiveYears?: readonly number[];
  milestoneYears?: readonly number[];
}) {
  const knownYears = [
    ...YEARS,
    ...(input.financialYears ?? []),
    ...(input.capabilityTargetYears ?? []),
    ...(input.objectiveYears ?? []),
    ...(input.milestoneYears ?? []),
  ].filter(Number.isInteger);
  const firstYear = Math.min(...knownYears);
  const finalYear = Math.max(...knownYears);
  return Array.from(
    { length: finalYear - firstYear + 1 },
    (_, offset) => firstYear + offset
  );
}

export const USE_CASE_STATUS_LABEL: Record<string, string> = {
  prioritized: "Prioritized",
  in_flight: "In flight",
  planned: "Planned",
  watchlist: "Watchlist",
};

export const ITEM_TYPE_LABEL: Record<string, string> = {
  feature_enhancement: "Feature enhancement",
  eos: "End of support",
  capacity_forecast: "Capacity forecast",
};

export const ITEM_STATUS_LABEL: Record<string, string> = {
  assess: "Assess",
  planned: "Planned",
  in_progress: "In progress",
  monitoring: "Monitoring",
};

export function yearlyTotals(
  investments: Array<{ planningYear: number; amountSarM: number }>,
  planningYears: readonly number[] = YEARS
) {
  return planningYears.map(year => ({
    year,
    amount: investments
      .filter(item => item.planningYear === year)
      .reduce((total, item) => total + item.amountSarM, 0),
  }));
}

export function classifiedYearlyTotals(
  investments: Array<{
    planningYear: number;
    amountSarM: number;
    budgetType: "internal" | "external";
  }>,
  planningYears: readonly number[] = YEARS
) {
  return planningYears.map(year => {
    const annualInvestments = investments.filter(
      item => item.planningYear === year
    );
    const internal = annualInvestments
      .filter(item => item.budgetType === "internal")
      .reduce((total, item) => total + item.amountSarM, 0);
    const external = annualInvestments
      .filter(item => item.budgetType === "external")
      .reduce((total, item) => total + item.amountSarM, 0);
    return { year, internal, external, amount: internal + external };
  });
}

export function filterStrategicObjectivesByIds<T extends { id: number }>(
  objectives: readonly T[],
  selectedIds: readonly number[]
) {
  if (!selectedIds.length) return [...objectives];
  const selected = new Set(selectedIds);
  return objectives.filter(objective => selected.has(objective.id));
}

export function kpiIdsByCapability<
  Mapping extends { capabilityId: number; kpiId: number },
>(mappings: readonly Mapping[]) {
  return mappings.reduce<Record<number, number[]>>((result, mapping) => {
    result[mapping.capabilityId] = [
      ...(result[mapping.capabilityId] ?? []),
      mapping.kpiId,
    ];
    return result;
  }, {});
}

export function kpiCoverageSummary<
  Capability extends { id: number },
  Mapping extends { capabilityId: number; kpiId: number },
>(capabilities: readonly Capability[], mappings: readonly Mapping[]) {
  const idsByCapability = kpiIdsByCapability(mappings);
  const mapped = capabilities.filter(
    capability => (idsByCapability[capability.id] ?? []).length > 0
  );
  const unmapped = capabilities.filter(
    capability => (idsByCapability[capability.id] ?? []).length === 0
  );
  return {
    mapped,
    unmapped,
    mappedCount: mapped.length,
    unmappedCount: unmapped.length,
    totalCount: capabilities.length,
    coveragePercent: capabilities.length
      ? Math.round((mapped.length / capabilities.length) * 100)
      : 0,
    idsByCapability,
  };
}

export function relationshipFocusView<
  Capability extends { id: number },
  StrategicObjective extends { id: number },
  Relationship extends { capabilityId: number; useCaseId: number },
>(input: {
  capabilities: readonly Capability[];
  strategicObjectives: readonly StrategicObjective[];
  relationships: readonly Relationship[];
  selected: { kind: "capability" | "useCase"; id: number } | null;
}) {
  if (!input.selected) {
    return {
      capabilities: [...input.capabilities],
      strategicObjectives: [...input.strategicObjectives],
      relationships: [...input.relationships],
    };
  }

  const selected = input.selected;

  const relationships = input.relationships.filter(relationship =>
    selected.kind === "capability"
      ? relationship.capabilityId === selected.id
      : relationship.useCaseId === selected.id
  );
  const capabilityIds = new Set(
    relationships.map(relationship => relationship.capabilityId)
  );
  const strategicObjectiveIds = new Set(
    relationships.map(relationship => relationship.useCaseId)
  );
  if (selected.kind === "capability") capabilityIds.add(selected.id);
  else strategicObjectiveIds.add(selected.id);

  return {
    capabilities: input.capabilities.filter(capability =>
      capabilityIds.has(capability.id)
    ),
    strategicObjectives: input.strategicObjectives.filter(objective =>
      strategicObjectiveIds.has(objective.id)
    ),
    relationships,
  };
}

export function usePortfolioSnapshot() {
  return trpc.portfolio.snapshot.useQuery(undefined, {
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function statusTone(status: string) {
  if (["prioritized", "in_flight", "in_progress", "complete"].includes(status))
    return "text-violet-100 bg-violet-300/10 border-violet-200/20";
  if (["critical", "p1"].includes(status))
    return "text-rose-200 bg-rose-300/10 border-rose-200/20";
  if (["high", "planned", "evolving"].includes(status))
    return "text-fuchsia-100 bg-fuchsia-300/10 border-fuchsia-200/20";
  return "text-slate-300 bg-white/[.055] border-white/10";
}

export function itemTypeTone(type: string) {
  if (type === "eos") return "bg-rose-400";
  if (type === "capacity_forecast") return "bg-violet-400";
  return "bg-fuchsia-300";
}
