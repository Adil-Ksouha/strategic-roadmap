import PortfolioPageHeader, { InsightNote } from "@/components/PortfolioPageHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/_core/hooks/useAuth";
import { relationshipFocusView, usePortfolioSnapshot } from "@/lib/portfolio";
import { trpc } from "@/lib/trpc";
import { Check, CheckSquare, GitFork, Link2, MousePointer2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Selection = { kind: "capability" | "useCase"; id: number } | null;

export default function RelationshipMap() {
  const { data, isLoading, isFetching, refetch } = usePortfolioSnapshot();
  const { isAuthenticated } = useAuth();
  const { data: access } = trpc.portfolio.access.useQuery(undefined, { enabled: isAuthenticated });
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<Selection>({ kind: "useCase", id: 1 });
  const [useCaseId, setUseCaseId] = useState("");
  const [capabilityId, setCapabilityId] = useState("");
  const [bulkUseCaseId, setBulkUseCaseId] = useState("");
  const [bulkCapabilityIds, setBulkCapabilityIds] = useState<number[]>([]);
  const [contribution, setContribution] = useState<"anchor" | "enabling" | "supporting">("supporting");
  const [teamFilter, setTeamFilter] = useState<number | "all">("all");
  const [isFocusMode, setIsFocusMode] = useState(false);
  const link = trpc.portfolio.linkCapability.useMutation({
    onSuccess: () => { void utils.portfolio.snapshot.invalidate(); setUseCaseId(""); setCapabilityId(""); toast.success("Connection saved"); },
    onError: error => toast.error("Relationship not saved", { description: error.message }),
  });
  const unlink = trpc.portfolio.unlinkCapability.useMutation({
    onSuccess: () => { void utils.portfolio.snapshot.invalidate(); toast.success("Connection removed"); },
    onError: error => toast.error("Connection not removed", { description: error.message }),
  });
  const bulkLink = trpc.portfolio.bulkLinkCapabilities.useMutation({
    onSuccess: result => {
      void utils.portfolio.snapshot.invalidate();
      setBulkCapabilityIds([]);
      toast.success(`${result.linkedCount} capability connection${result.linkedCount === 1 ? "" : "s"} saved`);
    },
    onError: error => toast.error("Connections not saved", { description: error.message }),
  });

  const domainView = useMemo(() => {
    const allCapabilities = data?.capabilities ?? [];
    const allObjectives = data?.useCases ?? [];
    const allRelationships = data?.relationships ?? [];
    if (teamFilter === "all") return { capabilities: allCapabilities, strategicObjectives: allObjectives, relationships: allRelationships };

    const ownedCapabilityIds = new Set(allCapabilities.filter(item => item.teamId === teamFilter).map(item => item.id));
    const ownedObjectiveIds = new Set(allObjectives.filter(item => item.teamId === teamFilter || item.scope === "shared").map(item => item.id));
    const relationships = allRelationships.filter(item => ownedObjectiveIds.has(item.useCaseId));
    const visibleCapabilityIds = new Set<number>(Array.from(ownedCapabilityIds).concat(relationships.map(item => item.capabilityId)));

    return {
      capabilities: allCapabilities.filter(item => visibleCapabilityIds.has(item.id)),
      strategicObjectives: allObjectives.filter(item => ownedObjectiveIds.has(item.id)),
      relationships,
    };
  }, [data, teamFilter]);
  const graphView = useMemo(() => isFocusMode ? relationshipFocusView({ ...domainView, selected }) : domainView, [domainView, isFocusMode, selected]);
  const capabilities = graphView.capabilities;
  const strategicObjectives = graphView.strategicObjectives;
  const visibleRelationships = graphView.relationships;

  useEffect(() => {
    if (!data) return;
    const selectedIsVisible = selected?.kind === "capability"
      ? domainView.capabilities.some(item => item.id === selected.id)
      : domainView.strategicObjectives.some(item => item.id === selected?.id);
    if (!selectedIsVisible) {
      setIsFocusMode(false);
      const firstObjective = domainView.strategicObjectives[0];
      const firstCapability = domainView.capabilities[0];
      setSelected(firstObjective ? { kind: "useCase", id: firstObjective.id } : firstCapability ? { kind: "capability", id: firstCapability.id } : null);
    }
  }, [data, domainView, selected]);

  if (isLoading || !data) return <div className="grid min-h-[65vh] place-items-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-200/20 border-t-cyan-200" /></div>;
  if (!data.capabilities.length && !data.useCases.length) return <div className="mx-auto max-w-[1500px]"><PortfolioPageHeader eyebrow="Architecture traceability" title="See the architecture behind the ambition." description="Create capabilities and Strategic Objectives in the portfolio catalog before tracing their relationships." /><div className="glass-card grid min-h-[360px] place-items-center rounded-2xl p-8 text-center"><div><GitFork className="mx-auto h-6 w-6 text-cyan-200" /><h2 className="serif-title mt-4 text-2xl text-white">The relationship map is ready for its first connection.</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">Add at least one capability and one Strategic Objective to reveal the architecture links that support your portfolio.</p></div></div></div>;

  const selectedLinks = selected
    ? visibleRelationships.filter(item => selected.kind === "useCase" ? item.useCaseId === selected.id : item.capabilityId === selected.id)
    : [];
  const selectedName = selected?.kind === "useCase"
    ? data.useCases.find(item => item.id === selected.id)?.name
    : data.capabilities.find(item => item.id === selected?.id)?.name;
  const selectedDescription = selected?.kind === "useCase"
    ? data.useCases.find(item => item.id === selected.id)?.outcome
    : data.capabilities.find(item => item.id === selected?.id)?.description;
  const relatedNames = selectedLinks.map(item => selected?.kind === "useCase"
    ? data.capabilities.find(capability => capability.id === item.capabilityId)?.name
    : data.useCases.find(useCase => useCase.id === item.useCaseId)?.name,
  ).filter(Boolean);
  const caps = capabilities;
  const useCases = strategicObjectives;
  const selectedUseCase = strategicObjectives.find(item => item.id === Number(useCaseId));
  const canEditSelectedUseCase = Boolean(access?.isExecutive || (selectedUseCase && access?.memberships.some(item => item.teamId === selectedUseCase.teamId)));
  const selectedRelationship = visibleRelationships.find(item => item.useCaseId === Number(useCaseId) && item.capabilityId === Number(capabilityId));
  const selectedBulkUseCase = strategicObjectives.find(item => item.id === Number(bulkUseCaseId));
  const canEditBulkUseCase = Boolean(access?.isExecutive || (selectedBulkUseCase && access?.memberships.some(item => item.teamId === selectedBulkUseCase.teamId)));
  const toggleBulkCapability = (id: number) => setBulkCapabilityIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const canRemoveRelationship = (relationship: { useCaseId: number }) => {
    const objective = data.useCases.find(item => item.id === relationship.useCaseId);
    return Boolean(access?.isExecutive || (objective && access?.memberships.some(item => item.teamId === objective.teamId)));
  };
  const editRelationship = (relationship: { useCaseId: number; capabilityId: number; contribution: "anchor" | "enabling" | "supporting" }) => {
    setUseCaseId(String(relationship.useCaseId));
    setCapabilityId(String(relationship.capabilityId));
    setContribution(relationship.contribution);
    document.getElementById("connection-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const removeRelationship = (relationship: { useCaseId: number; capabilityId: number }) => {
    if (unlink.isPending || !canRemoveRelationship(relationship)) return;
    if (window.confirm("Remove this capability-to-Strategic Objective connection? This does not delete either portfolio record.")) {
      unlink.mutate(relationship);
    }
  };
  const graphHeight = Math.max(520, 132 + Math.max(caps.length * 70, useCases.length * 82));

  return <div className="mx-auto max-w-[1500px]">
    <PortfolioPageHeader eyebrow="Architecture traceability" title="See the architecture behind the ambition." description="Explore the many-to-many relationships that connect Strategic Objectives to the capabilities that enable them. Select a node to reveal its strategic dependencies." />
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <article className="glass-card overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-white/[.08] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-300/10 text-cyan-200"><GitFork className="h-4 w-4" /></span><div><p className="text-sm font-medium text-slate-100">Capability relationship map</p><p className="mt-0.5 text-xs text-slate-500">{visibleRelationships.length} active strategic connections</p></div></div>
          <div className="flex flex-wrap items-center gap-3"><select aria-label="Filter relationship map by domain" value={teamFilter} onChange={event => { setTeamFilter(event.target.value === "all" ? "all" : Number(event.target.value)); setIsFocusMode(false); }} className="h-8 min-w-[178px] rounded-lg border border-white/10 bg-[#1b2943] px-2.5 text-xs text-white outline-none focus:border-violet-300/60"><option value="all">All domains</option>{data.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select>{isFocusMode && <button type="button" onClick={() => setIsFocusMode(false)} className="h-8 rounded-lg border border-cyan-200/35 bg-cyan-200/10 px-2.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-200/20">Show full map</button>}<button type="button" onClick={() => void refetch()} disabled={isFetching} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:border-violet-300/50 hover:bg-violet-300/10 disabled:opacity-50" aria-label="Refresh relationship map"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /></button><div className="flex gap-3 text-[.65rem] text-slate-400"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-300" />Capability</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-200" />Strategic Objective</span></div></div>
        </div>
        <div className="relationship-map-pane relative overflow-auto bg-[radial-gradient(circle_at_center,rgba(48,108,154,.12),transparent_42%),linear-gradient(rgba(255,255,255,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.025)_1px,transparent_1px)] bg-[size:auto,34px_34px,34px_34px] p-5 soft-scroll">
          <div className="relative mx-auto min-w-[760px] max-w-[1000px]" style={{ minHeight: graphHeight }}>
            <div className="absolute left-2 top-2"><p className="eyebrow text-violet-200/80">Enabling capabilities</p></div>
            <div className="absolute right-2 top-2"><p className="eyebrow text-cyan-100/80">Strategic Objectives</p></div>
            <svg viewBox={`0 0 1000 ${graphHeight}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {visibleRelationships.map(edge => {
                const capIndex = caps.findIndex(cap => cap.id === edge.capabilityId);
                const useCaseIndex = useCases.findIndex(useCase => useCase.id === edge.useCaseId);
                if (capIndex < 0 || useCaseIndex < 0) return null;
                const active = selected && ((selected.kind === "capability" && selected.id === edge.capabilityId) || (selected.kind === "useCase" && selected.id === edge.useCaseId));
                const y1 = 102 + capIndex * 72;
                const y2 = 112 + useCaseIndex * 85;
                return <path key={edge.id} d={`M 275 ${y1} C 430 ${y1}, 575 ${y2}, 725 ${y2}`} fill="none" stroke={active ? "#9ef3f4" : "rgba(148,163,184,.24)"} strokeWidth={active ? 2.3 : 1.1} opacity={selected && !active ? .22 : 1} className="transition-all duration-200" />;
              })}
            </svg>
            <div className="absolute left-3 top-16 grid w-[260px] gap-3">
              {caps.map(capability => {
                const active = selected?.kind === "capability" && selected.id === capability.id;
                return <button key={capability.id} onClick={() => { setSelected({ kind: "capability", id: capability.id }); setIsFocusMode(true); }} className={`relative z-10 min-h-[55px] rounded-xl border p-3 text-left transition ${active ? "border-violet-200/55 bg-violet-300/15 shadow-[0_0_28px_rgba(196,181,253,.12)]" : "border-white/10 bg-[#17233a]/90 hover:border-violet-200/30 hover:bg-white/[.07]"}`}><span className="block text-xs font-semibold text-slate-100">{capability.name}</span><span className="mt-1 block text-[.62rem] text-slate-500">{capability.domain}</span></button>;
              })}
            </div>
            <div className="absolute right-3 top-[74px] grid w-[260px] gap-4">
              {useCases.map(useCase => {
                const active = selected?.kind === "useCase" && selected.id === useCase.id;
                return <button key={useCase.id} onClick={() => { setSelected({ kind: "useCase", id: useCase.id }); setIsFocusMode(true); }} className={`relative z-10 min-h-[64px] rounded-xl border p-3 text-left transition ${active ? "border-cyan-100/55 bg-cyan-300/15 shadow-[0_0_28px_rgba(103,232,249,.11)]" : "border-white/10 bg-[#17233a]/90 hover:border-cyan-100/30 hover:bg-white/[.07]"}`}><span className="block text-xs font-semibold text-slate-100">{useCase.name}</span><span className="mt-1 block text-[.62rem] text-slate-500">{useCase.theme} · {useCase.startYear}–{useCase.endYear}</span></button>;
              })}
            </div>
            {(!caps.length || !useCases.length) && <div className="absolute inset-x-[285px] top-1/2 -translate-y-1/2 rounded-xl border border-dashed border-white/10 bg-[#17233a]/70 p-5 text-center"><p className="text-sm font-medium text-slate-200">No relationship nodes in this domain yet.</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Create both a capability and a Strategic Objective in this domain to begin mapping their dependencies.</p></div>}
          </div>
        </div>
      </article>
      <aside className="glass-card rounded-2xl p-5"><div className="flex items-center gap-2"><MousePointer2 className="h-4 w-4 text-cyan-200" /><p className="eyebrow">Selected node</p></div>{selectedName ? <div className="mt-4"><p className="mono text-[.65rem] uppercase text-slate-500">{selected?.kind === "useCase" ? "Strategic Objective" : "Capability"}</p><h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-100">{selectedName}</h2><p className="mt-2 text-xs leading-relaxed text-slate-400">{selectedDescription}</p><div className="mt-5 border-t border-white/[.08] pt-4"><p className="eyebrow">Connected to</p><div className="mt-3 space-y-2">{selectedLinks.map(relationship => { const relatedName = selected?.kind === "useCase" ? data.capabilities.find(item => item.id === relationship.capabilityId)?.name : data.useCases.find(item => item.id === relationship.useCaseId)?.name; return <div key={relationship.id} className="rounded-lg bg-white/[.04] px-2.5 py-2"><div className="flex items-start gap-2 text-xs text-slate-300"><Link2 className="mt-0.5 h-3 w-3 shrink-0 text-cyan-200" /><span className="min-w-0 flex-1">{relatedName}</span>{isAuthenticated && canRemoveRelationship(relationship) && <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => editRelationship(relationship)} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 transition hover:bg-violet-300/15 hover:text-violet-100" aria-label={`Edit connection with ${relatedName}`}><Pencil className="h-3 w-3" /></button><button type="button" onClick={() => removeRelationship(relationship)} disabled={unlink.isPending} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 transition hover:bg-rose-400/15 hover:text-rose-100 disabled:opacity-50" aria-label={`Remove connection with ${relatedName}`}><Trash2 className="h-3 w-3" /></button></div>}</div><p className="mt-1 pl-5 text-[.62rem] uppercase tracking-[.12em] text-slate-500">{relationship.contribution} contribution</p></div>; })}{relatedNames.length === 0 && <p className="text-xs text-slate-500">No connections assigned.</p>}</div></div></div> : <p className="mt-4 text-sm text-slate-500">Select a node to inspect its relationships.</p>}</aside>
    </section>
    {selectedRelationship && <section id="connection-editor" className="glass-card mt-5 rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><Pencil className="h-4 w-4" /></span><div><p className="eyebrow">Connection details</p><h2 className="serif-title mt-1 text-2xl text-white">Modify the selected connection</h2><p className="mt-1 text-xs text-slate-400">{data.capabilities.find(item => item.id === selectedRelationship.capabilityId)?.name} supports {data.useCases.find(item => item.id === selectedRelationship.useCaseId)?.name}.</p></div></div><div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]"><select value={contribution} onChange={event => setContribution(event.target.value as "anchor" | "enabling" | "supporting")} disabled={!isAuthenticated || !canEditSelectedUseCase} className="h-10 rounded-xl border border-white/10 bg-[#1b2943] px-3 text-sm text-white outline-none disabled:opacity-45"><option value="anchor">Anchor</option><option value="enabling">Enabling</option><option value="supporting">Supporting</option></select><Button disabled={!isAuthenticated || !canEditSelectedUseCase || link.isPending} onClick={() => link.mutate({ useCaseId: selectedRelationship.useCaseId, capabilityId: selectedRelationship.capabilityId, contribution })} className="h-10 rounded-xl bg-cyan-200 text-slate-950 hover:bg-cyan-100"><Check className="mr-2 h-4 w-4" />{link.isPending ? "Saving" : "Save connection"}</Button><button type="button" onClick={() => removeRelationship(selectedRelationship)} disabled={unlink.isPending || !canRemoveRelationship(selectedRelationship)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-300/25 px-3 text-xs font-medium text-rose-200 transition hover:bg-rose-400/10 hover:text-rose-100 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Remove</button></div></section>}
    <section className="glass-card mt-5 rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-300/10 text-violet-100"><CheckSquare className="h-4 w-4" /></span><div><p className="eyebrow">Bulk relationship mapping</p><h2 className="serif-title mt-1 text-2xl text-white">Map several capabilities at once</h2><p className="mt-1 text-xs text-slate-400">Choose one Strategic Objective, select the enabling capabilities, then save every connection in one action.</p></div></div><div className="mt-5 grid gap-3 md:grid-cols-[1fr_.7fr_1fr]"><select value={bulkUseCaseId} onChange={event => setBulkUseCaseId(event.target.value)} disabled={!isAuthenticated} className="h-10 rounded-xl border border-white/10 bg-[#1b2943] px-3 text-sm text-white outline-none disabled:opacity-45"><option value="">Select Strategic Objective</option>{strategicObjectives.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={contribution} onChange={event => setContribution(event.target.value as "anchor" | "enabling" | "supporting")} disabled={!isAuthenticated || Boolean(bulkUseCaseId) && !canEditBulkUseCase} className="h-10 rounded-xl border border-white/10 bg-[#1b2943] px-3 text-sm text-white outline-none disabled:opacity-45"><option value="anchor">Anchor</option><option value="enabling">Enabling</option><option value="supporting">Supporting</option></select><Popover><PopoverTrigger asChild><button type="button" disabled={!isAuthenticated || !bulkUseCaseId || !canEditBulkUseCase} className="flex h-10 items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#1b2943] px-3 text-left text-sm text-slate-100 disabled:opacity-45"><span className="truncate">{bulkCapabilityIds.length ? `${bulkCapabilityIds.length} capabilities selected` : "Select capabilities"}</span><CheckSquare className="h-4 w-4 shrink-0 text-cyan-200" /></button></PopoverTrigger><PopoverContent align="end" className="w-[min(360px,calc(100vw-2rem))] border-white/10 bg-[#131c2e] p-2 text-slate-100"><div className="flex items-center justify-between border-b border-white/[.08] px-2 py-2"><span className="text-xs font-medium">Capabilities</span><button type="button" onClick={() => setBulkCapabilityIds([])} className="text-xs text-cyan-200 hover:text-cyan-100">Clear</button></div><div className="soft-scroll max-h-64 overflow-y-auto pt-1">{capabilities.map(capability => <label key={capability.id} htmlFor={`bulk-capability-${capability.id}`} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs hover:bg-white/[.06]"><Checkbox id={`bulk-capability-${capability.id}`} checked={bulkCapabilityIds.includes(capability.id)} onCheckedChange={() => toggleBulkCapability(capability.id)} className="border-white/25 data-[state=checked]:border-cyan-200 data-[state=checked]:bg-cyan-200 data-[state=checked]:text-slate-950" /><span className="min-w-0 flex-1 truncate">{capability.name}</span></label>)}</div></PopoverContent></Popover></div><div className="mt-4 flex flex-col items-start gap-2 border-t border-white/[.08] pt-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-400">{bulkCapabilityIds.length ? `${bulkCapabilityIds.length} capability connection${bulkCapabilityIds.length === 1 ? " is" : "s are"} ready to save.` : "Select a Strategic Objective and one or more capabilities to enable the save action."}</p><Button disabled={!isAuthenticated || !bulkUseCaseId || !canEditBulkUseCase || !bulkCapabilityIds.length || bulkLink.isPending} onClick={() => bulkLink.mutate({ useCaseId: Number(bulkUseCaseId), capabilityIds: bulkCapabilityIds, contribution })} className="h-10 rounded-xl bg-[#4f1f78] px-5 font-semibold !text-white hover:bg-[#64238f]"><CheckSquare className="mr-2 h-4 w-4" />{bulkLink.isPending ? "Saving connections" : "Save selected capabilities"}</Button></div></section>
    <div className="mt-5"><InsightNote><strong className="font-semibold text-cyan-100">Reading the map:</strong> connections represent how a capability contributes to a Strategic Objective. One capability may create leverage across several Strategic Objectives, while each Strategic Objective can depend on a distinct combination of architectural building blocks.</InsightNote></div>
  </div>;
}
