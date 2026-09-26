// Headless balance simulation.
//
// The game modules under src/ that hold the actual rules (world, player,
// entities) touch no DOM, so they can be driven straight from Node with stubbed
// input and effects. This runs whole descents at a fixed timestep under a couple
// of policies and reports what actually happens to fuel, hull and depth --
// numbers to check balance claims against instead of reasoning about them.
//
// Usage:  node tools/sim.mjs [runs]

import { TILE, W, D, CORE_TOP, EMPTY, World, strataAt, rng } from '../src/world.js';
import { createPlayer, updatePlayer, damage, MAX_HULL, MAX_FUEL } from '../src/player.js';
import { populate, updateAliens, updateHazards, updatePickups, ramAliens, applyHazard } from '../src/entities.js';

const DT = 1 / 60;
const MAX_SECONDS = 1200;
const ESCAPE_BUDGET = 60;   // must track state.escapeLeft in main.js

const noFx = { spawn() {} };

// An input stub the player module cannot tell from the real one.
function scriptedInput() {
  let dir = null;
  const taps = new Set();
  return {
    set(d) { dir = d; },
    tap(a) { taps.add(a); },
    held: () => false,
    tapped(a) { if (!taps.has(a)) return false; taps.delete(a); return true; },
    direction: () => dir,
    endFrame() {},
  };
}

// Where is the nearest untaken pickup of a kind worth detouring for?
function nearestPickup(pickups, p, radius, want) {
  let best = null, bestD = Infinity;
  for (const u of pickups) {
    if (u.taken || u.kind.kind !== want) continue;
    if (u.y < p.ty) continue;                    // never backtrack upward for fuel
    const d = Math.abs(u.x - p.tx) + Math.abs(u.y - p.ty);
    if (d < bestD && d <= radius) { best = u; bestD = d; }
  }
  return best;
}

