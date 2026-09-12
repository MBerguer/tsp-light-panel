import { useState } from "react";
import { useStore } from "@/lib/store";
import { TrackMap } from "@/components/TrackMap";
import { FlagButton } from "@/components/FlagButton";
import { EventFeed } from "@/components/EventFeed";
import { MarshalRoster } from "@/components/MarshalRoster";
import type { ClientRole } from "@/types/ClientRole";
import type { CommandTarget } from "@/types/CommandTarget";
import type { FlagState } from "@/types/FlagState";
import { safeRandomUUID } from "@/lib/uuid";

/**
 * Race Director's view: track map + global override buttons + event feed.
 */
export function RaceControlView() {
  const role = useStore((s) => s.role);
  const resetSession = useStore((s) => s.resetSession);
  const submit = useGlobalCommand(role);
  const [confirmReset, setConfirmReset] = useState(false);

  if (role.role !== "race_control") {
    return (
      <div className="card text-center text-slate-400">
        Switch to the Race Control role to issue global overrides.
      </div>
    );
  }

  const globalTarget: CommandTarget = { scope: "global" };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="col-span-1 lg:col-span-8 xl:col-span-9 flex flex-col gap-4">
        {/* Marshal Roster Status Board */}
        <MarshalRoster />

        <div className="h-64 sm:h-80 md:h-96 lg:h-[480px]">
          <TrackMap />
        </div>

        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-slate-400">
              Global overrides
            </h3>
            {confirmReset ? (
              <div className="flex items-center gap-2 bg-red-950/40 border border-red-500/40 rounded-lg px-2.5 py-1">
                <span className="text-xs text-amber-300 font-semibold">¿Reiniciar todas las banderas?</span>
                <button
                  type="button"
                  onClick={() => {
                    resetSession();
                    setConfirmReset(false);
                  }}
                  className="rounded bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white hover:bg-red-500 active:scale-95 transition-all"
                >
                  SÍ, REINICIAR
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-900/40 active:scale-95 transition-all"
                title="Apaga todas las banderas y limpia overrides del circuito"
              >
                <span>🔄</span>
                <span>Reiniciar Sesión de Carrera</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2 sm:gap-2.5">
            <FlagButton
              flag={{ kind: "green" }}
              onClick={() => submit(globalTarget, { kind: "green" })}
            />
            <FlagButton
              flag={{ kind: "yellow", data: "single" }}
              onClick={() =>
                submit(globalTarget, { kind: "yellow", data: "single" })
              }
            />
            <FlagButton
              flag={{ kind: "yellow", data: "double" }}
              onClick={() =>
                submit(globalTarget, { kind: "yellow", data: "double" })
              }
            />
            <FlagButton
              flag={{ kind: "safety_car" }}
              onClick={() => submit(globalTarget, { kind: "safety_car" })}
            />
            <FlagButton
              flag={{ kind: "virtual_safety_car" }}
              onClick={() =>
                submit(globalTarget, { kind: "virtual_safety_car" })
              }
            />
            <FlagButton
              flag={{ kind: "vsc_ending" }}
              onClick={() => submit(globalTarget, { kind: "vsc_ending" })}
            />
            <FlagButton
              flag={{ kind: "red" }}
              onClick={() => submit(globalTarget, { kind: "red" })}
            />
            <FlagButton
              flag={{ kind: "chequered" }}
              onClick={() => submit(globalTarget, { kind: "chequered" })}
            />
            <FlagButton
              flag={{ kind: "off" }}
              onClick={() => submit(globalTarget, { kind: "off" })}
            />
          </div>
        </div>

        <div className="card">
          <div className="mb-1 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 sm:gap-3">
            <h3 className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-slate-400">
              Endurance / special procedures
            </h3>
            <span className="text-[10px] text-slate-500">
              FIA 3504-2019 Appendix 2 · WEC/24H/F1
            </span>
          </div>
          <p className="mb-3 text-[11px] text-slate-500">
            Speed-restriction and procedural modes the Race Director can deploy
            without scrambling a Safety Car. All are RC-exclusive; the marshal
            console only mirrors them as read-only indicators.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
            <FlagButton
              flag={{ kind: "full_course_yellow" }}
              onClick={() =>
                submit(globalTarget, { kind: "full_course_yellow" })
              }
            />
            <FlagButton
              flag={{ kind: "code60" }}
              onClick={() => submit(globalTarget, { kind: "code60" })}
            />
            <FlagButton
              flag={{ kind: "slow_zone" }}
              onClick={() => submit(globalTarget, { kind: "slow_zone" })}
            />
            <FlagButton
              flag={{ kind: "next_slow" }}
              onClick={() => submit(globalTarget, { kind: "next_slow" })}
            />
            <FlagButton
              flag={{ kind: "pit_entry_open" }}
              onClick={() => submit(globalTarget, { kind: "pit_entry_open" })}
            />
            <FlagButton
              flag={{ kind: "pit_entry_closed" }}
              onClick={() =>
                submit(globalTarget, { kind: "pit_entry_closed" })
              }
            />
            <FlagButton
              flag={{ kind: "standing_start" }}
              onClick={() => submit(globalTarget, { kind: "standing_start" })}
            />
            <FlagButton
              flag={{ kind: "rolling_start" }}
              onClick={() => submit(globalTarget, { kind: "rolling_start" })}
            />
            <FlagButton
              flag={{ kind: "rain" }}
              onClick={() => submit(globalTarget, { kind: "rain" })}
            />
            <FlagButton
              flag={{ kind: "custom_blue" }}
              onClick={() => submit(globalTarget, { kind: "custom_blue" })}
            />
          </div>
        </div>
      </div>
      <aside className="col-span-1 lg:col-span-4 xl:col-span-3 min-h-[280px] lg:min-h-0 lg:h-full">
        <EventFeed />
      </aside>
    </div>
  );
}

function useGlobalCommand(role: ClientRole) {
  const client = useStore((s) => s.client);
  return (target: CommandTarget, flag: FlagState) => {
    if (!client || role.role !== "race_control") return;
    client.send({
      type: "submit_command",
      command: {
        id: safeRandomUUID(),
        source: { kind: "race_control", data: { operator: role.data.operator } },
        target,
        flag,
        timestamp: new Date().toISOString(),
      },
    });
  };
}
