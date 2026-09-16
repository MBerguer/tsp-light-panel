import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { describeFlag } from "@/lib/flag";
import type { FlagState } from "@/types/FlagState";

interface Props {
  /** Initial panel ID to bind to. If omitted, reads from URL (?panel=X) or defaults to 1. */
  defaultPanelId?: number;
  /** When true, runs in kiosk mode with controls hidden by default. */
  kioskMode?: boolean;
  /** Optional callback to return to dashboard. */
  onClose?: () => void;
}

type AspectRatio = "1:1" | "4:3" | "16:9" | "stretch";

/**
 * Fullscreen Digital Light Panel View.
 * Emulates official FIA Grade 1/2/3 trackside LED light panels (EM Motorsport / Pixelcom / MYLAPS).
 * Designed to run on Raspberry Pi, industrial mini-PCs, or browser kiosks connected
 * directly to physical high-brightness outdoor LED matrix screens.
 */
export function LightPanelView({
  defaultPanelId,
  kioskMode: initialKiosk = false,
  onClose,
}: Props) {
  const panels = useStore((s) => s.panels);
  const topology = useStore((s) => s.topology);
  const status = useStore((s) => s.status);

  // Read panel ID from URL search query (?panel=3 or ?post=3) if available
  const urlParamPanel = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const p = params.get("panel") ?? params.get("post") ?? params.get("id");
    return p ? parseInt(p, 10) : null;
  }, []);

  const [panelId, setPanelId] = useState<number>(
    defaultPanelId ?? urlParamPanel ?? 1
  );

  // Available panels in topology (or 1..16 fallback)
  const availablePanelIds = useMemo(() => {
    if (topology?.panels && topology.panels.length > 0) {
      return topology.panels.map((p) => p.id).sort((a, b) => a - b);
    }
    return Array.from({ length: 16 }, (_, i) => i + 1);
  }, [topology]);

  const [aspect, setAspect] = useState<AspectRatio>("1:1");
  const [ledSimulation, setLedSimulation] = useState<boolean>(false);
  const [showToolbar, setShowToolbar] = useState<boolean>(!initialKiosk);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Current effective flag state for this panel
  const panel = panels[panelId];
  const flagState: FlagState = panel?.effective_state ?? { kind: "off" };
  const flagDisplay = describeFlag(flagState);

  // Keep screen awake via Wake Lock API
  useEffect(() => {
    let wakeLock: any = null;
    async function requestWakeLock() {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await (navigator as any).wakeLock.request("screen");
        }
      } catch {
        // WakeLock may fail if window not focused
      }
    }
    requestWakeLock();
    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, []);

  // Sync fullscreen state
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {}
    } else {
      try {
        await document.exitFullscreen();
      } catch {}
    }
  };

  const currentPanelMeta = topology?.panels?.find((p) => p.id === panelId);

  return (
    <div
      className="relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-black font-sans"
      onDoubleClick={toggleFullscreen}
    >
      {/* Floating settings button to reveal toolbar if hidden in kiosk */}
      {!showToolbar && (
        <button
          type="button"
          onClick={() => setShowToolbar(true)}
          className="absolute top-2 right-2 z-50 rounded-full bg-slate-900/60 p-2 text-slate-400 opacity-20 hover:opacity-100 transition-opacity backdrop-blur"
          title="Abrir controles del panel"
        >
          ⚙️
        </button>
      )}

      {/* Floating Toolbar & Status Drawer */}
      {showToolbar && (
        <div className="absolute top-3 left-3 right-3 z-50 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-950/85 px-4 py-2.5 shadow-2xl backdrop-blur-md text-xs">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-widest text-sky-400 text-xs">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400 animate-pulse" />
              PANEL FÍSICO
            </span>

            {/* Panel Selector */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="panel-select" className="text-slate-400 font-semibold">
                Puesto:
              </label>
              <select
                id="panel-select"
                value={panelId}
                onChange={(e) => setPanelId(Number(e.target.value))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-slate-100 font-mono font-bold focus:outline-none focus:border-sky-500"
              >
                {availablePanelIds.map((id) => (
                  <option key={id} value={id}>
                    Panel #{id} {topology?.name ? `(${topology.name})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {currentPanelMeta && (
              <span className="hidden sm:inline text-[11px] text-slate-400 font-mono">
                Zona {currentPanelMeta.zone} · Sector {currentPanelMeta.sector} · {Math.round(currentPanelMeta.distance_m)}m
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Aspect Ratio Toggle */}
            <div className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-[10px] font-bold">
              {(["1:1", "4:3", "16:9", "stretch"] as AspectRatio[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAspect(r)}
                  className={`rounded px-2 py-0.5 transition-all ${
                    aspect === r ? "bg-sky-600 text-white shadow" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* LED Matrix Simulator Toggle */}
            <button
              type="button"
              onClick={() => setLedSimulation(!ledSimulation)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-all ${
                ledSimulation
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
              title="Añade textura de rejilla de matriz de LED física"
            >
              LED Matrix: {ledSimulation ? "ON" : "OFF"}
            </button>

            {/* Fullscreen Button */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-slate-200 font-semibold border border-slate-700 active:scale-95 transition-all"
              title="Alternar Pantalla Completa (F11)"
            >
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen ⛶"}
            </button>

            {/* Close / Hide Controls */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-red-950/40 hover:bg-red-900/60 px-2 py-1 text-red-300 font-bold border border-red-500/30"
                title="Volver al Panel de Control"
              >
                ✕ Volver
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowToolbar(false)}
              className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2 py-1 text-slate-400 hover:text-white"
              title="Ocultar barra para modo pantalla fija"
            >
              ▲
            </button>
          </div>
        </div>
      )}

      {/* Main Display Box with Aspect Ratio Constraint */}
      <div
        className={`relative flex items-center justify-center overflow-hidden transition-all duration-100 ${
          aspect === "1:1"
            ? "aspect-square h-full max-h-screen max-w-[100vh] w-auto"
            : aspect === "4:3"
              ? "aspect-[4/3] h-full max-h-screen max-w-[133vh] w-auto"
              : aspect === "16:9"
                ? "aspect-video h-full max-h-screen max-w-[177vh] w-auto"
                : "h-full w-full"
        }`}
      >
        {/* Render the Active Flag Graphic */}
        <PanelFlagCanvas flag={flagState} panelId={panelId} />

        {/* LED Matrix Simulator Overlay (Subtle dot-matrix scanline texture) */}
        {ledSimulation && (
          <div
            className="pointer-events-none absolute inset-0 z-30 opacity-40 mix-blend-multiply"
            style={{
              backgroundImage: `radial-gradient(circle, transparent 40%, rgba(0, 0, 0, 0.95) 75%)`,
              backgroundSize: "8px 8px",
            }}
          />
        )}
      </div>

      {/* Corner Telemetry Watermark (Dim heartbeat indicator so marshals know panel is live) */}
      <div className="pointer-events-none absolute bottom-2 right-3 z-40 flex items-center gap-2 font-mono text-[10px] text-slate-500/50">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status === "open" ? "bg-emerald-500/70" : "bg-red-500/70"
          }`}
        />
        <span>POST #{panelId < 10 ? `0${panelId}` : panelId}</span>
        <span>·</span>
        <span>{flagDisplay.label}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Internal Screen Renderers: Replicates real FIA Digi-Flag Visual Output
// ============================================================================

function PanelFlagCanvas({ flag, panelId }: { flag: FlagState; panelId: number }) {
  switch (flag.kind) {
    case "off":
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-black text-slate-700">
          <div className="flex flex-col items-center gap-2 opacity-30">
            <span className="font-mono text-5xl font-black">
              #{panelId < 10 ? `0${panelId}` : panelId}
            </span>
            <span className="font-mono text-xs uppercase tracking-widest">
              STANDBY · SYSTEM READY
            </span>
          </div>
        </div>
      );

    case "green":
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#00e65b] text-slate-950">
          {/* Authentic full-screen ultra-bright racing green */}
          <div className="flex flex-col items-center justify-center">
            <span className="text-[15vmin] font-black tracking-wider leading-none">
              GREEN
            </span>
            <span className="text-[4vmin] font-extrabold uppercase tracking-widest opacity-90 mt-2">
              TRACK CLEAR
            </span>
          </div>
        </div>
      );

    case "yellow":
      if (flag.data === "double") {
        return (
          <div
            className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-amber-500"
            style={{
              backgroundImage: `repeating-linear-gradient(45deg, #f59e0b, #f59e0b 6vmin, #000000 6vmin, #000000 12vmin)`,
            }}
          >
            {/* Center High-Contrast Hazard Plaque */}
            <div className="z-10 flex flex-col items-center justify-center rounded-3xl bg-slate-950/95 p-[4vmin] border-[1vmin] border-amber-400 shadow-2xl">
              <div className="flex items-center gap-[2vmin]">
                <span className="text-[8vmin]">⚠️</span>
                <span className="text-[10vmin] font-black tracking-wider text-amber-400 leading-none">
                  DOUBLE
                </span>
                <span className="text-[8vmin]">⚠️</span>
              </div>
              <span className="text-[7vmin] font-black tracking-tight text-amber-300">
                YELLOW
              </span>
              <span className="text-[3vmin] font-black uppercase tracking-widest text-amber-400/90 mt-1">
                GREAT DANGER · SLOW DOWN
              </span>
            </div>
          </div>
        );
      }

      // Single Yellow
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#ffcc00] text-slate-950 p-6">
          <div className="flex flex-col items-center justify-center text-center">
            <span className="text-[18vmin] leading-none mb-2">⚠️</span>
            <span className="text-[13vmin] font-black tracking-wider leading-none">
              YELLOW
            </span>
            <span className="text-[4vmin] font-extrabold uppercase tracking-widest text-slate-950/90 mt-2">
              CAUTION · NO OVERTAKING
            </span>
          </div>
        </div>
      );

    case "blue":
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-[#0055ff] text-white p-6">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex items-center gap-[3vmin] mb-2">
              <span className="text-[16vmin] leading-none">⇥</span>
              <span className="text-[14vmin] font-black tracking-wider leading-none">
                BLUE
              </span>
            </div>
            <span className="text-[4.5vmin] font-black uppercase tracking-widest text-sky-200">
              GIVE WAY · OVERTAKE
            </span>
          </div>
        </div>
      );

    case "red":
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#ff0022] text-white p-6">
          <div className="flex flex-col items-center justify-center text-center">
            <span className="text-[16vmin] leading-none mb-2">🚩</span>
            <span className="text-[14vmin] font-black tracking-wider leading-none">
              RED FLAG
            </span>
            <span className="text-[4vmin] font-black uppercase tracking-widest text-white/95 mt-2">
              STOP · RETURN TO PIT
            </span>
          </div>
        </div>
      );

    case "rain":
      return (
        <div
          className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-sky-700 text-white p-6"
          style={{
            backgroundImage: `repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0px, rgba(255, 255, 255, 0.15) 3px, transparent 3px, transparent 18px), linear-gradient(180deg, #0284c7 0%, #0369a1 100%)`,
          }}
        >
          <div className="z-10 flex flex-col items-center justify-center text-center">
            <div className="flex items-center gap-[2vmin] mb-2">
              <span className="text-[12vmin]">🌧️</span>
              <span className="text-[8vmin] text-sky-200">💧</span>
              <span className="text-[10vmin] text-sky-100">💧</span>
            </div>
            <span className="text-[14vmin] font-black tracking-wider leading-none drop-shadow-lg">
              RAIN
            </span>
            <span className="text-[4.5vmin] font-black uppercase tracking-widest text-sky-200 mt-2">
              WET TRACK · LOW GRIP
            </span>
          </div>
        </div>
      );

    case "yellow_red_striped":
      return (
        <div
          className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, #eab308, #eab308 10vmin, #dc2626 10vmin, #dc2626 20vmin)`,
          }}
        >
          <div className="z-10 rounded-3xl bg-slate-950/90 border-[1vmin] border-amber-400 p-[5vmin] text-center shadow-2xl">
            <span className="text-[10vmin] font-black tracking-wider text-amber-300 leading-none">
              SLIPPERY
            </span>
            <span className="block text-[4vmin] font-bold text-slate-200 uppercase tracking-widest mt-2">
              OIL · WATER · DEBRIS
            </span>
          </div>
        </div>
      );

    case "safety_car":
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-[#ff8800] text-slate-950 p-6">
          {/* Alternating Emergency Strobe Lightbar on top */}
          <div className="absolute top-[5vmin] flex items-center gap-[2vmin]">
            <span className="h-[3vmin] w-[10vmin] rounded-full bg-white shadow-[0_0_15px_#fff]" />
            <span className="h-[3vmin] w-[10vmin] rounded-full bg-slate-950 shadow-[0_0_15px_#000]" />
            <span className="h-[3vmin] w-[10vmin] rounded-full bg-white shadow-[0_0_15px_#fff]" />
          </div>

          <div className="flex flex-col items-center justify-center text-center mt-[4vmin]">
            <span className="text-[22vmin] font-black tracking-widest leading-none">
              SC
            </span>
            <span className="text-[5vmin] font-black uppercase tracking-widest text-amber-950">
              SAFETY CAR DEPLOYED
            </span>
          </div>
        </div>
      );

    case "virtual_safety_car":
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-[#050811] text-amber-400 p-6 border-[2vmin] border-amber-400">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex items-center gap-[2vmin]">
              <span className="text-[12vmin] text-amber-400">⚡</span>
              <span className="text-[20vmin] font-black tracking-widest leading-none font-mono text-amber-300 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]">
                VSC
              </span>
            </div>
            <span className="text-[4.5vmin] font-black uppercase tracking-widest text-amber-400 mt-2">
              VIRTUAL SAFETY CAR · DELTA
            </span>
          </div>
        </div>
      );

    case "vsc_ending":
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-r from-amber-500 via-emerald-500 to-emerald-600 text-slate-950 p-6">
          <div className="flex flex-col items-center justify-center text-center">
            <span className="text-[18vmin] font-black tracking-wider leading-none">
              VSC END
            </span>
            <span className="text-[4.5vmin] font-black uppercase tracking-widest text-slate-950/90 mt-3">
              PREPARE TO RESUME RACING
            </span>
          </div>
        </div>
      );

    case "chequered":
      return (
        <div
          className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden"
          style={{
            backgroundImage: `repeating-conic-gradient(#000000 0% 25%, #ffffff 0% 50%)`,
            backgroundPosition: "50%",
            backgroundSize: "16vmin 16vmin",
          }}
        >
          <div className="z-10 rounded-3xl bg-slate-950/90 border-[1vmin] border-white p-[5vmin] text-center shadow-2xl">
            <span className="text-[10vmin]">🏁</span>
            <span className="block text-[12vmin] font-black tracking-wider text-white leading-none mt-1">
              FINISH
            </span>
            <span className="block text-[3.5vmin] font-bold text-slate-300 uppercase tracking-widest mt-2">
              CHEQUERED FLAG · SESSION END
            </span>
          </div>
        </div>
      );

    case "white":
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-white text-slate-900 p-6">
          <div className="flex flex-col items-center justify-center text-center">
            <span className="text-[16vmin] leading-none mb-2">🚗💨</span>
            <span className="text-[14vmin] font-black tracking-wider leading-none">
              WHITE
            </span>
            <span className="text-[4vmin] font-black uppercase tracking-widest text-slate-700 mt-2">
              SLOW VEHICLE ON TRACK
            </span>
          </div>
        </div>
      );

    case "code60":
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-white p-6">
          {/* Regulatory Speed Limit Disc */}
          <div className="flex h-[75vmin] w-[75vmin] items-center justify-center rounded-full border-[6vmin] border-red-600 bg-white shadow-2xl">
            <span className="text-[34vmin] font-black tracking-tighter text-slate-950 font-mono">
              60
            </span>
          </div>
        </div>
      );

    default:
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-900 text-slate-200 p-6">
          <span className="text-[12vmin] font-black tracking-wider">
            {flag.kind.toUpperCase()}
          </span>
        </div>
      );
  }
}
