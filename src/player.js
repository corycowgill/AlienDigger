// The Super Drill. Grid-based: it occupies one tile and either moves into an
// open neighbour or grinds through a solid one. Fuel pays for both.

import { TILE, W, D, EMPTY } from './world.js';

export const MAX_HULL = 100;
export const MAX_FUEL = 100;

const MOVE_TIME = 0.14;     // seconds to cross an open tile
const DRILL_RATE = 2.2;     // hardness units per second
const FUEL_DRILL = 2.6;     // per second while drilling
const FUEL_MOVE = 1.1;      // per second while moving
const FUEL_IDLE = 0.15;
const FUEL_STARVE_DPS = 6;  // an empty tank kills a full hull in ~17s

export function createPlayer() {
  return {
    tx: Math.floor(W / 2), ty: 3,
    px: Math.floor(W / 2) * TILE, py: 3 * TILE,
    facing: 'down',
    hull: MAX_HULL,
    fuel: MAX_FUEL,
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
    p.moving.t += dt / MOVE_TIME;
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
    p.drillProgress += DRILL_RATE * dt;
    p.fuel -= FUEL_DRILL * dt;
    p.frame += dt * 22;

    if (p.drillProgress % 0.35 < dt * DRILL_RATE) {
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

export function damage(p, amount, fx) {
  if (p.invuln > 0 || p.dead) return false;
  p.hull -= amount;
  p.invuln = 0.6;
  if (fx) fx.spawn('shieldhit', p.px + TILE / 2, p.py + TILE / 2);
  if (p.hull <= 0) { p.hull = 0; p.dead = true; }
  return true;
}
