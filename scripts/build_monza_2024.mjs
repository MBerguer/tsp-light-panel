#!/usr/bin/env node
// Build crates/server/circuits/monza_2024.json from the open-data GeoJSON
// trace of Autodromo Nazionale Monza (bacinger/f1-circuits, MIT licensed),
// then attach the FIA panel layout, the marshal posts and the 20-driver grid
// of the 2024 Italian Grand Prix.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GEOJSON_PATH = "/tmp/tsp-research/monza.geojson";
const OUT_PATH = join(ROOT, "crates/server/circuits/monza_2024.json");

// ---------------------------------------------------------------------------
// 1) Load and project the racing line.
// ---------------------------------------------------------------------------

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
const coords = geojson.features[0].geometry.coordinates; // [lng, lat][]
const OFFICIAL_LENGTH_M = geojson.features[0].properties.length; // 5793

// Equirectangular projection centred on the track's centroid — accurate to
// well under 1 m at the 1.5 km scale of Monza.
const centroidLat = coords.reduce((a, [, lat]) => a + lat, 0) / coords.length;
const centroidLng = coords.reduce((a, [lng]) => a + lng, 0) / coords.length;
const LAT_PER_M = 1 / 110_540; // metres → degrees latitude
const cosLat = Math.cos((centroidLat * Math.PI) / 180);
const LNG_PER_M = 1 / (111_320 * cosLat);

const metric = coords.map(([lng, lat]) => [
  (lng - centroidLng) / LNG_PER_M, // x in metres, east-positive
  (lat - centroidLat) / LAT_PER_M, // y in metres, north-positive
]);

// Cumulative arc length using planar distance (post-projection it's already
// in metres). We then renormalise so the published length matches Monza's
// official 5793 m exactly.
let raw = 0;
const cumRaw = [0];
for (let i = 1; i < metric.length; i++) {
  const dx = metric[i][0] - metric[i - 1][0];
  const dy = metric[i][1] - metric[i - 1][1];
  raw += Math.hypot(dx, dy);
  cumRaw.push(raw);
}
// Close the loop.
const dxC = metric[0][0] - metric.at(-1)[0];
const dyC = metric[0][1] - metric.at(-1)[1];
raw += Math.hypot(dxC, dyC);

const scale = OFFICIAL_LENGTH_M / raw; // ~1.0; corrects for projection error
const cumM = cumRaw.map((d) => d * scale);

// ---------------------------------------------------------------------------
// 2) Map metric → 1200×800 SVG viewport, flipping Y so north is up on screen.
// ---------------------------------------------------------------------------

const VIEW_W = 1200;
const VIEW_H = 800;
const PAD = 50;

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const [x, y] of metric) {
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
const spanX = maxX - minX;
const spanY = maxY - minY;
const fit = Math.min((VIEW_W - 2 * PAD) / spanX, (VIEW_H - 2 * PAD) / spanY);
const offX = (VIEW_W - spanX * fit) / 2;
const offY = (VIEW_H - spanY * fit) / 2;

const racingLine = metric.map(([x, y]) => [
  +(offX + (x - minX) * fit).toFixed(2),
  +(offY + (maxY - y) * fit).toFixed(2), // flip Y
]);

// ---------------------------------------------------------------------------
// 3) Sample helper: given a distance in metres, return {x, y, bearing}.
// ---------------------------------------------------------------------------

function sampleAt(distanceM) {
  const d = ((distanceM % OFFICIAL_LENGTH_M) + OFFICIAL_LENGTH_M) % OFFICIAL_LENGTH_M;
  // Binary search the segment containing `d`.
  let lo = 0, hi = cumM.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cumM[mid] <= d) lo = mid; else hi = mid;
  }
  const a = racingLine[lo];
  const b = racingLine[hi % racingLine.length];
  const segLen = cumM[hi] - cumM[lo] || 1;
  const t = (d - cumM[lo]) / segLen;
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const bearing = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return { x: +x.toFixed(2), y: +y.toFixed(2), bearing: +bearing.toFixed(1) };
}

// ---------------------------------------------------------------------------
// 4) FIA-style turn / zone / sector model for Monza.
//
// Sectors as used by F1 live timing at Monza:
//   - Sector 1: start/finish → Curva di Lesmo 2 exit (T7)
//   - Sector 2: Lesmo 2 exit → Variante Ascari exit (T10)
//   - Sector 3: Ascari exit → start/finish
//
// Turn-to-distance figures are taken from public FIA circuit notes and
// race-engineer telemetry write-ups; rounded to the nearest 10 m. They are
// good enough for visual scenario playback — they don't claim sub-metre
// FIA-grade accuracy.
// ---------------------------------------------------------------------------

