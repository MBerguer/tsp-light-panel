/**
 * Mock GPS Tracking System ("Racer")
 * Emulates the onboard GPS telemetry boxes used by Race Control and Comisarios
 * at El Pinar (VBF Circuito N°13 - 4.000 km)
 *
 * Sends real-time telemetry over UDP to tsp-server (port 8889) or prints live telemetry.
 */

import dgram from 'node:dgram';

const UDP_TARGET_PORT = process.env.RACER_PORT || 8889;
const UDP_TARGET_HOST = '127.0.0.1';
const TRACK_LENGTH_M = 4000;

// Drivers from AUVO C2
const CARS = [
  { num: 29, driver: "Ignacio Effinger", dist: 0, speedKmh: 175 },
  { num: 11, driver: "Dario Silva", dist: 50, speedKmh: 173 },
  { num: 46, driver: "Richard Barbachan", dist: 120, speedKmh: 170 },
  { num: 591, driver: "Agustin Caissutti", dist: 210, speedKmh: 168 },
  { num: 94, driver: "Sergio Patpatian", dist: 350, speedKmh: 165 },
  { num: 55, driver: "Luis Laureiro", dist: 480, speedKmh: 167 },
  { num: 14, driver: "Nicolas Gerpe", dist: 590, speedKmh: 166 },
  { num: 16, driver: "Carlo Esposito", dist: 720, speedKmh: 164 },
  { num: 23, driver: "Diego Amaya", dist: 890, speedKmh: 163 },
  { num: 24, driver: "Alejandro Gonzalez", dist: 1040, speedKmh: 162 }
];

const socket = dgram.createSocket('udp4');

console.log(`=======================================================`);
console.log(`🛰️  "RACER" GPS Telemetry Mock Running!`);
console.log(`📡 Emitting 10 Hz telemetry to UDP ${UDP_TARGET_HOST}:${UDP_TARGET_PORT}`);
console.log(`📍 Track: El Pinar - VBF Circuito N°13 (${TRACK_LENGTH_M}m)`);
console.log(`=======================================================`);

const DT_SEC = 0.1; // 10 Hz update rate

setInterval(() => {
  const now = Date.now();
  const telemetryFrames = [];

  for (const car of CARS) {
    // Advance car along track
    const speedMs = (car.speedKmh * 1000) / 3600;
    car.dist = (car.dist + speedMs * DT_SEC) % TRACK_LENGTH_M;

    // Approximate GPS coords for El Pinar (center ~ -34.793, -55.973)
    const angle = (car.dist / TRACK_LENGTH_M) * 2 * Math.PI;
    const lat = -34.7935 + 0.004 * Math.sin(angle);
    const lon = -55.9730 + 0.007 * Math.cos(angle);

    const frame = {
      car: car.num,
      name: car.driver,
      distance_m: Math.round(car.dist * 10) / 10,
      speed_kmh: car.speedKmh,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      ts: now
    };

    telemetryFrames.push(frame);
  }

  const payload = Buffer.from(JSON.stringify({
    source: "racer_gps",
    circuit: "el_pinar_n13",
    timestamp: now,
    cars: telemetryFrames
  }));

  socket.send(payload, UDP_TARGET_PORT, UDP_TARGET_HOST, (err) => {
    if (err && err.code !== 'ECONNREFUSED') {
      console.error("UDP error:", err.message);
    }
  });
}, 100);
