// One command that says whether the game is still correct.
//
// Balance work in this project has repeatedly broken something quietly: a
// stratum that stopped getting harder, a hazard kind that could no longer
// spawn, a supply curve that made the deep game unreachable, an art row
// referenced by a name that no longer existed. Each was found by accident. This
// runs the invariants that each of those violated, and exits non-zero.
//
// Usage:  node tools/check.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { W, D, CORE_TOP, EMPTY, STRATA, World, rng, strataAt } from '../src/world.js';
import { populate, ALIEN_KINDS, HAZARD_KINDS, PICKUPS } from '../src/entities.js';
import { statsFor, difficultyFor, UPGRADES } from '../src/progress.js';

let failures = 0;
function check(name, ok, detail = '') {
  const mark = ok ? 'ok  ' : 'FAIL';
  if (!ok) failures++;
  console.log(`  ${mark} ${name}${detail ? '  -- ' + detail : ''}`);
}

// ---------------------------------------------------------------- strata
console.log('strata');
{
  let monotonic = true, offender = '';
  for (let i = 1; i < STRATA.length; i++) {
    if (STRATA[i].hardness < STRATA[i - 1].hardness) {
      monotonic = false;
      offender = `${STRATA[i].name} ${STRATA[i].hardness} < ${STRATA[i - 1].name} ${STRATA[i - 1].hardness}`;
    }
  }
  check('hardness rises with depth', monotonic, offender);

  const depths = STRATA.map((s) => s.depth);
  check('depths ascend and reach the core',
        depths.every((d, i) => i === 0 || d > depths[i - 1]) && depths[depths.length - 1] >= D);
  check('exactly one stratum cools', STRATA.filter((s) => s.heat < 0).length === 1);
}

// ------------------------------------------------------------ reachability
console.log('\ncontent reachability');
{
  const seen = { alien: {}, hazard: {}, pickup: {}, ore: [0, 0, 0, 0, 0] };
  const RUNS = 40;
  for (let i = 0; i < RUNS; i++) {
    const world = new World(7000 + i);
    const { aliens, hazards, pickups } = populate(world, rng((7000 + i) ^ 0x9e37));
    for (const a of aliens) seen.alien[a.kind.row] = (seen.alien[a.kind.row] || 0) + 1;
    for (const h of hazards) seen.hazard[h.kind.row] = (seen.hazard[h.kind.row] || 0) + 1;
    for (const u of pickups) seen.pickup[u.kind.kind] = (seen.pickup[u.kind.kind] || 0) + 1;
    for (let k = 0; k < world.ore.length; k++) if (world.ore[k] >= 0) seen.ore[world.ore[k]]++;
  }
  for (const k of ALIEN_KINDS) {
    check(`alien ${k.row} spawns`, (seen.alien[k.row] || 0) > 0, `${((seen.alien[k.row] || 0) / RUNS).toFixed(1)}/run`);
  }
  for (const k of HAZARD_KINDS) {
    check(`hazard ${k.row} spawns`, (seen.hazard[k.row] || 0) > 0, `${((seen.hazard[k.row] || 0) / RUNS).toFixed(1)}/run`);
  }
  for (const k of PICKUPS) {
    check(`pickup ${k.kind} spawns`, (seen.pickup[k.kind] || 0) > 0, `${((seen.pickup[k.kind] || 0) / RUNS).toFixed(1)}/run`);
  }
  const rarityFalls = seen.ore.every((v, i) => i === 0 || v <= seen.ore[i - 1]);
  check('ore rarity falls as value rises', rarityFalls, seen.ore.map((v) => Math.round(v / RUNS)).join(' > '));
}

// ------------------------------------------------------------------ supply
console.log('\nsupply');
{
  const FUEL_DRILL = 2.6;
  const { drillRate, maxFuel } = statsFor({});
  let stranded = 0;
  const SEEDS = 120;
  for (let s = 0; s < SEEDS; s++) {
    const world = new World(8000 + s);
    const { pickups } = populate(world, rng((8000 + s) ^ 0x9e37));
    const col = Math.floor(W / 2);
    let fuel = maxFuel;
    for (let y = 4; y <= CORE_TOP + 7; y++) {
      if (world.tiles[world.idx(col, y)] !== EMPTY) {
        fuel -= (strataAt(y).hardness / drillRate) * FUEL_DRILL;
      }
      for (const u of pickups) {
        if (!u.taken && u.kind.kind === 'fuel' && u.y === y && Math.abs(u.x - col) <= 6) {
          u.taken = true;
          fuel = Math.min(maxFuel, fuel + u.kind.amount);
        }
      }
      if (fuel <= 0) { stranded++; break; }
    }
  }
  check('deep game is supplyable', stranded / SEEDS <= 0.02, `${stranded}/${SEEDS} stranded`);
}

// ------------------------------------------------------------ progression
console.log('\nprogression');
{
  const base = statsFor({});
  const maxed = statsFor(Object.fromEntries(UPGRADES.map((u) => [u.key, u.max])));
  check('every upgrade changes a stat',
        UPGRADES.every((u) => {
          const one = statsFor({ [u.key]: 1 });
          return Object.keys(base).some((k) => one[k] !== base[k]);
        }));
  check('maxed beats base on every axis',
        maxed.maxHull > base.maxHull && maxed.maxFuel > base.maxFuel
        && maxed.drillRate > base.drillRate && maxed.scanner > base.scanner
        && maxed.moveTime < base.moveTime && maxed.cargoMult > base.cargoMult
        && maxed.cooling < base.cooling);
  const p1 = difficultyFor(0), p9 = difficultyFor(8);
  check('later planets are harder and pay more',
        p9.hardness > p1.hardness && p9.density > p1.density
        && p9.escape < p1.escape && p9.payout > p1.payout);
  check('escape budget never reaches zero', difficultyFor(999).escape > 0);
}

// -------------------------------------------------------------------- art
console.log('\nart');
{
  const atlas = JSON.parse(readFileSync(new URL('../art/game/atlas.json', import.meta.url)));
  const src = readdirSync(new URL('../src/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8'))
    .join('\n');

  const rows = {};
  for (const sheet of Object.values(atlas)) {
    for (const [row, data] of Object.entries(sheet.animations || {})) rows[row] = data.count;
  }
  // every kind the rules reference must have art behind it
  for (const k of ALIEN_KINDS) check(`art for alien ${k.row}`, rows[k.row] > 0);
  for (const k of HAZARD_KINDS) check(`art for hazard ${k.row}`, rows[k.row] > 0);
  check('art for the guardian', rows.guardian > 0);
  check('pickup row covers every kind', (rows.pickup || 0) >= PICKUPS.length,
        `${rows.pickup} frames for ${PICKUPS.length} kinds`);
  check('gem row covers every ore tier', (rows.gem || 0) >= 5);
  check('tiles cover every stratum',
        (atlas.alien_digger_03_terrain_tiles?.tiles?.length || 0) >= STRATA.length * 6);

  // effect names are strings, so a typo fails silently at runtime
  const fxRows = new Set([
    ...Object.keys(atlas.alien_digger_07_fx_sheet?.animations || {}),
    // fx.js also resolves the minerals sheet's sparkle row by name
    ...Object.keys(atlas.alien_digger_04_minerals_sheet?.animations || {}).filter((r) => r === 'sparkle'),
  ]);
  const spawned = [...src.matchAll(/fx\.spawn\('([a-z]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(spawned)].filter((r) => !fxRows.has(r));
  check('every fx.spawn names a real row', missing.length === 0, missing.join(', '));
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
