import { useEffect, useMemo, useRef, useState } from "react";
import { TrackMap } from "@/components/TrackMap";
import { describeFlag } from "@/lib/flag";
import type { Car } from "@/types/Car";
import type { DomainEvent } from "@/types/DomainEvent";
import type { FlagState } from "@/types/FlagState";

/**
 * Replay view — fetches the full event log from the server, lets the user
 * scrub a time slider, and derives panel + car state at time `T` to overlay
 * on the TrackMap. Useful for post-race analysis without needing a live
 * scenario running.
 */
export function ReplayView() {
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [cursorMs, setCursorMs] = useState(0);
  const rafRef = useRef<number | null>(null);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/replay/events");
      if (!res.ok) throw new Error(await res.text());
      const body: { events: DomainEvent[] } = await res.json();
      setEvents(body.events);
      setCursorMs(0);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvents();
  }, []);

  const startTs = events[0]?.timestamp;
  const endTs = events[events.length - 1]?.timestamp;
  const durationMs =
    startTs && endTs
      ? new Date(endTs).getTime() - new Date(startTs).getTime()
      : 0;

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      setCursorMs((c) => {
        const next = c + delta * speed;
        if (next >= durationMs) {
          setPlaying(false);
          return durationMs;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, durationMs, speed]);

  const derived = useMemo(() => {
    if (!startTs) return { panels: {}, cars: {} };
    const cutoffMs = new Date(startTs).getTime() + cursorMs;
    return deriveStateAt(events, cutoffMs);
  }, [events, cursorMs, startTs]);

  const carsArray = Object.values(derived.cars);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              className="btn"
              onClick={() => setPlaying((p) => !p)}
              disabled={events.length === 0}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setCursorMs(0);
              }}
            >
              ⏮
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setCursorMs((c) => Math.max(0, c - 2000));
              }}
            >
              −2s
            </button>
            <button
              className="btn"
              onClick={() => {
                setPlaying(false);
                setCursorMs((c) => Math.min(durationMs, c + 2000));
              }}
            >
              +2s
            </button>
            <button className="btn" onClick={fetchEvents}>
              {loading ? "Loading..." : "Reload"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Speed
            <select
              className="rounded bg-slate-800 px-2 py-1 text-slate-200"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[1, 2, 4, 8, 16, 32].map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="card flex-shrink-0">
          <input
            type="range"
            min={0}
            max={durationMs || 1}
            value={cursorMs}
            step={50}
            onChange={(e) => {
              setPlaying(false);
              setCursorMs(Number(e.target.value));
            }}
            className="w-full"
            disabled={durationMs === 0}
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span>{startTs ? new Date(startTs).toLocaleTimeString() : "—"}</span>
            <span>
              T+{(cursorMs / 1000).toFixed(2)}s / {(durationMs / 1000).toFixed(2)}s
            </span>
            <span>{endTs ? new Date(endTs).toLocaleTimeString() : "—"}</span>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <TrackMap
            panelOverrides={derived.panels}
            carsOverride={carsArray}
          />
        </div>
      </div>
      <aside className="card flex h-full min-h-0 flex-col overflow-hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Replay log
        </h2>
        {error && (
          <p className="mt-2 text-xs text-red-400">{error}</p>
        )}
        <div className="mt-2 flex-1 overflow-y-auto pr-1 text-xs">
          {events.length === 0 ? (
            <p className="text-slate-500">No events recorded yet.</p>
          ) : (
            events.slice(-200).reverse().map((ev, i) => (
              <ReplayLogRow key={i} event={ev} />
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function ReplayLogRow({ event }: { event: DomainEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const label = labelFor(event);
  return (
    <div className="border-b border-slate-800/80 py-1">
      <span className="font-mono text-[10px] text-slate-500">{time}</span>{" "}
      <span className="text-slate-300">{label}</span>
    </div>
  );
}

function labelFor(e: DomainEvent): string {
  switch (e.type) {
    case "panel_state_changed":
      return `Panel #${e.panel}: ${describeFlag(e.from).label} → ${describeFlag(e.to).label}`;
    case "car_moved":
      return `Car #${e.car}: zone ${e.from ?? "—"} → ${e.to ?? "pit"}`;
    case "ecu_notified":
      return `Car #${e.car} sees ${describeFlag(e.flag).label} in zone ${e.zone}`;
    case "diagnostic_alert_raised":
      return `ALERT ${e.alert.kind} on panel #${e.alert.panel}`;
    case "diagnostic_alert_cleared":
      return `Cleared ${e.alert.kind} on panel #${e.alert.panel}`;
    case "race_control_override_set":
      return `RC override panel #${e.panel}: ${e.flag ? describeFlag(e.flag).label : "cleared"}`;
    case "marshal_local_state_set":
      return `Marshal panel #${e.panel}: ${e.flag ? describeFlag(e.flag).label : "cleared"}`;
    case "follow_up_state_set":
      return `Auto-follow-up panel #${e.panel}: ${e.flag ? describeFlag(e.flag).label : "cleared"}`;
    case "command_accepted":
      return `Command ${e.command_id.slice(0, 8)} accepted`;
    case "command_rejected":
      return `Command rejected`;
  }
}

function deriveStateAt(
  events: DomainEvent[],
  cutoffMs: number
): {
  panels: Record<number, FlagState>;
  cars: Record<number, Car>;
} {
  const panels: Record<number, FlagState> = {};
  const cars: Record<number, Car> = {};
  for (const ev of events) {
    const t = new Date(ev.timestamp).getTime();
    if (t > cutoffMs) break;
    switch (ev.type) {
      case "panel_state_changed":
        panels[ev.panel as number] = ev.to;
        break;
      case "car_moved": {
        const num = ev.car as number;
        const prev = cars[num];
        cars[num] = {
          number: ev.car,
          zone: ev.to,
          last_flag: prev?.last_flag ?? { kind: "off" },
          last_updated: ev.timestamp,
        };
        break;
      }
      case "ecu_notified": {
        const num = ev.car as number;
        const prev = cars[num];
        cars[num] = {
          number: ev.car,
          zone: prev?.zone ?? ev.zone,
          last_flag: ev.flag,
          last_updated: ev.timestamp,
        };
        break;
      }
      default:
        break;
    }
  }
  return { panels, cars };
}
