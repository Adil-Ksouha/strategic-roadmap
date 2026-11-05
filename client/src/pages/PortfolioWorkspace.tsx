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
  statusTone,
  usePortfolioSnapshot,
  USE_CASE_STATUS_LABEL,
} from "@/lib/portfolio";
import { trpc } from "@/lib/trpc";
import {
  Boxes,
  CheckCircle2,
  Edit3,
  Layers3,
  Plus,
  Trash2,
} from "lucide-react";
import { FormEvent, ReactNode, useState } from "react";
import { toast } from "sonner";

type View = "capabilities" | "useCases";
type CapabilityRecord = {
  id: number;
  name: string;
  domain: string;
  description: string;
  owner: string;
  maturity: "emerging" | "evolving" | "established";
  criticality: "critical" | "high" | "medium" | "low";
  targetYear: number;
  teamId: number;
};
type UseCaseRecord = {
  id: number;
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
type KpiDefinition = {
  id: number;
  code: string;
  name: string;
  strategicPillar: string;
  theme: string;
  unit: string;
};
type KpiEditor = KpiDefinition | "new" | null;
type Editor =
  | { kind: "capability"; record?: CapabilityRecord }
  | { kind: "useCase"; record?: UseCaseRecord }
  | null;

const tabs: Array<{ id: View; label: string; icon: typeof Boxes }> = [
  { id: "capabilities", label: "Capabilities", icon: Boxes },
  { id: "useCases", label: "Strategic Objectives", icon: Layers3 },
];

export default function PortfolioWorkspace() {
  const { data, isLoading } = usePortfolioSnapshot();
  const { isAuthenticated } = useAuth();
  const { data: access } = trpc.portfolio.access.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>("capabilities");
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
  const [editor, setEditor] = useState<Editor>(null);
  const [kpiEditor, setKpiEditor] = useState<CapabilityRecord | null>(null);
  const [selectedKpiIds, setSelectedKpiIds] = useState<number[]>([]);
  const [kpiCatalogOpen, setKpiCatalogOpen] = useState(false);
  const [kpiDefinitionEditor, setKpiDefinitionEditor] =
    useState<KpiEditor>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const invalidate = async () => {
    await utils.portfolio.snapshot.invalidate();
    setSaveError(null);
    setEditor(null);
  };
  const reportMutationError = (error: unknown) => {
    const detail =
      error instanceof Error && error.message
        ? error.message
        : "Strategic Roadmap could not save this record. Please try again.";
    setSaveError(detail);
    toast.error("Portfolio update not saved", { description: detail });
  };
  const refresh = () => void utils.portfolio.snapshot.invalidate();
  const addCapability = trpc.portfolio.addCapability.useMutation({
    onSuccess: invalidate,
    onError: reportMutationError,
  });
  const updateCapability = trpc.portfolio.updateCapability.useMutation({
    onSuccess: invalidate,
    onError: reportMutationError,
  });
  const deleteCapability = trpc.portfolio.deleteCapability.useMutation({
    onSuccess: refresh,
    onError: reportMutationError,
  });
  const addUseCase = trpc.portfolio.addUseCase.useMutation({
    onSuccess: invalidate,
    onError: reportMutationError,
  });
  const updateUseCase = trpc.portfolio.updateUseCase.useMutation({
    onSuccess: invalidate,
    onError: reportMutationError,
  });
  const deleteUseCase = trpc.portfolio.deleteUseCase.useMutation({
    onSuccess: refresh,
    onError: reportMutationError,
  });
  const setCapabilityKpis = trpc.portfolio.setCapabilityKpis.useMutation({
    onSuccess: async result => {
      await utils.portfolio.snapshot.invalidate();
      setKpiEditor(null);
      toast.success("KPI coverage updated", {
        description: `${result.mappedCount} KPI${result.mappedCount === 1 ? "" : "s"} mapped to this capability.`,
      });
    },
    onError: reportMutationError,
  });
  const completeKpiCatalogueUpdate = async () => {
    await utils.portfolio.snapshot.invalidate();
    setKpiDefinitionEditor(null);
    toast.success("KPI catalogue updated");
  };
  const createKpiDefinition = trpc.portfolio.createKpiDefinition.useMutation({
    onSuccess: completeKpiCatalogueUpdate,
    onError: reportMutationError,
  });
  const updateKpiDefinition = trpc.portfolio.updateKpiDefinition.useMutation({
    onSuccess: completeKpiCatalogueUpdate,
    onError: reportMutationError,
  });
  const deleteKpiDefinition = trpc.portfolio.deleteKpiDefinition.useMutation({
    onSuccess: completeKpiCatalogueUpdate,
    onError: reportMutationError,
  });

  if (isLoading || !data)
    return (
      <div className="grid min-h-[65vh] place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200" />
      </div>
    );
  const openCreate = () =>
    setEditor(
      view === "capabilities" ? { kind: "capability" } : { kind: "useCase" }
    );
  const actionLabel =
    view === "capabilities" ? "Add capability" : "Add Strategic Objective";
  const pending =
    addCapability.isPending ||
    updateCapability.isPending ||
    addUseCase.isPending ||
    updateUseCase.isPending;
  const confirmDelete = (label: string, action: () => void) => {
    if (window.confirm(`Delete “${label}”? This action cannot be undone.`))
      action();
  };
  const openKpiMapping = (record: CapabilityRecord) => {
    setSelectedKpiIds(
      data.capabilityKpis
        .filter(mapping => mapping.capabilityId === record.id)
        .map(mapping => mapping.kpiId)
    );
    setKpiEditor(record);
  };
  const submitKpiDefinition = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!kpiDefinitionEditor) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      code: String(form.get("code")),
      name: String(form.get("name")),
      strategicPillar: String(form.get("strategicPillar")),
      theme: String(form.get("theme")),
      unit: String(form.get("unit")),
    };
    kpiDefinitionEditor === "new"
      ? createKpiDefinition.mutate(payload)
      : updateKpiDefinition.mutate({ id: kpiDefinitionEditor.id, ...payload });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    const form = new FormData(event.currentTarget);
    if (!editor) return;
    if (editor.kind === "capability") {
      const payload = {
        name: String(form.get("name")),
        domain: String(form.get("domain")),
        description: String(form.get("description")),
        owner: String(form.get("owner")),
        maturity: String(form.get("maturity")) as CapabilityRecord["maturity"],
        criticality: String(
          form.get("criticality")
        ) as CapabilityRecord["criticality"],
        targetYear: Number(form.get("targetYear")),
        teamId: Number(form.get("teamId")),
      };
      editor.record
        ? updateCapability.mutate({ id: editor.record.id, ...payload })
        : addCapability.mutate(payload);
    }
    if (editor.kind === "useCase") {
      const scope: UseCaseRecord["scope"] =
        access?.isExecutive && form.get("scope") === "shared"
          ? "shared"
          : "team";
      const payload = {
        name: String(form.get("name")),
        theme: String(form.get("theme")),
        description: String(form.get("description")),
        outcome: String(form.get("outcome")),
        sponsor: String(form.get("sponsor")),
        status: String(form.get("status")) as UseCaseRecord["status"],
        priority: String(form.get("priority")) as UseCaseRecord["priority"],
        startYear: Number(form.get("startYear")),
        endYear: Number(form.get("endYear")),
        teamId: scope === "shared" ? null : Number(form.get("teamId")),
        scope,
      };
      editor.record
        ? updateUseCase.mutate({ id: editor.record.id, ...payload })
        : addUseCase.mutate(payload);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      <PortfolioPageHeader
        eyebrow="Portfolio catalog"
        title="Architecture commitments, in one place."
        description="Maintain the reusable capabilities and Strategic Objectives that make the portfolio investable and executable."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={openCreate}
              disabled={
                !isAuthenticated ||
                (!access?.isExecutive && !access?.memberships.length)
              }
              className="h-10 rounded-xl bg-cyan-200 px-4 font-semibold text-slate-950 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Plus className="mr-2 h-4 w-4" />
              {isAuthenticated ? actionLabel : "Sign in to edit"}
            </Button>
          </div>
        }
      />
      <KpiLibrarySection
        kpis={data.kpis as KpiDefinition[]}
        isExecutive={Boolean(access?.isExecutive)}
        onAdd={() => {
          setKpiDefinitionEditor("new");
          setKpiCatalogOpen(true);
        }}
        onManage={() => {
          setKpiDefinitionEditor(null);
          setKpiCatalogOpen(true);
        }}
      />
      <div className="mb-5 mt-5 flex flex-col gap-3 rounded-2xl border border-white/[.08] bg-white/[.025] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Team scope</p>
          <p className="mt-1 text-xs text-slate-400">
            Filter the portfolio by engineering ownership. Cross-team
            architecture relationships remain visible.
          </p>
        </div>
        <select
          aria-label="Filter portfolio by team"
          value={teamFilter}
          onChange={event =>
            setTeamFilter(
              event.target.value === "all" ? "all" : Number(event.target.value)
            )
          }
          className={`${selectClass} w-full sm:w-[245px]`}
        >
          <option value="all">Enterprise portfolio</option>
          {data.teams.map(team => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div className="glass-card rounded-2xl p-1.5">
        <div className="flex overflow-x-auto soft-scroll">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`flex h-10 min-w-fit flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm transition ${view === tab.id ? "bg-white/[.1] text-cyan-100 shadow-sm" : "text-slate-400 hover:bg-white/[.045] hover:text-slate-200"}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              <span className="mono ml-1 text-[.65rem] opacity-65">
                {tab.id === "capabilities"
                  ? data.capabilities.length
                  : data.useCases.length}
              </span>
            </button>
          ))}
        </div>
      </div>
      {!isAuthenticated && (
        <div className="mt-5">
          <InsightNote>
            Portfolio data is available for review.{" "}
            <strong className="font-semibold text-cyan-100">Sign in</strong> to
            add, edit, remove, and govern capabilities and Strategic Objectives.
          </InsightNote>
        </div>
      )}
      {view === "capabilities" && (
        <section className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.capabilities.filter(
            record => teamFilter === "all" || record.teamId === teamFilter
          ).length ? (
            data.capabilities
              .filter(
                record => teamFilter === "all" || record.teamId === teamFilter
              )
              .map((record, index) => {
                const linked = data.relationships.filter(
                  link => link.capabilityId === record.id
                ).length;
                const mappedKpiIds = data.capabilityKpis
                  .filter(mapping => mapping.capabilityId === record.id)
                  .map(mapping => mapping.kpiId);
                const team = data.teams.find(item => item.id === record.teamId);
                const canEdit = Boolean(
                  access?.isExecutive ||
                    access?.memberships.some(
                      item => item.teamId === record.teamId
                    )
                );
                return (
                  <article
                    key={record.id}
                    className={`glass-card reveal rounded-2xl p-5 ${index % 3 === 1 ? "reveal-delay-1" : index % 3 === 2 ? "reveal-delay-2" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="eyebrow">{team?.name ?? record.domain}</p>
                        <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-100">
                          {record.name}
                        </h2>
                      </div>
                      <RecordActions
                        enabled={canEdit}
                        onEdit={() => setEditor({ kind: "capability", record })}
                        onDelete={() =>
                          confirmDelete(record.name, () =>
                            deleteCapability.mutate({ id: record.id })
                          )
                        }
                      />
                    </div>
                    <p className="mt-3 min-h-[3rem] text-xs leading-relaxed text-slate-400">
                      {record.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      <Pill label={record.maturity} />
                      <Pill label={record.criticality} />
                      <span className="rounded-md bg-white/[.055] px-2 py-1 text-[.62rem] text-slate-400">
                        {record.domain}
                      </span>
                      <span
                        className={`rounded-md border px-2 py-1 text-[.62rem] font-medium ${mappedKpiIds.length ? "border-emerald-200/20 bg-emerald-300/10 text-emerald-100" : "border-amber-200/25 bg-amber-300/10 text-amber-100"}`}
                      >
                        {mappedKpiIds.length
                          ? `${mappedKpiIds.length} KPI${mappedKpiIds.length === 1 ? "" : "s"} mapped`
                          : "KPI mapping required"}
                      </span>
                    </div>
                    <div className="mt-5 flex items-center justify-between border-t border-white/[.08] pt-4">
                      <Info value={String(record.targetYear)} label="Target" />
                      <Info
                        value={`${linked} Strategic Objective${linked === 1 ? "" : "s"}`}
                        label="Enables"
                        align="right"
                      />
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openKpiMapping(record)}
                        className="mt-4 w-full rounded-xl border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 focus:outline-none focus:ring-2 focus:ring-cyan-200/50"
                      >
                        {mappedKpiIds.length
                          ? "Review KPI mappings"
                          : "Map KPIs"}
                      </button>
                    )}
                  </article>
                );
              })
          ) : (
            <EmptyState
              title="No capabilities in this team"
              detail="Choose another team scope or create the first enabling capability for this domain."
              action={
                isAuthenticated
                  ? () => setEditor({ kind: "capability" })
                  : undefined
              }
            />
          )}
        </section>
      )}
      {view === "useCases" && (
        <section className="mt-5 grid gap-4 lg:grid-cols-2">
          {data.useCases.filter(
            record =>
              teamFilter === "all" ||
              record.scope === "shared" ||
              record.teamId === teamFilter
          ).length ? (
            data.useCases
              .filter(
                record =>
                  teamFilter === "all" ||
                  record.scope === "shared" ||
                  record.teamId === teamFilter
              )
              .map((record, index) => {
                const names = data.relationships
                  .filter(link => link.useCaseId === record.id)
                  .map(
                    link =>
                      data.capabilities.find(
                        capability => capability.id === link.capabilityId
                      )?.name
                  )
                  .filter(Boolean);
                const team = data.teams.find(item => item.id === record.teamId);
                const isShared = record.scope === "shared";
                const canEdit = Boolean(
                  access?.isExecutive ||
                    (!isShared &&
                      access?.memberships.some(
                        item => item.teamId === record.teamId
                      ))
                );
                return (
                  <article
                    key={record.id}
                    className={`glass-card reveal rounded-2xl p-5 ${index % 2 ? "reveal-delay-1" : ""}`}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${record.priority === "p1" ? "border-cyan-200/25 bg-cyan-300/10 text-cyan-200" : "border-white/10 bg-white/[.035] text-slate-300"}`}
                      >
                        <span className="mono text-xs font-medium uppercase">
                          {record.priority}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold tracking-tight text-slate-100">
                            {record.name}
                          </h2>
                          <span
                            className={`rounded-md border px-1.5 py-0.5 text-[.62rem] font-medium ${statusTone(record.status)}`}
                          >
                            {USE_CASE_STATUS_LABEL[record.status]}
                          </span>
                          {isShared && (
                            <span className="rounded-md border border-violet-200/25 bg-violet-300/10 px-1.5 py-0.5 text-[.62rem] font-medium text-violet-100">
                              Shared · administrator managed
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-cyan-100/75">
                          {isShared
                            ? "Cross-department Strategic Objective"
                            : (team?.name ?? record.theme)}{" "}
                          · {record.startYear}–{record.endYear}
                        </p>
                      </div>
                      <RecordActions
                        enabled={canEdit}
                        onEdit={() => setEditor({ kind: "useCase", record })}
                        onDelete={() =>
                          confirmDelete(record.name, () =>
                            deleteUseCase.mutate({ id: record.id })
                          )
                        }
                      />
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-slate-300">
                      {record.outcome}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      {record.description}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-1.5 border-t border-white/[.08] pt-4">
                      {names.length ? (
                        names.map(name => (
                          <span
                            key={String(name)}
                            className="rounded-md bg-white/[.055] px-2 py-1 text-[.63rem] text-slate-300"
                          >
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">
                          No enabling capability assigned
                        </span>
                      )}
                    </div>
                  </article>
                );
              })
          ) : (
            <EmptyState
              title="No Strategic Objectives in this team"
              detail="Choose another team scope or create a Strategic Objective for this domain."
              action={
                isAuthenticated
                  ? () => setEditor({ kind: "useCase" })
                  : undefined
              }
            />
          )}
        </section>
      )}
      <PortfolioEditor
        editor={editor}
        teams={data.teams}
        isExecutive={Boolean(access?.isExecutive)}
        onOpenChange={open => !open && setEditor(null)}
        onSubmit={submit}
        busy={pending}
        saveError={saveError}
      />
      <KpiMappingDialog
        capability={kpiEditor}
        kpis={data.kpis as KpiDefinition[]}
        selectedKpiIds={selectedKpiIds}
        onSelectedKpiIdsChange={setSelectedKpiIds}
        onOpenChange={open => !open && setKpiEditor(null)}
        onSave={() =>
          kpiEditor &&
          setCapabilityKpis.mutate({
            capabilityId: kpiEditor.id,
            kpiIds: selectedKpiIds,
          })
        }
        busy={setCapabilityKpis.isPending}
      />
      <KpiCatalogueDialog
        open={kpiCatalogOpen}
        kpis={data.kpis as KpiDefinition[]}
        editor={kpiDefinitionEditor}
        onOpenChange={setKpiCatalogOpen}
        onEditorChange={setKpiDefinitionEditor}
        onSubmit={submitKpiDefinition}
        onDelete={id => {
          if (
            window.confirm(
              "Retire this KPI? Existing capability mappings to it will also be removed."
            )
          )
            deleteKpiDefinition.mutate({ id });
        }}
        busy={
          createKpiDefinition.isPending ||
          updateKpiDefinition.isPending ||
          deleteKpiDefinition.isPending
        }
      />
    </div>
  );
}

function KpiMappingDialog({
  capability,
  kpis,
  selectedKpiIds,
  onSelectedKpiIdsChange,
  onOpenChange,
  onSave,
  busy,
}: {
  capability: CapabilityRecord | null;
  kpis: KpiDefinition[];
  selectedKpiIds: number[];
  onSelectedKpiIdsChange: (ids: number[]) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const groups = kpis.reduce<Record<string, KpiDefinition[]>>((result, kpi) => {
    const key = `${kpi.strategicPillar}|||${kpi.theme}`;
    result[key] = [...(result[key] ?? []), kpi];
    return result;
  }, {});
  const toggle = (id: number) =>
    onSelectedKpiIdsChange(
      selectedKpiIds.includes(id)
        ? selectedKpiIds.filter(selectedId => selectedId !== id)
        : [...selectedKpiIds, id]
    );
  return (
    <Dialog open={capability !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#17233a] text-slate-100 sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="serif-title text-2xl">
            Map KPI coverage
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Select one or more catalogue KPIs for{" "}
            <strong className="text-slate-200">{capability?.name}</strong>.
            Saving with no selections deliberately marks the capability as
            uncovered.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs">
          <span className="text-slate-400">Selected KPI measures</span>
          <span className="mono font-semibold text-cyan-100">
            {selectedKpiIds.length}
          </span>
        </div>
        <div className="mt-3 space-y-4">
          {Object.entries(groups).map(([key, group]) => {
            const [pillar, theme] = key.split("|||");
            return (
              <section
                key={key}
                className="rounded-xl border border-white/[.09] p-3"
              >
                <p className="eyebrow">{pillar}</p>
                <h3 className="mt-1 text-sm font-semibold text-slate-200">
                  {theme}
                </h3>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {group.map(kpi => {
                    const checked = selectedKpiIds.includes(kpi.id);
                    return (
                      <label
                        key={kpi.id}
                        className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 text-xs transition ${checked ? "border-cyan-200/35 bg-cyan-300/10 text-cyan-50" : "border-white/[.08] bg-white/[.02] text-slate-300 hover:bg-white/[.05]"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(kpi.id)}
                          className="mt-0.5 h-4 w-4 accent-cyan-300"
                        />
                        <span className="min-w-0">
                          <strong className="font-semibold text-cyan-100">
                            {kpi.code}
                          </strong>
                          <span className="ml-1.5">{kpi.name}</span>
                          <span className="mt-1 block text-[.65rem] text-slate-500">
                            {kpi.unit}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="rounded-xl bg-cyan-200 px-4 text-slate-950 hover:bg-cyan-100"
          >
            {busy ? "Saving…" : "Save KPI mappings"}
            <CheckCircle2 className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KpiLibrarySection({
  kpis,
  isExecutive,
  onAdd,
  onManage,
}: {
  kpis: KpiDefinition[];
  isExecutive: boolean;
  onAdd: () => void;
  onManage: () => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const results = kpis.filter(kpi =>
    [kpi.code, kpi.name, kpi.strategicPillar, kpi.theme, kpi.unit]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch)
  );
  return (
    <section
      aria-labelledby="kpi-library-title"
      className="mt-5 overflow-hidden rounded-2xl border border-violet-200/15 bg-gradient-to-br from-violet-400/[.10] via-white/[.025] to-cyan-300/[.06]"
    >
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow text-violet-200">Enterprise KPI library</p>
          <h2
            id="kpi-library-title"
            className="serif-title mt-2 text-2xl text-slate-100"
          >
            Find measures before mapping capabilities.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Search the approved KPI catalogue by code, measure, strategic
            pillar, theme, or unit. Each capability can be mapped to one or more
            measures.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-cyan-200/15 bg-cyan-300/[.08] px-3 py-2 mono text-xs text-cyan-100">
            {kpis.length} measures
          </span>
          {isExecutive && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onManage}
                className="rounded-xl border-violet-200/35 bg-violet-300/10 text-violet-100 hover:bg-violet-300/20 hover:text-white"
              >
                Manage catalogue
              </Button>
              <Button
                type="button"
                onClick={onAdd}
                className="rounded-xl bg-cyan-200 text-slate-950 hover:bg-cyan-100"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add KPI
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="border-t border-white/[.08] bg-slate-950/15 p-4">
        <label className="sr-only" htmlFor="kpi-library-search">
          Search the KPI library
        </label>
        <input
          id="kpi-library-search"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search KPI code, measure, pillar, theme, or unit…"
          className={`${inputClass} h-10`}
        />
        <div className="mt-3 grid max-h-60 gap-2 overflow-y-auto pr-1 soft-scroll sm:grid-cols-2 xl:grid-cols-3">
          {results.map(kpi => (
            <article
              key={kpi.id}
              className="rounded-xl border border-white/[.08] bg-slate-950/35 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="mono text-xs font-semibold text-cyan-100">
                  {kpi.code}
                </span>
                <span className="shrink-0 rounded-md bg-white/[.055] px-2 py-1 text-[.6rem] text-slate-400">
                  {kpi.unit}
                </span>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-200">
                {kpi.name}
              </h3>
              <p className="mt-1 truncate text-xs text-slate-400">
                {kpi.theme}
              </p>
              <p className="mt-1 truncate text-[.63rem] uppercase tracking-[.06em] text-violet-200/80">
                {kpi.strategicPillar}
              </p>
            </article>
          ))}
          {!results.length && (
            <div className="col-span-full rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-400">
              No KPI measures match this search.
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Showing {results.length} of {kpis.length} measures.
          {!isExecutive &&
            " KPI catalogue changes are restricted to administrators."}
        </p>
      </div>
    </section>
  );
}

function KpiCatalogueDialog({
  open,
  kpis,
  editor,
  onOpenChange,
  onEditorChange,
  onSubmit,
  onDelete,
  busy,
}: {
  open: boolean;
  kpis: KpiDefinition[];
  editor: KpiEditor;
  onOpenChange: (open: boolean) => void;
  onEditorChange: (editor: KpiEditor) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: number) => void;
  busy: boolean;
}) {
  const close = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) onEditorChange(null);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#17233a] text-slate-100 sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle className="serif-title text-2xl">
            {editor
              ? editor === "new"
                ? "Add KPI measure"
                : "Edit KPI measure"
              : "KPI catalogue"}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Administrators govern the enterprise KPI library. Retiring a measure
            removes only its capability mappings; it does not remove
            capabilities or Strategic Objectives.
          </DialogDescription>
        </DialogHeader>
        {editor ? (
          <form onSubmit={onSubmit} className="mt-2 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[.55fr_1.45fr]">
              <Field label="KPI code">
                <input
                  required
                  name="code"
                  maxLength={32}
                  defaultValue={editor === "new" ? "" : editor.code}
                  className={inputClass}
                />
              </Field>
              <Field label="KPI measure">
                <input
                  required
                  name="name"
                  maxLength={240}
                  defaultValue={editor === "new" ? "" : editor.name}
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Strategic pillar">
                <input
                  required
                  name="strategicPillar"
                  maxLength={140}
                  defaultValue={editor === "new" ? "" : editor.strategicPillar}
                  className={inputClass}
                />
              </Field>
              <Field label="Theme">
                <input
                  required
                  name="theme"
                  maxLength={160}
                  defaultValue={editor === "new" ? "" : editor.theme}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Unit / measurement">
              <input
                required
                name="unit"
                maxLength={40}
                placeholder="%, #, MSAR, Milestone"
                defaultValue={editor === "new" ? "" : editor.unit}
                className={inputClass}
              />
            </Field>
            <div className="flex justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onEditorChange(null)}
                className="rounded-xl border-white/15 text-slate-300 hover:bg-white/[.05] hover:text-white"
              >
                Back to catalogue
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-cyan-200 px-4 text-slate-950 hover:bg-cyan-100"
              >
                {busy
                  ? "Saving…"
                  : editor === "new"
                    ? "Add KPI measure"
                    : "Save KPI measure"}
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs">
              <span className="text-slate-400">
                Available enterprise measures
              </span>
              <span className="mono font-semibold text-cyan-100">
                {kpis.length}
              </span>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                onClick={() => onEditorChange("new")}
                className="rounded-xl bg-cyan-200 text-slate-950 hover:bg-cyan-100"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add KPI measure
              </Button>
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-white/[.09]">
              <div className="grid grid-cols-[.6fr_2.2fr_1.4fr_auto] gap-3 border-b border-white/[.08] bg-white/[.035] px-3 py-2 mono text-[.6rem] uppercase tracking-[.08em] text-slate-500">
                <span>Code</span>
                <span>Measure</span>
                <span>Theme</span>
                <span>Actions</span>
              </div>
              <div className="soft-scroll max-h-[45vh] overflow-y-auto">
                {kpis.map(kpi => (
                  <div
                    key={kpi.id}
                    className="grid grid-cols-[.6fr_2.2fr_1.4fr_auto] items-center gap-3 border-b border-white/[.06] px-3 py-2.5 text-xs last:border-b-0"
                  >
                    <span className="mono font-semibold text-cyan-100">
                      {kpi.code}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate font-medium text-slate-200">
                        {kpi.name}
                      </strong>
                      <span className="mt-0.5 block truncate text-[.64rem] text-slate-500">
                        {kpi.strategicPillar} · {kpi.unit}
                      </span>
                    </span>
                    <span className="truncate text-slate-400">{kpi.theme}</span>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => onEditorChange(kpi)}
                        className="rounded-md px-2 py-1 text-[.65rem] font-semibold text-cyan-100 hover:bg-cyan-300/10"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(kpi.id)}
                        disabled={busy}
                        className="rounded-md px-2 py-1 text-[.65rem] font-semibold text-rose-200 hover:bg-rose-300/10 disabled:opacity-40"
                      >
                        Retire
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordActions({
  enabled,
  onEdit,
  onDelete,
}: {
  enabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {enabled && (
        <>
          <button
            onClick={onEdit}
            aria-label="Edit record"
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-white/[.07] hover:text-cyan-100"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete record"
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-rose-300/10 hover:text-rose-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
function Pill({ label }: { label: string }) {
  return (
    <span
      className={`rounded-md border px-2 py-1 text-[.62rem] font-medium ${statusTone(label)}`}
    >
      {label}
    </span>
  );
}
function Info({
  value,
  label,
  align,
}: {
  value: string;
  label: string;
  align?: "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="mono text-[.62rem] text-slate-500">{label.toUpperCase()}</p>
      <p className="mt-1 max-w-[150px] truncate text-xs font-medium text-slate-300">
        {value}
      </p>
    </div>
  );
}
function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: () => void;
}) {
  return (
    <div className="glass-card col-span-full flex min-h-[260px] flex-col items-center justify-center rounded-2xl p-8 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.055] text-cyan-200">
        <Boxes className="h-4 w-4" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-100">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
        {detail}
      </p>
      {action && (
        <Button
          onClick={action}
          className="mt-5 rounded-xl bg-cyan-200 text-slate-950 hover:bg-cyan-100"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create record
        </Button>
      )}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
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

function PortfolioEditor({
  editor,
  teams,
  isExecutive,
  onOpenChange,
  onSubmit,
  busy,
  saveError,
}: {
  editor: Editor;
  teams: Array<{ id: number; name: string }>;
  isExecutive: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  saveError: string | null;
}) {
  const title =
    editor?.kind === "capability"
      ? `${editor.record ? "Edit" : "Add"} strategic capability`
      : `${editor?.record ? "Edit" : "Add"} Strategic Objective`;
  const record = editor?.record;
  return (
    <Dialog open={editor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#17233a] text-slate-100 sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="serif-title text-2xl">{title}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Capture the details that make this record usable in the strategic
            planning portfolio.
          </DialogDescription>
        </DialogHeader>
        {editor && (
          <form className="mt-2 grid gap-4" onSubmit={onSubmit}>
            {editor.kind === "capability" && (
              <CapabilityFields
                record={record as CapabilityRecord | undefined}
                teams={teams}
              />
            )}
            {editor.kind === "useCase" && (
              <UseCaseFields
                record={record as UseCaseRecord | undefined}
                teams={teams}
                isExecutive={isExecutive}
              />
            )}
            {saveError && (
              <p
                role="alert"
                className="rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 py-2 text-xs leading-relaxed text-rose-100"
              >
                {saveError}
              </p>
            )}
            <div className="mt-1 flex justify-end">
              <Button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-cyan-200 px-4 text-slate-950 hover:bg-cyan-100"
              >
                {busy
                  ? "Saving…"
                  : editor.record
                    ? "Save changes"
                    : "Create record"}
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
function TeamField({
  record,
  teams,
}: {
  record?: { teamId: number | null };
  teams: Array<{ id: number; name: string }>;
}) {
  return (
    <Field label="Owning team">
      <select
        name="teamId"
        defaultValue={record?.teamId ?? teams[0]?.id}
        className={selectClass}
      >
        {teams.map(team => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function CapabilityFields({
  record,
  teams,
}: {
  record?: CapabilityRecord;
  teams: Array<{ id: number; name: string }>;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Capability name">
          <input
            required
            minLength={2}
            name="name"
            defaultValue={record?.name}
            className={inputClass}
          />
        </Field>
        <Field label="Domain">
          <input
            required
            minLength={2}
            name="domain"
            defaultValue={record?.domain}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          required
          minLength={10}
          name="description"
          defaultValue={record?.description}
          rows={3}
          className={`${inputClass} h-auto py-2.5`}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Accountable owner">
          <input
            required
            minLength={2}
            name="owner"
            defaultValue={record?.owner}
            className={inputClass}
          />
        </Field>
        <Field label="Target year">
          <input
            required
            name="targetYear"
            type="number"
            min="2020"
            max="2100"
            defaultValue={record?.targetYear ?? 2028}
            className={inputClass}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Enter any calendar year through 2100. Future years are added to both
        roadmaps automatically.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamField record={record} teams={teams} />
        <Field label="Maturity">
          <select
            name="maturity"
            defaultValue={record?.maturity ?? "emerging"}
            className={selectClass}
          >
            <option value="emerging">Emerging</option>
            <option value="evolving">Evolving</option>
            <option value="established">Established</option>
          </select>
        </Field>
      </div>
      <Field label="Criticality">
        <select
          name="criticality"
          defaultValue={record?.criticality ?? "medium"}
          className={selectClass}
        >
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </Field>
    </>
  );
}
function UseCaseFields({
  record,
  teams,
  isExecutive,
}: {
  record?: UseCaseRecord;
  teams: Array<{ id: number; name: string }>;
  isExecutive: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Strategic Objective name">
          <input
            required
            minLength={2}
            name="name"
            defaultValue={record?.name}
            className={inputClass}
          />
        </Field>
        <Field label="Value theme">
          <input
            required
            minLength={2}
            name="theme"
            defaultValue={record?.theme}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Strategic outcome">
        <textarea
          required
          minLength={10}
          name="outcome"
          defaultValue={record?.outcome}
          rows={2}
          className={`${inputClass} h-auto py-2.5`}
        />
      </Field>
      <Field label="Description">
        <textarea
          required
          minLength={10}
          name="description"
          defaultValue={record?.description}
          rows={3}
          className={`${inputClass} h-auto py-2.5`}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sponsor">
          <input
            required
            minLength={2}
            name="sponsor"
            defaultValue={record?.sponsor}
            className={inputClass}
          />
        </Field>
        <Field label="Start">
          <input
            required
            name="startYear"
            type="number"
            min="2020"
            max="2100"
            defaultValue={record?.startYear ?? 2026}
            className={inputClass}
          />
        </Field>
        <Field label="End">
          <input
            required
            name="endYear"
            type="number"
            min="2020"
            max="2100"
            defaultValue={record?.endYear ?? 2029}
            className={inputClass}
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-slate-500">
        Roadmaps automatically extend to the latest planned year, including 2035
        and beyond.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {isExecutive && (
          <Field label="Strategic Objective type">
            <select
              name="scope"
              defaultValue={record?.scope ?? "team"}
              className={selectClass}
            >
              <option value="team">Team-owned</option>
              <option value="shared">
                Shared across departments · administrators only
              </option>
            </select>
          </Field>
        )}
        <TeamField record={record} teams={teams} />
        <Field label="Status">
          <select
            name="status"
            defaultValue={record?.status ?? "planned"}
            className={selectClass}
          >
            <option value="prioritized">Prioritized</option>
            <option value="in_flight">In flight</option>
            <option value="planned">Planned</option>
            <option value="watchlist">Watchlist</option>
          </select>
        </Field>
      </div>
      {isExecutive && (
        <p className="-mt-2 text-xs text-slate-400">
          Shared Strategic Objectives are enterprise-wide and intentionally do
          not have an owning team. Only administrators can add, edit, or remove
          them.
        </p>
      )}
      <Field label="Priority">
        <select
          name="priority"
          defaultValue={record?.priority ?? "p2"}
          className={selectClass}
        >
          <option value="p1">P1</option>
          <option value="p2">P2</option>
          <option value="p3">P3</option>
        </select>
      </Field>
    </>
  );
}
