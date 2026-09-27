// The Super Drill. Grid-based: it occupies one tile and either moves into an
// open neighbour or grinds through a solid one. Fuel pays for both.

import { TILE, W, D, EMPTY } from './world.js';
import { statsFor } from './progress.js';

// Move time, drill rate, tank and hull now come from the player's upgrade
// levels (see progress.js). Level 0 reproduces the tuned base game, so anything
// reading p.stats gets the same numbers a fresh save always had.
const FUEL_DRILL = 2.6;     // per second while drilling
const FUEL_MOVE = 1.1;      // per second while moving
const FUEL_IDLE = 0.15;
const FUEL_STARVE_DPS = 6;  // an empty tank kills a full hull in ~17s

// Drilling on an empty tank runs at a fraction of normal speed: the rig is
// burning hull for power, which is what the draining health bar reads as. A
// hard stop was the other option and is more literal, but it can seal a player
// into a pocket with no recourse at all, and this keeps a tense last-ditch grind
// available instead. Measured over 40 runs per policy, the choice only taxes
// careless play -- a naive dig wins 20/40 at full speed, 12/40 here and 8/40 at
// a hard stop, while competent fuel management wins 34/40 at every setting
// because it never runs dry in the first place.
const DRY_DRILL_SCALE = 0.35;

export function createPlayer(levels) {
  const stats = statsFor(levels);
  return {
    stats,
    tx: Math.floor(W / 2), ty: 3,
    px: Math.floor(W / 2) * TILE, py: 3 * TILE,
    facing: 'down',
    hull: stats.maxHull,
    fuel: stats.maxFuel,
    minerals: [0, 0, 0, 0, 0],
    charges: 3,
    planted: 0,
    frame: 0,
    drilling: false,
    moving: null,        // { fromX, fromY, toX, toY, t }
    drillProgress: 0,
    drillTarget: null,
    invuln: 0,
    dead: false,
  };
}

const DELTA = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
};

export function updatePlayer(p, world, input, dt, fx) {
  p.invuln = Math.max(0, p.invuln - dt);
  if (p.dead) return;

  // finish an in-progress move before accepting new input
  if (p.moving) {
    p.moving.t += dt / p.stats.moveTime;
    const t = Math.min(1, p.moving.t);
    p.px = p.moving.fromX * TILE + (p.moving.toX - p.moving.fromX) * TILE * t;
    p.py = p.moving.fromY * TILE + (p.moving.toY - p.moving.fromY) * TILE * t;
    p.fuel -= FUEL_MOVE * dt;
    if (t >= 1) {
      p.tx = p.moving.toX; p.ty = p.moving.toY;
      p.px = p.tx * TILE; p.py = p.ty * TILE;
      p.moving = null;
    }
    p.frame += dt * 14;
    return;
  }

  const dir = input.direction();
  if (!dir) {
    p.drilling = false;
    p.drillProgress = 0;
    p.drillTarget = null;
    p.fuel -= FUEL_IDLE * dt;
    return;
  }

  p.facing = dir;
  const [dx, dy] = DELTA[dir];
  const nx = p.tx + dx, ny = p.ty + dy;

  if (!world.inBounds(nx, ny)) { p.drilling = false; return; }

  if (world.solid(nx, ny)) {
    // grinding: progress is per-target, so switching direction restarts it
    if (!p.drillTarget || p.drillTarget.x !== nx || p.drillTarget.y !== ny) {
      p.drillTarget = { x: nx, y: ny };
      p.drillProgress = 0;
    }
    p.drilling = true;
    p.drillProgress += p.stats.drillRate * (p.fuel <= 0 ? DRY_DRILL_SCALE : 1) * dt;
    p.fuel -= FUEL_DRILL * dt;
    p.frame += dt * 22;

    if (p.drillProgress % 0.35 < dt * p.stats.drillRate) {
      fx.spawn('debris', nx * TILE + TILE / 2, ny * TILE + TILE / 2);
    }

    if (p.drillProgress >= world.hardness(nx, ny)) {
      const ore = world.dig(nx, ny);
      if (ore >= 0) {
        p.minerals[ore]++;
        fx.spawn('sparkle', nx * TILE + TILE / 2, ny * TILE + TILE / 2);
      }
      fx.spawn('dustpuff', nx * TILE + TILE / 2, ny * TILE + TILE / 2);
      p.drillProgress = 0;
      p.drillTarget = null;
      p.moving = { fromX: p.tx, fromY: p.ty, toX: nx, toY: ny, t: 0 };
    }
  } else {
    p.drilling = false;
    p.drillProgress = 0;
    p.drillTarget = null;
    p.moving = { fromX: p.tx, fromY: p.ty, toX: nx, toY: ny, t: 0 };
  }

  // Fuel starvation drains the hull directly, deliberately bypassing the i-frame
  // system. Routing it through damage() made it self-gating: one ~0.13 hit per
  // 0.6s, about 0.22/sec, so an empty tank needed ~450s to kill. Worse, every
  // one of those hits refreshed invuln, so running dry left the drill almost
  // immune to aliens and hazards -- the opposite of the pressure it should be.
  if (p.fuel <= 0) {
    p.fuel = 0;
    p.hull -= FUEL_STARVE_DPS * dt;
    if (p.hull <= 0) { p.hull = 0; p.dead = true; }
  }
}

// The shared invulnerability window is deliberately global: a hazard and an
// alien can occupy one tile, and without it several sources stack into damage
// with no counterplay. 0.9s rather than 0.6s because once aliens could actually
// path to the player and the core chamber had a guard detail, a run took 11
// contacts instead of 0.5, and at 0.6s that was 122 hull against a 100 tank.
// Measured over 40 runs: competent play wins 23/40 here, 14/40 at 0.6s and
// 31/40 at 1.2s, against 6/40 for a careless straight dig. Settled at 0.75s
// once the Foundry landed: a fresh save wins about two runs in three, and
// upgrades buy the rest of the margin back rather than starting with it.
export function damage(p, amount, fx) {
  if (p.invuln > 0 || p.dead) return false;
  p.hull -= amount;
  p.invuln = 0.75;
  if (fx) fx.spawn('shieldhit', p.px + TILE / 2, p.py + TILE / 2);
  if (p.hull <= 0) { p.hull = 0; p.dead = true; }
  return true;
}
