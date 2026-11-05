import { ArrowUpRight, Sparkles } from "lucide-react";
import { ReactNode } from "react";

export default function PortfolioPageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-cyan-200" /><p className="eyebrow">{eyebrow}</p></div><h1 className="serif-title mt-2 text-3xl text-white sm:text-[2.45rem]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">{description}</p></div>{action && <div className="shrink-0">{action}</div>}</header>;
}

export function InsightNote({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-3 rounded-2xl border border-cyan-200/10 bg-cyan-300/[.055] px-4 py-3 text-xs leading-relaxed text-slate-300"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-cyan-300/15 text-cyan-200"><ArrowUpRight className="h-3 w-3" /></span><span>{children}</span></div>;
}
