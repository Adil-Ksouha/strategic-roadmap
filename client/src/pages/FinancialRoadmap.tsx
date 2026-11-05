import PortfolioPageHeader, {
  InsightNote,
} from "@/components/PortfolioPageHeader";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  classifiedYearlyTotals,
  filterStrategicObjectivesByIds,
  kpiCoverageSummary,
  roadmapPlanningYears,
  sarM,
  statusTone,
  usePortfolioSnapshot,
} from "@/lib/portfolio";
import { trpc } from "@/lib/trpc";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CircleDollarSign,
  Filter,
  PencilLine,
  Plus,
  TrendingUp,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import sarSymbolUrl from "@/assets/saudi-riyal-symbol-cropped.png";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

function SaudiRiyalSymbol({ className = "" }: { className?: string }) {
  return (
    <img
      src={sarSymbolUrl}
      alt=""
      aria-hidden="true"
      onError={event => {
        event.currentTarget.style.display = "none";
      }}
      className={`block object-contain ${className}`}
    />
  );
}

export default function FinancialRoadmap() {
  const { data, isLoading } = usePortfolioSnapshot();
  const { isAuthenticated } = useAuth();
  const { data: access } = trpc.portfolio.access.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const utils = trpc.useUtils();
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
  const [selectedObjectiveIds, setSelectedObjectiveIds] = useState<number[]>(
    []
  );
  const [yearEditorOpen, setYearEditorOpen] = useState(false);
  const [newPlanningYear, setNewPlanningYear] = useState("");
  const updateInvestment = trpc.portfolio.setInvestment.useMutation({
    onSuccess: () => utils.portfolio.snapshot.invalidate(),
    onError: error =>
      toast.error("Investment not saved", { description: error.message }),
  });
  const addFinancialPlanningYear =
    trpc.portfolio.addFinancialPlanningYear.useMutation({
      onSuccess: () => {
        void utils.portfolio.snapshot.invalidate();
        setNewPlanningYear("");
        setYearEditorOpen(false);
        toast.success("Financial year added");
      },
      onError: error =>
        toast.error("Financial year not added", { description: error.message }),
    });
  useEffect(() => {
    setSelectedObjectiveIds([]);
  }, [teamFilter]);
  if (isLoading || !data)
    return (
      <div className="grid min-h-[65vh] place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200" />
      </div>
    );
  if (!data.useCases.length)
    return (
      <div className="mx-auto max-w-[1500px]">
        <PortfolioPageHeader
          eyebrow="Capital planning"
          title="Fund the architecture, year by year."
          description="Add a Strategic Objective to start recording annual funding commitments and portfolio investment rollups."
        />
        <div className="glass-card grid min-h-[360px] place-items-center rounded-2xl p-8 text-center">
          <div>
            <CircleDollarSign className="mx-auto h-6 w-6 text-amber-200" />
            <h2 className="serif-title mt-4 text-2xl text-white">
              No investment plan has been defined yet.
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
              Strategic Objective investment plans will roll up into an
              executive five-year capital view once planning data is added.
            </p>
          </div>
        </div>
      </div>
    );
  const scopedUseCases = data.useCases.filter(
    useCase =>
      teamFilter === "all" ||
      useCase.scope === "shared" ||
      useCase.teamId === teamFilter
  );
  const filteredUseCases = filterStrategicObjectivesByIds(
    scopedUseCases,
    selectedObjectiveIds
  );
  const scopedIds = new Set(filteredUseCases.map(useCase => useCase.id));
  const selectedCapabilityIds = new Set(
    data.relationships
      .filter(link => scopedIds.has(link.useCaseId))
      .map(link => link.capabilityId)
  );
  const selectedCapabilities = data.capabilities.filter(capability =>
    selectedCapabilityIds.has(capability.id)
  );
  const kpiCoverage = kpiCoverageSummary(
    selectedCapabilities,
    data.capabilityKpis
  );
  const financialYears = roadmapPlanningYears({
    financialYears: data.financialYears,
    capabilityTargetYears: data.capabilities.map(item => item.targetYear),
    objectiveYears: data.useCases.flatMap(item => [
      item.startYear,
      item.endYear,
    ]),
    milestoneYears: data.milestones.map(item => item.planningYear),
  });
  const annual = classifiedYearlyTotals(
    data.investments.filter(item => scopedIds.has(item.useCaseId)),
    financialYears
  );
  const total = annual.reduce((sum, item) => sum + item.amount, 0);
  const internalTotal = annual.reduce((sum, item) => sum + item.internal, 0);
  const externalTotal = annual.reduce((sum, item) => sum + item.external, 0);
  const peak = annual.reduce((max, item) => Math.max(max, item.amount), 0);
  const perUseCase = (
    id: number,
    year: number,
    budgetType: "internal" | "external"
  ) =>
    data.investments
      .filter(
        item =>
          item.useCaseId === id &&
          item.planningYear === year &&
          item.budgetType === budgetType
      )
      .reduce((sum, item) => sum + item.amountSarM, 0);
  const canEditUseCase = (useCase: {
    teamId: number | null;
    scope: "team" | "shared";
  }) =>
    Boolean(
      access?.isExecutive ||
        (useCase.scope !== "shared" &&
          access?.memberships.some(
            membership => membership.teamId === useCase.teamId
          ))
    );
  const toggleObjective = (objectiveId: number) => {
    setSelectedObjectiveIds(currentIds =>
      currentIds.includes(objectiveId)
        ? currentIds.filter(id => id !== objectiveId)
        : [...currentIds, objectiveId]
    );
  };
  const selectedLabel = selectedObjectiveIds.length
    ? `${selectedObjectiveIds.length} Strategic Objective${selectedObjectiveIds.length === 1 ? "" : "s"} selected`
    : `All Strategic Objectives (${scopedUseCases.length})`;
  const submitFinancialYear = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const planningYear = Number(newPlanningYear);
    if (
      !Number.isInteger(planningYear) ||
      planningYear < 2020 ||
      planningYear > 2100
    ) {
      toast.error("Enter a valid calendar year between 2020 and 2100.");
      return;
    }
    addFinancialPlanningYear.mutate({ planningYear });
  };
  return (
    <div className="mx-auto max-w-[1500px]">
      <PortfolioPageHeader
        eyebrow="Capital planning"
        title="Fund the architecture, year by year."
        description="Translate strategic execution into a multi-year investment view. Review portfolio rollups and adjust the annual funding commitments that enable each Strategic Objective."
      />
      <div className="mb-5 grid gap-3 rounded-2xl border border-white/[.08] bg-white/[.025] p-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-center">
        <div>
          <p className="eyebrow">Budget scope</p>
          <p className="mt-1 text-xs text-slate-400">
            Select a team and, if needed, one or more Strategic Objectives. All
            financial totals update to the selected budget set, split by
            Internal and External funding.
          </p>
        </div>
        <select
          aria-label="Filter financial roadmap by team"
          value={teamFilter}
          onChange={event =>
            setTeamFilter(
              event.target.value === "all" ? "all" : Number(event.target.value)
            )
          }
          className="h-10 w-full rounded-xl border border-white/10 bg-[#1b2943] px-3 text-sm text-slate-100 outline-none focus:border-cyan-200/45 sm:w-[245px]"
        >
          <option value="all">Enterprise financial view</option>
          {data.teams.map(team => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Filter financial roadmap by Strategic Objectives"
              className="flex h-10 min-w-[245px] items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#1b2943] px-3 text-left text-sm text-slate-100 outline-none transition hover:border-cyan-200/35 focus-visible:border-cyan-200/45 focus-visible:ring-2 focus-visible:ring-cyan-200/20"
            >
              <span className="truncate">{selectedLabel}</span>
              <Filter className="h-4 w-4 shrink-0 text-cyan-200" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(360px,calc(100vw-2rem))] border-white/10 bg-[#131c2e] p-0 text-slate-100 shadow-2xl shadow-black/35"
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/[.08] px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  Strategic Objectives
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Choose one or more to consolidate their SAR budgets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedObjectiveIds([])}
                disabled={!selectedObjectiveIds.length}
                className="shrink-0 text-xs font-medium text-cyan-200 transition hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>
            <div className="soft-scroll max-h-72 overflow-y-auto p-2">
              {scopedUseCases.map(useCase => {
                const selected = selectedObjectiveIds.includes(useCase.id);
                return (
                  <label
                    key={useCase.id}
                    htmlFor={`financial-objective-${useCase.id}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 transition hover:bg-white/[.06]"
                  >
                    <Checkbox
                      id={`financial-objective-${useCase.id}`}
                      checked={selected}
                      onCheckedChange={() => toggleObjective(useCase.id)}
                      className="mt-0.5 border-white/25 data-[state=checked]:border-cyan-200 data-[state=checked]:bg-cyan-200 data-[state=checked]:text-slate-950"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-200">
                        {useCase.name}
                      </span>
                      <span className="mt-0.5 block text-[.68rem] text-slate-500">
                        {useCase.scope === "shared"
                          ? "All domains"
                          : (data.teams.find(team => team.id === useCase.teamId)
                              ?.name ?? useCase.theme)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
        {access?.isExecutive && (
          <Button
            type="button"
            onClick={() => setYearEditorOpen(true)}
            className="h-10 rounded-xl bg-cyan-200 px-3 text-slate-950 hover:bg-cyan-100"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add year
          </Button>
        )}
      </div>
      <section className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <article className="glass-card rounded-2xl p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="eyebrow">Portfolio investment profile</p>
              <h2 className="serif-title mt-1 text-2xl text-white">
                Investment cadence
              </h2>
            </div>
            <TrendingUp className="h-5 w-5 text-cyan-200" />
          </div>
          <div className="mt-5 h-[255px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={annual}
                margin={{ top: 8, right: 6, left: -22, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="financeGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#c4b5fd" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#c4b5fd" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="financeExternalGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="#67e8f9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="rgba(148,163,184,.12)"
                  strokeDasharray="3 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="year"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#8fa0ba", fontSize: 11 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#8fa0ba", fontSize: 11 }}
                  tickFormatter={value => sarM(value)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#162139",
                    border: "1px solid rgba(148,163,184,.25)",
                    borderRadius: "12px",
                    color: "#e6f4fa",
                    fontSize: "12px",
                  }}
                  formatter={(value: number, name: string) => [
                    sarM(value),
                    name === "internal" ? "Internal budget" : "External budget",
                  ]}
                  labelStyle={{ color: "#92a4bf" }}
                />
                <Area
                  type="monotone"
                  dataKey="internal"
                  name="internal"
                  stroke="#c4b5fd"
                  strokeWidth={2.5}
                  fill="url(#financeGradient)"
                  stackId="budget"
                  activeDot={{
                    r: 5,
                    fill: "#c4b5fd",
                    stroke: "#102039",
                    strokeWidth: 3,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="external"
                  name="external"
                  stroke="#67e8f9"
                  strokeWidth={2.5}
                  fill="url(#financeExternalGradient)"
                  stackId="budget"
                  activeDot={{
                    r: 5,
                    fill: "#67e8f9",
                    stroke: "#102039",
                    strokeWidth: 3,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <article className="glass-card rounded-2xl p-5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-white">
              <SaudiRiyalSymbol className="h-5 w-5" />
            </span>
            <p className="metric-value mt-4 text-3xl text-white">
              {sarM(total)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Total investment requirement
            </p>
          </article>
          <article className="glass-card rounded-2xl p-5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-white">
              <SaudiRiyalSymbol className="h-5 w-5" />
            </span>
            <p className="metric-value mt-4 text-3xl text-white">
              {sarM(internalTotal)}
            </p>
            <p className="mt-2 text-xs text-slate-400">Total Internal budget</p>
          </article>
          <article className="glass-card rounded-2xl p-5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-white">
              <SaudiRiyalSymbol className="h-5 w-5" />
            </span>
            <p className="metric-value mt-4 text-3xl text-white">
              {sarM(externalTotal)}
            </p>
            <p className="mt-2 text-xs text-slate-400">Total External budget</p>
          </article>
          <article className="glass-card rounded-2xl p-5">
            <PencilLine className="h-4 w-4 text-violet-200" />
            <p className="metric-value mt-4 text-3xl text-white">
              {sarM(peak)}
            </p>
            <p className="mt-2 text-xs text-slate-400">Peak annual total</p>
          </article>
          <article className="glass-card rounded-2xl p-5">
            <PencilLine className="h-4 w-4 text-violet-200" />
            <p className="metric-value mt-4 text-3xl text-white">
              {kpiCoverage.coveragePercent}%
            </p>
            <p className="mt-2 text-xs text-slate-400">
              KPI coverage · {kpiCoverage.unmappedCount} unmapped{" "}
              {kpiCoverage.unmappedCount === 1 ? "capability" : "capabilities"}
            </p>
          </article>
        </div>
      </section>
      <section className="glass-card mt-5 overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-2 border-b border-white/[.08] px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-5 w-5 place-items-center rounded bg-white">
                <SaudiRiyalSymbol className="h-4 w-4" />
              </span>
              <p className="eyebrow">
                Annual investment register · SAR millions
              </p>
            </div>
            <h2 className="serif-title mt-1 text-2xl text-white">
              Strategic Objectives funding plan
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            {isAuthenticated
              ? "Record separate Internal and External annual SAR amounts for the Strategic Objectives your team owns. Shared objectives are administrator managed."
              : "Sign in to adjust investment values."}
          </p>
          <p className="mono text-[.64rem] uppercase tracking-[.08em] text-slate-500">
            I = Internal budget · E = External budget
          </p>
        </div>
        <div className="overflow-x-auto soft-scroll">
          <table className="financial-roadmap-table border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[.08] bg-white/[.025]">
                <th className="w-[290px] px-5 py-3 mono text-[.64rem] font-medium uppercase tracking-[.12em] text-slate-500">
                  Strategic Objective
                </th>
                {financialYears.map(year => (
                  <th
                    key={year}
                    className="border-l border-white/[.06] px-4 py-3 text-center mono text-[.68rem] font-medium text-slate-400"
                  >
                    {year}
                  </th>
                ))}
                <th className="border-l border-white/[.06] px-4 py-3 text-right mono text-[.64rem] font-medium uppercase tracking-[.12em] text-slate-500">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUseCases.map(useCase => {
                const rowInternal = financialYears.reduce(
                  (sum, year) => sum + perUseCase(useCase.id, year, "internal"),
                  0
                );
                const rowExternal = financialYears.reduce(
                  (sum, year) => sum + perUseCase(useCase.id, year, "external"),
                  0
                );
                const rowTotal = rowInternal + rowExternal;
                const canEdit = canEditUseCase(useCase);
                const team = data.teams.find(
                  item => item.id === useCase.teamId
                );
                const isShared = useCase.scope === "shared";
                return (
                  <tr
                    key={useCase.id}
                    className="border-b border-white/[.06] last:border-b-0 hover:bg-white/[.025]"
                  >
                    <td className="px-5 py-4">
                      <p className="text-sm font-medium text-slate-100">
                        {useCase.name}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`rounded border px-1 py-0.5 text-[.58rem] ${statusTone(useCase.status)}`}
                        >
                          {useCase.priority.toUpperCase()}
                        </span>
                        <span className="text-[.66rem] text-slate-500">
                          {isShared
                            ? "Shared · administrator managed"
                            : (team?.name ?? useCase.theme)}
                        </span>
                        <span className="text-[.6rem] text-violet-200/80">
                          I {sarM(rowInternal)} · E {sarM(rowExternal)}
                        </span>
                      </div>
                    </td>
                    {financialYears.map(year => {
                      const internalValue = perUseCase(
                        useCase.id,
                        year,
                        "internal"
                      );
                      const externalValue = perUseCase(
                        useCase.id,
                        year,
                        "external"
                      );
                      return (
                        <td
                          key={year}
                          className="border-l border-white/[.06] px-2 py-3 text-center"
                        >
                          <div className="mx-auto grid w-[118px] gap-1">
                            <BudgetAmountInput
                              label="I"
                              ariaLabel={`${useCase.name} ${year} Internal budget in Saudi Riyal millions`}
                              value={internalValue}
                              disabled={!canEdit || updateInvestment.isPending}
                              onSave={amountSarM =>
                                updateInvestment.mutate({
                                  useCaseId: useCase.id,
                                  planningYear: year,
                                  budgetType: "internal",
                                  amountSarM,
                                })
                              }
                            />
                            <BudgetAmountInput
                              label="E"
                              ariaLabel={`${useCase.name} ${year} External budget in Saudi Riyal millions`}
                              value={externalValue}
                              disabled={!canEdit || updateInvestment.isPending}
                              onSave={amountSarM =>
                                updateInvestment.mutate({
                                  useCaseId: useCase.id,
                                  planningYear: year,
                                  budgetType: "external",
                                  amountSarM,
                                })
                              }
                            />
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-l border-white/[.06] px-5 py-3 text-right mono text-sm font-medium text-cyan-100">
                      {sarM(rowTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-violet-300/[.045]">
                <td className="px-5 py-3 text-xs font-semibold text-violet-100">
                  Internal total
                </td>
                {annual.map(item => (
                  <td
                    key={item.year}
                    className="border-l border-white/[.08] px-4 py-3 text-center mono text-xs font-medium text-violet-100"
                  >
                    {sarM(item.internal)}
                  </td>
                ))}
                <td className="border-l border-white/[.08] px-5 py-3 text-right mono text-sm font-semibold text-violet-100">
                  {sarM(internalTotal)}
                </td>
              </tr>
              <tr className="bg-cyan-300/[.035]">
                <td className="px-5 py-3 text-xs font-semibold text-cyan-100">
                  External total
                </td>
                {annual.map(item => (
                  <td
                    key={item.year}
                    className="border-l border-white/[.08] px-4 py-3 text-center mono text-xs font-medium text-cyan-100"
                  >
                    {sarM(item.external)}
                  </td>
                ))}
                <td className="border-l border-white/[.08] px-5 py-3 text-right mono text-sm font-semibold text-cyan-100">
                  {sarM(externalTotal)}
                </td>
              </tr>
              <tr className="bg-cyan-300/[.055]">
                <td className="px-5 py-4 text-sm font-semibold text-cyan-100">
                  Selected total
                </td>
                {annual.map(item => (
                  <td
                    key={item.year}
                    className="border-l border-white/[.08] px-4 py-4 text-center mono text-sm font-medium text-cyan-100"
                  >
                    {sarM(item.amount)}
                  </td>
                ))}
                <td className="border-l border-white/[.08] px-5 py-4 text-right mono text-base font-semibold text-cyan-100">
                  {sarM(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <Dialog open={yearEditorOpen} onOpenChange={setYearEditorOpen}>
        <DialogContent className="border-white/10 bg-[#17233a] text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="serif-title text-2xl">
              Add financial year
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Create another Financial Roadmap column. The new year starts at
              0.0 SAR million for every Strategic Objective.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitFinancialYear} className="mt-2 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">
                Calendar year
              </span>
              <input
                autoFocus
                required
                type="number"
                min="2020"
                max="2100"
                step="1"
                value={newPlanningYear}
                onChange={event => setNewPlanningYear(event.target.value)}
                placeholder={String((financialYears.at(-1) ?? 2030) + 1)}
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[.05] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-200/45"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setYearEditorOpen(false)}
                className="border-white/15 text-slate-200 hover:bg-white/[.06]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={addFinancialPlanningYear.isPending}
                className="bg-cyan-200 text-slate-950 hover:bg-cyan-100"
              >
                {addFinancialPlanningYear.isPending ? "Adding…" : "Add year"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <div className="mt-5">
        <InsightNote>
          <strong className="font-semibold text-cyan-100">
            Financial perspective:
          </strong>{" "}
          the portfolio reaches its high-water mark in the middle years, when
          cloud foundation, 5G scale, and automation capabilities must progress
          together. The roadmap makes this planned concentration visible before
          annual budgeting decisions are finalized.
        </InsightNote>
      </div>
    </div>
  );
}

function BudgetAmountInput({
  label,
  ariaLabel,
  value,
  disabled,
  onSave,
}: {
  label: "I" | "E";
  ariaLabel: string;
  value: number;
  disabled: boolean;
  onSave: (amountSarM: number) => void;
}) {
  const isInternal = label === "I";
  return (
    <div className="relative">
      <span
        className={`pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 mono text-[.58rem] font-semibold ${isInternal ? "bg-violet-300/15 text-violet-100" : "bg-cyan-300/15 text-cyan-100"}`}
      >
        {label}
      </span>
      <span className="pointer-events-none absolute left-6 top-1/2 grid h-3.5 w-3.5 -translate-y-1/2 place-items-center rounded-sm bg-white">
        <SaudiRiyalSymbol className="h-2.5 w-2.5" />
      </span>
      <input
        aria-label={ariaLabel}
        type="number"
        min="0"
        step="0.1"
        defaultValue={value}
        disabled={disabled}
        onBlur={event => {
          const nextSar = Number(event.currentTarget.value);
          if (Number.isFinite(nextSar) && nextSar !== value) onSave(nextSar);
        }}
        className="h-7 w-full rounded-md border border-transparent bg-white/[.04] pl-11 pr-1 text-right mono text-[.68rem] text-slate-200 outline-none transition focus:border-cyan-200/35 focus:bg-white/[.08] disabled:opacity-65"
      />
    </div>
  );
}
