import { useEffect, useState } from "react";

export interface MylapsDriver {
  position: number;
  car: string;
  name: string;
  laps: number;
  total_time: string;
  best_lap: string;
  last_lap: string;
}

export interface MylapsSessionState {
  connected: boolean;
  session_name: string;
  current_lap: number;
  total_laps: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  flag_code: number;
  leader_car: string | null;
  leader_name: string | null;
  chequered_suggested: boolean;
  top_drivers: MylapsDriver[];
  last_update: string;
}

export function useMylapsTiming() {
  const [timing, setTiming] = useState<MylapsSessionState | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchTiming() {
      try {
        const res = await fetch("/api/timing/session");
        if (res.ok) {
          const data = (await res.json()) as MylapsSessionState;
          if (isMounted) {
            setTiming(data);
          }
        }
      } catch {
        // ignore fetch error when backend is offline
      }
    }

    fetchTiming();
    const interval = setInterval(fetchTiming, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return timing;
}

interface TimingBarProps {
  onDeployChequered?: () => void;
}

export function TimingBar({ onDeployChequered }: TimingBarProps) {
  const timing = useMylapsTiming();

  if (!timing) return null;

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const progressPercent =
    timing.total_laps > 0
      ? Math.min(100, Math.round((timing.current_lap / timing.total_laps) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Chequered Flag Recommendation Banner */}
      {timing.chequered_suggested && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-yellow-400 bg-gradient-to-r from-yellow-950/80 via-black to-yellow-950/80 p-3 shadow-lg shadow-yellow-500/10 animate-pulse">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🏁</span>
            <div>
              <div className="text-sm font-black uppercase tracking-wider text-yellow-400">
                Sugerencia de Dirección de Carrera: ¡Final de Carrera Cumplido!
              </div>
              <div className="text-xs text-slate-200">
                El líder <strong className="text-white">#{timing.leader_car} {timing.leader_name}</strong> ha cumplido las {timing.total_laps} vueltas reglamentarias.
              </div>
            </div>
          </div>
          {onDeployChequered && (
            <button
              type="button"
              onClick={onDeployChequered}
              className="flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-black hover:bg-yellow-400 active:scale-95 transition-all shadow-md"
            >
              <span>🏁</span>
              <span>Desplegar Bandera a Cuadros</span>
            </button>
          )}
        </div>
      )}

      {/* Main Timing Status Card */}
      <div className="card bg-slate-900/90 border border-slate-800 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                timing.connected
                  ? "bg-emerald-500 animate-ping"
                  : "bg-slate-600"
              }`}
            />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
              {timing.connected ? "MYLAPS Orbits Feed Online" : "MYLAPS Orbits Desconectado"}
            </span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
              TCP 50000
            </span>
          </div>

          <div className="text-xs font-semibold text-slate-300 truncate max-w-md">
            {timing.session_name}
          </div>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Laps */}
          <div className="rounded-lg bg-slate-950/60 border border-slate-800/60 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Vueltas
            </div>
            <div className="text-lg sm:text-xl font-black text-white font-mono flex items-baseline gap-1">
              <span>{timing.current_lap}</span>
              <span className="text-xs text-slate-500">/ {timing.total_laps}</span>
            </div>
            {/* Progress mini bar */}
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Time Remaining */}
          <div className="rounded-lg bg-slate-950/60 border border-slate-800/60 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Tiempo Restante
            </div>
            <div className="text-lg sm:text-xl font-black text-amber-400 font-mono">
              {formatSeconds(timing.remaining_seconds)}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              Transcurrido: {formatSeconds(timing.elapsed_seconds)}
            </div>
          </div>

          {/* Leader */}
          <div className="col-span-2 rounded-lg bg-slate-950/60 border border-slate-800/60 p-2.5 flex flex-col justify-between">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span>🥇 Líder de Carrera (P1)</span>
              {timing.top_drivers[0] && (
                <span className="text-emerald-400 font-mono">
                  Mejor: {timing.top_drivers[0].best_lap}
                </span>
              )}
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="text-sm sm:text-base font-black text-white truncate">
                {timing.leader_car ? (
                  <>
                    <span className="rounded bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 text-xs mr-2 font-mono">
                      #{timing.leader_car}
                    </span>
                    {timing.leader_name}
                  </>
                ) : (
                  <span className="text-slate-500 text-xs font-normal">A la espera de primer paso...</span>
                )}
              </div>
              {timing.top_drivers[0] && (
                <div className="text-xs font-mono text-slate-400">
                  Última: <span className="text-white font-semibold">{timing.top_drivers[0].last_lap}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
