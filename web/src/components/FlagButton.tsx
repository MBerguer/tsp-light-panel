import type { FlagState } from "@/types/FlagState";
import { describeFlag } from "@/lib/flag";

interface Props {
  flag: FlagState;
  onClick(): void;
  disabled?: boolean;
  active?: boolean;
}

/**
 * Square chunky button used by both the Race Control panel and the Marshal
 * console. The button colour matches the flag it triggers; an active
 * state outlines it.
 */
export function FlagButton({ flag, onClick, disabled, active }: Props) {
  const d = describeFlag(flag);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn-flag ${d.bg} ${d.fg} ${
        active ? "ring-4 ring-sky-400" : "border-white/10"
      }`}
    >
      {d.label}
    </button>
  );
}
