// Headless balance simulation.
//
// The game modules under src/ that hold the actual rules (world, player,
// entities) touch no DOM, so they can be driven straight from Node with stubbed
// input and effects. This runs whole descents at a fixed timestep under a couple
// of policies and reports what actually happens to fuel, hull and depth --
// numbers to check balance claims against instead of reasoning about them.
//
// Usage:  node tools/sim.mjs [runs] [drill=2,hull=1,detour=9] [planet]
//
// Three policies, in ascending order of greed: `beeline` digs straight down and
// ignores everything, `greedy` manages fuel, hull and heat but walks past every
// vein in the world, and `prospector` also detours for ore up to `detour` tiles
// off its shaft -- which is the policy the finite cargo bay actually acts on,
// since the other two never fill it.

import { TILE, W, D, CORE_TOP, EMPTY, World, STRATA, strataAt, rng } from '../src/world.js';
import { createPlayer, updatePlayer, damage, cargoUsed, cargoRoom, dumpOre } from '../src/player.js';
import { populate, updateAliens, updateHazards, updatePickups, ramAliens, applyHazard, applyPickup, collectOre, runTremor, TREMOR, lavaLevel, lavaBurn, leechSteal } from '../src/entities.js';
import { statsFor, difficultyFor, valueOf, planetType } from '../src/progress.js';

const DT = 1 / 60;
const MAX_SECONDS = 1200;

// How far off the shaft column the prospector policy will chase a vein. This is
// the dial the whole risk/reward curve turns on, so it is a parameter rather
// than a constant -- `node tools/sim.mjs 40 detour=9` reproduces any row of the
// table in the README.
let DETOUR = 6;


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

