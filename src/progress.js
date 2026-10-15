// Run-to-run progression. Credits earned from minerals are spent at the Foundry
// on upgrades that scale the drill's constants, and both persist in
// localStorage so a planet cracked is progress kept.
//
// Nothing here touches the DOM, and every storage access is guarded, so the
// headless simulator can import it and run at any upgrade level.

const KEY = 'alien-digger:save:v1';

export const UPGRADES = [
  {
    key: 'drill', name: 'DRILL BIT', max: 5,
    blurb: 'Cuts harder rock faster',
    cost: (l) => 110 + l * 90,
  },
  {
    key: 'tank', name: 'FUEL TANK', max: 5,
    blurb: 'Carry more between caches',
    cost: (l) => 120 + l * 95,
  },
  {
    key: 'hull', name: 'HULL PLATING', max: 5,
    blurb: 'Survive more of the deep',
    cost: (l) => 130 + l * 100,
  },
  {
    key: 'scanner', name: 'SCANNER', max: 3,
    blurb: 'See buried caches further off',
    cost: (l) => 180 + l * 160,
  },
  {
    key: 'thruster', name: 'THRUSTERS', max: 4,
    blurb: 'Move through tunnels quicker',
    cost: (l) => 150 + l * 130,
  },
  {
    key: 'cooling', name: 'HEAT SINKS', max: 4,
    blurb: 'Run hotter rock for longer',
    cost: (l) => 170 + l * 145,
  },
  {
    key: 'cargo', name: 'CARGO BAY', max: 4,
    blurb: 'Hold more ore, and refine it better',
    cost: (l) => 160 + l * 140,
  },
];

// Base values. Level 0 has to reproduce the tuned game exactly, so these are
// the numbers the balance pass landed on.
//
// cargoCap is the one that binds on greed and never on caution. A world holds
// ~240 tiles of ore; a straight shaft down the spawn column frees 8 of them and
// a player who detours for veins frees 30 to 50. At 16 the beeline and the
// fuel-first descent never once fill the bay across 40 simulated runs, while a
// prospector fills it in 43% of them -- so the limit is only ever met by the
// player who went looking, which is the player it has something to say to.
const BASE = {
  drillRate: 2.2,
  maxFuel: 100,
  maxHull: 100,
  scanner: 7,
  moveTime: 0.14,
  cargoMult: 1,
  cargoCap: 16,
  cooling: 1,
};

export function emptySave() {
  return { credits: 0, levels: Object.fromEntries(UPGRADES.map((u) => [u.key, 0])), runs: 0, cracked: 0, taught: {}, best: { depth: 0, haul: 0 }, planet: 'rocky' };
}

export function load() {
  const save = emptySave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return save;
    const got = JSON.parse(raw);
    // Everything is clamped, not just trusted. A hand-edited or half-written
    // save should degrade to something playable rather than feeding a negative
    // planet count into the difficulty curve or showing "-9 planets cracked"
    // on the title.
    const whole = (v, hi) => Math.max(0, Math.min(hi, v | 0));
    save.credits = whole(got.credits, 9e6);
    save.runs = whole(got.runs, 9e5);
    save.cracked = whole(got.cracked, 9e5);
    if (got.taught && typeof got.taught === 'object') save.taught = { ...got.taught };
    if (got.best && typeof got.best === 'object') {
      save.best.depth = whole(got.best.depth, 9e4);
      save.best.haul = whole(got.best.haul, 9e6);
    }
    for (const u of UPGRADES) {
      save.levels[u.key] = Math.min(u.max, Math.max(0, got.levels?.[u.key] | 0));
    }
    // An unknown key falls back to ROCKY rather than throwing, so a save from
    // before planets had types still loads.
    if (typeof got.planet === 'string') save.planet = planetType(got.planet).key;
  } catch {
    // private window, blocked storage, or corrupt JSON: play from scratch
  }
  return save;
}

export function store(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // not being able to persist must never break a run
  }
}

export function statsFor(levels) {
  const l = levels || {};
  return {
    drillRate: BASE.drillRate * (1 + 0.13 * (l.drill | 0)),
    maxFuel: BASE.maxFuel + 26 * (l.tank | 0),
    maxHull: BASE.maxHull + 20 * (l.hull | 0),
    scanner: BASE.scanner + 3 * (l.scanner | 0),
    moveTime: BASE.moveTime / (1 + 0.1 * (l.thruster | 0)),
    cargoMult: BASE.cargoMult + 0.2 * (l.cargo | 0),
    // 16 / 20 / 24 / 28 / 32. Doubling the bay eases the choice rather than
    // ending it: a maxed hold still fills on about one run in ten for a player
    // who prospects hard, which is the point of upgrading it at all. +7 a level
    // was the first cut and it retired the decision by level 2 -- a mechanic
    // that only exists on a fresh save is not a mechanic.
    cargoCap: BASE.cargoCap + 4 * (l.cargo | 0),
    cooling: BASE.cooling / (1 + 0.16 * (l.cooling | 0)),
  };
}

