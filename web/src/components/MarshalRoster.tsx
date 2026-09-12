import { useMemo } from "react";
import { useStore } from "@/lib/store";

export function MarshalRoster() {
  const roster = useStore((s) => s.marshalRoster);
  const topology = useStore((s) => s.topology);

  // Default to 16 AUVO posts if El Pinar C13, or use zones from topology
  const postIds = useMemo(() => {
    if (topology && topology.zones && topology.zones.length > 0) {
      return topology.zones.map((z) => z.id).sort((a, b) => a - b);
    }
    return Array.from({ length: 16 }, (_, i) => i + 1);
  }, [topology]);

  const rosterByPost = useMemo(() => {
    const map = new Map<number, (typeof roster)[0]>();
    for (const entry of roster) {
      map.set(entry.post, entry);
    }
    return map;
  }, [roster]);

  const onlineCount = useMemo(() => {
    let count = 0;
    for (const id of postIds) {
      const entry = rosterByPost.get(id);
      if (entry && entry.online) count++;
    }
    return count;
  }, [postIds, rosterByPost]);

  return (
    <div className="card flex flex-col gap-3 sm:gap-4 bg-slate-900/90 border border-slate-800">
      {/* Header with Stats */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
        <div>
          <div className="text-[10px] sm:text-xs uppercase tracking-widest text-slate-400 font-semibold">
            Control de Personal de Pista · Roster
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-100 flex items-center gap-2">
            <span>Comisarios en Puestos</span>
            <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-mono text-slate-300">
              {onlineCount} / {postIds.length} ONLINE
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {onlineCount > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Puestos Activos
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Esperando Conexiones
            </span>
          )}
        </div>
      </div>

      {/* Grid of Posts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {postIds.map((postId) => {
          const entry = rosterByPost.get(postId);
          const isOnline = entry?.online ?? false;
          const checkInTime = entry?.checked_in_at
            ? new Date(entry.checked_in_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : null;

          return (
            <div
              key={postId}
              className={`flex flex-col justify-between rounded-lg p-2.5 transition-all text-left ${
                isOnline
                  ? "bg-emerald-950/30 border border-emerald-500/40 shadow-sm shadow-emerald-950/50"
                  : "bg-slate-950/40 border border-slate-800/80 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-extrabold tracking-tight text-slate-200">
                  Puesto {postId}
                </span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOnline
                      ? "bg-emerald-400 ring-2 ring-emerald-500/20 animate-pulse"
                      : "bg-slate-600"
                  }`}
                  title={isOnline ? "Conectado" : "Desconectado"}
                />
              </div>

              <div className="mt-1 min-h-[32px]">
                {isOnline && entry ? (
                  <>
                    <p className="text-xs font-semibold text-emerald-300 truncate" title={entry.name}>
                      {entry.name}
                    </p>
                    {checkInTime && (
                      <p className="text-[10px] text-slate-400 font-mono">
                        {checkInTime}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 italic">
                    Sin comisario
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
