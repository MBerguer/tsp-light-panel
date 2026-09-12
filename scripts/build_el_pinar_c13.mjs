#!/usr/bin/env node
// Build crates/server/circuits/el_pinar_n13.json from the OpenStreetMap trace of
// Autódromo Víctor Borrat Fabini (El Pinar, Canelones, Uruguay) for Circuito N° 13
// (4.000 m oficiales FIA / AUVO), incorporating "La S" and "El Cajón", along with
// the official AUVO emergency/rescue marshal positions and FIA light panels.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OSM_PATH = join(__dirname, "data", "el_pinar_osm.json");
const OUT_PATH = join(ROOT, "crates/server/circuits/el_pinar_n13.json");

const osm = JSON.parse(readFileSync(OSM_PATH, "utf8"));
const nodes = {};
for (const elem of osm.elements) {
  if (elem.type === "node") {
    nodes[elem.id] = [elem.lon, elem.lat];
  }
}
const ways = {};
for (const elem of osm.elements) {
  if (elem.type === "way") {
    ways[elem.id] = elem;
  }
}

// ---------------------------------------------------------------------------
// 1) Assemble Circuit N° 13 from OSM ways.
//    - Way 113311135: Main track (nodes 0..127 to node 1285306480)
//    - Way 113311121 Part 1: Chicane entry / "La S" up to node 1285306502
//    - Way 113311123 Reversed: Full loop of "El Cajón" (502 -> apex -> 505)
//    - Way 113311121 Part 3: Cajón exit connecting to node 1285306616
//    - Way 113311135: Final curve (from node 1285306616) to Start/Finish
// ---------------------------------------------------------------------------

const main = ways[113311135].nodes;
const w121 = ways[113311121].nodes;
const w123 = ways[113311123].nodes;

const idx502 = w121.indexOf(1285306502);
const idx505 = w121.indexOf(1285306505);

const part1 = w121.slice(0, idx502 + 1); // 1285306480 -> 1285306502
const cajon = [...w123].reverse();       // 1285306502 -> apex -> 1285306505
const part3 = w121.slice(idx505);        // 1285306505 -> 1285306616

// main[127] is 1285306480, main[129] is 1285306616
const c13Nodes = [
  ...main.slice(0, 128),
  ...part1.slice(1),
  ...cajon.slice(1),
  ...part3.slice(1),
  ...main.slice(130),
];

const coords = c13Nodes.map((nid) => nodes[nid]);
const OFFICIAL_LENGTH_M = 4000; // 4.000 m (FIA / AUVO Circuito N° 13)

// ---------------------------------------------------------------------------
// 2) Equirectangular metric projection centered on the centroid.
// ---------------------------------------------------------------------------

const centroidLat = coords.reduce((a, [, lat]) => a + lat, 0) / coords.length;
const centroidLng = coords.reduce((a, [lng]) => a + lng, 0) / coords.length;
const LAT_PER_M = 1 / 110_540;
const cosLat = Math.cos((centroidLat * Math.PI) / 180);
const LNG_PER_M = 1 / (111_320 * cosLat);

const metric = coords.map(([lng, lat]) => [
  (lng - centroidLng) / LNG_PER_M,
  (lat - centroidLat) / LAT_PER_M,
]);

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
// 3) Map metric -> 1200x800 SVG viewport, north is up.
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
// 4) Sampling helper for panel and post placement.
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
  const segLen = (cumM[hi] - cumM[lo]) || 1;
  const t = (d - cumM[lo]) / segLen;
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const bearing = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return { x: +x.toFixed(2), y: +y.toFixed(2), bearing: +bearing.toFixed(1) };
}

// ---------------------------------------------------------------------------
// 5) FIA-style turn / zone / sector model for Circuito N° 13 (4.000 m).
// ---------------------------------------------------------------------------
// 5) AUVO 16-Marshal Post & Zone Model for Circuito N° 13 (4.000 m).
// Each marshal post controls the track section up to the next post.
// ---------------------------------------------------------------------------