function run(seed, policy) {
  const world = new World(seed);
  const player = createPlayer();
  const { aliens, hazards, pickups } = populate(world, rng(seed ^ 0x9e37));
  const input = scriptedInput();
  const shaftX = player.tx;     // the column the descent was dug down

  const log = { seed, policy, reachedCore: false, planted: 0, escaped: false };
  let t = 0, phase = 'descend';
  let fuelOuts = 0, hits = 0, deepest = 0;
  let escapeStart = null, dryTime = 0, dryInvulnTime = 0, blockedHits = 0;
  let alienHits = 0, hazHits = 0, alienDmg = 0, hazDmg = 0, chamberHits = 0;

  while (t < MAX_SECONDS) {
    // ---- policy picks a direction
    let dir = 'down';
    if (phase === 'descend') {
      if (policy === 'greedy') {
        // Detour for fuel when the tank is low, then come back to the shaft
        // column. A player who wanders leaves no straight way home, and the
        // escape timer starts the moment the third charge goes in.
        // A real player goes for the repair kit when the hull is low, not just
        // for fuel -- without that the bot walks into every fight at whatever
        // health it happens to have.
        const u = player.hull < 55 ? nearestPickup(pickups, player, 8, 'repair')
                : player.fuel < 55 ? nearestPickup(pickups, player, 8, 'fuel')
                : null;
        if (u && u.x !== player.tx) dir = u.x < player.tx ? 'left' : 'right';
        else if (!u && player.tx !== shaftX) dir = player.tx < shaftX ? 'right' : 'left';
      }
      if (player.ty >= CORE_TOP + 7) { phase = 'plant'; dir = null; }
    } else if (phase === 'plant') {
      // The Guardian gates the charges, so it has to be rammed down first.
      const boss = aliens.find((a) => a.boss && a.hp > 0);
      if (boss) {
        if (Math.abs(boss.x - player.tx) > 0) dir = boss.x < player.tx ? 'left' : 'right';
        else if (Math.abs(boss.y - player.ty) > 0) dir = boss.y < player.ty ? 'up' : 'down';
        else dir = 'down';
        input.set(dir);
        const fb = player.fuel;
        updatePlayer(player, world, input, DT, noFx);
        if (fb > 0 && player.fuel <= 0) fuelOuts++;
        updateAliens(aliens, world, player, DT, (a) => {
          if (a.hp <= 0) return;
          if (damage(player, a.kind.dmg, noFx)) { hits++; alienHits++; alienDmg += a.kind.dmg; if (player.ty > CORE_TOP) chamberHits++; } else blockedHits++;
        });
        ramAliens(aliens, player, DT, () => {});
        updatePickups(pickups, player, (u) => {
          if (u.kind.kind === 'fuel') player.fuel = Math.min(MAX_FUEL, player.fuel + u.kind.amount);
          else player.hull = Math.min(MAX_HULL, player.hull + u.kind.amount);
        });
        if (player.dead) break;
        t += DT;
        continue;
      }
      const socket = world.chargeSockets.find((s) => !s.planted);
      if (!socket) { phase = 'escape'; dir = 'up'; }
      else if (Math.abs(socket.x - player.tx) > 1) {
        dir = socket.x < player.tx ? 'left' : 'right';
      } else if (Math.abs(socket.y - player.ty) > 1) {
        dir = socket.y < player.ty ? 'up' : 'down';
      } else {
        socket.planted = true;
        player.charges--; player.planted++;
        dir = null;
        if (player.planted === 3) { phase = 'escape'; log.reachedCore = true; escapeStart = t; }
      }
    } else {
      // Climb the shaft that was already dug rather than boring a fresh one.
      // Planting leaves the drill at the far socket, 6 tiles off the descent
      // column, so a competent player walks back to it first.
      if (player.ty <= 3) dir = null;
      else if (!world.solid(player.tx, player.ty - 1)) dir = 'up';
      else if (player.tx !== shaftX) dir = player.tx < shaftX ? 'right' : 'left';
      else dir = 'up';
    }
    input.set(dir);

    // ---- tick the real systems
    const fuelBefore = player.fuel;
    updatePlayer(player, world, input, DT, noFx);
    if (fuelBefore > 0 && player.fuel <= 0) fuelOuts++;

    updateAliens(aliens, world, player, DT, (a) => {
      if (a.hp <= 0) return;
      if (damage(player, a.kind.dmg, noFx)) { hits++; alienHits++; alienDmg += a.kind.dmg; if (player.ty > CORE_TOP) chamberHits++; } else blockedHits++;
    });
    ramAliens(aliens, player, DT, () => {});
    updateHazards(hazards, player, DT, (h) => {
      const r = applyHazard(h, player, world, noFx);
      if (typeof r === 'number') { hits++; hazHits++; hazDmg += r; if (player.ty > CORE_TOP) chamberHits++; }
      else if (r === null) blockedHits++;
    });
    updatePickups(pickups, player, (u) => {
      if (u.kind.kind === 'fuel') player.fuel = Math.min(MAX_FUEL, player.fuel + u.kind.amount);
      else player.hull = Math.min(MAX_HULL, player.hull + u.kind.amount);
    });

    if (player.fuel <= 0) { dryTime += DT; if (player.invuln > 0) dryInvulnTime += DT; }

    deepest = Math.max(deepest, player.ty);
    if (player.dead) { log.deathFuel = Math.round(player.fuel); log.deathPhase = phase; log.deathDepth = player.ty; break; }
    if (phase === 'escape') {
      const spent = t - escapeStart;
      if (player.ty <= 3) { log.escaped = true; log.escapeSecs = +spent.toFixed(1); break; }
      if (spent > ESCAPE_BUDGET) { log.escapeSecs = +spent.toFixed(1); log.tooSlow = true; break; }
    }
    t += DT;
  }

  return {
    ...log,
    planted: player.planted,
    deepest,
    time: +t.toFixed(1),
    hull: Math.max(0, Math.round(player.hull)),
    fuel: Math.round(player.fuel),
    dead: player.dead,
    fuelOuts,
    hits,
    blockedHits,
    alienHits, hazHits, alienDmg, hazDmg, chamberHits,
    dryTime: +dryTime.toFixed(1),
    dryInvulnPct: dryTime > 0 ? Math.round(100 * dryInvulnTime / dryTime) : 0,
    coreDepth: CORE_TOP + 7,
  };
}

