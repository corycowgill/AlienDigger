// World-generation census: what a run actually contains.
// Catches content that is defined but never reaches a player.
//
// Usage:  node tools/census.mjs [runs]

import { W, D, CORE_TOP, EMPTY, World, rng } from '../src/world.js';
import { populate, ALIEN_KINDS, HAZARD_KINDS } from '../src/entities.js';

const N = Number(process.argv[2] || 20);
const ORE_NAMES = ['copper', 'iridium', 'voidstone', 'amber', 'pulse'];
const agg = { cave: 0, solid: 0, ore: [0, 0, 0, 0, 0], alien: {}, haz: {}, fuel: 0, repair: 0, buriedPickup: 0, buriedHaz: 0 };

for (let i = 0; i < N; i++) {
  const w = new World(1000 + i);
  const { aliens, hazards, pickups } = populate(w, rng((1000 + i) ^ 0x9e37));
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      const i2 = w.idx(x, y);
      w.tiles[i2] === EMPTY ? agg.cave++ : agg.solid++;
      const o = w.ore[i2];
      if (o >= 0) agg.ore[o]++;
    }
  }
  for (const a of aliens) agg.alien[a.kind.row] = (agg.alien[a.kind.row] || 0) + 1;
  for (const h of hazards) {
    agg.haz[h.kind.row] = (agg.haz[h.kind.row] || 0) + 1;
    if (w.solid(h.x, h.y)) agg.buriedHaz++;
  }
  for (const u of pickups) {
    u.kind.kind === 'fuel' ? agg.fuel++ : agg.repair++;
    if (w.solid(u.x, u.y)) agg.buriedPickup++;
  }
}

const per = (v) => (v / N).toFixed(1);
console.log(`cave share: ${(100 * agg.cave / (agg.cave + agg.solid)).toFixed(1)}%   (${per(agg.cave)} cave / ${per(agg.solid)} solid tiles per run)`);
console.log(`pickups per run  fuel: ${per(agg.fuel)}  repair: ${per(agg.repair)}  of which buried in rock: ${per(agg.buriedPickup)}`);
console.log(`hazards buried in rock: ${per(agg.buriedHaz)} of ${per(Object.values(agg.haz).reduce((a, c) => a + c, 0))}`);
console.log('\nore per run (rarity should fall as value rises):');
agg.ore.forEach((v, i) => console.log(`   ${ORE_NAMES[i].padEnd(10)} tier ${i}  worth ${(i + 1) * 10}  count ${per(v)}`));
console.log('\naliens per run:');
for (const k of ALIEN_KINDS) console.log(`   ${k.row.padEnd(10)} from y=${String(k.from).padStart(3)}  count ${per(agg.alien[k.row] || 0)}`);
console.log(`   ${'guardian'.padEnd(10)} boss       count ${per(agg.alien.guardian || 0)}`);
console.log('\nhazards per run:');
for (const k of HAZARD_KINDS) {
  const c = agg.haz[k.row] || 0;
  console.log(`   ${k.row.padEnd(13)} from y=${String(k.from).padStart(3)}  dmg ${String(k.dmg).padStart(2)}  count ${per(c)}${c === 0 ? '   <-- NEVER SPAWNS' : ''}`);
}
