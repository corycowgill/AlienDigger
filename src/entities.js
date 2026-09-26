// Aliens, hazards and pickups. Everything lives on the tile grid and only
// updates when it is near the camera, so depth costs nothing until you get there.

import { TILE, W, D, CORE_TOP, EMPTY } from './world.js';
import { damage } from './player.js';

// `from`/`to` bound the depth band a kind spawns in. Without `to`, nothing was
// ever gated out, so at depth every kind stayed equally likely and a 6-damage
// grubworm was as common in magma as a lurker -- the deep pool was diluted by
// everything that came before it. HP is set so a kill costs more than one
// invulnerability window: at 9 dmg/s of ramming a lurker takes ~1.7s, which is
// three i-frames, so ramming it is a real decision against rerouting.
export const ALIEN_KINDS = [
  { row: 'grubworm', hp: 4,  dmg: 6,  speed: 1.6, from: 8,  to: 70 },
  { row: 'rockcrab', hp: 8, dmg: 10, speed: 1.1, from: 40, to: 140 },
  { row: 'spitter',  hp: 9,  dmg: 12, speed: 1.3, from: 70 },
  { row: 'swarmlet', hp: 2,  dmg: 4,  speed: 3.0, from: 20, to: 95 },
  { row: 'lurker',   hp: 15, dmg: 16, speed: 2.1, from: 92 },
];

export const HAZARD_KINDS = [
  { row: 'lavavent',     dmg: 18, from: 60 },
  { row: 'gaspocket',    dmg: 10, from: 20 },
  { row: 'acidpool',     dmg: 12, from: 40 },
  { row: 'crusher',      dmg: 22, from: 90 },
  { row: 'boulder',      dmg: 14, from: 30 },
  { row: 'electricvein', dmg: 16, from: 100 },
  { row: 'spiketrap',    dmg: 13, from: 50 },
  { row: 'voidpit',      dmg: 25, from: 118 },
];

// Index into the minerals sheet's "pickup" row.
export const PICKUPS = [
  { row: 0, kind: 'repair', amount: 34 },
  { row: 1, kind: 'fuel', amount: 45 },
];

// Rates for content buried inside solid rock, per tile. Everything used to
// spawn only in caves, but a descent is mostly drilling through rock: a straight
// dig met ~1 hazard and almost no fuel in 190 tiles, so the run was empty and
// the tank could not be refilled without long detours. Burying some content
// means drilling itself is where the run happens -- a fuel cache you break into,
// a gas pocket you breach. Tuned so a straight descent meets roughly six
// pickups, which is about what the 300-fuel column costs.
const BURIED_PICKUP = 0.042;
const BURIED_HAZARD = 0.012;

export function populate(world, rand) {
  const aliens = [];
  const hazards = [];
  const pickups = [];

  for (let y = 6; y < CORE_TOP; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (world.tiles[world.idx(x, y)] !== EMPTY) {
        // Buried: inert until the drill breaks the tile open, since the player
        // can only ever stand in a tile that has been dug out.
        if (rand() < BURIED_PICKUP) {
          pickups.push({ kind: rand() < 0.68 ? PICKUPS[1] : PICKUPS[0], x, y, taken: false });
        } else if (rand() < BURIED_HAZARD) {
          const pool = HAZARD_KINDS.filter((k) => y >= k.from);
          if (pool.length) {
            const kind = pool[Math.floor(rand() * pool.length)];
            hazards.push({ kind, x, y, t: rand() * 3, cooldown: 0 });
          }
        }
        continue;
      }

      if (rand() < 0.03) {
        const pool = ALIEN_KINDS.filter((k) => y >= k.from && y < (k.to ?? Infinity));
        if (pool.length) {
          const kind = pool[Math.floor(rand() * pool.length)];
          aliens.push({
            kind, x, y, hp: kind.hp, t: rand() * 4,
            dx: rand() < 0.5 ? -1 : 1, px: x * TILE, py: y * TILE,
          });
        }
      } else if (rand() < 0.035) {
        const pool = HAZARD_KINDS.filter((k) => y >= k.from);
        if (pool.length) {
          const kind = pool[Math.floor(rand() * pool.length)];
          hazards.push({ kind, x, y, t: rand() * 3, cooldown: 0 });
        }
      } else if (rand() < 0.10) {
        // fuel is the real clock, so cells have to be common enough that a
        // careful descent can always reach the core
        const kind = rand() < 0.68 ? PICKUPS[1] : PICKUPS[0];
        pickups.push({ kind, x, y, taken: false });
      }
    }
  }

  // The Core Guardian patrols the chamber a few tiles above the sockets. It sat
  // directly on the middle socket before, which made that charge unplantable.
  const gx = Math.floor(W / 2);
  const gy = CORE_TOP + 4;
  // It has to be killed before the charges will arm (see main.js), because a
  // boss this slow in a room this open is otherwise just scenery you walk past.
  // 24 hp at 9 dmg/s of ramming is ~2.7s, about five i-frames, so it costs
  // roughly 45 hull -- losable if you arrive hurt, which is what the repair
  // kits are for.
  aliens.push({
    kind: { row: 'guardian', hp: 24, dmg: 9, speed: 1.2, boss: true },
    x: gx, y: gy, hp: 24, t: 0, dx: 1,
    px: gx * TILE, py: gy * TILE, boss: true,
  });

  // The chamber gets a hand-placed guard detail rather than the scatter rates
  // used above. Running the cave rates over a room that is 100% open packed ~13
  // aliens and ~15 hazards into the one arena the player cannot walk away from,
  // and 63% of all damage in a run landed here. A designed layout keeps the
  // climax a fight instead of a blender: one sentry short of each socket, and a
  // hazard between them so the approach has to be picked.
  const guard = ALIEN_KINDS.find((k) => k.row === 'spitter');
  const deep = HAZARD_KINDS.find((k) => k.row === 'lavavent');
  world.chargeSockets.forEach((sock, i) => {
    aliens.push({
      kind: guard, x: sock.x, y: sock.y - 4, hp: guard.hp, t: i,
      dx: i % 2 ? 1 : -1, px: sock.x * TILE, py: (sock.y - 4) * TILE,
    });
    if (i < 2) {
      hazards.push({ kind: deep, x: sock.x + 3, y: sock.y, t: i, cooldown: 0 });
    }
  });

  // A guaranteed cache in the core chamber. Without it the descent drains the
  // tank, the charges arm, and the climb out starts on empty with every pickup
  // on the way up already taken -- so reaching the core was a death sentence
  // rather than the turning point it should be. Planting is the point of no
  // return, so this is where the run gets topped up for the run home.
  for (const s of world.chargeSockets) {
    pickups.push({ kind: PICKUPS[1], x: s.x, y: s.y - 2, taken: false });
  }

  return { aliens, hazards, pickups };
}

