import { trpc } from "@/lib/trpc";
import { ArrowRight, Boxes, ChartNoAxesCombined, GitFork, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { normalizePrivateCredentialFields } from "./privateCredentials";

const networkArtworkUrl = import.meta.env.VITE_NETWORK_ARTWORK_URL || "https://stratportf-phejj5qh.manus.space/manus-storage/telecom-cloud-network_0d45c2b7.jpg";

export default function SignInScreen({ error }: { error?: Error | null }) {
  const setupRequested = new URLSearchParams(window.location.search).get("setup") === "1";
  const bootstrapStatus = trpc.auth.canBootstrap.useQuery(undefined, { enabled: setupRequested, retry: false });
  const setupMode = setupRequested && bootstrapStatus.data?.enabled === true;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [teamId, setTeamId] = useState("1");
  const login = trpc.auth.login.useMutation({ onSuccess: () => window.location.replace("/"), onError: () => setPassword("") });
  const bootstrap = trpc.auth.bootstrap.useMutation({ onSuccess: () => window.location.replace("/"), onError: () => setBootstrapToken("") });
  const activeMutation = setupMode ? bootstrap : login;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const values = normalizePrivateCredentialFields({
      email: String(fields.get("email") ?? email),
      password: String(fields.get("password") ?? password),
      name: String(fields.get("name") ?? name),
      bootstrapToken: String(fields.get("bootstrapToken") ?? bootstrapToken),
      teamId: String(fields.get("teamId") ?? teamId),
    });
    if (setupMode) bootstrap.mutate({ email: values.email, name: values.name, password: values.password, bootstrapToken: values.bootstrapToken, teamId: Number(values.teamId), teamRole: "lead" });
    else login.mutate({ email: values.email, password: values.password });
  };
  const errorText = activeMutation.error?.message ?? (error ? "We could not verify your session. Please sign in again." : null);

  return <main className="app-canvas relative grid min-h-screen overflow-hidden lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative z-10 flex flex-col justify-between p-6 sm:p-10 lg:p-14">
      <div className="flex items-center gap-3"><span className="stc-wordmark text-[1.55rem]" aria-label="stc">stc</span><div><p className="eyebrow">Strategic planning</p><p className="mt-0.5 text-base font-semibold tracking-tight text-white">Strategic Roadmap</p></div></div>
      <div className="my-14 max-w-xl lg:my-0"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-fuchsia-200" /><p className="eyebrow">Private platform access</p></div><h1 className="serif-title mt-5 text-4xl leading-[1.03] text-white sm:text-5xl lg:text-6xl">{setupMode ? "Create the first platform administrator." : "Sign in to Strategic Roadmap."}</h1><p className="mt-6 max-w-lg text-base leading-relaxed text-slate-400">{setupMode ? "Use the one-time setup token to establish your private executive account. After setup, administrators create each approved user and share their credentials privately." : "Use the private email and password issued to you by a Strategic Roadmap administrator."}</p>
        <form onSubmit={submit} className="mt-8 max-w-md"><div className="grid gap-3">{setupMode && <Field label="Display name"><input name="name" type="text" value={name} onChange={event => setName(event.target.value)} placeholder="Administrator name" required minLength={2} className={inputClass} /></Field>}<Field label="Private email"><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@company.com" required autoComplete="email" className={`${inputClass} pl-10`} /></div></Field><Field label="Password"><div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Your private password" required minLength={setupMode ? 12 : 1} autoComplete={setupMode ? "new-password" : "current-password"} className={`${inputClass} pl-10`} /></div></Field>{setupMode && <><Field label="Executive team"><select name="teamId" value={teamId} onChange={event => setTeamId(event.target.value)} className={inputClass}><option value="1">Core & Cloud</option><option value="2">Mobile Access</option><option value="3">Fixed & Transport</option><option value="4">Application Architecture</option><option value="5">Data Architecture</option></select></Field><Field label="One-time setup token"><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input name="bootstrapToken" type="password" value={bootstrapToken} onChange={event => setBootstrapToken(event.target.value)} placeholder="Provided securely by the platform owner" required className={`${inputClass} pl-10`} /></div></Field></>}</div><button type="submit" disabled={activeMutation.isPending} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-950 shadow-[0_10px_38px_rgba(255,255,255,.16)] transition hover:bg-slate-100 active:scale-[.97] disabled:cursor-wait disabled:opacity-75">{activeMutation.isPending ? "Verifying access…" : setupMode ? "Create administrator account" : "Sign in securely"}<ArrowRight className="h-4 w-4" /></button><p className="mt-3 text-xs leading-relaxed text-slate-500">{setupMode ? "The setup token is accepted once and is never stored in the platform database." : "Your password is verified with a secure hash. Strategic Roadmap never stores your plain-text password."}</p></form>
        {errorText && <p className="mt-4 max-w-lg rounded-lg border border-rose-200/20 bg-rose-300/10 px-3 py-2 text-xs text-rose-100">{errorText}</p>}
        <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-3"><AccessPoint icon={GitFork} label="Traceable relationships" /><AccessPoint icon={ChartNoAxesCombined} label="Five-year investment view" /><AccessPoint icon={ShieldCheck} label="Private account access" /></div>
      </div>
      <p className="mono text-[.64rem] tracking-[.08em] text-slate-600">PRIVATE PLATFORM ACCESS · 2026–2030</p>
    </section>
    <section className="relative hidden overflow-hidden border-l border-white/[.08] lg:block"><img src={networkArtworkUrl} alt="Abstract telecom cloud network" className="absolute inset-0 h-full w-full object-cover opacity-45 mix-blend-screen" /><div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(13,21,38,.96),rgba(13,21,38,.40)),linear-gradient(180deg,rgba(2,8,20,.15),rgba(2,8,20,.84))]" /><div className="absolute inset-x-14 bottom-14 rounded-2xl border border-white/10 bg-slate-950/45 p-6 backdrop-blur-xl"><p className="eyebrow">Private, controlled access</p><p className="serif-title mt-3 text-3xl leading-tight text-white">Architecture clarity for the people you authorize.</p><div className="mt-5 flex items-center gap-4 border-t border-white/10 pt-4"><span className="mono text-xs text-fuchsia-100">PRIVATE ACCOUNTS</span><span className="h-4 w-px bg-white/15" /><span className="mono text-xs text-slate-400">TEAM-SCOPED ACCESS</span></div></div></section>
  </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-300">{label}</span>{children}</label>; }
function AccessPoint({ icon: Icon, label }: { icon: typeof GitFork; label: string }) { return <div className="rounded-xl border border-white/[.08] bg-white/[.035] p-3"><Icon className="h-4 w-4 text-fuchsia-200" /><p className="mt-3 text-xs leading-snug text-slate-300">{label}</p></div>; }
const inputClass = "h-12 w-full rounded-xl border border-white/10 bg-white/[.055] px-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-fuchsia-200/50";