// ---- strata arithmetic, independent of any run
function drillBudget() {
  const FUEL_DRILL = 2.6, DRILL_RATE = 2.2;
  let total = 0, prev = 0;
  const rows = [];
  for (const s of strataAt ? [] : []) void s;
  const STRATA = [
    ['topsoil', 0.35, 6], ['dirt', 0.5, 24], ['sandstone', 0.7, 48],
    ['rock', 1.0, 80], ['ice', 1.3, 110], ['fungal', 1.1, 140],
    ['crystal', 1.7, 172], ['magma', 2.4, 200],
  ];
  for (const [name, hard, depth] of STRATA) {
    const tiles = depth - prev; prev = depth;
    const secs = tiles * hard / DRILL_RATE;
    const fuel = secs * FUEL_DRILL;
    total += fuel;
    rows.push({ name, tiles, hard, secs: +secs.toFixed(1), fuel: +fuel.toFixed(1) });
  }
  return { rows, total: +total.toFixed(1) };
}

const runs = Number(process.argv[2] || 40);

console.log('=== fuel cost of drilling every tile of a 200-tile column ===');
const b = drillBudget();
for (const r of b.rows) {
  console.log(`  ${r.name.padEnd(10)} ${String(r.tiles).padStart(3)} tiles  h=${r.hard}  ${String(r.secs).padStart(6)}s  ${String(r.fuel).padStart(6)} fuel`);
}
console.log(`  TOTAL ${b.total} fuel vs a ${MAX_FUEL}-unit tank = ${(b.total / MAX_FUEL).toFixed(1)} tanks\n`);

for (const policy of ['beeline', 'greedy']) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(run(1000 + i, policy));
  const won = results.filter((r) => r.escaped).length;
  const cored = results.filter((r) => r.reachedCore).length;
  const died = results.filter((r) => r.dead).length;
  const avg = (f) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(`=== policy: ${policy}  (${runs} runs) ===`);
  console.log(`  reached core: ${cored}/${runs}   escaped: ${won}/${runs}   died: ${died}/${runs}`);
  console.log(`  avg deepest: ${avg((r) => r.deepest)} / ${results[0].coreDepth}`);
  console.log(`  avg time: ${avg((r) => r.time)}s   avg hits taken: ${avg((r) => r.hits)}`);
  console.log(`  avg hull at end: ${avg((r) => r.hull)}   ran dry: ${results.filter((r) => r.fuelOuts).length}/${runs}`);
  console.log(`  avg seconds at zero fuel: ${avg((r) => r.dryTime)}   of which invulnerable: ${avg((r) => r.dryInvulnPct)}%`);
  console.log(`  avg contacts blocked by i-frames: ${avg((r) => r.blockedHits)}`);
  console.log(`  damage split -> aliens: ${avg((r) => r.alienHits)} hits / ${avg((r) => r.alienDmg)} hull   hazards: ${avg((r) => r.hazHits)} hits / ${avg((r) => r.hazDmg)} hull`);
  console.log(`  hits taken inside the core chamber: ${avg((r) => r.chamberHits)}`);
  const dead = results.filter((r) => r.dead);
  if (dead.length) {
    // A death with fuel still in the tank was chip damage, not a routing error.
    const taxed = dead.filter((r) => r.deathFuel > 5).length;
    const byPhase = {};
    for (const r of dead) byPhase[r.deathPhase] = (byPhase[r.deathPhase] || 0) + 1;
    console.log(`  deaths: ${dead.length}  with fuel left (chip damage): ${taxed}  dry (misrouted): ${dead.length - taxed}`);
    console.log(`  deaths by phase: ${Object.entries(byPhase).map(([k, v]) => `${k} ${v}`).join('  ')}`);
  }
  const esc = results.filter((r) => r.escapeSecs != null);
  if (esc.length) {
    const secs = esc.map((r) => r.escapeSecs);
    console.log(`  escape climb: avg ${(secs.reduce((a, c) => a + c, 0) / secs.length).toFixed(1)}s  max ${Math.max(...secs)}s  of ${ESCAPE_BUDGET}s budget   timed out: ${results.filter((r) => r.tooSlow).length}/${runs}`);
  }
  const sample = results.slice(0, 5).map((r) => `d${r.deepest}/${r.dead ? 'dead' : r.escaped ? 'WON' : 'stuck'}`).join('  ');
  console.log(`  sample: ${sample}\n`);
}
