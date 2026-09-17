import type { FlagState } from "@/types/FlagState";

/**
 * Map a [`FlagState`] to a Tailwind colour token (background) and a short
 * label suitable for a button or chip. Single source of truth used by the
 * track map, the marshal console and the event feed.
 */
export interface FlagDisplay {
  bg: string;
  fg: string;
  label: string;
  subLabel?: string;
  icon?: string;
  patternType?: "double-yellow" | "rain" | "chequered" | "slippery" | "vsc" | "code60" | "sc" | "fcy" | "vsc_ending";
  flashing: boolean;
  urgent?: boolean;
}

export function describeFlag(flag: FlagState): FlagDisplay {
  switch (flag.kind) {
    case "off":
      return {
        bg: "bg-slate-800/80 border-slate-700",
        fg: "text-slate-300",
        label: "OFF",
        subLabel: "APAGAR TODO",
        icon: "⚪",
        flashing: false,
      };
    case "green":
      return {
        bg: "bg-emerald-500 border-emerald-400",
        fg: "text-slate-950",
        label: "GREEN",
        subLabel: "PISTA LIBRE",
        icon: "🟢",
        flashing: false,
      };
    case "yellow":
      if (flag.data === "double") {
        return {
          bg: "bg-amber-500 border-amber-400",
          fg: "text-slate-950",
          label: "DOUBLE YELLOW",
          subLabel: "PELIGRO MÁXIMO",
          icon: "⚠️⚠️",
          patternType: "double-yellow",
          flashing: true,
          urgent: true,
        };
      }
      return {
        bg: "bg-amber-400 border-amber-300",
        fg: "text-slate-950",
        label: "YELLOW",
        subLabel: "PRECAUCIÓN",
        icon: "⚠️",
        flashing: true,
      };
    case "blue":
      return {
        bg: "bg-blue-600 border-2 border-blue-400 shadow-[0_0_12px_rgba(37,99,235,0.4)]",
        fg: "text-white",
        label: "BLUE",
        subLabel: "CEDER PASO",
        icon: "🔵",
        flashing: true,
      };
    case "white":
      return {
        bg: "bg-slate-100 border-white",
        fg: "text-slate-900",
        label: "WHITE",
        subLabel: "VEHÍCULO LENTO",
        icon: "⚪",
        flashing: false,
      };
    case "yellow_red_striped":
      return {
        bg: "bg-amber-400 border border-amber-300",
        fg: "text-slate-950 font-black",
        label: "SLIPPERY",
        subLabel: "ACEITE / AGUA",
        icon: "🟡🔴",
        patternType: "slippery",
        flashing: false,
      };
    case "rain":
      return {
        bg: "bg-black border-2 border-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.4)]",
        fg: "text-white",
        label: "RAIN",
        subLabel: "PISTA HÚMEDA",
        icon: "🌧️",
        patternType: "rain",
        flashing: false,
      };
    case "red":
      return {
        bg: "bg-red-600 border-red-400",
        fg: "text-white",
        label: "RED",
        subLabel: "DETENCIÓN TOTAL",
        icon: "🚩",
        flashing: false,
        urgent: true,
      };
    case "chequered":
      return {
        bg: "bg-slate-900 border-slate-400",
        fg: "text-white",
        label: "CHEQUERED",
        subLabel: "FIN DE SESIÓN",
        icon: "🏁",
        patternType: "chequered",
        flashing: false,
      };
    case "safety_car":
      return {
        bg: "bg-black border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.4)]",
        fg: "text-white",
        label: "SC",
        subLabel: "SAFETY CAR",
        icon: "🚨",
        patternType: "sc",
        flashing: true,
        urgent: true,
      };
    case "virtual_safety_car":
      return {
        bg: "bg-black border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.4)]",
        fg: "text-white",
        label: "VSC",
        subLabel: "VIRTUAL SC",
        icon: "⚡",
        patternType: "vsc",
        flashing: true,
      };
    case "vsc_ending":
      return {
        bg: "bg-black border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.4)]",
        fg: "text-white",
        label: "VSC END",
        subLabel: "PREP REINICIO",
        icon: "⚡🟢",
        patternType: "vsc_ending",
        flashing: true,
      };
    case "full_course_yellow":
      return {
        bg: "bg-black border-2 border-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.4)]",
        fg: "text-white",
        label: "FCY",
        subLabel: "80 KM/H LIMIT",
        icon: "⚠️",
        patternType: "fcy",
        flashing: true,
      };
    case "code60":
      return {
        bg: "bg-purple-700 border-purple-500",
        fg: "text-white",
        label: "CODE 60",
        subLabel: "MÁX 60 KM/H",
        icon: "🛑",
        patternType: "code60",
        flashing: false,
      };
    case "slow_zone":
      return {
        bg: "bg-amber-400 border-amber-300",
        fg: "text-slate-950",
        label: "SZ",
        subLabel: "ZONA LENTA",
        icon: "⚠️",
        flashing: true,
      };
    case "next_slow":
      return {
        bg: "bg-amber-300 border-amber-200",
        fg: "text-slate-950",
        label: "NEXT SLOW",
        subLabel: "AVISO LENTO",
        icon: "⚠️",
        flashing: true,
      };
    case "pit_entry_open":
      return {
        bg: "bg-emerald-500 border-emerald-400",
        fg: "text-slate-950",
        label: "PIT OPEN",
        subLabel: "BOXES ABIERTOS",
        icon: "🟢",
        flashing: false,
      };
    case "pit_entry_closed":
      return {
        bg: "bg-rose-700 border-rose-500",
        fg: "text-white",
        label: "PIT CLOSED",
        subLabel: "BOXES CERRADOS",
        icon: "⛔",
        flashing: false,
      };
    case "standing_start":
      return {
        bg: "bg-amber-500 border-amber-400",
        fg: "text-slate-950",
        label: "STD START",
        subLabel: "LARGADA PARADA",
        icon: "🚦",
        flashing: true,
      };
    case "rolling_start":
      return {
        bg: "bg-amber-400 border-amber-300",
        fg: "text-slate-950",
        label: "ROLL START",
        subLabel: "LARGADA MOV.",
        icon: "🏎️",
        flashing: true,
      };
    case "custom_blue":
      return {
        bg: "bg-blue-700 border-blue-500",
        fg: "text-white",
        label: "BLUE+",
        subLabel: "PRIORIDAD RET.",
        icon: "🔵+",
        flashing: true,
      };
    case "black_for_driver":
      return {
        bg: "bg-slate-950 border-slate-700",
        fg: "text-white",
        label: `BLACK #${flag.data}`,
        subLabel: "EXCLUSIÓN",
        icon: "⬛",
        flashing: false,
      };
    case "black_orange_disc":
      return {
        bg: "bg-slate-950 border-amber-500",
        fg: "text-amber-400",
        label: `MECH #${flag.data}`,
        subLabel: "FALLA MECÁNICA",
        icon: "🟠",
        flashing: false,
      };
    case "black_white_diagonal":
      return {
        bg: "bg-slate-950 border-slate-600",
        fg: "text-white",
        label: `WARN #${flag.data}`,
        subLabel: "APERCIBIMIENTO",
        icon: "⚠️",
        flashing: false,
      };
  }
}

export function flagShortCode(flag: FlagState): string {
  return describeFlag(flag).label.split(" ")[0];
}
