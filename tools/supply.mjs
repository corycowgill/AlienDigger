// Is the deep game supplyable?
//
// This is the regression for the failure that balance retunes keep re-opening:
// fuel cost per tile rises ~4x with depth, so if supply is coupled to anything
// that shrinks with depth the deep strata quietly become unreachable and the
// game is unwinnable on a fraction of seeds without ever erroring.
//
// It walks a straight descent per seed, spends real fuel against the real
// strata table, and banks every fuel cell inside a detour corridor. That is
// optimistic on purpose -- it over-counts what a route could actually collect,
// so a seed it strands is definitely stranded.
//
// Usage:  node tools/supply.mjs [seeds] [corridor]

import { W, CORE_TOP, EMPTY, World, strataAt, rng } from '../src/world.js';
import { populate } from '../src/entities.js';
import { MAX_FUEL } from '../src/player.js';

const FUEL_DRILL = 2.6, DRILL_RATE = 2.2;
const SEEDS = Number(process.argv[2] || 100);
const CORRIDOR = Number(process.argv[3] || 6);

const stranded = [];
const arrivals = [];
const bands = { dirt: 0, rock: 0, ice: 0, fungal: 0, crystal: 0, magma: 0 };

for (let s = 0; s < SEEDS; s++) {
  const world = new World(3000 + s);
  const { pickups } = populate(world, rng((3000 + s) ^ 0x9e37));
  const col = Math.floor(W / 2);
  let fuel = MAX_FUEL, strand = null;

  for (let y = 4; y <= CORE_TOP + 7; y++) {
    if (world.tiles[world.idx(col, y)] !== EMPTY) {
      fuel -= (strataAt(y).hardness / DRILL_RATE) * FUEL_DRILL;
    }
    for (const u of pickups) {
      if (u.taken || u.kind.kind !== 'fuel') continue;
      if (u.y === y && Math.abs(u.x - col) <= CORRIDOR) {
        u.taken = true;
        fuel = Math.min(MAX_FUEL, fuel + u.kind.amount);
      }
    }
    if (fuel <= 0) { strand = y; break; }
  }

  if (strand) {
    stranded.push(strand);
    const n = strataAt(strand).name;
    if (n in bands) bands[n]++;
  } else {
    arrivals.push(Math.round(fuel));
  }
}

const pct = (100 * stranded.length / SEEDS).toFixed(0);
console.log(`corridor +/-${CORRIDOR} columns, ${SEEDS} seeds`);
console.log(`stranded before the core: ${stranded.length}/${SEEDS}  (${pct}%)`);
if (stranded.length) {
  stranded.sort((a, b) => a - b);
  console.log(`  strand depth: median ${stranded[stranded.length >> 1]}  min ${stranded[0]}  max ${stranded[stranded.length - 1]}`);
  console.log(`  by stratum: ${Object.entries(bands).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('  ') || 'none'}`);
}
if (arrivals.length) {
  arrivals.sort((a, b) => a - b);
  console.log(`  fuel on arrival: median ${arrivals[arrivals.length >> 1]}  min ${arrivals[0]}  max ${arrivals[arrivals.length - 1]}`);
}
if (stranded.length / SEEDS > 0.02) {
  console.log('\nFAIL: the deep game is not reliably supplyable.');
  process.exit(1);
}
console.log('\nOK');
