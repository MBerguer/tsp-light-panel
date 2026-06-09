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
  /** Whether the panel must flash (FIA single waving yellow, etc.). */
  flashing: boolean;
}

export function describeFlag(flag: FlagState): FlagDisplay {
  switch (flag.kind) {
    case "off":
      return { bg: "bg-flag-off", fg: "text-slate-300", label: "OFF", flashing: false };
    case "green":
      return { bg: "bg-flag-green", fg: "text-slate-950", label: "GREEN", flashing: false };
    case "yellow":
      return {
        bg: "bg-flag-yellow",
        fg: "text-slate-950",
        label: flag.data === "double" ? "DOUBLE YELLOW" : "YELLOW",
        flashing: true,
      };
    case "blue":
      return { bg: "bg-flag-blue", fg: "text-white", label: "BLUE", flashing: true };
    case "white":
      return { bg: "bg-flag-white", fg: "text-slate-900", label: "WHITE", flashing: false };
    case "yellow_red_striped":
      return {
        bg: "bg-gradient-to-br from-flag-yellow to-flag-red",
        fg: "text-slate-950",
        label: "SLIPPERY",
        flashing: false,
      };
    case "rain":
      return {
        bg: "bg-gradient-to-br from-sky-400 via-sky-500 to-sky-700",
        fg: "text-white",
        label: "RAIN",
        flashing: false,
      };
    case "red":
      return { bg: "bg-flag-red", fg: "text-white", label: "RED", flashing: false };
    case "chequered":
      return {
        bg: "bg-flag-chequered",
        fg: "text-white",
        label: "CHEQUERED",
        flashing: false,
      };
    case "safety_car":
      return { bg: "bg-flag-sc", fg: "text-slate-950", label: "SC", flashing: true };
    case "virtual_safety_car":
      return { bg: "bg-flag-vsc", fg: "text-slate-950", label: "VSC", flashing: true };
    case "vsc_ending":
      return {
        bg: "bg-flag-vsc",
        fg: "text-slate-950",
        label: "VSC END",
        flashing: true,
      };
    case "full_course_yellow":
      return {
        bg: "bg-flag-yellow",
        fg: "text-slate-950",
        label: "FCY",
        flashing: true,
      };
    case "code60":
      return {
        bg: "bg-fuchsia-600",
        fg: "text-white",
        label: "CODE 60",
        flashing: false,
      };
    case "slow_zone":
      return {
        bg: "bg-flag-yellow",
        fg: "text-slate-950",
        label: "SZ",
        flashing: true,
      };
    case "next_slow":
      return {
        bg: "bg-flag-yellow",
        fg: "text-slate-950",
        label: "NEXT SLOW",
        flashing: true,
      };
    case "pit_entry_open":
      return {
        bg: "bg-emerald-500",
        fg: "text-slate-950",
        label: "PIT OPEN",
        flashing: false,
      };
    case "pit_entry_closed":
      return {
        bg: "bg-rose-700",
        fg: "text-white",
        label: "PIT CLOSED",
        flashing: false,
      };
    case "standing_start":
      return {
        bg: "bg-amber-500",
        fg: "text-slate-950",
        label: "STD START",
        flashing: true,
      };
    case "rolling_start":
      return {
        bg: "bg-amber-400",
        fg: "text-slate-950",
        label: "ROLL START",
        flashing: true,
      };
    case "custom_blue":
      return {
        bg: "bg-flag-blue",
        fg: "text-white",
        label: "BLUE+",
        flashing: true,
      };
    case "black_for_driver":
      return {
        bg: "bg-flag-chequered",
        fg: "text-white",
        label: `BLACK #${flag.data}`,
        flashing: false,
      };
    case "black_orange_disc":
      return {
        bg: "bg-flag-driver",
        fg: "text-white",
        label: `MECH #${flag.data}`,
        flashing: false,
      };
    case "black_white_diagonal":
      return {
        bg: "bg-flag-driver",
        fg: "text-white",
        label: `WARN #${flag.data}`,
        flashing: false,
      };
  }
}

export function flagShortCode(flag: FlagState): string {
  return describeFlag(flag).label.split(" ")[0];
}