export function updateAliens(aliens, world, player, dt, onHit) {
  for (const a of aliens) {
    a.t += dt;
    const near = Math.abs(a.y - player.ty) < 24;
    if (!near) continue;

    // drift along open tunnels, turning at walls; chase when the drill is close
    const chasing = Math.abs(a.x - player.tx) + Math.abs(a.y - player.ty) < 4;
    const step = a.kind.speed * dt * (chasing ? 1.4 : 1) * 18;

    let tx = a.x, ty = a.y;
    if (chasing) {
      if (Math.abs(player.tx - a.x) > Math.abs(player.ty - a.y)) {
        tx += Math.sign(player.tx - a.x);
      } else {
        ty += Math.sign(player.ty - a.y);
      }
    } else {
      tx += a.dx;
    }

    if (world.solid(tx, ty) && chasing) {
      // try the other axis before giving up, so an L-bend is navigable
      const ax = a.x + Math.sign(player.tx - a.x);
      const ay = a.y + Math.sign(player.ty - a.y);
      if (tx !== a.x && !world.solid(a.x, ay)) { tx = a.x; ty = ay; }
      else if (ty !== a.y && !world.solid(ax, a.y)) { tx = ax; ty = a.y; }
    }

    if (world.solid(tx, ty)) {
      a.dx = -a.dx;
    } else {
      const goalX = tx * TILE, goalY = ty * TILE;
      a.px += Math.sign(goalX - a.px) * Math.min(step, Math.abs(goalX - a.px));
      a.py += Math.sign(goalY - a.py) * Math.min(step, Math.abs(goalY - a.py));
      if (Math.abs(a.px - goalX) < 1 && Math.abs(a.py - goalY) < 1) {
        a.x = tx; a.y = ty; a.px = goalX; a.py = goalY;
      }
    }

    if (a.x === player.tx && a.y === player.ty) onHit(a);
  }
}

// The drill has no gun; ramming is the whole offence. Contact hurts both sides,
// so small aliens clear out of the way and the boss stays something to dodge.
export function ramAliens(aliens, player, dt, onKill) {
  for (const a of aliens) {
    if (a.hp <= 0) continue;
    if (a.x !== player.tx || a.y !== player.ty) continue;
    a.hp -= (player.moving || player.drilling ? 14 : 0) * dt;
    if (a.hp <= 0) onKill(a);
  }
}

export function updateHazards(hazards, player, dt, onHit) {
  for (const h of hazards) {
    h.t += dt;
    h.cooldown -= dt;
    if (Math.abs(h.y - player.ty) > 20) continue;
    if (h.x === player.tx && h.y === player.ty && h.cooldown <= 0) {
      h.cooldown = 1.1;
      onHit(h);
    }
  }
}

export function updatePickups(pickups, player, onTake) {
  for (const p of pickups) {
    if (p.taken) continue;
    if (p.x === player.tx && p.y === player.ty) {
      p.taken = true;
      onTake(p);
    }
  }
}

// Eight hazard sprites used to share one behaviour -- position match, fixed
// damage, 1.1s cooldown -- so a boulder never fell and a crusher never crushed;
// they were a spike trap with a different integer. That matters more now they
// are buried and cannot always be walked around, because behaviour is the only
// thing that makes them read as different threats.
export function applyHazard(h, player, world, fx) {
  const row = h.kind.row;

  if (row === 'acidpool') {
    // eats the tank rather than the hull, which hurts most when you are deep
    player.fuel = Math.max(0, player.fuel - 26);
    fx.spawn('acidsplash', player.px + 16, player.py + 16);
    return 'fuel';
  }

  // a crusher catches you mid-grind, when you cannot move out of the way
  const amount = row === 'crusher' && player.drilling ? h.kind.dmg * 2 : h.kind.dmg;
  if (!damage(player, amount, fx)) return null;
  fx.spawn(row === 'electricvein' ? 'sparks' : 'flash', player.px + 16, player.py + 16);

  // boulders throw you back up the shaft; void pits drop you further down it
  const shove = row === 'boulder' ? -1 : row === 'voidpit' ? 1 : 0;
  if (shove && !player.moving && !world.solid(player.tx, player.ty + shove)) {
    player.ty += shove;
    player.py = player.ty * TILE;
    fx.spawn('dustpuff', player.px + 16, player.py + 16);
  }

  // gas keeps burning for a beat instead of hitting once
  if (row === 'gaspocket') h.cooldown = 0.45;
  return amount;
}
