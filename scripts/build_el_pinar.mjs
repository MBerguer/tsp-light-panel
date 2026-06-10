#!/usr/bin/env node
// Build crates/server/circuits/el_pinar_2024.json from the OpenStreetMap trace of
// Autódromo Víctor Borrat Fabini (El Pinar, Canelones, Uruguay), then attach
// the FIA panel layout, the marshal posts and the entry list of the 2024
// FIA TCR World Tour + TCR South America joint round (2–4 August 2024).
//
// Circuit reference: FIA Grade 4 homologation, perimeter layout used since
// the 2017/2023 extensions (Beco Passadore corner + length increase to ~3120
// m). Lap record: Santiago Urrutia, Lynk&Co 03 FL TCR, 01:19.800.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GEOJSON_PATH = "/tmp/tsp-research/el_pinar.geojson";
const OUT_PATH = join(ROOT, "crates/server/circuits/el_pinar_2024.json");

// ---------------------------------------------------------------------------
// 1) Load and project the racing line.
// ---------------------------------------------------------------------------

const geojson = JSON.parse(readFileSync(GEOJSON_PATH, "utf8"));
const coords = geojson.geometry.coordinates; // [lng, lat][]
const OFFICIAL_LENGTH_M = geojson.properties.length_m; // 3120 m, FIA G4

// Equirectangular projection centred on the centroid — accurate to well under
// 0.5 m at the ~1 km scale of El Pinar.
const centroidLat = coords.reduce((a, [, lat]) => a + lat, 0) / coords.length;
const centroidLng = coords.reduce((a, [lng]) => a + lng, 0) / coords.length;
const LAT_PER_M = 1 / 110_540;
const cosLat = Math.cos((centroidLat * Math.PI) / 180);
const LNG_PER_M = 1 / (111_320 * cosLat);

const metric = coords.map(([lng, lat]) => [
  (lng - centroidLng) / LNG_PER_M, // x in metres, east-positive
  (lat - centroidLat) / LAT_PER_M, // y in metres, north-positive
]);

// Cumulative arc length, then renormalise to the published 3120 m.
let raw = 0;
const cumRaw = [0];
for (let i = 1; i < metric.length; i++) {
  const dx = metric[i][0] - metric[i - 1][0];
  const dy = metric[i][1] - metric[i - 1][1];
  raw += Math.hypot(dx, dy);
  cumRaw.push(raw);
}
const dxC = metric[0][0] - metric.at(-1)[0];
const dyC = metric[0][1] - metric.at(-1)[1];
raw += Math.hypot(dxC, dyC);
const scale = OFFICIAL_LENGTH_M / raw;
const cumM = cumRaw.map((d) => d * scale);

// ---------------------------------------------------------------------------
// 2) Map metric → 1200×800 SVG viewport, flipping Y so north is up.
// ---------------------------------------------------------------------------

const VIEW_W = 1200;
const VIEW_H = 800;
const PAD = 60;

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
  +(offY + (maxY - y) * fit).toFixed(2),
]);

// ---------------------------------------------------------------------------
// 3) Sample helper: given a distance in metres, return {x, y, bearing}.
// ---------------------------------------------------------------------------

