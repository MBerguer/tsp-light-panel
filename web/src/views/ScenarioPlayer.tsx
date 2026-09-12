import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { TrackMap } from "@/components/TrackMap";
import { EventFeed } from "@/components/EventFeed";

/**
 * Scenario player view: pick a scenario from the library, hit Play and watch
 * the same `World` everyone else is connected to walk through it in real
 * time. The track map below updates instantly because the regular
 * `DomainEvent` stream is reused.
 */
export function ScenarioPlayerView() {
  const role = useStore((s) => s.role);
  const scenarios = useStore((s) => s.scenarios);
  const run = useStore((s) => s.scenarioRun);
  const loadScenarios = useStore((s) => s.loadScenarios);
  const startScenario = useStore((s) => s.startScenario);
  const stopScenario = useStore((s) => s.stopScenario);
  const resetWorld = useStore((s) => s.resetWorld);
  const [selected, setSelected] = useState<string>("");
  const [speed, setSpeed] = useState<number>(1);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  useEffect(() => {
    if (!selected && scenarios.length > 0) {
      setSelected(scenarios[0]!.name);
    }
  }, [scenarios, selected]);

  const isRunning = run?.status === "running";

  const progressPct = useMemo(() => {
    if (!run || run.total_steps === 0) return 0;
    const last = run.progress[0]?.step_idx ?? 0;
    return Math.min(100, ((last + 1) / run.total_steps) * 100);
  }, [run]);

  if (role.role !== "race_control") {
    return (
      <div className="card text-center text-slate-400">
        Switch to the Race Control role to drive scenarios.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="col-span-1 lg:col-span-8 xl:col-span-9 flex flex-col gap-4">
        <div className="h-64 sm:h-80 md:h-96 lg:h-[420px]">
          <TrackMap />
        </div>
        <ControlBar
          scenarios={scenarios}
          selected={selected}
          onSelect={setSelected}
          isRunning={isRunning}
          speed={speed}
          onSpeed={setSpeed}
          onPlay={() => startScenario(selected, speed)}
          onStop={stopScenario}
          onReset={resetWorld}
        />
        {run && (
          <div className="max-h-[40vh] overflow-y-auto">
            <Timeline run={run} progressPct={progressPct} />
          </div>
        )}
      </div>
      <aside className="col-span-1 lg:col-span-4 xl:col-span-3 min-h-[280px] lg:min-h-0 lg:h-full overflow-hidden">
        <EventFeed />
      </aside>
    </div>
  );
}

function ControlBar({
  scenarios,
  selected,
  onSelect,
  isRunning,
  speed,
  onSpeed,
  onPlay,
  onStop,
  onReset,
}: {
  scenarios: { name: string; description: string | null; total_steps: number }[];
  selected: string;
  onSelect: (n: string) => void;
  isRunning: boolean;
  speed: number;
  onSpeed: (s: number) => void;
  onPlay: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  const meta = scenarios.find((s) => s.name === selected);
  return (
    <div className="card">
      <div className="flex flex-col sm:grid sm:grid-cols-12 items-stretch sm:items-center gap-3">
        <div className="sm:col-span-6 lg:col-span-5">
          <label className="block text-[10px] uppercase tracking-widest text-slate-400">
            Scenario
          </label>
          <select
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-2 text-xs sm:text-sm"
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
            disabled={isRunning}
          >
            {scenarios.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} — {s.total_steps} steps
              </option>
            ))}
          </select>
          {meta?.description && (
            <p className="mt-1 text-[11px] sm:text-xs text-slate-400 truncate sm:whitespace-normal">
              {meta.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 sm:contents">
          <div className="w-24 sm:w-auto sm:col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-400">
              Speed
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900/80 px-2.5 py-2 text-xs sm:text-sm"
              value={speed}
              onChange={(e) => onSpeed(Number(e.target.value))}
              disabled={isRunning}
            >
              {[0.5, 1, 2, 5, 10].map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 sm:col-span-4 lg:col-span-5 flex justify-end gap-2 pt-4 sm:pt-0">
            {!isRunning && (
              <button className="btn text-xs sm:text-sm flex-1 sm:flex-none" onClick={onReset}>
                Reset
              </button>
            )}
            {isRunning ? (
              <button
                className="btn border-red-400 bg-red-500/20 text-red-200 text-xs sm:text-sm flex-1 sm:flex-none"
                onClick={onStop}
              >
                Stop
              </button>
            ) : (
              <button
                className="btn border-emerald-400 bg-emerald-500/20 text-emerald-200 text-xs sm:text-sm flex-1 sm:flex-none"
                onClick={onPlay}
                disabled={!selected}
              >
                Play
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Timeline({
  run,
  progressPct,
}: {
  run: NonNullable<ReturnType<typeof useStore.getState>["scenarioRun"]>;
  progressPct: number;
}) {
  const statusColor =
    run.status === "running"
      ? "text-emerald-400"
      : run.status === "finished"
        ? "text-sky-400"
        : run.status === "stopped"
          ? "text-yellow-400"
          : "text-red-400";
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between text-xs">
        <div className="flex items-baseline gap-2">
          <span className="font-bold uppercase tracking-widest text-slate-200">
            {run.name}
          </span>
          <span className={`uppercase ${statusColor}`}>● {run.status}</span>
        </div>
        {run.result && (
          <span className="text-slate-400">
            assertions: {run.result.assertions_passed} pass /{" "}
            {run.result.assertions_failed} fail
          </span>
        )}
      </div>
      <div className="relative h-6 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full bg-gradient-to-r from-sky-500 to-emerald-400"
          style={{ width: `${progressPct}%`, transition: "width 0.15s linear" }}
        />
        {run.marks.map((m) => {
          const left = (m.step_idx / Math.max(1, run.total_steps)) * 100;
          return (
            <div
              key={`${m.step_idx}-${m.label}`}
              className="absolute top-0 flex h-full items-center"
              style={{ left: `${left}%` }}
            >
              <div className="h-full w-0.5 bg-amber-400" />
              <span className="ml-1 rounded bg-amber-400 px-1.5 text-[10px] font-bold text-slate-950">
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 max-h-32 space-y-1 overflow-y-auto pr-1">
        {run.progress.slice(0, 20).map((p, i) => (
          <div
            key={`${p.step_idx}-${i}`}
            className="flex items-center gap-2 rounded bg-slate-900/40 px-2 py-1 text-xs"
          >
            <span className="w-12 font-mono text-slate-500">
              [{p.step_idx + 1}/{p.total_steps}]
            </span>
            {p.mark && (
              <span className="rounded bg-amber-400 px-1.5 text-[10px] font-bold text-slate-950">
                {p.mark}
              </span>
            )}
            <span className="text-slate-200">{p.kind}</span>
            <span className="ml-auto text-[10px] text-slate-500">
              {new Date(p.at).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
