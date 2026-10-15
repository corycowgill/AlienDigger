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
import { populate, collectOre, hitScale, updateAliens, ALIEN_KINDS, HAZARD_KINDS, PICKUPS,
         VENT_TIME, VENT_BONUS, COIL_TIME, lavaLevel, lavaBurn, LAVA, DEATH_OF, staggerOf } from '../src/entities.js';
import { createPlayer, cargoUsed, cargoRoom, stowOre, dumpOre } from '../src/player.js';
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

// ------------------------------------------------------------------ cargo
// The bay is only a decision if ore survives being left behind. Every one of
// these is a way for a full hold to quietly eat the haul instead of handing the
// player a choice, which would turn the mechanic from a trade into a tax.
console.log('\ncargo');
{
  const world = new World(4242);
  const p = createPlayer({});
  const cap = p.stats.cargoCap;

  check('a fresh bay is empty and has room', cargoUsed(p) === 0 && cargoRoom(p) === cap);

  // somewhere open to work in
  const ox = Math.floor(W / 2), oy = 40;
  for (let y = oy - 1; y <= oy + 1; y++) world.dig(ox, y);

  p.minerals = [0, 0, 0, 0, 0];
  p.minerals[0] = cap;
  check('the bay fills at exactly its capacity', cargoRoom(p) === 0 && cargoUsed(p) === cap);

  // A full bay digging out ore must leave it in the tile, not vaporise it.
  const spill = stowOre(p, world, 4, 3, ox, oy);
  check('a full bay stows nothing', spill.kept === 0);
  check('what it cannot carry stays in the tile',
        spill.left === 3 && world.looseAt(ox, oy) === 4 && world.oreCount[world.idx(ox, oy)] === 3,
        `tier ${world.looseAt(ox, oy)} x${world.oreCount[world.idx(ox, oy)]}`);
  check('the overflow is reported for the HUD to say so', !!p.spilled && p.spilled.count === 3);

  // Dumping has to free a slot and put the ore somewhere recoverable.
  p.tx = ox; p.ty = oy; p.facing = 'down';
  const out = dumpOre(p, world);
  check('dump sheds the cheapest tier aboard',
        typeof out === 'object' && out.tier === 0, JSON.stringify(out));
  check('dump lands behind the drill, not underfoot',
        typeof out === 'object' && out.y === oy - 1);
  check('dump frees exactly one slot', cargoRoom(p) === 1);

  // ...and the slot it freed is immediately usable by the pile underfoot,
  // which is the one-press swap the whole mechanic rests on.
  collectOre(world, p);
  check('the freed slot takes the better ore underfoot',
        p.minerals[4] === 1 && cargoRoom(p) === 0, `t4=${p.minerals[4]}`);

  // A tremor burying your stash must not delete it.
  const before = world.oreCount[world.idx(ox, oy)];
  world.collapse(ox, oy);
  check('a tremor buries loose ore rather than destroying it',
        world.ore[world.idx(ox, oy)] === 4 && world.oreCount[world.idx(ox, oy)] === before,
        `x${world.oreCount[world.idx(ox, oy)]} still there`);
  const back = world.dig(ox, oy);
  check('digging rubble out returns the whole pile',
        back.tier === 4 && back.count === before, `${back.count} of ${before}`);

  // One tier per tile, or a pile stops being legible at a glance.
  check('a tile refuses a second tier',
        world.drop(ox, oy, 2, 1) === 1 && world.drop(ox, oy, 3, 1) === 0);
  check('ore never drops into solid rock', world.drop(ox, oy + 6, 1, 1) === 0);

  // The upgrade has to actually ease the thing it is sold as easing.
  const laddered = UPGRADES.find((u) => u.key === 'cargo');
  const caps = [];
  for (let l = 0; l <= laddered.max; l++) caps.push(statsFor({ cargo: l }).cargoCap);
  check('the cargo ladder rises every level',
        caps.every((c, i) => i === 0 || c > caps[i - 1]), caps.join(' < '));
  check('a maxed bay at least doubles the base',
        caps[caps.length - 1] >= caps[0] * 2, `${caps[0]} -> ${caps[caps.length - 1]}`);

  // ...and must still be bigger than a cautious descent ever needs, or the
  // limit would be taxing the player who never went looking for ore.
  let freed = 0;
  const SEEDS = 40;
  for (let s = 0; s < SEEDS; s++) {
    const w = new World(9100 + s);
    const col = Math.floor(W / 2);
    for (let y = 3; y <= CORE_TOP + 7; y++) {
      const i = w.idx(col, y);
      if (w.tiles[i] !== EMPTY && w.ore[i] >= 0) freed++;
    }
  }
  check('a straight shaft never fills the base bay',
        freed / SEEDS < caps[0], `${(freed / SEEDS).toFixed(1)} ore vs ${caps[0]} slots`);
}

