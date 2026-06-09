import type { PanelId, SectorId, ZoneId } from "@/types/ids";
import type { TrackSide } from "@/types/TrackSide";

/**
 * Mirror of `tsp_server::topology::CircuitTopology` served under
 * `/api/topology`. Kept hand-written because the topology types live in
 * `tsp_server` (not `tsp_core`) so ts-rs does not currently emit them.
 */
export interface CircuitTopology {
  name: string;
  label?: string | null;
  viewport: { width: number; height: number };
  track_length_m: number;
  racing_line: [number, number][];
  zones: ZoneTopology[];
  panels: PanelTopology[];
  /** Marshal posts shipped with data-driven circuits (Monza 2024 etc.). */
  posts?: MarshalPostTopology[];
  /** Driver roster shipped with data-driven circuits. */
  drivers?: DriverEntry[];
}

export interface ZoneTopology {
  id: ZoneId;
  sector: SectorId;
  label: string;
  hue: number;
}

export interface PanelTopology {
  id: PanelId;
  zone: ZoneId;
  sector: SectorId;
  distance_m: number;
  x: number;
  y: number;
  bearing_deg: number;
  side: TrackSide;
}

export type PostKind = "flag" | "track" | "led_controller";

export interface MarshalPostTopology {
  id: number;
  label: string;
  sector: SectorId;
  zone: ZoneId;
  distance_m: number;
  x: number;
  y: number;
  kind: PostKind;
}

export interface DriverEntry {
  number: number;
  code: string;
  name: string;
  team: string;
  team_color: string;
  initial_zone?: ZoneId | null;
}
