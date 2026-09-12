import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { PanelTopology, ZoneTopology } from "@/lib/topology";
import type { CircuitTopology } from "@/lib/topology";
import type { Car } from "@/types/Car";
import type { FlagState } from "@/types/FlagState";

export interface TrackSampler {
  sampleAt: (distanceM: number) => [number, number, number];
  trackLengthM: number;
  totalPx: number;
  cum: number[];
  points: [number, number][];
}

export function buildTrackSampler(
  racingLine: [number, number][] | undefined,
  trackLengthM: number | undefined
): TrackSampler {
  if (!racingLine || racingLine.length === 0) {
    return {
      sampleAt: () => [0, 0, 0],
      trackLengthM: 1000,
      totalPx: 1,
      cum: [0],
      points: [[0, 0]],
    };
  }
  const points: [number, number][] = [...racingLine, racingLine[0]!];
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(
      cum[i - 1]! +
        Math.hypot(
          points[i]![0] - points[i - 1]![0],
          points[i]![1] - points[i - 1]![1]
        )
    );
  }
  const totalPx = cum[cum.length - 1] || 1;
  const trackLen = trackLengthM || totalPx;

  function sampleAt(distanceM: number): [number, number, number] {
    const d = ((distanceM % trackLen) + trackLen) % trackLen;
    const targetPx = (d / trackLen) * totalPx;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! <= targetPx) lo = mid;
      else hi = mid;
    }
    const a = points[lo]!;
    const b = points[hi]!;
    const segLen = cum[hi]! - cum[lo]! || 1;
    const t = (targetPx - cum[lo]!) / segLen;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t;
    const bearing = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    return [x, y, bearing];
  }

  return { sampleAt, trackLengthM: trackLen, totalPx, cum, points };
}

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

  const sampler = useMemo(
    () => buildTrackSampler(topology?.racing_line, topology?.track_length_m),
    [topology?.racing_line, topology?.track_length_m]
  );

  const postDistanceMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!topology) return map;
    if (topology.posts) {
      for (const p of topology.posts) {
        map.set(p.zone as number, p.distance_m);
        map.set(p.id as number, p.distance_m);
      }
    }
    if (topology.panels) {
      for (const p of topology.panels) {
        if (!map.has(p.zone as number)) {
          map.set(p.zone as number, p.distance_m);
        }
        if (!map.has(p.id as number)) {
          map.set(p.id as number, p.distance_m);
        }
      }
    }
    return map;
  }, [topology]);

  const racingLinePath = useMemo(() => {
    if (!topology) return "";
    return (
      "M " +
      topology.racing_line.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ") +
      " Z"
    );
  }, [topology]);

  // Compute sector sub-paths, demarcation lines, and trackside badge positions
  const { sectorGeometries, startFinish } = useMemo(() => {
    if (!topology) {
      return { sectorGeometries: [], startFinish: null };
    }
    const rl = topology.racing_line;
    if (!rl || rl.length === 0 || !topology.panels || topology.panels.length === 0) {
      return { sectorGeometries: [], startFinish: null };
    }

    const { sampleAt, points, cum, totalPx, trackLengthM: trackLen } = sampler;

    let cx = 0;
    let cy = 0;
    for (const [x, y] of rl) {
      cx += x;
      cy += y;
    }
    cx /= rl.length;
    cy /= rl.length;

    function getSubPath(startM: number, endM: number): string {
      const pStart = sampleAt(startM);
      const pts: [number, number][] = [[pStart[0], pStart[1]]];
      if (startM < endM) {
        for (let i = 0; i < points.length; i++) {
          const vertM = (cum[i]! / totalPx) * trackLen;
          if (vertM > startM && vertM < endM) {
            pts.push(points[i]!);
          }
        }
      } else {
        for (let i = 0; i < points.length; i++) {
          const vertM = (cum[i]! / totalPx) * trackLen;
          if (vertM > startM) {
            pts.push(points[i]!);
          }
        }
        for (let i = 0; i < points.length; i++) {
          const vertM = (cum[i]! / totalPx) * trackLen;
          if (vertM < endM) {
            pts.push(points[i]!);
          }
        }
      }
      const pEnd = sampleAt(endM);
      pts.push([pEnd[0], pEnd[1]]);
      return "M " + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ");
    }

    const sortedPanels = [...topology.panels].sort((a, b) => a.distance_m - b.distance_m);

    const geometries = sortedPanels.map((p, idx) => {
      const nextP = sortedPanels[(idx + 1) % sortedPanels.length]!;
      const pathD = getSubPath(p.distance_m, nextP.distance_m);

      const rad = (p.bearing_deg * Math.PI) / 180;
      const nx = Math.sin(rad);
      const ny = -Math.cos(rad);

      // Sector demarcation tick across the road (width ~ 22px)
      const x1 = p.x + 11 * nx;
      const y1 = p.y + 11 * ny;
      const x2 = p.x - 11 * nx;
      const y2 = p.y - 11 * ny;

      // Trackside badge position: offset 22px outside the road with clearance check
      const p1 = { x: p.x + 22 * nx, y: p.y + 22 * ny };
      const p2 = { x: p.x - 22 * nx, y: p.y - 22 * ny };

      function clearance(cand: { x: number; y: number }, panelDistM: number): number {
        let minD = Infinity;
        for (let i = 0; i < rl.length; i++) {
          const vertM = (cum[i]! / totalPx) * trackLen;
          let distAlong = Math.abs(vertM - panelDistM);
          if (distAlong > trackLen / 2) distAlong = trackLen - distAlong;
          if (distAlong > 80) {
            const d = Math.hypot(rl[i]![0] - cand.x, rl[i]![1] - cand.y);
            if (d < minD) minD = d;
          }
        }
        return minD;
      }

      const c1 = clearance(p1, p.distance_m);
      const c2 = clearance(p2, p.distance_m);

      const post = topology.posts?.find(
        (pt) => Math.abs(pt.distance_m - p.distance_m) < 1.0 || pt.id === p.id
      );

      let badgePos = p1;
      if (post) {
        // Place badge on opposite side of the road from the flag post
        const d1 = Math.hypot(p1.x - post.x, p1.y - post.y);
        const d2 = Math.hypot(p2.x - post.x, p2.y - post.y);
        badgePos = d1 > d2 ? p1 : p2;
      } else if (c1 < 16 && c2 > c1) {
        badgePos = p2;
      } else if (c2 < 16 && c1 > c2) {
        badgePos = p1;
      } else {
        const d1 = Math.hypot(p1.x - cx, p1.y - cy);
        const d2 = Math.hypot(p2.x - cx, p2.y - cy);
        badgePos = d1 > d2 ? p1 : p2;
        if (badgePos === p1 && c1 < 22 && c2 > c1) badgePos = p2;
        if (badgePos === p2 && c2 < 22 && c1 > c2) badgePos = p1;
      }

      return {
        panel: p,
        pathD,
        badgePos,
        demarcation: { x1, y1, x2, y2 },
      };
    });

    // Línea de Sentencia (Finish Line):
    // In El Pinar, the finish line sits at ~75% of the recta final (~3925 m), before Post 1 (rostrum at 20 m).
    const finishLineDistanceM = topology.name.includes("el_pinar") ? 3925 : 0;
    const [sfx, sfy, sfBearing] = sampleAt(finishLineDistanceM);
    const sfRad = (sfBearing * Math.PI) / 180;
    const sfNx = Math.sin(sfRad);
    const sfNy = -Math.cos(sfRad);
    const sf = {
      x1: sfx + 11.5 * sfNx,
      y1: sfy + 11.5 * sfNy,
      x2: sfx - 11.5 * sfNx,
      y2: sfy - 11.5 * sfNy,
      bearing: sfBearing,
      flagX: sfx + 22 * sfNx,
      flagY: sfy + 22 * sfNy,
      arrowX: sfx - 22 * sfNx,
      arrowY: sfy - 22 * sfNy,
    };

    return { sectorGeometries: geometries, startFinish: sf };
  }, [topology, sampler]);

  // Global procedure detector & sector hazard counters
  const globalIndicators = useMemo(() => {
    let sc = false;
    let vsc = false;
    let vscEnding = false;
    let red = false;
    let chequered = false;
    let fcy = false;
    let code60 = false;
    let rain = false;
    let doubleYellowCount = 0;
    let singleYellowCount = 0;
    let slipperyCount = 0;

    const allPanels = topology?.panels ?? [];
    for (const p of allPanels) {
      const live = panels[p.id];
      const flag =
        panelOverrides?.[p.id] ??
        live?.effective_state ??
        ({ kind: "off" } as FlagState);
      if (flag.kind === "safety_car") sc = true;
      if (flag.kind === "virtual_safety_car") vsc = true;
      if (flag.kind === "vsc_ending") vscEnding = true;
      if (flag.kind === "red") red = true;
      if (flag.kind === "chequered") chequered = true;
      if (flag.kind === "full_course_yellow") fcy = true;
      if (flag.kind === "code60") code60 = true;
      if (flag.kind === "rain") rain = true;
      if (flag.kind === "yellow") {
        if (flag.data === "double") doubleYellowCount++;
        else singleYellowCount++;
      }
      if (flag.kind === "yellow_red_striped") slipperyCount++;
    }
    return {
      sc,
      vsc,
      vscEnding,
      red,
      chequered,
      fcy,
      code60,
      rain,
      doubleYellowCount,
      singleYellowCount,
      slipperyCount,
    };
  }, [topology?.panels, panels, panelOverrides]);

  if (!topology) {
    return (
      <div className="card flex h-full items-center justify-center text-slate-500">
        Loading topology...
      </div>
    );
  }

  const { width, height } = topology.viewport;

  return (
    <div className="card relative h-full overflow-hidden flex flex-col p-0 bg-slate-950/80">
      {/* ========================================================================= */}
      {/* FIA / F1 RACE CONTROL STATUS HUD OVERLAY                                  */}
      {/* ========================================================================= */}
      {globalIndicators.sc && (
        <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 z-20 flex items-center justify-between rounded-xl border-2 border-amber-400 bg-amber-950/95 px-3 py-1.5 sm:px-4 sm:py-2 text-amber-200 shadow-[0_0_25px_rgba(245,158,11,0.6)] backdrop-blur animate-pulse pointer-events-none">
          <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wider">
            <span className="text-base sm:text-lg">🚨</span>
            <span className="rounded bg-amber-400 px-2 py-0.5 font-black text-slate-950 text-xs sm:text-sm">
              SAFETY CAR
            </span>
            <span className="hidden sm:inline">DEPLOYED · PROHIBIDO ADELANTAR</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] sm:text-xs font-bold text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
            <span>SC ACTIVE</span>
          </div>
        </div>
      )}

      {globalIndicators.vsc && !globalIndicators.sc && (
        <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 z-20 flex items-center justify-between rounded-xl border-2 border-amber-400 bg-slate-950/95 px-3 py-1.5 sm:px-4 sm:py-2 text-amber-300 shadow-[0_0_25px_rgba(251,191,36,0.5)] backdrop-blur pointer-events-none">
          <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wider">
            <span className="text-base sm:text-lg text-amber-400">⚡</span>
            <span className="rounded border border-amber-400 bg-slate-900 px-2 py-0.5 font-mono font-black text-amber-300 text-xs sm:text-sm">
              VSC
            </span>
            <span className="hidden sm:inline font-bold">VIRTUAL SAFETY CAR · REDUCIR VELOCIDAD</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] sm:text-xs font-bold text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span>DELTA TIME</span>
          </div>
        </div>
      )}

      {globalIndicators.vscEnding && !globalIndicators.vsc && !globalIndicators.sc && (
        <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 z-20 flex items-center justify-between rounded-xl border-2 border-emerald-400 bg-slate-950/95 px-3 py-1.5 sm:px-4 sm:py-2 text-emerald-300 shadow-[0_0_25px_rgba(16,185,129,0.5)] backdrop-blur animate-pulse pointer-events-none">
          <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wider">
            <span className="text-base sm:text-lg">⚡🟢</span>
            <span className="rounded bg-emerald-500 px-2 py-0.5 font-black text-slate-950 text-xs sm:text-sm">
              VSC ENDING
            </span>
            <span className="hidden sm:inline font-bold">PREPARAR REINICIO · VERDE INMINENTE</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] sm:text-xs font-bold text-emerald-300">
            <span>RESUME SOON</span>
          </div>
        </div>
      )}

      {globalIndicators.red && (
        <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 z-20 flex items-center justify-between rounded-xl border-2 border-red-500 bg-red-950/95 px-3 py-1.5 sm:px-4 sm:py-2 text-red-100 shadow-[0_0_30px_rgba(239,68,68,0.7)] backdrop-blur animate-pulse pointer-events-none">
          <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wider">
            <span className="text-base sm:text-lg">🚩</span>
            <span className="rounded bg-red-600 px-2 py-0.5 font-black text-white text-xs sm:text-sm">
              RED FLAG
            </span>
            <span className="hidden sm:inline">SESIÓN SUSPENDIDA · REGRESAR A PIT LANE</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] sm:text-xs font-bold text-red-300">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping" />
            <span>SESSION STOPPED</span>
          </div>
        </div>
      )}

      {globalIndicators.rain && !globalIndicators.red && !globalIndicators.sc && !globalIndicators.vsc && (
        <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 z-20 flex items-center justify-between rounded-xl border-2 border-sky-400 bg-sky-950/95 px-3 py-1.5 sm:px-4 sm:py-2 text-sky-200 shadow-[0_0_25px_rgba(56,189,248,0.5)] backdrop-blur pointer-events-none">
          <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wider">
            <span className="text-base sm:text-lg">🌧️</span>
            <span className="rounded bg-sky-500 px-2 py-0.5 font-black text-slate-950 text-xs sm:text-sm">
              WET TRACK
            </span>
            <span className="hidden sm:inline font-bold">PISTA HÚMEDA · CONDICIONES DE LLUVIA</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] sm:text-xs font-bold text-sky-300">
            <span className="inline-block animate-bounce">💧</span>
            <span className="inline-block animate-bounce delay-100">💧</span>
            <span>RAIN ACTIVE</span>
          </div>
        </div>
      )}

      {globalIndicators.chequered && !globalIndicators.red && (
        <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 z-20 flex items-center justify-between rounded-xl border-2 border-slate-300 bg-slate-950/95 px-3 py-1.5 sm:px-4 sm:py-2 text-white shadow-2xl backdrop-blur pointer-events-none">
          <div className="flex items-center gap-2 font-black text-xs sm:text-sm tracking-wider">
            <span className="text-base sm:text-lg">🏁</span>
            <span className="rounded bg-white px-2 py-0.5 font-black text-slate-950 text-xs sm:text-sm">
              CHEQUERED FLAG
            </span>
            <span className="hidden sm:inline">SESIÓN FINALIZADA</span>
          </div>
          <span className="font-mono text-xs font-bold text-slate-300">FINISH</span>
        </div>
      )}

      {/* Local sector hazard summary if no top-level global alert */}
      {!globalIndicators.sc &&
        !globalIndicators.vsc &&
        !globalIndicators.vscEnding &&
        !globalIndicators.red &&
        !globalIndicators.rain &&
        !globalIndicators.chequered && (
          <div className="absolute top-2.5 left-3 right-3 z-20 flex flex-wrap items-center justify-between gap-2 text-xs pointer-events-none">
            <div className="flex items-center gap-2">
              {globalIndicators.doubleYellowCount > 0 ? (
                <span className="flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-500/60 px-2 py-0.5 font-extrabold text-[11px] text-amber-300 backdrop-blur shadow-sm animate-pulse">
                  <span>⚠️⚠️</span>
                  <span>{globalIndicators.doubleYellowCount} SECTOR(ES) DOUBLE YELLOW</span>
                </span>
              ) : globalIndicators.singleYellowCount > 0 ? (
                <span className="flex items-center gap-1 rounded-md bg-yellow-500/20 border border-yellow-500/50 px-2 py-0.5 font-bold text-[11px] text-yellow-300 backdrop-blur">
                  <span>⚠️</span>
                  <span>{globalIndicators.singleYellowCount} SECTOR(ES) AMARILLO SIMPLE</span>
                </span>
              ) : (
                <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400 backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>PISTA LIBRE · GREEN TRACK</span>
                </div>
              )}

              {globalIndicators.slipperyCount > 0 && (
                <span className="flex items-center gap-1 rounded-md bg-orange-500/20 border border-orange-500/60 px-2 py-0.5 font-bold text-[11px] text-orange-300 backdrop-blur">
                  <span>🟡🔴</span>
                  <span>{globalIndicators.slipperyCount} RESBALADIZO</span>
                </span>
              )}
            </div>
          </div>
        )}

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

          {/* Double Yellow Hazard Diagonal Stripes */}
          <pattern
            id="pattern-double-yellow"
            width="16"
            height="16"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="8" height="16" fill="#f59e0b" />
            <rect x="8" width="8" height="16" fill="#0f172a" />
          </pattern>

          {/* Rain / Wet Track: Slanted aqua rain droplets & ripples */}
          <pattern
            id="pattern-rain"
            width="20"
            height="20"
            patternTransform="rotate(-25)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="20" height="20" fill="#0369a1" />
            <line x1="3" y1="0" x2="3" y2="9" stroke="#7dd3fc" strokeWidth="1.6" strokeLinecap="round" opacity="0.85" />
            <line x1="13" y1="8" x2="13" y2="17" stroke="#bae6fd" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
            <circle cx="10" cy="5" r="3" fill="none" stroke="#38bdf8" strokeWidth="0.8" opacity="0.6" />
          </pattern>

          {/* Slippery: Alternating yellow and red stripes */}
          <pattern
            id="pattern-slippery"
            width="16"
            height="16"
            patternTransform="rotate(90)"
            patternUnits="userSpaceOnUse"
          >
            <rect width="8" height="16" fill="#eab308" />
            <rect x="8" width="8" height="16" fill="#dc2626" />
          </pattern>

          {/* Chequered flag texture */}
          <pattern id="pattern-chequered" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#f8fafc" />
            <rect x="6" width="6" height="6" fill="#0f172a" />
            <rect y="6" width="6" height="6" fill="#0f172a" />
            <rect x="6" y="6" width="6" height="6" fill="#f8fafc" />
          </pattern>

          {/* Glow filters */}
          <filter id="glow-double-yellow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#f59e0b" floodOpacity="0.95" />
          </filter>
          <filter id="glow-rain" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#38bdf8" floodOpacity="0.95" />
          </filter>
          <filter id="glow-sc" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ff7a00" floodOpacity="0.85" />
          </filter>
        </defs>

        <rect width={width} height={height} fill="url(#track-grad)" />

        {/* Legend of zones along the top edge. */}
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

        {/* Global procedure outer circuit glow */}
        {globalIndicators.sc && (
          <path
            d={racingLinePath}
            fill="none"
            stroke="#ff7a00"
            strokeWidth={32}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="animate-pulse opacity-60"
            filter="url(#glow-sc)"
          />
        )}
        {globalIndicators.vsc && (
          <path
            d={racingLinePath}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={30}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="animate-pulse opacity-50"
            filter="url(#glow-double-yellow)"
          />
        )}
        {globalIndicators.red && (
          <path
            d={racingLinePath}
            fill="none"
            stroke="#dc2626"
            strokeWidth={32}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="animate-pulse opacity-70"
          />
        )}

        {/* Outer track borders / Curbs */}
        <path
          d={racingLinePath}
          fill="none"
          stroke="#334155"
          strokeWidth={28}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Base dark asphalt */}
        <path
          d={racingLinePath}
          fill="none"
          stroke="#0f172a"
          strokeWidth={22}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Sector Asphalt Segments: painted with distinct patterns & authentic F1 styles */}
        {sectorGeometries.map(({ panel: p, pathD }) => {
          const live = panels[p.id];
          const flag =
            panelOverrides?.[p.id] ??
            live?.effective_state ??
            ({ kind: "off" } as FlagState);
          const display = describeFlag(flag);
          const isHighlight = highlightPanel === p.id;
          const isOff = flag.kind === "off";
          const isDoubleYellow = flag.kind === "yellow" && flag.data === "double";
          const isSingleYellow = flag.kind === "yellow" && flag.data !== "double";
          const isRain = flag.kind === "rain";
          const isSlippery = flag.kind === "yellow_red_striped";
          const isChequered = flag.kind === "chequered";
          const fill = svgFlagColour(flag);
          const pulse = !isOff && display.flashing ? "animate-flag-flash" : "";

          // Double Yellow: Diagonal hazard stripes + energetic flashing amber aura
          if (isDoubleYellow) {
            return (
              <g
                key={`sector-dy-${p.id}`}
                className="cursor-pointer"
                onClick={() => onPanelClick?.(p)}
              >
                {/* Amber flashing hazard underglow */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={26}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                  className="animate-pulse opacity-85"
                  filter="url(#glow-double-yellow)"
                />
                {/* 45° diagonal hazard stripes road surface */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#pattern-double-yellow)"
                  strokeWidth={22}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                />
                <title>
                  Sector {p.sector} · Panel #{p.id} · DOUBLE YELLOW (PELIGRO MÁXIMO)
                </title>
              </g>
            );
          }

          // Single Yellow: Solid caution yellow with gentle caution pulse
          if (isSingleYellow) {
            return (
              <path
                key={`sector-sy-${p.id}`}
                d={pathD}
                fill="none"
                stroke="#facc15"
                strokeWidth={isHighlight ? 24 : 22}
                strokeLinejoin="round"
                strokeLinecap="butt"
                className="cursor-pointer transition-colors duration-150 animate-flag-flash"
                style={{ filter: "drop-shadow(0 0 7px rgba(250, 204, 21, 0.85))" }}
                onClick={() => onPanelClick?.(p)}
              >
                <title>
                  Sector {p.sector} · Panel #{p.id} · YELLOW (PRECAUCIÓN SIMPLE)
                </title>
              </path>
            );
          }

          // Rain: Aqua/cyan wet asphalt with slanted rain streaks and ripple rings
          if (isRain) {
            return (
              <g
                key={`sector-rain-${p.id}`}
                className="cursor-pointer"
                onClick={() => onPanelClick?.(p)}
              >
                {/* Cyan wet road glow */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="#0284c7"
                  strokeWidth={26}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                  className="opacity-80"
                  filter="url(#glow-rain)"
                />
                {/* Rain pattern with slanted drops */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#pattern-rain)"
                  strokeWidth={22}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                />
                <title>
                  Sector {p.sector} · Panel #{p.id} · RAIN (PISTA HÚMEDA · GOTAS)
                </title>
              </g>
            );
          }

          // Slippery: Vertical yellow and red stripes
          if (isSlippery) {
            return (
              <g
                key={`sector-slippery-${p.id}`}
                className="cursor-pointer"
                onClick={() => onPanelClick?.(p)}
              >
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#pattern-slippery)"
                  strokeWidth={22}
                  strokeLinejoin="round"
                  strokeLinecap="butt"
                />
                <title>
                  Sector {p.sector} · Panel #{p.id} · SLIPPERY (ACEITE / AGUA)
                </title>
              </g>
            );
          }

          // Chequered: Checkered squares texture
          if (isChequered) {
            return (
              <path
                key={`sector-chq-${p.id}`}
                d={pathD}
                fill="none"
                stroke="url(#pattern-chequered)"
                strokeWidth={22}
                strokeLinejoin="round"
                strokeLinecap="butt"
                className="cursor-pointer"
                onClick={() => onPanelClick?.(p)}
              />
            );
          }

          // Other flags: Green, Blue, Red, Off, etc.
          return (
            <path
              key={`sector-asphalt-${p.id}`}
              d={pathD}
              fill="none"
              stroke={isOff ? (isHighlight ? "#1e293b" : "#0f172a") : fill}
              strokeWidth={isHighlight ? 24 : 22}
              strokeLinejoin="round"
              strokeLinecap="butt"
              className={`cursor-pointer transition-colors duration-150 ${isOff ? "hover:stroke-slate-700" : pulse}`}
              style={!isOff ? { color: fill, filter: "drop-shadow(0 0 5px currentColor)" } : undefined}
              onClick={() => onPanelClick?.(p)}
            >
              <title>
                Sector {p.sector} · Panel #{p.id} · Zona {p.zone}
                {!isOff ? ` · ${display.label}` : ""}
              </title>
            </path>
          );
        })}

        {/* Sector Demarcation Ticks (subtle dividers marking where each sector begins/ends) */}
        {sectorGeometries.map(({ panel: p, demarcation: d }) => (
          <line
            key={`demarcation-${p.id}`}
            x1={d.x1}
            y1={d.y1}
            x2={d.x2}
            y2={d.y2}
            stroke="#475569"
            strokeWidth={1.5}
            strokeLinecap="square"
            pointerEvents="none"
          />
        ))}

        {/* Start / Finish Line (Línea de Sentencia) */}
        {startFinish && (
          <g pointerEvents="none">
            {/* Checkered finish line across track */}
            <line
              x1={startFinish.x1}
              y1={startFinish.y1}
              x2={startFinish.x2}
              y2={startFinish.y2}
              stroke="#f8fafc"
              strokeWidth={3}
              strokeDasharray="3 3"
            />
            {/* Checkered flag badge on pit-wall side */}
            <g transform={`translate(${startFinish.flagX.toFixed(2)} ${startFinish.flagY.toFixed(2)})`}>
              <circle r={8} fill="#0f172a" stroke="#f8fafc" strokeWidth={1.2} />
              <text y={3} textAnchor="middle" fontSize={9}>🏁</text>
              <title>Línea de Sentencia · Meta / Llegada</title>
            </g>
            {/* Direction arrow badge on outer side */}
            <g
              transform={`translate(${startFinish.arrowX.toFixed(2)} ${startFinish.arrowY.toFixed(2)}) rotate(${startFinish.bearing.toFixed(1)})`}
            >
              <circle r={6.5} fill="#10b981" stroke="#0f172a" strokeWidth={1} />
              <path d="M -2.5 -3 L 2.5 0 L -2.5 3 Z" fill="#ffffff" />
            </g>
          </g>
        )}

        {/* Track Centerline (dashed line over the asphalt) */}
        <path
          d={racingLinePath}
          fill="none"
          stroke="#64748b"
          strokeOpacity={0.45}
          strokeWidth={1.2}
          strokeDasharray="6 8"
          strokeLinejoin="round"
          pointerEvents="none"
        />

        {/* Trackside Badges (replacing the old grey boxes on the road) */}
        {sectorGeometries.map(({ panel: p, badgePos }) => {
          const live = panels[p.id];
          const flag =
            panelOverrides?.[p.id] ??
            live?.effective_state ??
            ({ kind: "off" } as FlagState);
          const display = describeFlag(flag);
          const isHighlight = highlightPanel === p.id;
          const isOff = flag.kind === "off";
          const isDoubleYellow = flag.kind === "yellow" && flag.data === "double";
          const isRain = flag.kind === "rain";
          const isSC = flag.kind === "safety_car";
          const isVSC = flag.kind === "virtual_safety_car";
          const isChequered = flag.kind === "chequered";
          const isSlippery = flag.kind === "yellow_red_striped";

          const fill = isOff ? "#0f172a" : svgFlagColour(flag);
          const textFill = isOff ? "#94a3b8" : svgFlagTextColour(flag);
          const border = isHighlight ? "#38bdf8" : isOff ? "#334155" : svgFlagTextColour(flag);
          const label =
            !isOff && labelFor(flag) !== "—"
              ? labelFor(flag)
              : p.id < 10
                ? `0${p.id}`
                : `${p.id}`;
          const pulse = !isOff && display.flashing ? "animate-flag-flash" : "";

          // Double Yellow badge: high-visibility hazard black & gold circle with outer ring
          if (isDoubleYellow) {
            return (
              <g
                key={`badge-${p.id}`}
                transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
                className="cursor-pointer transition-transform duration-150 hover:scale-125 animate-pulse"
                onClick={() => onPanelClick?.(p)}
              >
                <circle
                  r={13}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={1.8}
                  strokeDasharray="3 2"
                />
                <circle
                  r={9.5}
                  fill="#f59e0b"
                  stroke="#000000"
                  strokeWidth={1.5}
                  className="drop-shadow"
                />
                <text
                  y={3}
                  textAnchor="middle"
                  fontSize={7}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={900}
                  fill="#000000"
                >
                  YY
                </text>
                <title>
                  Panel #{p.id} · DOUBLE YELLOW (PELIGRO MÁXIMO)
                </title>
              </g>
            );
          }

          // Rain badge: aqua-cyan with water droplet icon
          if (isRain) {
            return (
              <g
                key={`badge-${p.id}`}
                transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
                className="cursor-pointer transition-transform duration-150 hover:scale-125"
                onClick={() => onPanelClick?.(p)}
              >
                <circle
                  r={12}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  className="animate-ping opacity-50"
                />
                <circle
                  r={9.5}
                  fill="#0284c7"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  className="drop-shadow"
                />
                <text y={3.5} textAnchor="middle" fontSize={8}>
                  🌧️
                </text>
                <title>Panel #{p.id} · RAIN (PISTA HÚMEDA)</title>
              </g>
            );
          }

          // SC badge: amber emergency roof lightbar theme
          if (isSC) {
            return (
              <g
                key={`badge-${p.id}`}
                transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
                className="cursor-pointer transition-transform duration-150 hover:scale-125 animate-pulse"
                onClick={() => onPanelClick?.(p)}
              >
                <circle
                  r={13}
                  fill="none"
                  stroke="#ff7a00"
                  strokeWidth={2}
                  className="animate-ping opacity-60"
                />
                <circle
                  r={9.5}
                  fill="#ff7a00"
                  stroke="#000000"
                  strokeWidth={1.5}
                  className="drop-shadow"
                />
                <text
                  y={3}
                  textAnchor="middle"
                  fontSize={7}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={900}
                  fill="#000000"
                >
                  SC
                </text>
                <title>Panel #{p.id} · SAFETY CAR</title>
              </g>
            );
          }

          // VSC badge: high-contrast neon amber on carbon black
          if (isVSC) {
            return (
              <g
                key={`badge-${p.id}`}
                transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
                className="cursor-pointer transition-transform duration-150 hover:scale-125"
                onClick={() => onPanelClick?.(p)}
              >
                <circle
                  r={9.5}
                  fill="#0f172a"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  className="drop-shadow"
                />
                <text
                  y={3}
                  textAnchor="middle"
                  fontSize={6.5}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={900}
                  fill="#fbbf24"
                >
                  VSC
                </text>
                <title>Panel #{p.id} · VIRTUAL SAFETY CAR</title>
              </g>
            );
          }

          // Chequered flag badge
          if (isChequered) {
            return (
              <g
                key={`badge-${p.id}`}
                transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
                className="cursor-pointer transition-transform duration-150 hover:scale-125"
                onClick={() => onPanelClick?.(p)}
              >
                <circle
                  r={9.5}
                  fill="#0f172a"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  className="drop-shadow"
                />
                <text y={3.5} textAnchor="middle" fontSize={8}>
                  🏁
                </text>
                <title>Panel #{p.id} · CHEQUERED</title>
              </g>
            );
          }

          // Slippery badge
          if (isSlippery) {
            return (
              <g
                key={`badge-${p.id}`}
                transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
                className="cursor-pointer transition-transform duration-150 hover:scale-125"
                onClick={() => onPanelClick?.(p)}
              >
                <circle
                  r={9.5}
                  fill="#eab308"
                  stroke="#dc2626"
                  strokeWidth={2}
                  className="drop-shadow"
                />
                <text
                  y={3}
                  textAnchor="middle"
                  fontSize={6.5}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={900}
                  fill="#dc2626"
                >
                  OIL
                </text>
                <title>Panel #{p.id} · SLIPPERY</title>
              </g>
            );
          }

          // Standard badge (post number or flag code)
          return (
            <g
              key={`badge-${p.id}`}
              transform={`translate(${badgePos.x.toFixed(2)} ${badgePos.y.toFixed(2)})`}
              className={`cursor-pointer transition-transform duration-150 hover:scale-125 ${pulse}`}
              onClick={() => onPanelClick?.(p)}
            >
              {isHighlight && (
                <circle
                  r={13}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  className="animate-ping opacity-60"
                />
              )}
              <circle
                r={9}
                fill={fill}
                stroke={border}
                strokeWidth={isHighlight ? 2.5 : 1.2}
                className={!isOff ? "drop-shadow" : ""}
              />
              <text
                y={3}
                textAnchor="middle"
                fontSize={label.length > 2 ? 7 : 8}
                fontFamily="ui-monospace, monospace"
                fontWeight={700}
                fill={textFill}
              >
                {label}
              </text>
              <title>
                Panel #{p.id} · Sector {p.sector} · Zona {p.zone} · {display.label}
              </title>
            </g>
          );
        })}

        {/* Marshal posts (rendered after panels so they remain clearly visible) */}
        {(topology.posts ?? []).map((post) => {
          const fill = post.kind === "led_controller"
            ? "#38bdf8"
            : post.kind === "track"
              ? "#f97316"
              : "#22c55e";
          return (
            <g
              key={`post-${post.id}`}
              transform={`translate(${post.x} ${post.y})`}
              className="cursor-pointer"
            >
              <line
                x1={0}
                y1={-11}
                x2={0}
                y2={4}
                stroke="#e2e8f0"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
              <path
                d="M 0 -11 Q 5 -13 11 -10 Q 5 -7 0 -5 Z"
                fill={fill}
                stroke="#0f172a"
                strokeWidth={0.6}
              />
              <circle cx={0} cy={4} r={1.6} fill="#64748b" />
              <title>
                Puesto {post.label} · zona {post.zone} · sector {post.sector} · {Math.round(post.distance_m)} m
              </title>
            </g>
          );
        })}

        {/* Cars overlay */}
        {!hideCars && (
          <CarsLayer
            topology={topology}
            cars={cars}
            sampler={sampler}
            postDistanceMap={postDistanceMap}
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
  sampler: TrackSampler;
  postDistanceMap: Map<number, number>;
  panelStates: Record<number, import("@/types/Panel").Panel>;
  panelOverrides?: Record<number, FlagState>;
}

function CarsLayer({
  topology,
  cars,
  sampler,
  postDistanceMap,
  panelStates,
  panelOverrides,
}: CarsLayerProps) {
  return (
    <g>
      {cars.map((car) => (
        <AnimatedCar
          key={String(car.number)}
          topology={topology}
          car={car}
          sampler={sampler}
          postDistanceMap={postDistanceMap}
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
  sampler: TrackSampler;
  postDistanceMap: Map<number, number>;
  panelStates: Record<number, import("@/types/Panel").Panel>;
  panelOverrides?: Record<number, FlagState>;
}

const CAR_LERP_MS = 550;

const AnimatedCar = memo(function AnimatedCar({
  topology,
  car,
  sampler,
  postDistanceMap,
  panelStates,
  panelOverrides,
}: AnimatedCarProps) {
  const targetDistance =
    car.zone != null ? postDistanceMap.get(car.zone as number) ?? null : null;
  const currentDistRef = useRef<number | null>(targetDistance);
  const gRef = useRef<SVGGElement>(null);

  // Stagger cars along and across the track based on car number
  const carNum = Number(car.number) || 0;
  // Lateral lane offset: -5.6px to +5.6px within the 22px asphalt track
  const lane = ((carNum * 7) % 5) - 2;
  const lateralOffset = lane * 2.8;
  // Longitudinal stagger: -9m to +9m so cars at the same post don't stack directly on top
  const longStagger = (((carNum * 13) % 7) - 3) * 3;

  const getPositionAt = useCallback(
    (distM: number) => {
      const trackLen = sampler.trackLengthM;
      const actualDist = ((distM + longStagger) % trackLen + trackLen) % trackLen;
      const [cx, cy, bearing] = sampler.sampleAt(actualDist);
      const rad = (bearing * Math.PI) / 180;
      const nx = Math.sin(rad);
      const ny = -Math.cos(rad);
      return {
        x: cx + lateralOffset * nx,
        y: cy + lateralOffset * ny,
      };
    },
    [sampler, lateralOffset, longStagger]
  );

  useEffect(() => {
    if (!gRef.current) return;
    if (targetDistance == null) {
      gRef.current.style.display = "none";
      currentDistRef.current = null;
      return;
    }
    gRef.current.style.display = "";

    const trackLen = sampler.trackLengthM;
    if (currentDistRef.current == null) {
      currentDistRef.current = targetDistance;
      const pos = getPositionAt(targetDistance);
      gRef.current.setAttribute("transform", `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`);
      return;
    }

    const startDist = currentDistRef.current;
    let forwardDelta = targetDistance - (startDist % trackLen);
    while (forwardDelta < 0) forwardDelta += trackLen;

    // If jump is backwards or huge reset (over 90% of lap backwards):
    if (forwardDelta > trackLen * 0.9) {
      forwardDelta = targetDistance - startDist;
    }

    const startTime = performance.now();
    let frame: number;

    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / CAR_LERP_MS);
      // Smooth linear-to-quadratic easing for racecar motion
      const eased = t * (2 - t);
      const currDist = startDist + forwardDelta * eased;
      currentDistRef.current = currDist;

      const pos = getPositionAt(currDist);
      if (gRef.current) {
        gRef.current.setAttribute("transform", `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`);
      }

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        currentDistRef.current = targetDistance;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [targetDistance, sampler, getPositionAt]);

  const initialPos = targetDistance != null ? getPositionAt(targetDistance) : { x: 0, y: 0 };

  // Colour reflects whatever flag is showing in the car's zone (if any).
  const zonePanels =
    car.zone != null
      ? topology.panels.filter(
          (p) =>
            (p.zone as number) === (car.zone as number) ||
            (p.id as number) === (car.zone as number)
        )
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
    <g
      ref={gRef}
      transform={`translate(${initialPos.x.toFixed(2)} ${initialPos.y.toFixed(2)})`}
      style={{ display: targetDistance != null ? "" : "none" }}
    >
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
});

// Re-export to silence the unused warning while keeping the surface intact.
export type { ZoneTopology };

function svgFlagColour(flag: import("@/types/FlagState").FlagState): string {
  switch (flag.kind) {
    case "off":
      return "#1f2937";
    case "green":
      return "#0bd964";
    case "yellow":
      return flag.data === "double" ? "#f59e0b" : "#facc15";
    case "blue":
      return "#1d4ed8";
    case "white":
      return "#f8fafc";
    case "yellow_red_striped":
      return "#f59e0b";
    case "rain":
      return "#0284c7";
    case "red":
      return "#dc2626";
    case "chequered":
      return "#111827";
    case "safety_car":
      return "#ff7a00";
    case "virtual_safety_car":
      return "#fbbf24";
    case "vsc_ending":
      return "#10b981";
    case "full_course_yellow":
      return "#f59e0b";
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