// ------------------------------------------------------------------- lava
// The flood is pinned to the countdown so it can never lose a run the clock
// would have won. If that pinning drifts, the escape silently becomes a
// different and much harder game, and nothing else here would notice.
console.log('\nlava');
{
  const esc = difficultyFor(0).escape;
  const atStart = lavaLevel(esc, esc);
  const atEnd = lavaLevel(0, esc);
  check('starts below the world', atStart > D, `y=${atStart.toFixed(0)}`);
  check('reaches the surface as the clock expires', atEnd <= 3, `y=${atEnd.toFixed(1)}`);

  // Monotonic: it must never retreat, or the player could out-wait it.
  let falls = 0, prev = Infinity;
  for (let i = 0; i <= 100; i++) {
    const lv = lavaLevel(esc * (1 - i / 100), esc);
    if (lv > prev + 1e-9) falls++;
    prev = lv;
  }
  check('never retreats', falls === 0, `${falls} reversals`);

  // A head start, or planting the third charge would drown you where you stand.
  check('the core chamber is safe when the charges arm',
        lavaLevel(esc, esc) > CORE_TOP + 7 && lavaLevel(esc * 0.93, esc) > CORE_TOP + 7);

  // Burning has to bypass i-frames, or standing in lava becomes survivable.
  const p = createPlayer({});
  p.ty = 150; p.hull = 100; p.invuln = 99;
  const burn = lavaBurn(p, 100, 1);
  check('lava burns through invulnerability', burn > 0 && p.hull < 100,
        `${burn.toFixed(0)} hull/s`);
  check('two seconds in it is fatal from full hull', LAVA.dps * 2 >= createPlayer({}).stats.maxHull,
        `${LAVA.dps} dps vs ${createPlayer({}).stats.maxHull} hull`);

  const safe = createPlayer({});
  safe.ty = 50; safe.hull = 100;
  check('above the surface is safe', lavaBurn(safe, 100, 1) === 0 && safe.hull === 100);

  // Every planet, including the tightest escape window there is.
  const tight = difficultyFor(999).escape;
  check('it still reaches the surface on the hardest planet',
        lavaLevel(0, tight) <= 3, `${tight}s window`);
}