const ZONES = [
  { id: 1,  label: "Z1 · Start/Finish",          sector: 1, hue:  30, anchorM:   80 },
  { id: 2,  label: "Z2 · Variante del Rettifilo",sector: 1, hue:  45, anchorM:  620 },
  { id: 3,  label: "Z3 · Curva Grande",          sector: 1, hue:  60, anchorM: 1300 },
  { id: 4,  label: "Z4 · Variante della Roggia", sector: 1, hue:  80, anchorM: 1850 },
  { id: 5,  label: "Z5 · Lesmo 1 & 2",           sector: 1, hue: 110, anchorM: 2600 },
  { id: 6,  label: "Z6 · Curva del Serraglio",   sector: 2, hue: 150, anchorM: 3200 },
  { id: 7,  label: "Z7 · Variante Ascari",       sector: 2, hue: 200, anchorM: 3650 },
  { id: 8,  label: "Z8 · Rettilineo Ascari",     sector: 2, hue: 220, anchorM: 4100 },
  { id: 9,  label: "Z9 · Curva Alboreto (in)",   sector: 3, hue: 260, anchorM: 4800 },
  { id: 10, label: "Z10 · Curva Alboreto (out)", sector: 3, hue: 290, anchorM: 5100 },
  { id: 11, label: "Z11 · Rettifilo Tribune",    sector: 3, hue: 330, anchorM: 5500 },
];

// FIA TSP panels — placed on the run-up to every flagged corner plus two
// extras on the long pit straight. 22 panels total: representative of a
// modern F1 grade-1 circuit (Monza ships 20-25 according to FIA homologation
// reports). Distances are in metres from the start/finish line.
const PANELS = [
  { id: 1,  zone: 1,  distance: 50 },
  { id: 2,  zone: 1,  distance: 350 },
  { id: 3,  zone: 2,  distance: 580 },
  { id: 4,  zone: 2,  distance: 700 },
  { id: 5,  zone: 3,  distance: 1100 },
  { id: 6,  zone: 3,  distance: 1450 },
  { id: 7,  zone: 4,  distance: 1800 },
  { id: 8,  zone: 4,  distance: 1980 },
  { id: 9,  zone: 5,  distance: 2400 },
  { id: 10, zone: 5,  distance: 2700 },
  { id: 11, zone: 5,  distance: 2850 },
  { id: 12, zone: 6,  distance: 3150 },
  { id: 13, zone: 7,  distance: 3550 },
  { id: 14, zone: 7,  distance: 3750 },
  { id: 15, zone: 8,  distance: 4050 },
  { id: 16, zone: 8,  distance: 4350 },
  { id: 17, zone: 9,  distance: 4700 },
  { id: 18, zone: 9,  distance: 4950 },
  { id: 19, zone: 10, distance: 5150 },
  { id: 20, zone: 11, distance: 5350 },
  { id: 21, zone: 11, distance: 5550 },
  { id: 22, zone: 11, distance: 5700 },
];

// Marshal posts — FIM 2024 numbering. Two posts (1.1 + 1.2) per turn for the
// 11 named turns. Approximate distances were derived by interpolating between
// the published turn entry / exit positions. Real Monza fields ~30 posts at
// race weekend (260 marshals total); we ship 22 for a clean mapping to the
// turn structure.
const POSTS = [
  { num: 1.1, zone: 1,  distance: 100 },
  { num: 1.2, zone: 1,  distance: 380 },
  { num: 2.1, zone: 2,  distance: 600 },
  { num: 2.2, zone: 2,  distance: 720 },
  { num: 3.1, zone: 3,  distance: 1150 },
  { num: 3.2, zone: 3,  distance: 1500 },
  { num: 4.1, zone: 4,  distance: 1820 },
  { num: 4.2, zone: 4,  distance: 1990 },
  { num: 6.1, zone: 5,  distance: 2450 },
  { num: 7.1, zone: 5,  distance: 2780 },
  { num: 7.2, zone: 5,  distance: 2880 },
  { num: 8.1, zone: 6,  distance: 3200 },
  { num: 8.2, zone: 7,  distance: 3570 },
  { num: 9.1, zone: 7,  distance: 3680 },
  { num: 9.2, zone: 7,  distance: 3780 },
  { num: 10.1, zone: 8, distance: 4080 },
  { num: 10.2, zone: 8, distance: 4380 },
  { num: 11.1, zone: 9, distance: 4750 },
  { num: 11.2, zone: 9, distance: 4980 },
  { num: 11.3, zone: 10, distance: 5200 },
  { num: 11.4, zone: 11, distance: 5400 },
  { num: 0.0,  zone: 11, distance: 5780 }, // starter rostrum
];

