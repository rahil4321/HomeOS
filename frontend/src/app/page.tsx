"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Decision = "IDLE" | "IGNORE" | "VISUAL_ONLY" | "AUDIO_VISUAL_INTERRUPT";
type HistoryEntry = {
  id: string;
  time: string;
  event: string;
  context: string;
  urgency: number;
  decision: Exclude<Decision, "IDLE">;
  reason: string;
  source: string;
  provenance: string;
};
type HomeOSState = {
  app_name?: string;
  current_state?: string;
  event_title?: string;
  event_desc?: string;
  show_banner?: boolean;
  is_interruption?: boolean;
  decision?: Decision;
  reason?: string;
  urgency_score?: number | null;
  source?: string;
  model_status?: string;
  backend_status?: string;
  events_examined?: number;
  silent_count?: number;
  interrupt_count?: number;
  ignored_count?: number;
  last_updated?: string;
  history?: HistoryEntry[];
};

type Scenario = "delivery" | "urgent" | "trivial" | "meeting" | "offline" | "reset";

const EMPTY_STATE: HomeOSState = {
  decision: "IDLE",
  current_state: "FOCUS",
  reason: "Focus protected. Choose an event to see how HomeOS routes it.",
  history: [],
};


function DecisionPill({ decision }: { decision: Decision }) {
  if (decision === "IDLE") {
    return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Awaiting event</span>;
  }
  const style = decision === "AUDIO_VISUAL_INTERRUPT"
    ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
    : decision === "VISUAL_ONLY"
      ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
      : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  return <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${style}`}>{decision.replaceAll("_", " ")}</span>;
}

function Glyph({ kind, className = "" }: { kind: "shield" | "bell" | "zap" | "eye" | "pulse" | "arrow"; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...common}>
      {kind === "shield" && <><path d="M12 3 20 6v5c0 5-3.5 8.2-8 10-4.5-1.8-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>}
      {kind === "bell" && <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>}
      {kind === "zap" && <path d="m13 2-9 12h7l-1 8 10-13h-7z" />}
      {kind === "eye" && <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>}
      {kind === "pulse" && <><path d="M3 12h4l2-6 4 12 2-6h6" /><circle cx="12" cy="12" r="10" opacity=".25" /></>}
      {kind === "arrow" && <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>}
    </svg>
  );
}

export default function HomeOS() {
  const [uiState, setUiState] = useState<HomeOSState>(EMPTY_STATE);
  const [connected, setConnected] = useState(false);
  const [busyScenario, setBusyScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(45 * 60);
  const [timerRunning, setTimerRunning] = useState(true);
  const [lastAction, setLastAction] = useState("System initialized");

  const refreshState = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok) throw new Error("Backend not reachable");
      const data = (await response.json()) as HomeOSState;
      if (!("error" in data)) {
        setUiState(data);
        setConnected(true);
      } else {
        setConnected(false);
      }
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await refreshState();
      if (!cancelled) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshState]);

  useEffect(() => {
    if (!timerRunning || secondsLeft <= 0) return;
    const tick = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(tick);
  }, [timerRunning, secondsLeft]);

  const displayTime = useMemo(() => {
    const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
    const seconds = (secondsLeft % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [secondsLeft]);

  const triggerScenario = useCallback(async (scenario: Scenario) => {
    setBusyScenario(scenario);
    setError("");
    try {
      const response = await fetch("/api/demo-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      if (scenario === "reset") {
        setSecondsLeft(45 * 60);
        setTimerRunning(true);
        setLastAction("Demo reset · focus protected");
      } else {
        const result = payload.result as { decision?: Decision } | undefined;
        setLastAction(`${scenario.toUpperCase()} scenario · ${result?.decision ?? "routed"}`);
      }
      await refreshState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error while routing event.");
    } finally {
      setBusyScenario(null);
    }
  }, [refreshState]);

  const decision = uiState.decision ?? "IDLE";
  const history = uiState.history ?? [];

  return (
    <main className={`min-h-screen overflow-hidden transition-colors duration-500 ${uiState.is_interruption ? "bg-[#16090e]" : "bg-[#07090d]"}`}>
      <div className="pointer-events-none fixed inset-0 opacity-70" aria-hidden="true">
        <div className="absolute -top-64 left-[15%] h-[34rem] w-[34rem] rounded-full bg-sky-500/[0.06] blur-[130px]" />
        <div className={`absolute right-[-10rem] top-[28rem] h-[28rem] w-[28rem] rounded-full blur-[120px] ${uiState.is_interruption ? "bg-rose-500/10" : "bg-violet-500/[0.06]"}`} />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1540px] flex-col px-4 pb-8 sm:px-7 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/[0.08] py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-300/25 bg-sky-300/10 text-sky-200 shadow-[0_0_24px_rgba(56,189,248,0.09)]">
              <Glyph kind="shield" className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-[0.24em]">HOME<span className="text-sky-300">OS</span></div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-zinc-500">Semantic interruption router</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-zinc-400 md:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              {connected ? "Backend connected" : "Reconnecting"}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${uiState.model_status === "online" ? "bg-emerald-400" : "bg-amber-400"}`} />
              {uiState.model_status === "online" ? "Groq AI online" : "Resilient fallback"}
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)] lg:py-9">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
                  Attention protection active
                </div>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-white sm:text-4xl lg:text-[42px]">Your attention is the priority.</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">HomeOS interprets what happens around you, then decides whether it deserves your attention now, later, or not at all.</p>
              </div>
              <DecisionPill decision={decision} />
            </div>

            <div className={`relative overflow-hidden rounded-[28px] border p-6 sm:p-8 ${uiState.is_interruption ? "border-rose-300/25 bg-rose-950/35" : "border-white/[0.09] bg-[#0d1118]/90"}`}>
              <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-sky-400/[0.05] blur-[80px]" />
              <div className="relative flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Current session</div>
                  <div className="mt-2 flex items-center gap-2 text-sm font-medium text-zinc-200"><span className={`h-2 w-2 rounded-full ${uiState.is_interruption ? "bg-rose-400" : "bg-emerald-400"}`} />{uiState.is_interruption ? "Session interrupted" : "Deep work · focus protected"}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-zinc-500">Session  /  45 min</div>
              </div>

              <div className="relative flex flex-col items-center py-8 sm:py-11">
                <div className={`mb-5 flex h-16 w-16 items-center justify-center rounded-full border ${uiState.is_interruption ? "border-rose-300/50 bg-rose-400/10 text-rose-200 shadow-[0_0_48px_rgba(244,63,94,0.15)]" : "border-sky-300/25 bg-sky-300/[0.07] text-sky-200 shadow-[0_0_48px_rgba(56,189,248,0.08)]"}`}>
                  <Glyph kind={uiState.is_interruption ? "zap" : "eye"} className="h-7 w-7" />
                </div>
                <div className="font-mono text-[clamp(4rem,11vw,7.2rem)] font-medium leading-none tracking-[-0.09em] text-white tabular-nums">{displayTime}</div>
                <div className="mt-4 text-xs tracking-[0.04em] text-zinc-500">{secondsLeft === 0 ? "Session complete" : timerRunning ? "Focus session running" : "Focus session paused"}</div>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button onClick={() => setTimerRunning((running) => !running)} className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-xs font-semibold text-zinc-200 transition hover:border-white/20 hover:bg-white/10">{timerRunning ? "Pause focus" : "Resume focus"}</button>
                  <button onClick={() => { setSecondsLeft(45 * 60); setTimerRunning(true); }} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-zinc-400 transition hover:bg-white/[0.05]">Restart 45:00</button>
                </div>
              </div>

              <div className="relative grid grid-cols-2 gap-2 border-t border-white/[0.08] pt-5 sm:grid-cols-4 sm:gap-3">
                <div className="rounded-xl bg-black/20 p-3 sm:p-4"><div className="text-[9px] uppercase tracking-[0.17em] text-zinc-500">Events evaluated</div><div className="mt-2 text-2xl font-semibold tabular-nums">{uiState.events_examined ?? 0}</div></div>
                <div className="rounded-xl bg-black/20 p-3 sm:p-4"><div className="text-[9px] uppercase tracking-[0.17em] text-zinc-500">Silent surfaces</div><div className="mt-2 text-2xl font-semibold tabular-nums text-sky-200">{uiState.silent_count ?? 0}</div></div>
                <div className="rounded-xl bg-black/20 p-3 sm:p-4"><div className="text-[9px] uppercase tracking-[0.17em] text-zinc-500">Interruptions</div><div className="mt-2 text-2xl font-semibold tabular-nums text-rose-200">{uiState.interrupt_count ?? 0}</div></div>
                <div className="rounded-xl bg-black/20 p-3 sm:p-4"><div className="text-[9px] uppercase tracking-[0.17em] text-zinc-500">Noise filtered</div><div className="mt-2 text-2xl font-semibold tabular-nums text-zinc-300">{uiState.ignored_count ?? 0}</div></div>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-[24px] border border-white/[0.09] bg-[#0d1118]/85 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-300/10 text-sky-200"><Glyph kind="pulse" className="h-5 w-5" /></div>
                  <div><div className="text-sm font-semibold">Latest routing decision</div><div className="mt-1 text-[11px] text-zinc-500">Explainable · policy-constrained</div></div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3"><div className="text-xs uppercase tracking-[0.15em] text-zinc-500">Selected route</div><DecisionPill decision={decision} /></div>
                <p className="mt-4 min-h-[66px] text-sm leading-6 text-zinc-300">{uiState.reason || "Choose a scenario to inspect the routing explanation."}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                  <span className="rounded-md border border-white/10 px-2 py-1">Source: {uiState.source || "—"}</span>
                  {typeof uiState.urgency_score === "number" && <span className="rounded-md border border-white/10 px-2 py-1">Urgency {uiState.urgency_score}/10</span>}
                </div>
              </section>

              <section className={`rounded-[24px] border p-5 sm:p-6 ${uiState.show_banner ? uiState.is_interruption ? "border-rose-300/30 bg-rose-500/[0.08]" : "border-sky-300/25 bg-sky-400/[0.06]" : "border-white/[0.09] bg-[#0d1118]/85"}`}>
                <div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold">User-facing surface</div><Glyph kind="bell" className="h-5 w-5 text-zinc-500" /></div>
                {uiState.show_banner ? (
                  <div className="mt-5 flex gap-3">
                    <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${uiState.is_interruption ? "bg-rose-400/15 text-rose-200" : "bg-sky-300/10 text-sky-200"}`}><Glyph kind={uiState.is_interruption ? "zap" : "bell"} className="h-5 w-5" /></div>
                    <div><div className={`text-sm font-semibold ${uiState.is_interruption ? "text-rose-100" : "text-sky-100"}`}>{uiState.event_title}</div><div className="mt-2 text-xs leading-5 text-zinc-400">{uiState.event_desc}</div></div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-dashed border-white/10 p-4"><div className="text-sm font-medium text-zinc-300">No notification shown</div><p className="mt-1 text-xs leading-5 text-zinc-500">{decision === "IGNORE" ? "HomeOS filtered the event and cleared any stale notification." : "Nothing is currently demanding the user's attention."}</p></div>
                )}
                <div className="mt-5 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> No real device action is executed by this demo</div>
              </section>
            </div>
          </div>

          <aside className="flex min-w-0 flex-col gap-5">
            <section className="rounded-[26px] border border-white/[0.1] bg-[#0d1118]/95 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.18)] sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300">Live demo control</div><h2 className="mt-2 text-xl font-semibold tracking-[-0.03em]">Try the router</h2><p className="mt-2 text-xs leading-5 text-zinc-500">Send a repeatable event through the same HomeOS decision engine.</p></div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-zinc-400"><Glyph kind="zap" className="h-5 w-5" /></div>
              </div>

              <div className="mt-6 space-y-3">
                <button disabled={!!busyScenario} onClick={() => void triggerScenario("delivery")} className="group w-full rounded-2xl border border-sky-300/25 bg-sky-300/[0.07] p-4 text-left transition hover:border-sky-300/50 hover:bg-sky-300/[0.11] disabled:cursor-wait disabled:opacity-60">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-sky-100">Routine delivery</span><span className="rounded-md bg-sky-200/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-sky-200">Visual only</span></div>
                  <div className="mt-2 text-xs leading-5 text-zinc-400">“Amazon delivery driver dropped a package.”</div><div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-200">{busyScenario === "delivery" ? "Routing event…" : "Protect focus"}<Glyph kind="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" /></div>
                </button>

                <button disabled={!!busyScenario} onClick={() => void triggerScenario("urgent")} className="group w-full rounded-2xl border border-rose-300/25 bg-rose-300/[0.055] p-4 text-left transition hover:border-rose-300/50 hover:bg-rose-300/[0.09] disabled:cursor-wait disabled:opacity-60">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-rose-100">Critical alert</span><span className="rounded-md bg-rose-200/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-rose-200">Interrupt</span></div>
                  <div className="mt-2 text-xs leading-5 text-zinc-400">“Smoke alarm detected smoke in the kitchen.”</div><div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-rose-200">{busyScenario === "urgent" ? "Routing event…" : "Override focus"}<Glyph kind="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" /></div>
                </button>

                <button disabled={!!busyScenario} onClick={() => void triggerScenario("trivial")} className="group w-full rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.05] disabled:cursor-wait disabled:opacity-60">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-zinc-200">Background noise</span><span className="rounded-md bg-white/[0.07] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-300">Ignore</span></div>
                  <div className="mt-2 text-xs leading-5 text-zinc-500">“Routine weather update: sunny this afternoon.”</div><div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300">{busyScenario === "trivial" ? "Routing event…" : "Clear the noise"}<Glyph kind="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" /></div>
                </button>

                <button disabled={!!busyScenario} onClick={() => void triggerScenario("offline")} className="group w-full rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.035] p-4 text-left transition hover:border-emerald-300/40 hover:bg-emerald-300/[0.07] disabled:cursor-wait disabled:opacity-60">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-emerald-100">Model outage drill</span><span className="rounded-md bg-emerald-200/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-200">Offline fallback</span></div>
                  <div className="mt-2 text-xs leading-5 text-zinc-500">Force the local policy engine to route a delivery without calling Groq.</div><div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-200">{busyScenario === "offline" ? "Testing fallback…" : "Test resilience"}<Glyph kind="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" /></div>
                </button>
              </div>

              {error && <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs leading-5 text-rose-200">{error}</div>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] pt-4">
                <div><div className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">Last action</div><div className="mt-1 text-[11px] text-zinc-400">{lastAction}</div></div>
                <button disabled={!!busyScenario} onClick={() => void triggerScenario("reset")} className="rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 transition hover:bg-white/[0.05] disabled:opacity-50">Reset demo</button>
              </div>
            </section>

            <section className="min-h-[280px] rounded-[26px] border border-white/[0.09] bg-[#0d1118]/85 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.20em] text-zinc-500">Decision trace</div><h2 className="mt-2 text-lg font-semibold">Recent events</h2></div><span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] text-zinc-500">{history.length} shown</span></div>
              <div className="mt-5 space-y-0">
                {history.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 p-5 text-xs leading-5 text-zinc-500">No events yet. Run the routine delivery, critical alert and background-noise scenarios to populate the decision trace.</div> : history.slice(0, 5).map((item, index) => (
                  <div key={item.id ?? `${item.time}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
                    <div className="flex flex-col items-center"><div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.decision === "AUDIO_VISUAL_INTERRUPT" ? "bg-rose-300" : item.decision === "VISUAL_ONLY" ? "bg-sky-300" : "bg-zinc-500"}`} />{index < Math.min(history.length, 5) - 1 && <div className="mt-1 w-px flex-1 bg-white/10" />}</div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">{item.time} · {item.context}</div><span className={`text-[9px] font-bold uppercase tracking-[0.1em] ${item.decision === "AUDIO_VISUAL_INTERRUPT" ? "text-rose-300" : item.decision === "VISUAL_ONLY" ? "text-sky-300" : "text-zinc-500"}`}>{item.decision.replaceAll("_", " ")}</span></div><div className="mt-1.5 line-clamp-2 text-xs leading-5 text-zinc-300">{item.event}</div><div className="mt-1.5 text-[10px] leading-4 text-zinc-600">{item.reason}</div></div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[22px] border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500"><Glyph kind="shield" className="h-4 w-4" /> System integrity</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><div><div className="text-zinc-600">Routing engine</div><div className="mt-1 text-zinc-300">Groq + local fallback</div></div><div><div className="text-zinc-600">Control surface</div><div className="mt-1 text-zinc-300">FastMCP / signed Alexa</div></div></div>
              <p className="mt-3 text-[10px] leading-4 text-zinc-600">Demonstration prototype. Critical-event cues are a guardrail, not a certified life-safety system. No real smart-home device action is executed.</p>
            </section>
          </aside>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] py-4 text-[10px] uppercase tracking-[0.15em] text-zinc-600">
          <span>HomeOS · Protect attention, preserve awareness</span><span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} />{connected ? "Live state sync" : "Waiting for backend"} · {uiState.last_updated ? new Date(uiState.last_updated).toLocaleTimeString() : "—"}</span>
        </footer>
      </div>

      {uiState.show_banner && <div className={`fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[650px] -translate-x-1/2 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl sm:p-5 ${uiState.is_interruption ? "border-rose-300/35 bg-rose-950/95 shadow-rose-950/30" : "border-sky-300/25 bg-[#101923]/95 shadow-black/50"}`}><div className="flex items-start gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${uiState.is_interruption ? "bg-rose-300/15 text-rose-200" : "bg-sky-300/10 text-sky-200"}`}><Glyph kind={uiState.is_interruption ? "zap" : "bell"} className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className={`text-sm font-semibold ${uiState.is_interruption ? "text-rose-100" : "text-sky-100"}`}>{uiState.event_title}</div><div className="mt-1 text-xs leading-5 text-zinc-300">{uiState.event_desc}</div></div><button onClick={() => void triggerScenario("reset")} aria-label="Dismiss demo notification" className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-white/10 hover:text-white">×</button></div></div>}
    </main>
  );
}
