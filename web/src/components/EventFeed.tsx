import { useMemo } from "react";
import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { DomainEvent } from "@/types/DomainEvent";

/**
 * Rolling feed of `DomainEvent`s, most recent first. Renders each event as
 * a compact card with a colour-coded badge.
 */
export function EventFeed({ limit = 40 }: { limit?: number }) {
  const events = useStore((s) => s.events);
  const visibleEvents = useMemo(() => events.slice(0, limit), [events, limit]);
  return (
    <div className="card flex h-full flex-col gap-2 overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Event log
        </h3>
        <span className="text-xs text-slate-500">{visibleEvents.length} shown</span>
      </div>
      <div className="-mr-2 flex-1 space-y-1 overflow-y-auto pr-2">
        {visibleEvents.length === 0 && (
          <div className="text-xs text-slate-500">No events yet.</div>
        )}
        {visibleEvents.map((e) => (
          <Row key={e.id} event={e.event} at={e.at} />
        ))}
      </div>
    </div>
  );
}

function Row({ event, at }: { event: DomainEvent; at: string }) {
  const time = new Date(at).toLocaleTimeString();
  const { label, color } = describeEvent(event);
  return (
    <div className="flex items-start gap-2 rounded-md bg-slate-900/40 p-2 text-xs">
      <span className={`mt-1 inline-block h-2 w-2 rounded-full ${color}`} />
      <div className="flex-1">
        <div className="font-semibold text-slate-200">{label}</div>
        <div className="text-slate-500">{time}</div>
      </div>
    </div>
  );
}

function describeEvent(e: DomainEvent): { label: string; color: string } {
  switch (e.type) {
    case "panel_state_changed":
      return {
        label: `Panel #${e.panel}: ${describeFlag(e.from).label} → ${describeFlag(e.to).label}`,
        color: "bg-sky-400",
      };
    case "race_control_override_set":
      return {
        label: `RC override on panel #${e.panel}: ${
          e.flag ? describeFlag(e.flag).label : "cleared"
        }`,
        color: "bg-orange-400",
      };
    case "marshal_local_state_set":
      return {
        label: `Marshal input on panel #${e.panel}: ${
          e.flag ? describeFlag(e.flag).label : "cleared"
        }`,
        color: "bg-yellow-400",
      };
    case "follow_up_state_set":
      return {
        label: `Auto-follow-up on panel #${e.panel}: ${
          e.flag ? describeFlag(e.flag).label : "cleared"
        }`,
        color: "bg-emerald-300",
      };
    case "command_accepted":
      return { label: `Command ${e.command_id.slice(0, 8)} accepted (no-op)`, color: "bg-slate-500" };
    case "command_rejected":
      return {
        label: `Command rejected: ${(e.reason as { reason: string }).reason}`,
        color: "bg-red-500",
      };
    case "diagnostic_alert_raised":
      return {
        label: `ALERT — ${e.alert.kind} on panel #${e.alert.panel}`,
        color: "bg-red-400",
      };
    case "diagnostic_alert_cleared":
      return {
        label: `Cleared — ${e.alert.kind} on panel #${e.alert.panel}`,
        color: "bg-emerald-400",
      };
    case "ecu_notified":
      return {
        label: `Car #${e.car} → ${describeFlag(e.flag).label} (zone ${e.zone})`,
        color: "bg-violet-400",
      };
    case "car_moved":
      return {
        label: `Car #${e.car} moved ${e.from ?? "—"} → ${e.to ?? "pit"}`,
        color: "bg-cyan-400",
      };
  }
}