// AUVO Marshal Posts based on "POSICIONES DE RESCATE Y SERVICIOS DE EMERGENCIA"
const POSTS = [
  { label: "F0.0 (rostrum)", name: "Meta / Rostrum",               sector: 1, distance:   20, side: "left" },  // Post 1
  { label: "F1.1",           name: "Recta Principal",              sector: 1, distance:  180, side: "left" },  // Post 2
  { label: "F2.1",           name: "Curva 1 Entrada",              sector: 1, distance:  300, side: "left" },  // Post 3
  { label: "F2.2",           name: "Curva 1 Sur",                  sector: 1, distance:  420, side: "left" },  // Post 4
  { label: "F2.3",           name: "Gonzalo Rodríguez Oeste",      sector: 1, distance:  560, side: "left" },  // Post 5
  { label: "F2.4",           name: "Gonzalo Rodríguez Norte",      sector: 1, distance:  720, side: "left" },  // Post 6
  { label: "F3.1",           name: "El Bicheón",                   sector: 1, distance:  980, side: "left" },  // Post 7
  { label: "F4.1",           name: "Acceso Sector Ancap",          sector: 2, distance: 1180, side: "left" },  // Post 8
  { label: "F4.2",           name: "Ápice Sector Ancap",           sector: 2, distance: 1360, side: "left" },  // Post 9
  { label: "F5.1",           name: "El Tobogán",                   sector: 2, distance: 1570, side: "right" }, // Post 10
  { label: "F6.1",           name: "Recta Opuesta Alta",           sector: 2, distance: 1920, side: "right" }, // Post 11
  { label: "F6.2",           name: "Recta Opuesta Media",          sector: 2, distance: 2220, side: "right" }, // Post 12
  { label: "F6.3",           name: "Recta Opuesta Frenaje",        sector: 2, distance: 2480, side: "right" }, // Post 13
  { label: "F7.1",           name: "Horquilla del Fondo",          sector: 3, distance: 2680, side: "left" },  // Post 14
  { label: "F8.1",           name: "Entrada a La S",               sector: 3, distance: 2880, side: "left" },  // Post 15
  { label: "F9.1",           name: "El Cajón",                     sector: 3, distance: 3230, side: "left" },  // Post 16
];

const ZONES = POSTS.map((p, idx) => ({
  id: idx + 1,
  label: `P${idx + 1 < 10 ? "0" : ""}${idx + 1} · ${p.label}`,
  sector: p.sector,
  hue: Math.round((idx * 360) / POSTS.length),
}));

// Helper to position marshal posts trackside (outside asphalt surface)
function tracksideAt(distanceM, side, offset = 22.0) {
  const s = sampleAt(distanceM);
  const rad = (s.bearing * Math.PI) / 180;
  if (side === "left") {
    // left normal to direction of travel in SVG coordinates
    return {
      x: +(s.x + offset * Math.sin(rad)).toFixed(2),
      y: +(s.y - offset * Math.cos(rad)).toFixed(2),
    };
  } else {
    // right normal to direction of travel in SVG coordinates
    return {
      x: +(s.x - offset * Math.sin(rad)).toFixed(2),
      y: +(s.y + offset * Math.cos(rad)).toFixed(2),
    };
  }
}

