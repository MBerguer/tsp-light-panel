import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { PanelTopology, ZoneTopology } from "@/lib/topology";
import type { CircuitTopology } from "@/lib/topology";
import type { Car } from "@/types/Car";
import type { FlagState } from "@/types/FlagState";

interface Props {
  highlightPanel?: number;
  onPanelClick?: (panel: PanelTopology) => void;
  /** When true, hides cars even if the store has them. */
  hideCars?: boolean;
  /** Override the panel state (e.g. when scrubbing replays). */
  panelOverrides?: Record<number, FlagState>;
  /** Override the cars list (e.g. when scrubbing replays). */
  carsOverride?: Car[];
}

/**
 * SVG track map. Draws the closed racing line as a smooth polyline plus
 * one rectangle per panel oriented along the tangent direction. The panel
 * fill colour reflects its currently-displayed [`FlagState`].
 */
export function TrackMap({
  highlightPanel,
  onPanelClick,
  hideCars,
  panelOverrides,
  carsOverride,
}: Props) {
  const topology = useStore((s) => s.topology);
  const panels = useStore((s) => s.panels);
  const carsState = useStore((s) => s.cars);
  const cars = carsOverride ?? Object.values(carsState);

  if (!topology) {
    return (
      <div className="card flex h-full items-center justify-center text-slate-500">
        Loading topology...
      </div>
    );
  }

  const { width, height } = topology.viewport;

  const racingLinePath =
    "M " +
    topology.racing_line.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ") +
    " Z";

  return (
    <div className="card h-full overflow-hidden">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="track-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e293b" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>

        <rect width={width} height={height} fill="url(#track-grad)" />

        {/* Legend of zones along the top edge. Long labels collapse to their
            short prefix (before `·`) so 11+ zones still fit on screen. */}
        {topology.zones.map((z, i) => {
          const short = z.label.split("·")[0]!.trim();
          return (
            <text
              key={`zonelabel-${z.id}`}
              x={20 + i * 60}
              y={24}
              fill={`hsl(${z.hue}, 70%, 60%)`}
              fontSize={11}
              fontFamily="ui-monospace, monospace"
            >
              {short}
              <title>{z.label}</title>
            </text>
          );
        })}

        {/* Racing line */}
        <path
          d={racingLinePath}
          fill="none"
          stroke="#475569"
          strokeWidth={28}
          strokeLinejoin="round"
        />
        <path
          d={racingLinePath}
          fill="none"
          stroke="#0f172a"
          strokeWidth={22}
          strokeLinejoin="round"
        />
        <path
          d={racingLinePath}
          fill="none"
          stroke="#64748b"
          strokeOpacity={0.4}
          strokeWidth={1}
          strokeDasharray="6 8"
          strokeLinejoin="round"
        />

        {/* Marshal posts (only rendered when the topology ships them). */}
        {(topology.posts ?? []).map((post) => {
          const fill = post.kind === "led_controller"
            ? "#38bdf8"
            : post.kind === "track"
              ? "#f97316"
              : "#facc15";
          return (
            <g key={`post-${post.id}`} transform={`translate(${post.x} ${post.y})`}>
              <polygon
                points="0,-6 5,4 -5,4"
                fill={fill}
                fillOpacity={0.85}
                stroke="#0f172a"
                strokeWidth={0.8}
              >
                <title>
                  Marshal {post.label} · zone {post.zone} · sector {post.sector} · {Math.round(post.distance_m)} m
                </title>
              </polygon>
            </g>
          );
        })}

        {/* Panels */}
        {topology.panels.map((p) => {
          const live = panels[p.id];
          const flag =
            panelOverrides?.[p.id] ??
            live?.effective_state ??
            ({ kind: "off" } as FlagState);
          const display = describeFlag(flag);
          const isHighlight = highlightPanel === p.id;
          const fill = svgFlagColour(flag);
          const pulse = display.flashing ? "animate-flag-flash" : "";
          return (
            <g
              key={p.id}
              transform={`translate(${p.x} ${p.y}) rotate(${p.bearing_deg})`}
              className={`cursor-pointer ${pulse}`}
              onClick={() => onPanelClick?.(p)}
            >
              <rect
                x={-22}
                y={-9}
                width={44}
                height={18}
                rx={3}
                fill={fill}
                stroke={isHighlight ? "#38bdf8" : "#0f172a"}
                strokeWidth={isHighlight ? 3 : 1.5}
              />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
                fontWeight={700}
                fill={svgFlagTextColour(flag)}
                transform={`rotate(${-p.bearing_deg})`}
              >
                {labelFor(flag)}
              </text>
              <text
                x={0}
                y={-16}
                textAnchor="middle"
                fontSize={8}
                fontFamily="ui-monospace, monospace"
                fill="#94a3b8"
                transform={`rotate(${-p.bearing_deg})`}
              >
                #{p.id}
              </text>
            </g>
          );
        })}

        {/* Cars overlay */}
        {!hideCars && (
          <CarsLayer
            topology={topology}
            cars={cars}
            panelStates={panels}
            panelOverrides={panelOverrides}
          />
        )}
      </svg>
    </div>
  );
}

interface CarsLayerProps {
  topology: CircuitTopology;
  cars: Car[];
  panelStates: Record<number, import("@/types/Panel").Panel>;
  panelOverrides?: Record<number, FlagState>;
}

function CarsLayer({ topology, cars, panelStates, panelOverrides }: CarsLayerProps) {
  return (
    <g>
      {cars.map((car) => (
        <AnimatedCar
          key={String(car.number)}
          topology={topology}
          car={car}
          panelStates={panelStates}
          panelOverrides={panelOverrides}
        />
      ))}
    </g>
  );
}

