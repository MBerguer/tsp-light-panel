import type { FlagState } from "@/types/FlagState";
import { describeFlag } from "@/lib/flag";

interface Props {
  flag: FlagState;
  onClick(): void;
  disabled?: boolean;
  active?: boolean;
}

/**
 * High-visibility FIA / F1 Digi-flag button.
 * Renders authentic chromatic styling, textures (checkers, hazard chevrons,
 * rain droplets, speed limits), icons, and subtitles.
 */
export function FlagButton({ flag, onClick, disabled, active }: Props) {
  const d = describeFlag(flag);

  // Custom textures & patterns
  let customStyle: React.CSSProperties = {};

  if (d.patternType === "chequered") {
    customStyle = {
      backgroundImage: `repeating-conic-gradient(#0f172a 0% 25%, #f8fafc 0% 50%)`,
      backgroundPosition: "50%",
      backgroundSize: "18px 18px",
    };
  } else if (d.patternType === "double-yellow") {
    customStyle = {
      backgroundImage: `repeating-linear-gradient(45deg, #d97706, #d97706 8px, #000000 8px, #000000 16px)`,
    };
  } else if (d.patternType === "slippery") {
    customStyle = {
      backgroundImage: `repeating-linear-gradient(90deg, #eab308, #eab308 12px, #dc2626 12px, #dc2626 24px)`,
    };
  } else if (d.patternType === "rain") {
    customStyle = {
      backgroundImage: `repeating-linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0px, rgba(56, 189, 248, 0.25) 2px, transparent 2px, transparent 10px), linear-gradient(180deg, #0369a1 0%, #0c4a6e 100%)`,
    };
  }

  // Active ring & urgency pulse
  const activeRing = active
    ? "ring-4 ring-sky-400 scale-[0.98] shadow-2xl"
    : "border border-white/15 hover:scale-[1.02] shadow-md";

  const pulseClass = d.urgent
    ? "animate-pulse"
    : d.flashing
      ? "animate-flag-flash"
      : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={customStyle}
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl p-2.5 sm:p-3 text-center transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed min-h-[64px] sm:min-h-[72px] ${d.bg} ${d.fg} ${activeRing} ${pulseClass}`}
    >
      {/* Pattern Overlay / Darkening Pill for text legibility */}
      {d.patternType === "chequered" && (
        <div className="absolute inset-0 flex items-center justify-center p-1.5">
          <div className="flex h-full w-full flex-col items-center justify-center rounded-lg bg-slate-950/85 backdrop-blur-sm px-2 py-1">
            <span className="text-base sm:text-lg">🏁</span>
            <span className="text-xs sm:text-sm font-black tracking-wider text-white">
              CHEQUERED
            </span>
            <span className="text-[9px] font-semibold text-slate-300">
              FIN DE SESIÓN
            </span>
          </div>
        </div>
      )}

      {d.patternType === "double-yellow" && (
        <div className="absolute inset-1 flex items-center justify-center rounded-lg bg-amber-500/95 backdrop-blur-sm p-1 shadow-inner">
          <div className="flex flex-col items-center justify-center">
            <div className="flex items-center gap-1">
              <span className="text-xs">⚠️</span>
              <span className="text-xs font-black tracking-wider text-slate-950">
                DOUBLE YELLOW
              </span>
              <span className="text-xs">⚠️</span>
            </div>
            <span className="text-[9px] font-extrabold uppercase tracking-tight text-amber-950">
              PELIGRO MÁXIMO
            </span>
          </div>
        </div>
      )}

      {d.patternType === "slippery" && (
        <div className="absolute inset-1 flex items-center justify-center rounded-lg bg-slate-950/80 backdrop-blur-sm p-1">
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs">🟡🔴</span>
            <span className="text-xs font-black tracking-wider text-amber-300">
              SLIPPERY
            </span>
            <span className="text-[9px] font-semibold text-slate-300">
              ACEITE / AGUA
            </span>
          </div>
        </div>
      )}

      {d.patternType === "rain" && (
        <div className="flex flex-col items-center justify-center w-full">
          {/* Animated Water Droplets */}
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <span className="text-sm">🌧️</span>
            <span className="inline-block animate-bounce text-sky-200 text-xs">💧</span>
            <span className="inline-block animate-bounce delay-150 text-sky-300 text-xs">💧</span>
          </div>
          <span className="text-xs sm:text-sm font-black tracking-wider text-white drop-shadow-md">
            RAIN
          </span>
          <span className="text-[9px] font-bold text-sky-200 uppercase tracking-tight">
            PISTA HÚMEDA
          </span>
        </div>
      )}

      {flag.kind === "safety_car" && (
        <div className="flex flex-col items-center justify-center w-full">
          {/* Strobe emergency lightbar on top */}
          <div className="flex items-center gap-1 mb-1">
            <span className="h-1.5 w-3.5 rounded-full bg-white animate-pulse" />
            <span className="h-1.5 w-3.5 rounded-full bg-amber-950 animate-pulse delay-100" />
            <span className="h-1.5 w-3.5 rounded-full bg-white animate-pulse" />
          </div>
          <span className="text-sm sm:text-base font-black tracking-wider text-slate-950">
            🚨 SC
          </span>
          <span className="text-[9px] font-extrabold uppercase tracking-tight text-amber-950">
            SAFETY CAR
          </span>
        </div>
      )}

      {d.patternType === "vsc" && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-1">
            <span className="text-xs text-amber-400">⚡</span>
            <span className="text-sm sm:text-base font-black tracking-wider text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.5)]">
              VSC
            </span>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-tight text-amber-400/80">
            DELTA TIME
          </span>
        </div>
      )}

      {d.patternType === "code60" && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white border-2 border-red-600 font-black text-[11px] text-slate-950 shadow mb-0.5">
            60
          </div>
          <span className="text-xs font-black tracking-wider text-white">
            CODE 60
          </span>
          <span className="text-[9px] font-semibold text-purple-200">
            MÁX 60 KM/H
          </span>
        </div>
      )}

      {/* Standard / Other Flags */}
      {!d.patternType && flag.kind !== "safety_car" && (
        <div className="flex flex-col items-center justify-center">
          {d.icon && <span className="text-xs mb-0.5">{d.icon}</span>}
          <span className="text-xs sm:text-sm font-black tracking-wider leading-tight">
            {d.label}
          </span>
          {d.subLabel && (
            <span className="text-[9px] font-semibold opacity-85 leading-tight mt-0.5">
              {d.subLabel}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
