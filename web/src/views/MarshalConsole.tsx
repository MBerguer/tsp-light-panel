import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { ClientRole } from "@/types/ClientRole";
import type { CommandTarget } from "@/types/CommandTarget";
import type { FlagState } from "@/types/FlagState";
import type { Panel } from "@/types/Panel";
import type { ZoneTopology } from "@/lib/topology";

/**
 * Marshal post console — mirrors an EM Motorsport / MYLAPS trackside
 * marshal panel.
 *
 * Physical layout (4 + 4 + center):
 * ```
 *   [GREEN]  🟢 ┌─────────┐ 🟡  [Y SINGLE]
 *   [BLUE]   🔵 │   LCD   │ 🟡🟡 [Y DOUBLE]
 *   [OFF]    🏳 │  prev   │      [OFF]
 *   [WHITE]  ⚪ │  next   │ 🟡🔴 [RAIN]
 *              │ OK SC V  │
 *              └─────────┘
 * ```
 * Center column doubles as the LCD message area + SC/VSC/VSC-ending
 * read-only LEDs (those flags are race-control-only; the marshal only
 * *sees* them, it cannot trigger them).
 */
export function MarshalConsoleView() {
  const role = useStore((s) => s.role);
  const setRole = useStore((s) => s.setRole);
  const topology = useStore((s) => s.topology);
  const panels = useStore((s) => s.panels);

  const post = role.role === "marshal" ? role.data.post : -1;
  const allZones = topology?.zones ?? [];

  // Resolve previous / current / next zones in track order. `post` carries
  // the zone id (legacy naming). Wrap around at the ends.
  const { prevZone, currentZone, nextZone } = useMemo(
    () => resolveZoneTriplet(allZones, post),
    [allZones, post]
  );

  const zonePanels = useMemo(() => {
    if (!topology || !currentZone) return [];
    return topology.panels.filter((p) => p.zone === currentZone.id);
  }, [topology, currentZone]);

  // SC / VSC / VSC-ending indicators (read-only LEDs the marshal monitors
  // — they're RC-only commands).
  // We compute these unconditionally so the hook order stays stable across
  // the role / topology branches below.
  const globalIndicators = useMemo(
    () => detectGlobalIndicators(Object.values(panels)),
    [panels]
  );

  const submit = useMarshalCommand(role);

  if (role.role !== "marshal") {
    return <RoleSelector currentRole={role} onPick={setRole} />;
  }

  if (zonePanels.length === 0) {
    return (
      <div className="card text-center text-slate-400">
        No panels mapped to post {post} in the current topology.
      </div>
    );
  }

  // Current effective flag at this post (use first panel as canonical —
  // every panel in a zone always carries the same effective state).
  const currentPanel = panels[zonePanels[0]!.id] ?? null;
  const currentFlag: FlagState = currentPanel?.effective_state ?? { kind: "off" };
  const isLocal = currentPanel?.local_state != null;
  const isAutoGreen = !isLocal && currentPanel?.follow_up_state != null;

  return (
    <div className="grid h-full grid-cols-12 gap-4">
      {/* === Left: the physical-style panel ============================ */}
      <div className="col-span-8 flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400">
              Marshal post
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight">
              #{post} — {currentZone?.label ?? "?"}
            </h2>
          </div>
          <button
            className="btn"
            onClick={() => setRole({ role: "spectator" })}
          >
            Leave post
          </button>
        </header>

        <div className="card flex flex-col gap-4 bg-slate-900/80 p-6 ring-1 ring-slate-700">
          <div className="flex items-stretch justify-between gap-4">
            {/* Left column: 4 buttons + flag icons */}
            <div className="flex flex-col gap-3">
              <ButtonRow side="left" variant="green" label="GREEN" flag={{ kind: "green" }}
                onClick={() => submit({ scope: "zone", id: post }, { kind: "green" })} />
              <ButtonRow side="left" variant="blue" label="BLUE" flag={{ kind: "blue" }}
                onClick={() => submit({ scope: "zone", id: post }, { kind: "blue" })} />
              <ButtonRow side="left" variant="dark" label="OFF" flag="off"
                onClick={() => submit({ scope: "zone", id: post }, { kind: "off" })} />
              <ButtonRow side="left" variant="white" label="WHITE" flag={{ kind: "white" }}
                onClick={() => submit({ scope: "zone", id: post }, { kind: "white" })} />
            </div>

            {/* Center: LCD + LEDs */}
            <div className="flex w-64 flex-col">
              <LcdScreen
                currentFlag={currentFlag}
                isLocal={isLocal}
                isAutoGreen={isAutoGreen}
                prevZone={prevZone}
                nextZone={nextZone}
                prevFlag={zoneFlag(panels, topology?.panels ?? [], prevZone?.id ?? null)}
                nextFlag={zoneFlag(panels, topology?.panels ?? [], nextZone?.id ?? null)}
                global={globalIndicators}
              />
            </div>

            {/* Right column: 4 buttons */}
            <div className="flex flex-col gap-3">
              <ButtonRow side="right" variant="yellow" label="YELLOW" sub="SINGLE" flag={{ kind: "yellow", data: "single" }}
                onClick={() => submit({ scope: "zone", id: post }, { kind: "yellow", data: "single" })} />
              <ButtonRow side="right" variant="yellow" label="YELLOW" sub="DOUBLE" flag={{ kind: "yellow", data: "double" }}
                onClick={() => submit({ scope: "zone", id: post }, { kind: "yellow", data: "double" })} />
              <ButtonRow side="right" variant="dark" label="OFF" flag="off"
                onClick={() => submit({ scope: "zone", id: post }, { kind: "off" })} />
              <ButtonRow
                side="right"
                variant="yellow"
                label="SLIPPERY"
                sub="OIL · WATER"
                flag={{ kind: "yellow_red_striped" }}
                onClick={() => submit({ scope: "zone", id: post }, { kind: "yellow_red_striped" })}
                onLongPress={() => submit({ scope: "zone", id: post }, { kind: "rain" })}
                longPressMs={5000}
                longPressLabel="HOLD 5s → RAIN"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Marshals may only raise the eight local-scope flags above. Red,
            chequered, SC, VSC, FCY, Code 60, Pit Entry and driver-specific
            flags are reserved for Race Control. Raising any yellow variant
            here automatically lights up the next zone green per the FIA
            "green after yellow" rule.
          </p>
        </div>
      </div>

      {/* === Right: the actual panels lit at this post =================== */}
      <aside className="col-span-4 card flex flex-col gap-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
          Panels at this post
        </h3>
        <div className="grid grid-cols-1 gap-3">
          {zonePanels.map((p) => {
            const panel = panels[p.id];
            const flag = panel?.effective_state ?? { kind: "off" };
            const d = describeFlag(flag);
            return (
              <div
                key={p.id}
                className={`rounded-xl p-4 ${d.bg} ${d.fg} ${
                  d.flashing ? "animate-flag-flash" : ""
                }`}
              >
                <div className="text-xs uppercase tracking-widest opacity-75">
                  Panel #{p.id}
                </div>
                <div className="mt-1 text-2xl font-extrabold">{d.label}</div>
                <div className="mt-2 text-[10px] opacity-60">
                  dist {p.distance_m.toFixed(0)} m
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

type Variant = "green" | "yellow" | "blue" | "white" | "dark";

interface ButtonRowProps {
  side: "left" | "right";
  variant: Variant;
  label: string;
  sub?: string;
  /** Either a FlagState for the icon next to the button, or `"off"` for the
   * dashed "OFF" pictogram used by the two cancel buttons. */
  flag: FlagState | "off";
  onClick(): void;
  /** Optional hidden "long-press" gesture. When set, holding the button for
   * `longPressMs` (default 5 000 ms) fires `onLongPress` *instead* of the
   * tap-`onClick`. Used to emulate the EM Motorsport controller's hidden
   * SLIPPERY → RAIN shortcut. */
  onLongPress?(): void;
  longPressMs?: number;
  /** Tiny caption rendered under the button while it has a long-press
   * binding (e.g. `"HOLD 5s → RAIN"`). */
  longPressLabel?: string;
}
function ButtonRow({
  side,
  variant,
  label,
  sub,
  flag,
  onClick,
  onLongPress,
  longPressMs = 5000,
  longPressLabel,
}: ButtonRowProps) {
  const palette: Record<Variant, string> = {
    green: "bg-emerald-500 text-emerald-950 ring-emerald-900 hover:bg-emerald-400",
    yellow: "bg-amber-400 text-amber-950 ring-amber-900 hover:bg-amber-300",
    blue: "bg-sky-500 text-sky-950 ring-sky-900 hover:bg-sky-400",
    white: "bg-slate-100 text-slate-900 ring-slate-300 hover:bg-white",
    dark: "bg-slate-800 text-slate-100 ring-slate-950 hover:bg-slate-700",
  };

  // Long-press progress, 0..1. `null` means "not pressing".
  const [progress, setProgress] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const beginHold = () => {
    if (!onLongPress) return;
    firedRef.current = false;
    startedAtRef.current = performance.now();
    setProgress(0);
    const tick = () => {
      if (startedAtRef.current == null) return;
      const t = (performance.now() - startedAtRef.current) / longPressMs;
      const clamped = Math.min(1, Math.max(0, t));
      setProgress(clamped);
      if (clamped >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          onLongPress();
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  const cancelHold = () => {
    if (!onLongPress) return;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startedAtRef.current = null;
    setProgress(null);
  };
  const handleClick = () => {
    // Suppress the tap when the long-press already fired in this gesture.
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    onClick();
  };

  const showProgress = progress != null;
  const pct = Math.round((progress ?? 0) * 100);

  const btn = (
    <button
      onClick={handleClick}
      onMouseDown={beginHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={beginHold}
      onTouchEnd={cancelHold}
      onTouchCancel={cancelHold}
      className={`relative flex h-16 w-24 flex-col items-center justify-center overflow-hidden rounded-full px-2 ring-4 shadow-inner active:translate-y-px ${palette[variant]}`}
      title={longPressLabel ?? label}
    >
      {/* Long-press fill (rises from the bottom while held). */}
      {showProgress && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-sky-500/60 mix-blend-screen transition-[height] duration-75"
          style={{ height: `${pct}%` }}
        />
      )}
      <span className="relative text-sm font-extrabold tracking-wider">{label}</span>
      {sub && (
        <span className="relative text-[9px] font-bold uppercase opacity-80">
          {sub}
        </span>
      )}
    </button>
  );
  const icon = flag === "off" ? <FlagOffIcon /> : <FlagIcon flag={flag} />;
  return (
    <div className="flex flex-col items-stretch gap-0.5">
      <div className="flex items-center gap-2">
        {side === "left" ? (
          <>
            {btn}
            {icon}
          </>
        ) : (
          <>
            {icon}
            {btn}
          </>
        )}
      </div>
      {longPressLabel && (
        <span
          className={`px-1 text-[8px] uppercase tracking-wider ${
            side === "right" ? "text-right" : "text-left"
          } ${showProgress ? "text-sky-300" : "text-slate-500"}`}
        >
          {showProgress ? `${pct}% · ${longPressLabel}` : longPressLabel}
        </span>
      )}
    </div>
  );
}

function FlagIcon({ flag }: { flag: FlagState }) {
  const d = describeFlag(flag);
  return (
    <div
      className={`flex h-12 w-7 items-center justify-center rounded ${d.bg} ${d.fg}`}
      title={d.label}
    >
      <span className="rotate-90 whitespace-nowrap text-[8px] font-bold tracking-widest">
        {d.label}
      </span>
    </div>
  );
}

function FlagOffIcon() {
  return (
    <div
      className="flex h-12 w-7 items-center justify-center rounded border border-dashed border-slate-600 text-[8px] text-slate-500"
      title="Off (no flag)"
    >
      OFF
    </div>
  );
}

interface LcdProps {
  currentFlag: FlagState;
  isLocal: boolean;
  isAutoGreen: boolean;
  prevZone: ZoneTopology | null;
  nextZone: ZoneTopology | null;
  prevFlag: FlagState;
  nextFlag: FlagState;
  global: { sc: boolean; vsc: boolean; vscEnding: boolean };
}
function LcdScreen({
  currentFlag,
  isLocal,
  isAutoGreen,
  prevZone,
  nextZone,
  prevFlag,
  nextFlag,
  global,
}: LcdProps) {
  const cur = describeFlag(currentFlag);
  const isAutoActive =
    global.sc || global.vsc || global.vscEnding || isAutoGreen;
  return (
    <div className="row-span-4 flex flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono shadow-inner">
      {/* Top: previous / current / next mini chips */}
      <div className="grid grid-cols-3 gap-1 text-center text-[9px] uppercase">
        <MiniChip
          label={prevZone ? `< ${prevZone.label.split("·")[0]?.trim()}` : "<"}
          flag={prevFlag}
        />
        <MiniChip label="ME" flag={currentFlag} active />
        <MiniChip
          label={nextZone ? `${nextZone.label.split("·")[0]?.trim()} >` : ">"}
          flag={nextFlag}
        />
      </div>
      {/* Main readout */}
      <div
        className={`flex flex-1 flex-col items-center justify-center rounded text-center ${cur.bg} ${cur.fg} ${cur.flashing ? "animate-flag-flash" : ""}`}
      >
        <span className="text-[9px] uppercase tracking-widest opacity-70">
          {isLocal ? "Local" : isAutoGreen ? "Auto" : "—"}
        </span>
        <span className="text-base font-extrabold leading-tight">
          {cur.label}
        </span>
      </div>
      {/* LED row */}
      <div className="flex items-center justify-around text-[8px] uppercase tracking-wider">
        <Led on label="OK" />
        <Led on={global.sc || global.vsc} label="SC/VSC" />
        <Led on={global.vscEnding} label="VSC End" warn />
      </div>
      {/* Status line */}
      <div className="rounded border border-slate-800 bg-black px-1 py-0.5 text-[9px] text-emerald-400">
        {isAutoActive
          ? global.sc
            ? "RC: SAFETY CAR"
            : global.vsc
              ? "RC: VSC ACTIVE"
              : global.vscEnding
                ? "RC: VSC ENDING"
                : "AUTO: GREEN downstream of yellow"
          : "READY"}
      </div>
    </div>
  );
}

function MiniChip({
  label,
  flag,
  active,
}: {
  label: string;
  flag: FlagState;
  active?: boolean;
}) {
  const d = describeFlag(flag);
  return (
    <div
      className={`rounded px-1 py-0.5 text-[8px] font-bold ${d.bg} ${d.fg} ${
        active ? "ring-2 ring-sky-400" : ""
      }`}
    >
      <div className="opacity-75">{label}</div>
      <div>{d.label}</div>
    </div>
  );
}

function Led({ on, label, warn }: { on: boolean; label: string; warn?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`block h-2 w-2 rounded-full ${
          on
            ? warn
              ? "bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.6)]"
              : "bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.6)]"
            : "bg-slate-700"
        }`}
      />
      <span className={on ? "text-slate-200" : "text-slate-600"}>{label}</span>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function useMarshalCommand(role: ClientRole) {
  const client = useStore((s) => s.client);
  return (target: CommandTarget, flag: FlagState) => {
    if (!client || role.role !== "marshal") return;
    client.send({
      type: "submit_command",
      command: {
        id: crypto.randomUUID(),
        source: { kind: "marshal", data: { post: role.data.post } },
        target,
        flag,
        timestamp: new Date().toISOString(),
      },
    });
  };
}

function resolveZoneTriplet(
  zones: ZoneTopology[],
  post: number,
): { prevZone: ZoneTopology | null; currentZone: ZoneTopology | null; nextZone: ZoneTopology | null } {
  if (zones.length === 0 || post < 0) {
    return { prevZone: null, currentZone: null, nextZone: null };
  }
  const sorted = [...zones].sort((a, b) => (a.id as number) - (b.id as number));
  const idx = sorted.findIndex((z) => z.id === post);
  if (idx === -1) {
    return { prevZone: null, currentZone: null, nextZone: null };
  }
  return {
    prevZone: sorted[(idx - 1 + sorted.length) % sorted.length] ?? null,
    currentZone: sorted[idx] ?? null,
    nextZone: sorted[(idx + 1) % sorted.length] ?? null,
  };
}

function zoneFlag(
  panels: Record<number, Panel>,
  panelsTopology: { id: number; zone: number }[],
  zoneId: number | null,
): FlagState {
  if (zoneId == null) return { kind: "off" };
  const inZone = panelsTopology.find((p) => p.zone === zoneId);
  if (!inZone) return { kind: "off" };
  return panels[inZone.id]?.effective_state ?? { kind: "off" };
}

function detectGlobalIndicators(panels: Panel[]): {
  sc: boolean;
  vsc: boolean;
  vscEnding: boolean;
} {
  let sc = false;
  let vsc = false;
  let vscEnding = false;
  for (const p of panels) {
    const f = p.effective_state;
    if (f.kind === "safety_car") sc = true;
    if (f.kind === "virtual_safety_car") vsc = true;
    if (f.kind === "vsc_ending") vscEnding = true;
  }
  return { sc, vsc, vscEnding };
}

function RoleSelector({
  currentRole,
  onPick,
}: {
  currentRole: ClientRole;
  onPick(role: ClientRole): void;
}) {
  const topology = useStore((s) => s.topology);
  if (!topology) return null;
  return (
    <div className="card flex flex-col gap-3">
      <h3 className="text-lg font-semibold">Pick a marshal post</h3>
      <p className="text-sm text-slate-400">
        Currently signed in as {currentRole.role}.
      </p>
      <div className="grid grid-cols-3 gap-3">
        {topology.zones.map((z) => (
          <button
            key={z.id}
            className="btn"
            onClick={() => onPick({ role: "marshal", data: { post: z.id } })}
          >
            <div className="text-xs font-semibold uppercase tracking-widest">
              Take post
            </div>
            <div className="text-base font-extrabold">#{z.id}</div>
            <div className="mt-1 text-[10px] text-slate-500">
              {z.label.split("·")[0]?.trim()}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
