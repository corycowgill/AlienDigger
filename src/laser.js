// The drill's laser. A short beam fired along the heading: it burns every alien
// in its path and scorches the first rock it meets.
//
// It is deliberately not a machine gun. Ramming is the drill's main offence and
// everything in entities.js is tuned around that, so the laser is a sidearm:
// one shot per press, a cooldown between shots, and every shot dumps heat into
// the same bit that drilling heats. Fire it on a hot rig and it will not fire
// at all -- so it trades against the dig rather than replacing it.

import { ramScale } from './entities.js';

export const LASER = {
  range: 7,          // tiles
  damage: 6,         // per alien in the beam, before armour
  cut: 0.8,          // hardness burned off the rock the beam stops on
  cooldown: 2.4,     // seconds between shots
  heat: 24,          // added to the bit per shot
  lockout: 76,       // will not fire at or above this heat
  fuel: 3,           // a shot is not free
  show: 0.16,        // how long the beam stays drawn
};

const DELTA = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  upleft: [-1, -1], upright: [1, -1],
  downleft: [-1, 1], downright: [1, 1],
};

export function laserReady(p) {
  return !p.dead && (p.laserCd || 0) <= 0 && p.heat < LASER.lockout;
}

// Ticks the cooldown, and fires if asked and able. Returns null when nothing
// fired, 'hot' or 'cooling' when the trigger was pulled but refused (so the
// game can say why), or the shot itself.
export function updateLaser(p, world, aliens, wantFire, dt) {
  p.laserCd = Math.max(0, (p.laserCd || 0) - dt);
  if (p.beam) {
    p.beam.t -= dt;
    if (p.beam.t <= 0) p.beam = null;
  }
  if (!wantFire || p.dead) return null;
  if (p.heat >= LASER.lockout) return 'hot';
  if (p.laserCd > 0) return 'cooling';

  const [dx, dy] = DELTA[p.facing] || DELTA.down;
  p.laserCd = LASER.cooldown;
  p.heat = Math.min(100, p.heat + LASER.heat);
  p.fuel = Math.max(0, p.fuel - LASER.fuel);

  // Walk the beam out tile by tile until it meets rock or runs out of range.
  let x = p.tx, y = p.ty, len = 0;
  let rock = null;
  const path = [];
  for (let step = 1; step <= LASER.range; step++) {
    x += dx; y += dy;
    if (!world.inBounds(x, y)) break;
    len = step;
    path.push(x, y);
    if (world.solid(x, y)) { rock = { x, y }; break; }
  }

  // Every alien on the beam's path is hit -- including one burrowed into the
  // rock it stopped on. Armour and the Guardian's plating count the same way
  // they do for ramming, so the boss still has to be caught open.
  const hits = [];
  for (const a of aliens) {
    if (a.hp <= 0) continue;
    for (let k = 0; k < path.length; k += 2) {
      if (a.x !== path[k] || a.y !== path[k + 1]) continue;
      const dmg = LASER.damage * (1 - (a.kind.armor || 0)) * ramScale(a);
      a.hp -= dmg;
      a.hurt = 0.2;
      // an ambusher that has been shot is not waiting any more
      if (a.kind.ambush) a.woke = true;
      hits.push({ alien: a, dmg, killed: a.hp <= 0 });
      break;
    }
  }

  // The rock remembers being scorched: hardness is burned off the tile, so the
  // drill finishes the job faster, and soft rock breaks outright.
  let broke = false, ore = -1;
  if (rock) {
    const i = world.idx(rock.x, rock.y);
    world.hp[i] = Math.max(0, world.hp[i] - LASER.cut);
    if (world.hp[i] <= 0.05) {
      ore = world.dig(rock.x, rock.y);
      if (ore >= 0) p.minerals[ore]++;
      broke = true;
    }
  }

  p.beam = { x0: p.tx, y0: p.ty, dx, dy, len, t: LASER.show };
  return { hits, rock, broke, ore, len, dx, dy };
}
