import { useStore } from "@/lib/store";
import { TrackMap } from "@/components/TrackMap";
import { FlagButton } from "@/components/FlagButton";
import { EventFeed } from "@/components/EventFeed";
import type { ClientRole } from "@/types/ClientRole";
import type { CommandTarget } from "@/types/CommandTarget";
import type { FlagState } from "@/types/FlagState";

/**
 * Race Director's view: track map + global override buttons + event feed.
 */
export function RaceControlView() {
  const role = useStore((s) => s.role);
  const submit = useGlobalCommand(role);

  if (role.role !== "race_control") {
    return (
      <div className="card text-center text-slate-400">
        Switch to the Race Control role to issue global overrides.
      </div>
    );
  }

  const globalTarget: CommandTarget = { scope: "global" };

  return (
    <div className="grid h-full grid-cols-12 gap-4">
      <div className="col-span-9 flex flex-col gap-4">
        <TrackMap />
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
            Global overrides
          </h3>
          <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
            <FlagButton
              flag={{ kind: "green" }}
              onClick={() => submit(globalTarget, { kind: "green" })}
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
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
              Endurance / special procedures
            </h3>
            <span className="text-[10px] text-slate-500">
              FIA 3504-2019 Appendix 2 · WEC/24H/F1 procedural signals
            </span>
          </div>
          <p className="mb-3 text-[11px] text-slate-500">
            Speed-restriction and procedural modes the Race Director can deploy
            without scrambling a Safety Car. All are RC-exclusive; the marshal
            console only mirrors them as read-only indicators.
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      <aside className="col-span-3 h-full">
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
        id: crypto.randomUUID(),
        source: { kind: "race_control", data: { operator: role.data.operator } },
        target,
        flag,
        timestamp: new Date().toISOString(),
      },
    });
  };
}