// ----------------------------------------------------------------- planets
// Every planet used to be the same generator with bigger numbers, so the only
// thing the Foundry ever asked was what to buy. These give it a second
// question, and a more interesting one: which world to take. They are offered
// three at a time, so the choice is between concrete alternatives rather than
// against an abstract standard.
//
// Each type has to change what the run *is*, not just how hard it is. A frozen
// world is slow rock that lets the bit run cold, so the heat clock stops being
// the thing that paces you. A hollow one is barely any drilling and far more
// company, so fuel stops being the binding constraint and the hull starts. A
// dense one is almost solid: quiet, slow, and expensive in fuel. Payout is the
// price tag, not the point.
export const PLANET_TYPES = [
  { key: 'rocky', name: 'ROCKY', blurb: 'Nothing unusual. A fair fight.',
    hardness: 1, caves: 1, ore: 1, hazard: 1, alien: 1, heat: 1, payout: 1 },
  { key: 'frozen', name: 'FROZEN', blurb: 'Slow rock, but the bit runs cold',
    hardness: 1.06, caves: 0.95, ore: 0.85, hazard: 0.75, alien: 0.85, heat: 0.5, payout: 1 },
  { key: 'volcanic', name: 'VOLCANIC', blurb: 'Hot and crowded. Pays for it.',
    hardness: 0.96, caves: 1.05, ore: 1.05, hazard: 1.7, alien: 1.4, heat: 1.5, payout: 1.5 },
  { key: 'rich', name: 'MINERAL RICH', blurb: 'Thick veins, and things guarding them',
    hardness: 1.02, caves: 1, ore: 1.7, hazard: 0.95, alien: 1.0, heat: 1, payout: 1 },
  { key: 'hollow', name: 'HOLLOW', blurb: 'Caves all the way down. Less digging, more company.',
    hardness: 1, caves: 1.5, ore: 0.9, hazard: 1, alien: 1.45, heat: 1, payout: 1.45 },
  { key: 'dense', name: 'DENSE', blurb: 'Nearly solid. Slow, quiet, thirsty.',
    hardness: 1.22, caves: 0.7, ore: 1.0, hazard: 0.85, alien: 0.7, heat: 1.1, payout: 1.12 },
];

export function planetType(key) {
  return PLANET_TYPES.find((p) => p.key === key) || PLANET_TYPES[0];
}

// The three on offer after a given number of runs. Derived from the run count
// rather than stored, so it survives a reload and cannot be re-rolled by
// bouncing off the Foundry until a good one appears. ROCKY is always one of
// them: there is always a plain option, so a player who does not want to engage
// with this at all never has to.
export function offeredPlanets(runs) {
  const n = Math.max(0, runs | 0);
  const rest = PLANET_TYPES.filter((p) => p.key !== 'rocky');
  const a = rest[n % rest.length];
  const b = rest[(n * 3 + 2) % rest.length];
  const second = b.key === a.key ? rest[(n * 3 + 3) % rest.length] : b;
  return [PLANET_TYPES[0], a, second];
}

// Planets get harder as you crack them, or the Foundry eventually outruns the
// game and every later run is a formality. Rock gets tougher, the caves get
// busier, the climb out gets tighter -- and the haul is worth more, so the risk
// is chosen rather than imposed.
export function difficultyFor(planet, typeKey = 'rocky') {
  const n = Math.max(0, planet | 0);
  const t = planetType(typeKey);
  return {
    planet: n + 1,
    type: t,
    // The curve and the type multiply: a volcanic world on planet ten is both.
    hardness: (1 + 0.06 * n) * t.hardness,
    density: 1 + 0.10 * n,
    escape: Math.max(40, 60 - 2 * n),
    payout: (1 + 0.18 * n) * t.payout,
    mods: { caves: t.caves, ore: t.ore, heat: t.heat, alien: t.alien, hazard: t.hazard },
  };
}

export function costOf(upgrade, levels) {
  const lvl = levels[upgrade.key] | 0;
  return lvl >= upgrade.max ? null : upgrade.cost(lvl);
}

export function buy(save, upgrade) {
  const cost = costOf(upgrade, save.levels);
  if (cost === null || save.credits < cost) return false;
  save.credits -= cost;
  save.levels[upgrade.key]++;
  return true;
}

// Ore is worth more the rarer it is; the cargo bay scales the whole haul.
export function valueOf(minerals, cargoMult, payout = 1) {
  return Math.round(minerals.reduce((a, c, i) => a + c * (i + 1) * 10, 0) * cargoMult * payout);
}
