import PortfolioPageHeader, {
  InsightNote,
} from "@/components/PortfolioPageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  kpiCoverageSummary,
  roadmapPlanningYears,
  statusTone,
  usePortfolioSnapshot,
  USE_CASE_STATUS_LABEL,
} from "@/lib/portfolio";
import { trpc } from "@/lib/trpc";
import {
  CalendarRange,
  CheckCircle2,
  CircleDotDashed,
  Edit3,
  Flag,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

type MilestonePhase = "discover" | "foundation" | "scale" | "optimize" | "run";
type MilestoneStatus = "planned" | "in_progress" | "complete";
type Milestone = {
  id: number;
  useCaseId: number;
  planningYear: number;
  phase: MilestonePhase;
  title: string;
  status: MilestoneStatus;
  sourceCapabilityId?: number | null;
};
type Editor = {
  record?: Milestone;
  useCaseId: number;
  planningYear: number;
} | null;

const phaseTone: Record<MilestonePhase, string> = {
  discover: "border-violet-200/25 bg-violet-300/10 text-violet-100",
  foundation: "border-cyan-200/25 bg-cyan-300/10 text-cyan-100",
  scale: "border-amber-200/25 bg-amber-300/10 text-amber-100",
  optimize: "border-fuchsia-200/25 bg-fuchsia-300/10 text-fuchsia-100",
  run: "border-emerald-200/25 bg-emerald-300/10 text-emerald-100",
};

export default function ExecutionRoadmap() {
  const { data, isLoading } = usePortfolioSnapshot();
  const { isAuthenticated } = useAuth();
  const { data: access } = trpc.portfolio.access.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const utils = trpc.useUtils();
  const [editor, setEditor] = useState<Editor>(null);
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
  const [saveError, setSaveError] = useState<string | null>(null);
  const complete = async () => {
    await utils.portfolio.snapshot.invalidate();
    setSaveError(null);
    setEditor(null);
  };
  const fail = (error: unknown) => {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Strategic Roadmap could not save this milestone. Please try again.";
    setSaveError(message);
    toast.error("Roadmap update not saved", { description: message });
  };
  const createMilestone = trpc.portfolio.addMilestone.useMutation({
    onSuccess: complete,
    onError: fail,
  });
  const updateMilestone = trpc.portfolio.updateMilestone.useMutation({
    onSuccess: complete,
    onError: fail,
  });
  const deleteMilestone = trpc.portfolio.deleteMilestone.useMutation({
    onSuccess: () => void utils.portfolio.snapshot.invalidate(),
    onError: fail,
  });
  const pending =
    createMilestone.isPending ||
    updateMilestone.isPending ||
    deleteMilestone.isPending;

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
          eyebrow="Strategic execution"
          title="A five-year path from decision to delivery."
          description="Create a Strategic Objective in the portfolio catalog to begin shaping the execution roadmap."
        />
        <div className="glass-card grid min-h-[360px] place-items-center rounded-2xl p-8 text-center">
          <div>
            <CalendarRange className="mx-auto h-6 w-6 text-cyan-200" />
            <h2 className="serif-title mt-4 text-2xl text-white">
              No execution plan has been defined yet.
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
              When you add Strategic Objectives and their milestones, the
              integrated five-year delivery timeline will appear here.
            </p>
          </div>
        </div>
      </div>
    );

  const visibleUseCases = data.useCases.filter(
    item =>
      teamFilter === "all" ||
      item.scope === "shared" ||
      item.teamId === teamFilter
  );
  const visibleUseCaseIds = new Set(visibleUseCases.map(item => item.id));
  const scopedCapabilityIds = new Set(
    data.relationships
      .filter(link => visibleUseCaseIds.has(link.useCaseId))
      .map(link => link.capabilityId)
  );
  const scopedCapabilities = data.capabilities.filter(capability =>
    scopedCapabilityIds.has(capability.id)
  );
  const kpiCoverage = kpiCoverageSummary(
    scopedCapabilities,
    data.capabilityKpis
  );
  const roadmapYears = roadmapPlanningYears({
    financialYears: data.financialYears,
    capabilityTargetYears: data.capabilities.map(item => item.targetYear),
    objectiveYears: data.useCases.flatMap(item => [
      item.startYear,
      item.endYear,
    ]),
    milestoneYears: data.milestones.map(item => item.planningYear),
  });
  const editableUseCases = data.useCases.filter(item =>
    Boolean(
      access?.isExecutive ||
        (item.scope !== "shared" &&
          access?.memberships.some(
            membership => membership.teamId === item.teamId
          ))
    )
  );
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
  const activeMilestones = data.milestones.filter(
    item =>
      item.status === "in_progress" &&
      visibleUseCases.some(useCase => useCase.id === item.useCaseId)
  ).length;
  const openCreate = (
    useCaseId = editableUseCases[0]?.id,
    planningYear = editableUseCases[0]?.startYear
  ) => {
    if (!useCaseId || !planningYear) return;
    setSaveError(null);
    setEditor({ useCaseId, planningYear });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;
    setSaveError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      useCaseId: Number(form.get("useCaseId")),
      planningYear: Number(form.get("planningYear")),
      phase: String(form.get("phase")) as MilestonePhase,
      title: String(form.get("title")),
      status: String(form.get("status")) as MilestoneStatus,
    };
    editor.record
      ? updateMilestone.mutate({ id: editor.record.id, ...payload })
      : createMilestone.mutate(payload);
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <PortfolioPageHeader
        eyebrow="Strategic execution"
        title="A five-year path from decision to delivery."
        description="Sequence each Strategic Objective across discovery, foundation, scale, and optimization phases so executives can see where action and investment intersect."
        action={
          <Button
            onClick={() => openCreate()}
            disabled={!isAuthenticated || !editableUseCases.length}
            className="h-10 rounded-xl bg-cyan-200 px-4 font-semibold text-slate-950 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Plus className="mr-2 h-4 w-4" />
            {isAuthenticated ? "Add milestone" : "Sign in to edit"}
          </Button>
        }
      />
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/[.08] bg-white/[.025] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Team scope</p>
          <p className="mt-1 text-xs text-slate-400">
            Review enterprise sequencing or focus the roadmap on one engineering
            team.
          </p>
        </div>
        <select
          aria-label="Filter execution roadmap by team"
          value={teamFilter}
          onChange={event =>
            setTeamFilter(
              event.target.value === "all" ? "all" : Number(event.target.value)
            )
          }
          className={`${selectClass} w-full sm:w-[245px]`}
        >
          <option value="all">Enterprise roadmap</option>
          {data.teams.map(team => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <section className="mb-5 grid gap-4 sm:grid-cols-3">
        <Metric
          icon={CalendarRange}
          value={
            data.milestones.filter(item =>
              visibleUseCases.some(useCase => useCase.id === item.useCaseId)
            ).length
          }
          label="Milestones in current scope"
          tone="text-cyan-200"
        />
        <Metric
          icon={CircleDotDashed}
          value={activeMilestones}
          label="Active delivery motions"
          tone="text-amber-200"
        />
        <Metric
          icon={Rocket}
          value={kpiCoverage.coveragePercent}
          label={`KPI coverage · ${kpiCoverage.unmappedCount} ${kpiCoverage.unmappedCount === 1 ? "capability" : "capabilities"} need mapping`}
          tone={
            kpiCoverage.unmappedCount ? "text-amber-200" : "text-emerald-200"
          }
        />
      </section>
      {!isAuthenticated && (
        <div className="mb-5">
          <InsightNote>
            Roadmap milestones are visible for review.{" "}
            <strong className="font-semibold text-cyan-100">Sign in</strong> to
            create, edit, reschedule, or remove delivery commitments.
          </InsightNote>
        </div>
      )}
      <section className="glass-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[.08] px-5 py-4">
          <div>
            <p className="eyebrow">Integrated roadmap</p>
            <h2 className="serif-title mt-1 text-2xl text-white">
              Strategic Objectives delivery plan
            </h2>
          </div>
          <span className="mono text-[.65rem] text-slate-500">
            {roadmapYears[0]} / {roadmapYears.at(-1)}
          </span>
        </div>
        <div className="overflow-x-auto soft-scroll">
          <div className="min-w-[1050px]">
            <div className="roadmap-grid border-b border-white/[.08] bg-white/[.025]">
              <div className="px-5 py-3">
                <p className="mono text-[.65rem] uppercase tracking-[.12em] text-slate-500">
                  Strategic Objective
                </p>
              </div>
              {roadmapYears.map(year => (
                <div
                  key={year}
                  className="border-l border-white/[.06] px-4 py-3 text-center"
                >
                  <p className="mono text-xs text-slate-300">{year}</p>
                </div>
              ))}
            </div>
            {visibleUseCases.map(useCase => {
              const canEdit = canEditUseCase(useCase);
              const team = data.teams.find(item => item.id === useCase.teamId);
              const isShared = useCase.scope === "shared";
              return (
                <div
                  key={useCase.id}
                  className="roadmap-grid border-b border-white/[.06] last:border-b-0"
                >
                  <div className="p-5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${useCase.priority === "p1" ? "bg-cyan-200" : "bg-slate-500"}`}
                      />
                      <p className="text-sm font-medium text-slate-100">
                        {useCase.name}
                      </p>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="mono text-[.62rem] text-slate-500">
                        {isShared
                          ? "Shared · administrator managed"
                          : (team?.name ?? useCase.theme)}
                      </span>
                      <span
                        className={`rounded border px-1 py-0.5 text-[.58rem] ${statusTone(useCase.status)}`}
                      >
                        {USE_CASE_STATUS_LABEL[useCase.status]}
                      </span>
                    </div>
                  </div>
                  {roadmapYears.map(year => {
                    const milestones = data.milestones.filter(
                      item =>
                        item.useCaseId === useCase.id &&
                        item.planningYear === year
                    ) as Milestone[];
                    const inRange =
                      year >= useCase.startYear && year <= useCase.endYear;
                    return (
                      <div
                        key={year}
                        className={`group min-h-[105px] border-l border-white/[.06] p-2.5 ${inRange ? "bg-cyan-300/[.015]" : ""}`}
                      >
                        {milestones.map(milestone => {
                          const sourceCapability = milestone.sourceCapabilityId
                            ? data.capabilities.find(
                                capability =>
                                  capability.id === milestone.sourceCapabilityId
                              )
                            : undefined;
                          const sourceIsMapped = sourceCapability
                            ? (
                                kpiCoverage.idsByCapability[
                                  sourceCapability.id
                                ] ?? []
                              ).length > 0
                            : false;
                          return (
                            <article
                              key={milestone.id}
                              className={`relative mb-1.5 rounded-lg border px-2 py-1.5 ${phaseTone[milestone.phase]}`}
                            >
                              <div className="flex items-center gap-1.5">
                                <Flag className="h-2.5 w-2.5 shrink-0" />
                                <p className="mono text-[.57rem] uppercase tracking-[.07em]">
                                  {milestone.phase}
                                </p>
                                {canEdit && (
                                  <div className="ml-auto flex gap-0.5">
                                    <button
                                      onClick={() => {
                                        setSaveError(null);
                                        setEditor({
                                          record: milestone,
                                          useCaseId: milestone.useCaseId,
                                          planningYear: milestone.planningYear,
                                        });
                                      }}
                                      aria-label={`Edit ${milestone.title}`}
                                      className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
                                    >
                                      <Edit3 className="h-2.5 w-2.5" />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            `Delete “${milestone.title}”?`
                                          )
                                        )
                                          deleteMilestone.mutate({
                                            id: milestone.id,
                                          });
                                      }}
                                      aria-label={`Delete ${milestone.title}`}
                                      className="rounded p-0.5 opacity-70 hover:bg-white/10 hover:opacity-100"
                                    >
                                      <Trash2 className="h-2.5 w-2.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              <p className="mt-1 text-[.65rem] leading-snug">
                                {milestone.title}
                              </p>
                              {sourceCapability && (
                                <p
                                  className={`mt-1 text-[.56rem] font-semibold uppercase tracking-[.06em] ${sourceIsMapped ? "text-emerald-100" : "text-amber-100"}`}
                                >
                                  {sourceIsMapped
                                    ? "KPI mapped"
                                    : "KPI required"}
                                </p>
                              )}
                              {milestone.status === "complete" && (
                                <CheckCircle2 className="mt-1.5 h-3 w-3 opacity-80" />
                              )}
                            </article>
                          );
                        })}
                        {canEdit && inRange && (
                          <button
                            onClick={() => openCreate(useCase.id, year)}
                            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-white/10 px-1.5 py-1 text-[.6rem] text-slate-500 opacity-0 transition hover:border-cyan-200/30 hover:bg-cyan-300/[.05] hover:text-cyan-100 group-hover:opacity-100 focus:opacity-100"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            Milestone
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <div className="mt-5">
        <InsightNote>
          <strong className="font-semibold text-cyan-100">
            Portfolio signal:
          </strong>{" "}
          2027–2028 is the principal foundation-and-scale window, concentrating
          the platform work needed to unlock differentiated 5G, cloud-native
          modernization, autonomous operations, and enterprise edge services.
        </InsightNote>
      </div>
      <MilestoneEditor
        editor={editor}
        useCases={editableUseCases}
        busy={pending}
        error={saveError}
        onOpenChange={open => !open && setEditor(null)}
        onSubmit={submit}
        planningYears={roadmapYears}
      />
    </div>
  );
}

function MilestoneEditor({
  editor,
  useCases,
  busy,
  error,
  onOpenChange,
  onSubmit,
  planningYears,
}: {
  editor: Editor;
  useCases: Array<{ id: number; name: string }>;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  planningYears: readonly number[];
}) {
  const record = editor?.record;
  return (
    <Dialog open={editor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#17233a] text-slate-100 sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle className="serif-title text-2xl">
            {record ? "Edit milestone" : "Add delivery milestone"}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Define the outcome, delivery phase, year, and execution status for a
            Strategic Objective.
          </DialogDescription>
        </DialogHeader>
        {editor && (
          <form onSubmit={onSubmit} className="mt-2 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Strategic Objective">
                <select
                  name="useCaseId"
                  defaultValue={record?.useCaseId ?? editor.useCaseId}
                  className={selectClass}
                >
                  {useCases.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Delivery year">
                <select
                  name="planningYear"
                  defaultValue={record?.planningYear ?? editor.planningYear}
                  className={selectClass}
                >
                  {planningYears.map(year => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Milestone">
              <input
                required
                minLength={2}
                maxLength={180}
                name="title"
                defaultValue={record?.title}
                placeholder="e.g. Closed-loop remediation pilot"
                className={inputClass}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Delivery phase">
                <select
                  name="phase"
                  defaultValue={record?.phase ?? "foundation"}
                  className={selectClass}
                >
                  <option value="discover">Discover</option>
                  <option value="foundation">Foundation</option>
                  <option value="scale">Scale</option>
                  <option value="optimize">Optimize</option>
                  <option value="run">Run</option>
                </select>
              </Field>
              <Field label="Status">
                <select
                  name="status"
                  defaultValue={record?.status ?? "planned"}
                  className={selectClass}
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In progress</option>
                  <option value="complete">Complete</option>
                </select>
              </Field>
            </div>
            {error && (
              <p
                role="alert"
                className="rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-relaxed text-rose-100"
              >
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-cyan-200 px-4 text-slate-950 hover:bg-cyan-100"
              >
                {busy
                  ? "Saving…"
                  : record
                    ? "Save milestone"
                    : "Create milestone"}
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-300">
        {label}
      </span>
      {children}
    </label>
  );
}
const inputClass =
  "h-10 w-full rounded-xl border border-white/10 bg-white/[.05] px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-200/45";
const selectClass =
  "h-10 w-full rounded-xl border border-white/10 bg-[#1b2943] px-3 text-sm text-slate-100 outline-none focus:border-cyan-200/45";
function Metric({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof CalendarRange;
  value: number;
  label: string;
  tone: string;
}) {
  return (
    <article className="glass-card rounded-2xl p-5">
      <Icon className={`h-4 w-4 ${tone}`} />
      <p className="metric-value mt-4 text-3xl text-white">{value}</p>
      <p className="mt-2 text-xs text-slate-400">{label}</p>
    </article>
  );
}
