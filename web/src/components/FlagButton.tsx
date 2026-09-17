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
      backgroundImage: `linear-gradient(135deg, #ffcc00 50%, #000000 50%)`,
    };
  } else if (d.patternType === "slippery") {
    customStyle = {
      backgroundImage: `repeating-linear-gradient(90deg, #eab308, #eab308 12px, #dc2626 12px, #dc2626 24px)`,
    };
  } else if (d.patternType === "rain") {
    customStyle = {
      backgroundImage: `linear-gradient(180deg, #050b14 0%, #000000 100%)`,
    };
  }

  // Active ring styling
  const activeRing = active
    ? "ring-4 ring-sky-400 scale-[0.98] shadow-2xl"
    : "border border-white/15 hover:scale-[1.02] shadow-md";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={customStyle}
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl p-2.5 sm:p-3 text-center transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed min-h-[64px] sm:min-h-[72px] ${d.bg} ${d.fg} ${activeRing}`}
    >
      {/* Pattern Overlay / Darkening Pill for text legibility */}
      {d.patternType === "chequered" && (
        <div className="absolute inset-0 flex items-center justify-center p-1.5">
          <div className="flex h-full w-full flex-col items-center justify-center rounded-lg bg-slate-950/85 backdrop-blur-sm px-2 py-1">
            <span className="text-base sm:text-lg emoji-shadow">🏁</span>
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
        <div className="absolute inset-1 flex items-center justify-center rounded-lg bg-black/85 backdrop-blur-sm p-1 border border-amber-400/90 shadow-inner">
          <div className="flex flex-col items-center justify-center">
            <div className="flex items-center gap-1">
              <span className="text-xs emoji-shadow">⚠️</span>
              <span className="text-xs font-black tracking-wider text-amber-300">
                DOUBLE YELLOW
              </span>
              <span className="text-xs emoji-shadow">⚠️</span>
            </div>
            <span className="text-[9px] font-extrabold uppercase tracking-tight text-amber-400">
              PELIGRO MÁXIMO
            </span>
          </div>
        </div>
      )}

      {d.patternType === "slippery" && (
        <div className="absolute inset-1 flex items-center justify-center rounded-lg bg-slate-950/80 backdrop-blur-sm p-1">
          <div className="flex flex-col items-center justify-center">
            <span className="text-xs emoji-shadow">🟡🔴</span>
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
          {/* Authentic vertical water drops */}
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <span className="text-sm emoji-shadow">🌧️</span>
            <span className="inline-block text-cyan-300 text-xs emoji-shadow">💧</span>
            <span className="inline-block text-cyan-200 text-xs emoji-shadow">💧</span>
          </div>
          <span className="text-xs sm:text-sm font-black tracking-wider text-cyan-300 drop-shadow-[0_0_8px_rgba(0,212,255,0.6)]">
            RAIN
          </span>
          <span className="text-[9px] font-bold text-sky-200 uppercase tracking-tight">
            PISTA HÚMEDA
          </span>
        </div>
      )}

      {flag.kind === "safety_car" && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs emoji-shadow">🚨</span>
            <span className="text-sm sm:text-base font-black tracking-wider text-white font-mono drop-shadow">
              SC
            </span>
          </div>
          <span className="text-[9px] font-extrabold uppercase tracking-tight text-amber-300">
            SAFETY CAR
          </span>
        </div>
      )}

      {flag.kind === "virtual_safety_car" && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs text-amber-300 emoji-shadow">⚡</span>
            <span className="text-sm sm:text-base font-black tracking-wider text-white font-mono drop-shadow">
              VSC
            </span>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-tight text-amber-300">
            VIRTUAL SC
          </span>
        </div>
      )}

      {flag.kind === "vsc_ending" && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs emoji-shadow">⚡🟢</span>
            <span className="text-xs sm:text-sm font-black tracking-wider text-white font-mono drop-shadow">
              VSC END
            </span>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-tight text-emerald-400">
            PREP REINICIO
          </span>
        </div>
      )}

      {flag.kind === "full_course_yellow" && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs text-amber-300 emoji-shadow">⚠️</span>
            <span className="text-sm sm:text-base font-black tracking-wider text-white font-mono drop-shadow">
              FCY
            </span>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-tight text-amber-300">
            80 KM/H LIMIT
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
          {d.icon && <span className="text-xs mb-0.5 emoji-shadow">{d.icon}</span>}
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
