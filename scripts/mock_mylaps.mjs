/**
 * Mock MYLAPS Orbits / RMonitor TCP Server
 * Emulates the timing feed from the AUVO timing tower at El Pinar (VBF Circuito N°13)
 * Based on the official AUVO C2 race sheet:
 * Carrera: TURISMO AUVO C2 (30:00 o 12 Vueltas) - Copa Gonchi Rodriguez
 * Leader: (29) Ignacio Effinger, (11) Dario Silva, (46) Richard Barbachan
 *
 * Runs a TCP server on port 50000 (standard RMonitor port).
 * Connect via telnet / netcat: nc localhost 50000
 */

import net from 'node:net';

const PORT = process.env.MYLAPS_PORT || 50000;

// Drivers from the AUVO C2 race sheet
const DRIVERS = [
  { num: "29", first: "Ignacio", last: "Effinger", class: "Turismo AUVO C2", best: "2:06.309", lastLap: "2:06.884" },
  { num: "11", first: "Dario", last: "Silva", class: "Turismo AUVO C2", best: "2:06.289", lastLap: "2:06.440" },
  { num: "46", first: "Richard", last: "Barbachan", class: "Turismo AUVO C2", best: "2:07.553", lastLap: "2:08.950" },
  { num: "591", first: "Agustin", last: "Caissutti", class: "Turismo AUVO C2", best: "2:07.882", lastLap: "2:09.477" },
  { num: "94", first: "Sergio", last: "Patpatian", class: "Turismo AUVO C2", best: "2:08.033", lastLap: "2:08.907" },
  { num: "55", first: "Luis", last: "Laureiro", class: "Turismo AUVO C2", best: "2:07.780", lastLap: "2:08.681" },
  { num: "14", first: "Nicolas", last: "Gerpe", class: "Turismo AUVO C2", best: "2:07.780", lastLap: "2:09.109" },
  { num: "16", first: "Carlo", last: "Esposito", class: "Turismo AUVO C2", best: "2:08.837", lastLap: "2:11.100" },
  { num: "23", first: "Diego", last: "Amaya", class: "Turismo AUVO C2", best: "2:07.011", lastLap: "2:08.922" },
  { num: "24", first: "Alejandro", last: "Gonzalez", class: "Turismo AUVO C2", best: "2:09.183", lastLap: "2:09.183" }
];

const clients = new Set();
let currentLap = 1;
const TOTAL_LAPS = 12;
let elapsedSeconds = 0;
const TIME_LIMIT = 1800; // 30 minutes in seconds

function broadcast(record) {
  const line = `${record}\r\n`;
  for (const client of clients) {
    client.write(line);
  }
}

const server = net.createServer((socket) => {
  console.log(`[MYLAPS Mock] Client connected from ${socket.remoteAddress}:${socket.remotePort}`);
  clients.add(socket);

  // Send Initial Setup (RMonitor handshake)
  socket.write(`$B,10,"TURISMO AUVO C2 - CARRERA (30:00 o 12 Vueltas)"\r\n`);
  
  // Register all competitors
  for (const d of DRIVERS) {
    socket.write(`$COMP,"${d.num}","${d.num}","${d.num}","${d.first}","${d.last}","URY","${d.class}"\r\n`);
  }

  // Send current flag status (1 = Green)
  socket.write(`$F,1,${elapsedSeconds},${TIME_LIMIT - elapsedSeconds}\r\n`);

  socket.on('close', () => {
    console.log(`[MYLAPS Mock] Client disconnected`);
    clients.delete(socket);
  });

  socket.on('error', (err) => {
    console.warn(`[MYLAPS Mock] Socket error:`, err.message);
    clients.delete(socket);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🏁 MYLAPS Orbits / RMonitor Mock Server Running!`);
  console.log(`📡 Listening on TCP port ${PORT}`);
  console.log(`📍 Track: El Pinar - VBF Circuito N°13 (4.000 km)`);
  console.log(`🏆 Session: TURISMO AUVO C2 (12 Vueltas o 30:00)`);
  console.log(`=======================================================`);
});

// Race Simulation Timer Tick (every 2 seconds advances the race)
setInterval(() => {
  elapsedSeconds += 2;
  const remaining = Math.max(0, TIME_LIMIT - elapsedSeconds);

  // Periodic Heartbeat / Flag Status
  const flagCode = (currentLap >= TOTAL_LAPS) ? 4 : 1; // 4 = Chequered Flag!
  broadcast(`$F,${flagCode},${elapsedSeconds},${remaining}`);

  // Send Leaderboard ($G records)
  DRIVERS.forEach((driver, idx) => {
    const pos = idx + 1;
    broadcast(`$G,${pos},"${driver.num}",${currentLap},"13:${Math.floor(elapsedSeconds / 60)}:${elapsedSeconds % 60}","${driver.best}","${driver.lastLap}"`);
  });

  // Advance lap every 10 seconds in demo mode
  if (elapsedSeconds % 10 === 0 && currentLap < TOTAL_LAPS) {
    currentLap++;
    console.log(`[MYLAPS Mock] >> VUELA ${currentLap} / ${TOTAL_LAPS} - Lider: #29 Ignacio Effinger`);
    
    // Simulate passing crossing for leader
    broadcast(`$J,"29","2:06.309","13:18:02.985"`);

    if (currentLap === TOTAL_LAPS) {
      console.log(`[MYLAPS Mock] 🏁 BANDERA A CUADROS! Carrera finalizada.`);
      broadcast(`$F,4,${elapsedSeconds},${remaining}`);
    }
  }
}, 2000);
