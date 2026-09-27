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
    blurb: 'Bank more per mineral',
    cost: (l) => 160 + l * 140,
  },
];

// Base values. Level 0 has to reproduce the tuned game exactly, so these are
// the numbers the balance pass landed on.
const BASE = {
  drillRate: 2.2,
  maxFuel: 100,
  maxHull: 100,
  scanner: 7,
  moveTime: 0.14,
  cargoMult: 1,
  cooling: 1,
};

export function emptySave() {
  return { credits: 0, levels: Object.fromEntries(UPGRADES.map((u) => [u.key, 0])), runs: 0, cracked: 0, taught: {}, best: { depth: 0, haul: 0 } };
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
    cooling: BASE.cooling / (1 + 0.16 * (l.cooling | 0)),
  };
}

// Planets get harder as you crack them, or the Foundry eventually outruns the
// game and every later run is a formality. Rock gets tougher, the caves get
// busier, the climb out gets tighter -- and the haul is worth more, so the risk
// is chosen rather than imposed.
export function difficultyFor(planet) {
  const n = Math.max(0, planet | 0);
  return {
    planet: n + 1,
    hardness: 1 + 0.06 * n,
    density: 1 + 0.10 * n,
    escape: Math.max(40, 60 - 2 * n),
    payout: 1 + 0.18 * n,
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