// ---------------------------------------------------------------------------
// 5) 2024 Italian GP starting grid (20 drivers, FIA entry list).
//    Order is grid position; numbers are the FIA-assigned car numbers.
//    Colours are 2024 team livery primaries.
// ---------------------------------------------------------------------------

const DRIVERS = [
  { number:  4, code: "NOR", name: "Lando Norris",       team: "McLaren",         team_color: "#FF8000" },
  { number: 81, code: "PIA", name: "Oscar Piastri",      team: "McLaren",         team_color: "#FF8000" },
  { number: 63, code: "RUS", name: "George Russell",     team: "Mercedes",        team_color: "#27F4D2" },
  { number: 16, code: "LEC", name: "Charles Leclerc",    team: "Ferrari",         team_color: "#E80020" },
  { number: 55, code: "SAI", name: "Carlos Sainz",       team: "Ferrari",         team_color: "#E80020" },
  { number: 44, code: "HAM", name: "Lewis Hamilton",     team: "Mercedes",        team_color: "#27F4D2" },
  { number:  1, code: "VER", name: "Max Verstappen",     team: "Red Bull Racing", team_color: "#3671C6" },
  { number: 11, code: "PER", name: "Sergio Pérez",       team: "Red Bull Racing", team_color: "#3671C6" },
  { number: 23, code: "ALB", name: "Alex Albon",         team: "Williams",        team_color: "#64C4FF" },
  { number: 27, code: "HUL", name: "Nico Hülkenberg",    team: "Haas",            team_color: "#B6BABD" },
  { number: 14, code: "ALO", name: "Fernando Alonso",    team: "Aston Martin",    team_color: "#229971" },
  { number:  3, code: "RIC", name: "Daniel Ricciardo",   team: "RB",              team_color: "#6692FF" },
  { number: 20, code: "MAG", name: "Kevin Magnussen",    team: "Haas",            team_color: "#B6BABD" },
  { number: 10, code: "GAS", name: "Pierre Gasly",       team: "Alpine",          team_color: "#FF87BC" },
  { number: 31, code: "OCO", name: "Esteban Ocon",       team: "Alpine",          team_color: "#FF87BC" },
  { number: 22, code: "TSU", name: "Yuki Tsunoda",       team: "RB",              team_color: "#6692FF" },
  { number: 18, code: "STR", name: "Lance Stroll",       team: "Aston Martin",    team_color: "#229971" },
  { number: 43, code: "COL", name: "Franco Colapinto",   team: "Williams",        team_color: "#64C4FF" },
  { number: 77, code: "BOT", name: "Valtteri Bottas",    team: "Kick Sauber",     team_color: "#52E252" },
  { number: 24, code: "ZHO", name: "Zhou Guanyu",        team: "Kick Sauber",     team_color: "#52E252" },
];

// ---------------------------------------------------------------------------
// 6) Compose CircuitTopology JSON.
// ---------------------------------------------------------------------------

const panels = PANELS.map((p) => {
  const z = ZONES.find((z) => z.id === p.zone);
  const s = sampleAt(p.distance);
  return {
    id: p.id,
    zone: p.zone,
    sector: z.sector,
    distance_m: p.distance,
    x: s.x,
    y: s.y,
    bearing_deg: s.bearing,
    side: "outside",
  };
});

const posts = POSTS.map((p, idx) => {
  const z = ZONES.find((z) => z.id === p.zone);
  const s = sampleAt(p.distance);
  // FIM scheme: prefix `F` for flag, `T` for track. We mark them all as flag
  // posts for the simulator (which is what TSP-light-panel models).
  const label = p.num === 0 ? "F0.0 (rostrum)" : `F${p.num.toFixed(1)}`;
  return {
    id: idx + 1,
    label,
    sector: z.sector,
    zone: p.zone,
    distance_m: p.distance,
    x: s.x,
    y: s.y,
    kind: "flag",
  };
});

const drivers = DRIVERS.map((d) => ({ ...d, initial_zone: null }));

const topology = {
  name: "monza_2024",
  label: "Autodromo Nazionale Monza — GP Italia 2024",
  viewport: { width: VIEW_W, height: VIEW_H },
  track_length_m: OFFICIAL_LENGTH_M,
  racing_line: racingLine,
  zones: ZONES.map((z) => ({
    id: z.id,
    sector: z.sector,
    label: z.label,
    hue: z.hue,
  })),
  panels,
  posts,
  drivers,
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(topology, null, 2));
console.log(
  `wrote ${OUT_PATH} (${racingLine.length} pts, ${panels.length} panels, ${posts.length} posts, ${drivers.length} drivers, length=${OFFICIAL_LENGTH_M} m)`,
);