// Entry roster (TCR / AUVO 2024 drivers)
const DRIVERS = [
  { number: 112, code: "URR", name: "Santiago Urrutia",    team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 168, code: "EHR", name: "Yann Ehrlacher",      team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 155, code: "MQH", name: "Ma Qing Hua",         team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 111, code: "BJK", name: "Thed Björk",          team: "Cyan Racing Lynk & Co",       team_color: "#005F9E" },
  { number: 129, code: "GIR", name: "Néstor Girolami",     team: "BRC Hyundai N Squadra Corse", team_color: "#002C5F" },
  { number: 105, code: "MIC", name: "Norbert Michelisz",   team: "BRC Hyundai N Squadra Corse", team_color: "#002C5F" },
  { number: 196, code: "AZC", name: "Mikel Azcona",        team: "BRC Hyundai N Squadra Corse", team_color: "#002C5F" },
  { number: 186, code: "GUE", name: "Esteban Guerrieri",   team: "GOAT Racing Honda",           team_color: "#CC0000" },
  { number: 199, code: "BUT", name: "Marco Butti",         team: "GOAT Racing Honda",           team_color: "#CC0000" },
  { number:  62, code: "BOR", name: "Dušan Borković",      team: "GOAT Racing Honda",           team_color: "#CC0000" },
  { number: 127, code: "FIL", name: "John Filippi",        team: "Vulcano Motorsport Audi",     team_color: "#BB0A30" },
  { number:  77, code: "REI", name: "Raphael Reis",        team: "W2 Pro GP CUPRA",             team_color: "#E6552F" },
  { number:  28, code: "OSM", name: "Galid Osman",         team: "W2 Pro GP CUPRA",             team_color: "#E6552F" },
  { number:  37, code: "RSL", name: "Guilherme Reischl",   team: "W2 Pro GP CUPRA",             team_color: "#E6552F" },
  { number:   7, code: "VIV", name: "Thiago Vivacqua",     team: "Cobra Racing Toyota",         team_color: "#EB0A1E" },
  { number:   3, code: "BAP", name: "Rodrigo Baptista",    team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  60, code: "CAS", name: "Juan Manuel Casella", team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  34, code: "CSG", name: "Fabio Casagrande",    team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  15, code: "MAG", name: "Enrique Maglione",    team: "Squadra Martino Honda",       team_color: "#1C1C1C" },
  { number:  43, code: "CDR", name: "Pedro Cardoso",       team: "PMO Racing Peugeot",          team_color: "#1F2A44" },
  { number:   8, code: "SUZ", name: "Rafael Suzuki",       team: "PMO Racing Peugeot",          team_color: "#1F2A44" },
  { number:  17, code: "ROS", name: "Matías Rossi",        team: "Toyota Team Argentina",       team_color: "#FFFFFF" },
  { number:  16, code: "RSO", name: "Juan Ángel Rosso",    team: "Paladini Racing Toyota",      team_color: "#0033A0" },
  { number:  18, code: "SLV", name: "Carlos Silva",        team: "Paladini Racing Toyota",      team_color: "#0033A0" },
  { number:  47, code: "FON", name: "Norberto Fontana",    team: "Squadra Martino Racing",      team_color: "#2C2C2C" },
];

// ---------------------------------------------------------------------------
// 6) Build CircuitTopology JSON.
// ---------------------------------------------------------------------------

const panels = POSTS.map((p, idx) => {
  const s = sampleAt(p.distance);
  return {
    id: idx + 1,
    zone: idx + 1,
    sector: p.sector,
    distance_m: p.distance,
    x: s.x,
    y: s.y,
    bearing_deg: s.bearing,
    side: p.side === "left" ? "inside" : "outside",
  };
});

const posts = POSTS.map((p, idx) => {
  const pos = tracksideAt(p.distance, p.side, 22.0);
  return {
    id: idx + 1,
    label: p.label,
    sector: p.sector,
    zone: idx + 1,
    distance_m: p.distance,
    x: pos.x,
    y: pos.y,
    kind: "flag",
  };
});

const topology = {
  name: "el_pinar_n13",
  label: "Autódromo Víctor Borrat Fabini — Circuito N° 13 (4.000m · Con El Cajón y La S)",
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
  drivers: DRIVERS.map((d) => ({ ...d, initial_zone: null })),
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(topology, null, 2));

console.log(
  `wrote ${OUT_PATH} (${racingLine.length} pts, ${panels.length} panels, ${posts.length} posts, ${topology.drivers.length} drivers, length=${OFFICIAL_LENGTH_M} m)`,
);
