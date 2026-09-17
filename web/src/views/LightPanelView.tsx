import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
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
      <div className="pointer-events-none absolute bottom-2 right-3 z-40 flex items-center gap-2 font-mono text-[10px] text-slate-500/40">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status === "open" ? "bg-emerald-500/60" : "bg-red-500/60"
          }`}
        />
        <span>POST #{panelId < 10 ? `0${panelId}` : panelId}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Double Yellow: Rapidly Alternating Diagonal Split Triangles (~3 Hz)
// ============================================================================

function DoubleYellowCanvas() {
  const [phase, setPhase] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((p) => !p);
    }, 180);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black select-none">
      {/* Top-Right Triangle */}
      <div
        className="absolute inset-0 transition-none"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 100%)",
          backgroundColor: phase ? "#ffcc00" : "#000000",
        }}
      />
      {/* Bottom-Left Triangle */}
      <div
        className="absolute inset-0 transition-none"
        style={{
          clipPath: "polygon(0 0, 0 100%, 100% 100%)",
          backgroundColor: phase ? "#000000" : "#ffcc00",
        }}
      />
    </div>
  );
}

// ============================================================================
// Rain Flag: Authentic Downward Scrolling Teardrop Water Droplets
// Replicates physical trackside LED panel (pointed top, round bulbous bottom)
// ============================================================================

function RainDropSvg({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`absolute -translate-x-1/2 -translate-y-1/2 ${className}`} style={style}>
      <svg
        viewBox="0 0 100 142"
        className="w-[28vmin] h-[40vmin] drop-shadow-[0_0_16px_rgba(0,212,255,0.75)]"
      >
        <path
          d="M 50 8 C 56 35 88 75 88 104 A 38 38 0 1 1 12 104 C 12 75 44 35 50 8 Z"
          fill="#00d4ff"
        />
      </svg>
    </div>
  );
}

function RainPatternBlock() {
  return (
    <div className="relative w-full h-1/2">
      {/* Upper center drop */}
      <RainDropSvg style={{ left: "50%", top: "28%" }} />
      {/* Lower left & right drops */}
      <RainDropSvg style={{ left: "20%", top: "78%" }} />
      <RainDropSvg style={{ left: "80%", top: "78%" }} />
    </div>
  );
}

function RainDropsCanvas() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-black select-none">
      <style>{`
        @keyframes rainScrollDown {
          0% {
            transform: translateY(-50%);
          }
          100% {
            transform: translateY(0%);
          }
        }
        .rain-scroll-track {
          animation: rainScrollDown 2.2s linear infinite;
        }
      `}</style>
      <div className="rain-scroll-track absolute left-0 top-0 w-full h-[200%] flex flex-col pointer-events-none">
        {/* Block 1 (top 50% = 1 screen height) */}
        <RainPatternBlock />
        {/* Block 2 (bottom 50% = 1 screen height, identical duplicate for seamless loop) */}
        <RainPatternBlock />
      </div>
    </div>
  );
}

// ============================================================================
// Internal Screen Renderers: Replicates real FIA Digi-Flag Visual Output
// ZERO text or emojis on solid flags; pure colors and high-contrast signals
// ============================================================================

function PanelFlagCanvas({ flag, panelId }: { flag: FlagState; panelId: number }) {
  switch (flag.kind) {
    case "off":
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-black text-slate-800 select-none">
          <span className="font-mono text-xs uppercase tracking-widest opacity-20">
            #{panelId < 10 ? `0${panelId}` : panelId} · OFF
          </span>
        </div>
      );

    case "green":
      return <div className="h-full w-full bg-[#00e600]" />;

    case "yellow":
      if (flag.data === "double") {
        return <DoubleYellowCanvas />;
      }
      return <div className="h-full w-full bg-[#ffcc00]" />;

    case "blue":
    case "custom_blue":
      return <div className="h-full w-full bg-[#0055ff]" />;

    case "red":
      return <div className="h-full w-full bg-[#ff0000]" />;

    case "rain":
      return <RainDropsCanvas />;

    case "safety_car":
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#ffcc00] select-none">
          <span className="text-[38vmin] font-black text-white leading-none tracking-tight">
            SC
          </span>
        </div>
      );

    case "virtual_safety_car":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[32vmin] font-black text-[#ffcc00] font-mono leading-none tracking-wider">
            VSC
          </span>
        </div>
      );

    case "vsc_ending":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[22vmin] font-black text-[#00e600] font-mono leading-none tracking-wider">
            VSC END
          </span>
        </div>
      );

    case "chequered":
      return (
        <div
          className="h-full w-full"
          style={{
            backgroundImage: `repeating-conic-gradient(#000000 0% 25%, #ffffff 0% 50%)`,
            backgroundPosition: "50%",
            backgroundSize: "16vmin 16vmin",
          }}
        />
      );

    case "yellow_red_striped":
      return (
        <div
          className="h-full w-full"
          style={{
            backgroundImage: `repeating-linear-gradient(45deg, #ffcc00 0, #ffcc00 8vmin, #dc2626 8vmin, #dc2626 16vmin)`,
          }}
        />
      );

    case "white":
      return <div className="h-full w-full bg-[#ffffff]" />;

    case "code60":
      return (
        <div className="flex h-full w-full items-center justify-center bg-white p-6 select-none">
          <div className="flex h-[75vmin] w-[75vmin] items-center justify-center rounded-full border-[6vmin] border-[#dc2626] bg-white">
            <span className="text-[34vmin] font-black tracking-tighter text-black font-mono leading-none">
              60
            </span>
          </div>
        </div>
      );

    case "full_course_yellow":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[30vmin] font-black text-[#ffcc00] font-mono leading-none tracking-wider">
            FCY
          </span>
        </div>
      );

    case "slow_zone":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[32vmin] font-black text-[#ffcc00] font-mono leading-none tracking-wider">
            SZ
          </span>
        </div>
      );

    case "next_slow":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[20vmin] font-black text-[#ffcc00] font-mono leading-none tracking-wide text-center">
            NEXT SLOW
          </span>
        </div>
      );

    case "pit_entry_open":
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#00e600] select-none">
          <span className="text-[20vmin] font-black text-black leading-none tracking-wider text-center">
            PIT OPEN
          </span>
        </div>
      );

    case "pit_entry_closed":
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#ff0000] select-none">
          <span className="text-[18vmin] font-black text-white leading-none tracking-wider text-center">
            PIT CLOSED
          </span>
        </div>
      );

    case "standing_start":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[20vmin] font-black text-[#ffcc00] font-mono leading-none tracking-wider text-center">
            START
          </span>
        </div>
      );

    case "rolling_start":
      return (
        <div className="flex h-full w-full items-center justify-center bg-black select-none">
          <span className="text-[20vmin] font-black text-[#ffcc00] font-mono leading-none tracking-wider text-center">
            ROLL START
          </span>
        </div>
      );

    default:
      return (
        <div className="flex h-full w-full items-center justify-center bg-black text-slate-500 select-none">
          <span className="text-[12vmin] font-black tracking-wider">
            {flag.kind.toUpperCase()}
          </span>
        </div>
      );
  }
}