// Which vein is worth a detour? Scored on tier against distance, because the
// whole question a vein poses is whether what is in it beats the fuel, heat and
// hull of getting there. Never uphill: the climb out is on a clock and a player
// who backtracks loses the straight shaft home.
//
// This is what the finite bay acts on. The old 'greedy' policy is greedy about
// survival -- it detours for fuel and repairs and digs a one-tile shaft past
// every vein in the world -- so it frees about nine ore in a run and never
// comes close to filling a twenty-slot bay. Measuring a cargo limit against it
// would say the limit does nothing, which is true only of a player who ignores
// the ore.
function nearestVein(world, p, radius) {
  let best = null, bestScore = 0;
  for (const v of world.veins || []) {
    if (v.visited) continue;
    if (v.y < p.ty - 1) continue;
    const d = Math.abs(v.x - p.tx) + Math.abs(v.y - p.ty);
    if (d > radius) continue;
    const score = (v.tier + 1) / (1 + d * 0.09);
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
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

function run(seed, policy, levels = {}, planet = 0, type = 'rocky') {
  const diff = difficultyFor(planet, type);
  const world = new World(seed, diff.hardness, diff.mods);
  const player = createPlayer(levels);
  const { aliens, hazards, pickups } = populate(world, rng(seed ^ 0x9e37), diff.density, diff.mods);
  const input = scriptedInput();
  const shaftX = player.tx;     // the column the descent was dug down

  const log = { seed, policy, reachedCore: false, planted: 0, escaped: false };
  let t = 0, phase = 'descend';
  let fuelOuts = 0, hits = 0, deepest = 0;
  let escapeStart = null, dryTime = 0, dryInvulnTime = 0, blockedHits = 0;
  let tremor = 3;
  let alienHits = 0, spitHits = 0, hazHits = 0, alienDmg = 0, hazDmg = 0, chamberHits = 0;
  let dumps = 0, fullAt = 0, dumpT = 0;
  let lavaSecs = 0, lavaGap = Infinity;
  let stolen = 0;

  // A competent player does not haul copper out of the magma layer. Once the
  // bay is full, the cheapest ore aboard is worth less than the slot it is
  // sitting in, so it goes over the side -- which is the decision the finite
  // bay exists to create, and the simulator has to make it or the win rate it
  // reports is the win rate of a player who ignores the mechanic.
  const paces = policy === 'greedy' || policy === 'prospector';

  const manageCargo = () => {
    // Ticked here rather than in the main loop, because the cooling and boss
    // branches below take their own `continue` and would otherwise freeze the
    // dump timer for the whole of the fight.
    dumpT = Math.max(0, dumpT - DT);
    if (!paces) return;
    if (cargoRoom(player) > 0) return;
    if (!fullAt) fullAt = player.ty;
    if (dumpT > 0) return;
    // Only shed what the depth has outgrown: tier 0 and 1 stop being worth a
    // slot once tier 2+ is what the rock is yielding.
    const floor = player.ty > 140 ? 2 : player.ty > 90 ? 1 : 0;
    if (player.minerals.findIndex((n) => n > 0) >= floor) return;
    if (typeof dumpOre(player, world) === 'object') { dumps++; dumpT = 0.14; }
  };

  while (t < MAX_SECONDS) {
    // ---- policy picks a direction
    let dir = 'down';
    if (phase === 'descend') {
      // A competent player paces: the bit cannot grind continuously once the
      // rock is hot, so back off and let it shed before it redlines.
      // Hysteresis: cool properly rather than tapping at the threshold.
      if (paces && (player.heat > 82 || (player.cooling && player.heat > 25))) {
        player.cooling = player.heat > 25;
        input.set(null);
        updatePlayer(player, world, input, DT, noFx);
        updatePickups(pickups, player, (u) => applyPickup(u, player));
        collectOre(world, player);
        manageCargo();
        t += DT;
        continue;
      }

      if (paces) {
        // Detour for fuel when the tank is low, then come back to the shaft
        // column. A player who wanders leaves no straight way home, and the
        // escape timer starts the moment the third charge goes in.
        // A real player goes for the repair kit when the hull is low, not just
        // for fuel -- without that the bot walks into every fight at whatever
        // health it happens to have.
        const u = player.hull < 55 ? nearestPickup(pickups, player, 8, 'repair')
                : player.fuel < 55 ? nearestPickup(pickups, player, 8, 'fuel')
                : null;

        // Staying alive outranks getting paid, so a vein is only chased with
        // the tank and the hull in hand -- and only with somewhere to put it.
        // A full bay chasing ore it cannot carry is the mistake the mechanic is
        // there to make available, not the one a competent policy makes.
        const v = !u && policy === 'prospector' && player.fuel > 55 && player.hull > 55
                  && cargoRoom(player) > 0
                ? nearestVein(world, player, DETOUR) : null;
        if (v && Math.abs(v.x - player.tx) + Math.abs(v.y - player.ty) <= 1) v.visited = true;

        if (u && u.x !== player.tx) dir = u.x < player.tx ? 'left' : 'right';
        else if (v && v.x !== player.tx) dir = v.x < player.tx ? 'left' : 'right';
        else if (v && v.y > player.ty) dir = 'down';
        else if (!u && !v && player.tx !== shaftX) dir = player.tx < shaftX ? 'right' : 'left';
      }
      if (player.ty >= CORE_TOP + 7) { phase = 'plant'; dir = null; }
    } else if (phase === 'plant') {
      // The Guardian gates the charges, so it has to be rammed down first.
      const boss = aliens.find((a) => a.boss && a.hp > 0);
      if (boss) {
        // Play the rhythm: clear the blast radius while it winds up, close and
        // commit while it is open. Standing on it the whole fight is what the
        // phases exist to punish.
        const dx = player.tx - boss.x, dy = player.ty - boss.y;
        const danger = boss.phase === 'windup' || boss.phase === 'slam';
        if (danger) {
          dir = Math.abs(dx) >= Math.abs(dy)
            ? (dx >= 0 ? 'right' : 'left')
            : (dy >= 0 ? 'down' : 'up');
        } else if (Math.abs(boss.x - player.tx) > 0) {
          dir = boss.x < player.tx ? 'left' : 'right';
        } else if (Math.abs(boss.y - player.ty) > 0) {
          dir = boss.y < player.ty ? 'up' : 'down';
        } else {
          dir = 'down';
        }
        input.set(dir);
        const fb = player.fuel;
        updatePlayer(player, world, input, DT, noFx);
        if (fb > 0 && player.fuel <= 0) fuelOuts++;
        updateAliens(aliens, world, player, DT, (a) => {
          if (a.hp <= 0) return;
          if (damage(player, a.kind.dmg, noFx)) { hits++; alienHits++; alienDmg += a.kind.dmg; if (player.ty > CORE_TOP) chamberHits++; } else blockedHits++;
        }, (a) => {
          if (damage(player, a.kind.spitDmg, noFx)) { hits++; spitHits++; alienDmg += a.kind.spitDmg; if (player.ty > CORE_TOP) chamberHits++; }
        }, (a, reach) => {
      if (reach && damage(player, a.kind.slam, noFx)) { hits++; alienDmg += a.kind.slam; chamberHits++; }
    });
        ramAliens(aliens, player, DT, () => {});
        updatePickups(pickups, player, (u) => applyPickup(u, player));
        collectOre(world, player);
        manageCargo();
        // Dying to the Guardian used to leave deathPhase unset, so the summary
        // reported those runs under "undefined".
        if (player.dead) {
          log.deathFuel = Math.round(player.fuel);
          log.deathPhase = phase;
          log.deathDepth = player.ty;
          break;
        }
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
      // A leech takes ore, not hull. Counting it as damage would report a
      // game in which the thief is just another thing that hurts you.
      if (a.kind.steals) {
        if (player.invuln <= 0) { stolen += leechSteal(a, player, world); player.invuln = 0.75; }
        return;
      }
      if (damage(player, a.kind.dmg, noFx)) { hits++; alienHits++; alienDmg += a.kind.dmg; if (player.ty > CORE_TOP) chamberHits++; } else blockedHits++;
    }, (a) => {
      // ranged spit is its own, weaker attack -- without this the harness
      // measures a game where the one ranged enemy does no damage at all
      if (damage(player, a.kind.spitDmg, noFx)) { hits++; spitHits++; alienDmg += a.kind.spitDmg; if (player.ty > CORE_TOP) chamberHits++; }
    }, (a, reach) => {
      if (reach && damage(player, a.kind.slam, noFx)) { hits++; alienDmg += a.kind.slam; chamberHits++; }
    });
    ramAliens(aliens, player, DT, () => {});
    updateHazards(hazards, player, DT, (h) => {
      const r = applyHazard(h, player, world, noFx);
      if (typeof r === 'number') { hits++; hazHits++; hazDmg += r; if (player.ty > CORE_TOP) chamberHits++; }
      else if (r === null) blockedHits++;
    });
    updatePickups(pickups, player, (u) => applyPickup(u, player));
    collectOre(world, player);
    manageCargo();

    if (player.fuel <= 0) { dryTime += DT; if (player.invuln > 0) dryInvulnTime += DT; }

    deepest = Math.max(deepest, player.ty);
    if (player.dead) { log.deathFuel = Math.round(player.fuel); log.deathPhase = phase; log.deathDepth = player.ty; break; }
    if (phase === 'escape') {
      const spent = t - escapeStart;
      // tremors drop rubble into the shaft, same as the game does
      // Same collapse the game runs, imported rather than restated -- this
      // block used to be a hand copy and would have gone stale the moment the
      // tremors started escalating.
      const panic = Math.max(0, Math.min(1, spent / diff.escape));

      // The flood, same function the game runs. Without this the simulator
      // reports the win rate of a game where the lava does not exist.
      const level = lavaLevel(diff.escape - spent, diff.escape);
      if (lavaBurn(player, level, DT) > 0) {
        lavaSecs += DT;
        if (player.dead) { log.deathFuel = Math.round(player.fuel); log.deathPhase = 'lava'; log.deathDepth = player.ty; }
      }
      lavaGap = Math.min(lavaGap, level - player.ty);

      tremor -= DT;
      if (tremor <= 0) {
        tremor = TREMOR.gap(panic) + Math.random() * TREMOR.jitter(panic);
        runTremor(world, player, panic);
      }
      if (player.ty <= 3) { log.escaped = true; log.escapeSecs = +spent.toFixed(1); break; }
      if (spent > diff.escape) { log.escapeSecs = +spent.toFixed(1); log.tooSlow = true; break; }
    }
    t += DT;
  }

  // What the bay actually came home with, and what the run walked past. Ore
  // left lying in the shaft is the cost of the decision; without it the only
  // visible effect of a finite bay is a smaller number, which looks like a
  // straight nerf rather than a trade.
  let looseLeft = 0;
  for (let k = 0; k < world.ore.length; k++) {
    if (world.ore[k] >= 0 && world.tiles[k] === EMPTY) looseLeft += Math.max(1, world.oreCount[k]);
  }
  const stats = statsFor(levels);
  const gross = valueOf(player.minerals, stats.cargoMult, diff.payout);

  return {
    ...log,
    planted: player.planted,
    carried: cargoUsed(player),
    cargoCap: stats.cargoCap,
    banked: log.escaped ? gross : Math.round(gross * 0.4),
    gross,
    dumps,
    fullAt,
    stolen,
    lavaSecs: +lavaSecs.toFixed(1),
    lavaGap: lavaGap === Infinity ? null : Math.round(lavaGap),
    looseLeft,
    deepest,
    time: +t.toFixed(1),
    hull: Math.max(0, Math.round(player.hull)),
    fuel: Math.round(player.fuel),
    dead: player.dead,
    fuelOuts,
    hits,
    blockedHits,
    alienHits, spitHits, hazHits, alienDmg, hazDmg, chamberHits,
    dryTime: +dryTime.toFixed(1),
    dryInvulnPct: dryTime > 0 ? Math.round(100 * dryInvulnTime / dryTime) : 0,
    coreDepth: CORE_TOP + 7,
  };
}

// ---- strata arithmetic, independent of any run
// Read from src/world.js rather than restated here. The copy that used to live
// in this function had drifted: it still carried fungal at hardness 1.1 against
// the real 1.45, so the printed column cost was ~12 fuel light -- a table whose
// whole job is to be the number you check balance claims against.
function drillBudget() {
  const FUEL_DRILL = 2.6;
  const { drillRate: DRILL_RATE, maxFuel: MAX_FUEL } = statsFor({});
  let total = 0, prev = 0;
  const rows = [];
  for (const { name, hardness: hard, depth } of STRATA) {
    const tiles = depth - prev; prev = depth;
    const secs = tiles * hard / DRILL_RATE;
    const fuel = secs * FUEL_DRILL;
    total += fuel;
    rows.push({ name, tiles, hard, secs: +secs.toFixed(1), fuel: +fuel.toFixed(1) });
  }
  return { rows, total: +total.toFixed(1) };
}

const runs = Number(process.argv[2] || 40);
// node tools/sim.mjs 60 drill=2,hull=1  -> simulate a part-upgraded drill
const levels = Object.fromEntries((process.argv[3] || '').split(',').filter(Boolean)
  .map((kv) => { const [k, v] = kv.split('='); return [k, Number(v) || 0]; }));
// detour= rides in the same argument as the upgrade levels, but it is a policy
// dial rather than a stat, so it comes back out before statsFor ever sees it.
if ('detour' in levels) { DETOUR = levels.detour; delete levels.detour; }
const planet = Number(process.argv[4] || 0);
// node tools/sim.mjs 40 '' 0 volcanic  -> run that world type
const TYPE = planetType(process.argv[5] || 'rocky').key;
if (TYPE !== 'rocky') console.log('world:', TYPE);
if (Object.keys(levels).length) console.log('upgrades:', JSON.stringify(levels));
if (planet) console.log('planet:', planet + 1);

console.log('=== fuel cost of drilling every tile of a 200-tile column ===');
const b = drillBudget();
for (const r of b.rows) {
  console.log(`  ${r.name.padEnd(10)} ${String(r.tiles).padStart(3)} tiles  h=${r.hard}  ${String(r.secs).padStart(6)}s  ${String(r.fuel).padStart(6)} fuel`);
}
console.log(`  TOTAL ${b.total} fuel vs a ${statsFor({}).maxFuel}-unit tank = ${(b.total / statsFor({}).maxFuel).toFixed(1)} tanks\n`);

for (const policy of ['beeline', 'greedy', 'prospector']) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(run(1000 + i, policy, levels, planet, TYPE));
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
  console.log(`  damage split -> aliens: ${avg((r) => r.alienHits)} hits / ${avg((r) => r.alienDmg)} hull   spit: ${avg((r) => r.spitHits)} hits   hazards: ${avg((r) => r.hazHits)} hits / ${avg((r) => r.hazDmg)} hull`);
  console.log(`  hits taken inside the core chamber: ${avg((r) => r.chamberHits)}`);
  const filled = results.filter((r) => r.fullAt);
  const firstFull = filled.length
    ? Math.round(filled.reduce((a, r) => a + r.fullAt, 0) / filled.length) : 0;
  console.log(`  cargo: ${avg((r) => r.carried)}/${results[0].cargoCap} aboard   `
            + `bay filled in ${filled.length}/${runs} runs`
            + `${filled.length ? ` (first at ${firstFull}m on average)` : ''}   `
            + `dumped ${avg((r) => r.dumps)}`);
  const lav = results.filter((r) => r.lavaGap != null);
  if (lav.length) {
    const caught = results.filter((r) => r.lavaSecs > 0).length;
    console.log(`  lava: closest ${(lav.reduce((a, r) => a + r.lavaGap, 0) / lav.length).toFixed(1)} tiles below   `
              + `touched it in ${caught}/${runs}   burned for ${avg((r) => r.lavaSecs)}s`);
  }
  console.log(`  ore stolen by leeches: ${avg((r) => r.stolen)} units`);
  console.log(`  haul: ${avg((r) => r.gross)} CR gross -> ${avg((r) => r.banked)} CR banked   `
            + `left lying in the shaft: ${avg((r) => r.looseLeft)} units`);
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
    console.log(`  escape climb: avg ${(secs.reduce((a, c) => a + c, 0) / secs.length).toFixed(1)}s  max ${Math.max(...secs)}s  of ${difficultyFor(planet).escape}s budget   timed out: ${results.filter((r) => r.tooSlow).length}/${runs}`);
  }
  const sample = results.slice(0, 5).map((r) => `d${r.deepest}/${r.dead ? 'dead' : r.escaped ? 'WON' : 'stuck'}`).join('  ');
  console.log(`  sample: ${sample}\n`);
}