interface AnimatedCarProps {
  topology: CircuitTopology;
  car: Car;
  panelStates: Record<number, import("@/types/Panel").Panel>;
  panelOverrides?: Record<number, FlagState>;
}

const ZONE_LERP_MS = 1200;

function AnimatedCar({ topology, car, panelStates, panelOverrides }: AnimatedCarProps) {
  const zoneCenters = useMemo(
    () => zoneCenterMap(topology),
    [topology]
  );

  const target = car.zone != null ? zoneCenters[car.zone as number] : null;
  const previousRef = useRef<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    target
  );

  useEffect(() => {
    if (!target) {
      previousRef.current = null;
      setPosition(null);
      return;
    }
    const start = previousRef.current ?? target;
    previousRef.current = target;
    const startTime = performance.now();
    let frame: number;
    const tick = () => {
      const t = Math.min(1, (performance.now() - startTime) / ZONE_LERP_MS);
      const eased = easeOutCubic(t);
      setPosition({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
      });
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target?.x, target?.y, target]);

  if (!position) return null;

  // Colour reflects whatever flag is showing in the car's zone (if any).
  const zonePanels =
    car.zone != null
      ? topology.panels.filter((p) => (p.zone as number) === (car.zone as number))
      : [];
  const flagState: FlagState =
    panelOverrides && zonePanels[0]
      ? panelOverrides[zonePanels[0].id] ?? { kind: "off" }
      : zonePanels[0]
        ? panelStates[zonePanels[0].id]?.effective_state ?? car.last_flag
        : car.last_flag;
  const fill = svgFlagColour(flagState);
  const stroke = svgFlagTextColour(flagState);

  return (
    <g transform={`translate(${position.x.toFixed(2)} ${position.y.toFixed(2)})`}>
      <circle r={10} fill="#0f172a" opacity={0.7} />
      <circle
        r={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.5}
        className="drop-shadow"
      />
      <text
        y={3}
        textAnchor="middle"
        fontSize={9}
        fontFamily="ui-monospace, monospace"
        fontWeight={700}
        fill={stroke}
      >
        {String(car.number)}
      </text>
    </g>
  );
}

function zoneCenterMap(topology: CircuitTopology) {
  const out: Record<number, { x: number; y: number }> = {};
  for (const zone of topology.zones) {
    const inZone = topology.panels.filter((p) => p.zone === zone.id);
    if (inZone.length === 0) continue;
    const sx = inZone.reduce((s, p) => s + p.x, 0) / inZone.length;
    const sy = inZone.reduce((s, p) => s + p.y, 0) / inZone.length;
    out[zone.id as number] = { x: sx, y: sy };
  }
  return out;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Re-export to silence the unused warning while keeping the surface intact.
export type { ZoneTopology };

function svgFlagColour(flag: import("@/types/FlagState").FlagState): string {
  switch (flag.kind) {
    case "off":
      return "#1f2937";
    case "green":
      return "#0bd964";
    case "yellow":
      return "#ffcc00";
    case "blue":
      return "#0078ff";
    case "white":
      return "#f8fafc";
    case "yellow_red_striped":
      return "#fb923c";
    case "rain":
      return "#0ea5e9";
    case "red":
      return "#e8201f";
    case "chequered":
      return "#111827";
    case "safety_car":
      return "#ff7a00";
    case "virtual_safety_car":
      return "#ff7a00";
    case "vsc_ending":
      return "#ff7a00";
    case "full_course_yellow":
      return "#ffcc00";
    case "code60":
      return "#a21caf";
    case "slow_zone":
      return "#ffcc00";
    case "next_slow":
      return "#facc15";
    case "pit_entry_open":
      return "#10b981";
    case "pit_entry_closed":
      return "#9f1239";
    case "standing_start":
      return "#f59e0b";
    case "rolling_start":
      return "#fbbf24";
    case "custom_blue":
      return "#1d4ed8";
    default:
      return "#7d1f1f";
  }
}

function svgFlagTextColour(flag: import("@/types/FlagState").FlagState): string {
  const dark = ["red", "chequered", "blue", "off"].includes(flag.kind);
  return dark ? "#f8fafc" : "#0f172a";
}

function labelFor(flag: import("@/types/FlagState").FlagState): string {
  switch (flag.kind) {
    case "off":
      return "—";
    case "yellow":
      return flag.data === "double" ? "YY" : "Y";
    case "green":
      return "G";
    case "blue":
      return "B";
    case "white":
      return "W";
    case "yellow_red_striped":
      return "Y/R";
    case "rain":
      return "RN";
    case "red":
      return "R";
    case "chequered":
      return "CHQ";
    case "safety_car":
      return "SC";
    case "virtual_safety_car":
      return "VSC";
    case "vsc_ending":
      return "VSCx";
    case "full_course_yellow":
      return "FCY";
    case "code60":
      return "60";
    case "slow_zone":
      return "SZ";
    case "next_slow":
      return "NXT";
    case "pit_entry_open":
      return "PIT";
    case "pit_entry_closed":
      return "PITX";
    case "standing_start":
      return "STG";
    case "rolling_start":
      return "ROL";
    case "custom_blue":
      return "B+";
    case "black_for_driver":
      return `BLK ${flag.data}`;
    case "black_orange_disc":
      return `MEC ${flag.data}`;
    case "black_white_diagonal":
      return `WRN ${flag.data}`;
  }
}