function sampleAt(distanceM) {
  const d = ((distanceM % OFFICIAL_LENGTH_M) + OFFICIAL_LENGTH_M) % OFFICIAL_LENGTH_M;
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
// 4) FIA-style turn / zone / sector model for El Pinar (Circuit 12, 2023+).
//
// AUVO publishes three sectors and a 12-turn count. We split into 8 zones
// for marshal coverage — each zone covers 1–2 turns. Distances are derived
// by linearly distributing along the published 3120 m loop, anchored to the
// known turn positions on the OSM trace.
// ---------------------------------------------------------------------------

const ZONES = [
  { id: 1, label: "Z1 · Recta de Boxes",     sector: 1, hue:  30, anchorM:  100 },
  { id: 2, label: "Z2 · C1 — Curva 1",       sector: 1, hue:  50, anchorM:  450 },
  { id: 3, label: "Z3 · Bicheón",            sector: 1, hue:  80, anchorM:  780 },
  { id: 4, label: "Z4 · Beco Passadore",     sector: 2, hue: 130, anchorM: 1180 },
  { id: 5, label: "Z5 · El Tobogán",         sector: 2, hue: 170, anchorM: 1600 },
  { id: 6, label: "Z6 · El Pasajero",        sector: 2, hue: 210, anchorM: 2000 },
  { id: 7, label: "Z7 · S del Bosque",       sector: 3, hue: 260, anchorM: 2440 },
  { id: 8, label: "Z8 · Última — Curva 12",  sector: 3, hue: 320, anchorM: 2900 },
];

// FIA TSP panels — 16 panels distributed along the 3.12 km loop, with denser
// coverage on the technical mid-sector. Distances are in metres from the
// start/finish line.
const PANELS = [
  { id:  1, zone: 1, distance:   50 },
  { id:  2, zone: 1, distance:  250 },
  { id:  3, zone: 2, distance:  430 },
  { id:  4, zone: 2, distance:  560 },
  { id:  5, zone: 3, distance:  760 },
  { id:  6, zone: 3, distance:  900 },
  { id:  7, zone: 4, distance: 1100 },
  { id:  8, zone: 4, distance: 1280 },
  { id:  9, zone: 5, distance: 1540 },
  { id: 10, zone: 5, distance: 1740 },
  { id: 11, zone: 6, distance: 1950 },
  { id: 12, zone: 6, distance: 2120 },
  { id: 13, zone: 7, distance: 2380 },
  { id: 14, zone: 7, distance: 2560 },
  { id: 15, zone: 8, distance: 2800 },
  { id: 16, zone: 8, distance: 3020 },
];

// Marshal posts — AUVO numbering. Two flag posts per named corner, plus a
// starter rostrum at the start/finish line. Distances approximated from
// AUVO circuit maps + OSM corner positions.
const POSTS = [
  { num: 0.0,  zone: 1, distance:   20 }, // starter rostrum
  { num: 1.1,  zone: 1, distance:  120 },
  { num: 1.2,  zone: 1, distance:  280 },
  { num: 2.1,  zone: 2, distance:  430 },
  { num: 2.2,  zone: 2, distance:  580 },
  { num: 3.1,  zone: 3, distance:  760 },
  { num: 3.2,  zone: 3, distance:  920 },
  { num: 4.1,  zone: 4, distance: 1120 },
  { num: 4.2,  zone: 4, distance: 1300 },
  { num: 5.1,  zone: 5, distance: 1520 },
  { num: 5.2,  zone: 5, distance: 1740 },
  { num: 6.1,  zone: 6, distance: 1950 },
  { num: 6.2,  zone: 6, distance: 2140 },
  { num: 7.1,  zone: 7, distance: 2380 },
  { num: 7.2,  zone: 7, distance: 2580 },
  { num: 8.1,  zone: 8, distance: 2800 },
  { num: 8.2,  zone: 8, distance: 3000 },
];

// ---------------------------------------------------------------------------
// 5) 2024 FIA TCR World Tour + TCR South America joint round entry list
//    (Autódromo Víctor Borrat Fabini, 2–4 August 2024).
//
// Source: official entry list published by AUVO / TCR South America Banco BRB.
// Numbers are FIA-assigned; team colours are 2024 livery primaries.
// Drivers marked with `*` were classified as TCR South America Trophy
// (gentleman) entries.
// ---------------------------------------------------------------------------

const DRIVERS = [
  // Cyan Racing — Lynk & Co (World Tour)
  { number: 112, code: "URR", name: "Santiago Urrutia",   team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 168, code: "EHR", name: "Yann Ehrlacher",     team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 155, code: "MQH", name: "Ma Qing Hua",        team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 111, code: "BJK", name: "Thed Björk",         team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  // BRC Squadra Corse — Hyundai (World Tour)
  { number: 129, code: "GIR", name: "Néstor Girolami",    team: "BRC Hyundai N Squadra Corse", team_color: "#002C5F" },
  { number: 105, code: "MIC", name: "Norbert Michelisz",  team: "BRC Hyundai N Squadra Corse", team_color: "#002C5F" },
  { number: 196, code: "AZC", name: "Mikel Azcona",       team: "BRC Hyundai N Squadra Corse", team_color: "#002C5F" },
  // GOAT Racing — Honda (World Tour)
  { number: 186, code: "GUE", name: "Esteban Guerrieri",  team: "GOAT Racing Honda",           team_color: "#CC0000" },
  { number: 199, code: "BUT", name: "Marco Butti",        team: "GOAT Racing Honda",           team_color: "#CC0000" },
  { number:  62, code: "BOR", name: "Dušan Borković",     team: "GOAT Racing Honda",           team_color: "#CC0000" },
  // Vulcano Motorsport — Audi
  { number: 127, code: "FIL", name: "John Filippi",       team: "Vulcano Motorsport Audi",     team_color: "#BB0A30" },
  // W2 Pro GP — CUPRA
  { number:  77, code: "REI", name: "Raphael Reis",       team: "W2 Pro GP CUPRA",             team_color: "#E6552F" },
  { number:  28, code: "OSM", name: "Galid Osman",        team: "W2 Pro GP CUPRA",             team_color: "#E6552F" },
  { number:  37, code: "RSL", name: "Guilherme Reischl",  team: "W2 Pro GP CUPRA",             team_color: "#E6552F" },
  // Cobra Racing Team — Toyota
  { number:   7, code: "VIV", name: "Thiago Vivacqua",    team: "Cobra Racing Toyota",         team_color: "#EB0A1E" },
  // Squadra Martino — Honda
  { number:   3, code: "BAP", name: "Rodrigo Baptista",   team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  60, code: "CAS", name: "Juan Manuel Casella",team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  34, code: "CSG", name: "Fabio Casagrande",   team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  15, code: "MAG", name: "Enrique Maglione",   team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  // PMO Racing — Peugeot
  { number:  43, code: "CDR", name: "Pedro Cardoso",      team: "PMO Racing Peugeot",          team_color: "#1F2A44" },
  { number:   8, code: "SUZ", name: "Rafael Suzuki",      team: "PMO Racing Peugeot",          team_color: "#1F2A44" },
  // Toyota Team Argentina — Toyota
  { number:  17, code: "ROS", name: "Matías Rossi",       team: "Toyota Team Argentina",       team_color: "#FFFFFF" },
  // Paladini Racing — Toyota
  { number:  16, code: "RSO", name: "Juan Ángel Rosso",   team: "Paladini Racing Toyota",      team_color: "#0033A0" },
  { number:  18, code: "SLV", name: "Carlos Silva",       team: "Paladini Racing Toyota",      team_color: "#0033A0" },
  // Squadra Martino Racing — Honda (Trophy)
  { number:  47, code: "FON", name: "Norberto Fontana",   team: "Squadra Martino Racing",      team_color: "#2C2C2C" },
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
  name: "el_pinar_2024",
  label: "Autódromo Víctor Borrat Fabini — TCR World Tour & TCR SA 2024",
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