// ----------------------------------------------------------------- combat
// Every alien is supposed to have an answer, and a different one. These check
// that the answers exist and that the ram and the beam agree about them -- the
// moment those two disagree the player is being taught two different games.
console.log('\ncombat');
{
  const crabKind = ALIEN_KINDS.find((k) => k.row === 'rockcrab');
  const crab = (face) => ({ kind: crabKind, x: 5, y: 5, hp: 8, maxHp: 8, face });

  // Shell faces right: a hit arriving from the right is frontal.
  const facingRight = crab([1, 0]);
  const front = hitScale(facingRight, 1, 0);
  const rear = hitScale(facingRight, -1, 0);
  const flank = hitScale(facingRight, 0, 1);
  check('a crab shrugs off a head-on hit', Math.abs(front - (1 - crabKind.armor)) < 1e-9,
        `x${front.toFixed(2)}`);
  check('its back is bare', Math.abs(rear - 1) < 1e-9, `x${rear.toFixed(2)}`);
  check('its flank is bare', Math.abs(flank - 1) < 1e-9, `x${flank.toFixed(2)}`);
  check('flanking is worth strictly more than meeting it head-on', rear > front,
        `x${rear.toFixed(2)} vs x${front.toFixed(2)}`);
  // The forward hemisphere is armoured, so a single diagonal step is not a flank.
  check('a diagonal off its nose is still frontal',
        Math.abs(hitScale(facingRight, 1, -1) - front) < 1e-9);

  // An unarmoured kind must not accidentally gain a facing rule.
  const worm = { kind: ALIEN_KINDS.find((k) => k.row === 'grubworm'), face: [1, 0] };
  check('kinds without a shell ignore direction',
        hitScale(worm, 1, 0) === 1 && hitScale(worm, -1, 0) === 1);

  // A venting spitter is the window its behaviour is built around.
  const spit = ALIEN_KINDS.find((k) => k.row === 'spitter');
  check('a vented spitter takes more',
        hitScale({ kind: spit, vent: VENT_TIME }, 1, 0) === VENT_BONUS
        && hitScale({ kind: spit, vent: 0 }, 1, 0) === 1);

  // The boss is a phase, not a side: no angle may cheat its plating.
  const boss = { boss: true, kind: { boss: true }, phase: 'armored' };
  const angles = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  check('no approach angle beats the Guardian plating',
        angles.every(([x, y]) => hitScale(boss, x, y) === hitScale(boss, 1, 0)));
  check('the Guardian is still worth catching open',
        hitScale({ boss: true, kind: {}, phase: 'exposed' })
        > hitScale({ boss: true, kind: {}, phase: 'armored' }));

  // Nothing may ever make a hit heal, or land for nothing.
  const every = [];
  for (const k of ALIEN_KINDS) {
    for (const f of [[1, 0], [-1, 0], [0, 1], [0, -1], null]) {
      for (const v of [0, VENT_TIME]) {
        for (const [ax, ay] of angles) every.push(hitScale({ kind: k, face: f, vent: v }, ax, ay));
      }
    }
  }
  check('a hit always lands for something', every.every((k) => k > 0),
        `min x${Math.min(...every).toFixed(2)}`);

  // The lurker's telegraph: it must hold still long enough to be read, then go.
  {
    const world = new World(31337);
    const lurk = ALIEN_KINDS.find((k) => k.row === 'lurker');
    // a clear corridor so nothing but the coil can stop it moving
    for (let x = 4; x <= 12; x++) world.dig(x, 100);
    const a = { kind: lurk, x: 10, y: 100, px: 10 * 32, py: 100 * 32,
                hp: lurk.hp, maxHp: lurk.hp, t: 0, dx: -1, face: [-1, 0] };
    const p = { tx: 7, ty: 100, px: 7 * 32, py: 100 * 32, hull: 100, invuln: 0,
                shield: 0, dead: false, stats: { maxHull: 100 } };
    updateAliens([a], world, p, 1 / 60, () => {}, null, null);
    check('a lurker coils when it wakes', a.woke && a.coil > 0, `${a.coil.toFixed(2)}s`);
    const heldAt = a.px;
    for (let i = 0; i < Math.round((COIL_TIME - 0.05) * 60); i++) {
      updateAliens([a], world, p, 1 / 60, () => {}, null, null);
    }
    check('it does not move while coiled', a.px === heldAt, `${a.px} vs ${heldAt}`);
    for (let i = 0; i < 20; i++) updateAliens([a], world, p, 1 / 60, () => {}, null, null);
    check('and then it bolts', a.coil === 0 && a.px < heldAt, `${a.px} vs ${heldAt}`);
  }
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

  // Every kind must have a death, and that death must have art. Adding an
  // alien without one is silent: it just dies as nothing at all.
  for (const k of ALIEN_KINDS) {
    const death = DEATH_OF[k.row];
    check(`${k.row} has a death`, !!death && rows[death] > 0, death || 'unmapped');
  }
  check('both staggers exist',
        rows[staggerOf({ kind: {} })] > 0 && rows[staggerOf({ kind: { armor: 0.5 } })] > 0);
  check('pickup row covers every kind', (rows.pickup || 0) >= PICKUPS.length,
        `${rows.pickup} frames for ${PICKUPS.length} kinds`);
  check('gem row covers every ore tier', (rows.gem || 0) >= 5);

  // The Foundry draws one icon per level, so a row that is short silently shows
  // the wrong part and a row that is long carries art nothing can ever display.
  // The original art brief asked for five stages of everything against real
  // ladders of 5/5/5/3/4/4/4, which is exactly this failure.
  const UPG_ART = {
    drill: 'upgdrill', tank: 'upgtank', hull: 'upghull', scanner: 'upgscan',
    thruster: 'upgthrust', cooling: 'upgheat', cargo: 'upgcargo',
  };
  for (const u of UPGRADES) {
    const got = rows[UPG_ART[u.key]] || 0;
    check(`upgrade art for ${u.key} matches its ladder`, got === u.max,
          `${got} frames for ${u.max} levels`);
  }
  check('tiles cover every stratum',
        (atlas.alien_digger_03_terrain_tiles?.tiles?.length || 0) >= STRATA.length * 6);

  // effect names are strings, so a typo fails silently at runtime
  const fxRows = new Set([
    ...Object.keys(atlas.alien_digger_07_fx_sheet?.animations || {}),
    // the heat/laser sheet is folded into the same flat namespace by fx.js
    ...Object.keys(atlas.alien_digger_14_heat_laser?.animations || {}),
    ...Object.keys(atlas.alien_digger_15_collapse?.animations || {}),
    ...Object.keys(atlas.alien_digger_18_lava?.animations || {}),
    ...Object.keys(atlas.alien_digger_17_reactions?.animations || {}),
    // fx.js also resolves the minerals sheet's sparkle row by name
    ...Object.keys(atlas.alien_digger_04_minerals_sheet?.animations || {}).filter((r) => r === 'sparkle'),
  ]);
  // Every quoted name inside a spawn call, not just one sitting right after the
  // paren. Half the spawns pick their row with a ternary now -- the heat stages,
  // the beam hitting rock -- and the old literal-only pattern walked straight
  // past all of them, which is the exact silent failure this check exists for.
  const spawned = [];
  for (const call of src.matchAll(/fx\.spawn\(([^;]*?)\)\s*;/g)) {
    // A ternary that picks a row by testing something else -- `row ===
    // 'electricvein' ? 'sparks' : 'flash'` -- puts a string in the call that is
    // not a row name. Only the value side counts, so comparisons go first.
    const values = call[1].replace(/[!=]==?\s*'[a-z_]+'/g, '');
    for (const lit of values.matchAll(/'([a-z_]+)'/g)) spawned.push(lit[1]);
  }
  const missing = [...new Set(spawned)].filter((r) => !fxRows.has(r));
  check('every fx.spawn names a real row', missing.length === 0,
        `${new Set(spawned).size} rows referenced${missing.length ? ': ' + missing.join(', ') : ''}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
