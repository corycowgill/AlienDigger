// Aliens, hazards and pickups. Everything lives on the tile grid and only
// updates when it is near the camera, so depth costs nothing until you get there.

import { TILE, W, D, CORE_TOP, EMPTY } from './world.js';
import { damage } from './player.js';

// Drilling bought per point: 100 fuel = 84.6 hardness, 100 hull = 36.7.
const FUEL_TO_HULL = 2.31;

// `from`/`to` bound the depth band a kind spawns in. Without `to`, nothing was
// ever gated out, so at depth every kind stayed equally likely and a 6-damage
// grubworm was as common in magma as a lurker -- the deep pool was diluted by
// everything that came before it. HP is set so a kill costs more than one
// invulnerability window: at 9 dmg/s of ramming a lurker takes ~1.7s, which is
// three i-frames, so ramming it is a real decision against rerouting.
// Each kind now behaves the way its sprite suggests. They all drifted and
// chased identically before, which left the art carrying distinctions the rules
// did not have -- a rock crab and a swarmlet played the same.
//   burrows  passes through rock at or below this hardness, so it arrives
//            through the wall of a shaft instead of needing a tunnel
//   armor    fraction of ramming damage the shell shrugs off
//   erratic  darts and reverses constantly instead of patrolling
//   ambush   dormant until the drill is this close, then bolts
//   ranged   spits down a clear tunnel instead of closing
export const ALIEN_KINDS = [
  { row: 'grubworm', hp: 4,  dmg: 6,  speed: 1.6, from: 8,  to: 70,  burrows: 0.75 },
  { row: 'rockcrab', hp: 8,  dmg: 10, speed: 1.1, from: 40, to: 140, armor: 0.5 },
  { row: 'spitter',  hp: 9,  dmg: 12, speed: 1.3, from: 70, ranged: 5, spitDmg: 10 },
  { row: 'swarmlet', hp: 2,  dmg: 4,  speed: 3.0, from: 20, to: 95,  erratic: true },
  { row: 'lurker',   hp: 15, dmg: 16, speed: 2.1, from: 92, ambush: 5 },
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

// Index into the minerals sheet's "pickup" row, which has five frames. The last
// three sat unused while the row was drawn for them, so each now does the thing
// its art already promised: a tank that vents heat, a battery that shields, a
// bit that overdrives.
export const PICKUPS = [
  { row: 0, kind: 'repair', amount: 34, weight: 18 },
  { row: 1, kind: 'fuel', amount: 45, weight: 66 },
  { row: 2, kind: 'coolant', amount: 0, weight: 7, from: 55 },
  { row: 3, kind: 'shield', amount: 9, weight: 5, from: 40 },
  { row: 4, kind: 'boost', amount: 9, weight: 4, from: 40 },
];

// Weighted draw, restricted to what is useful at this depth -- a coolant cell
// in the topsoil would be a wasted find.
function rollPickup(rand, y) {
  const pool = PICKUPS.filter((k) => y >= (k.from || 0));
  const total = pool.reduce((a, k) => a + k.weight, 0);
  let r = rand() * total;
  for (const k of pool) { r -= k.weight; if (r <= 0) return k; }
  return pool[0];
}

// Shared so the game and the simulator cannot drift apart on what a pickup
// does, which is exactly how the hazard rules went wrong once already.
export function applyPickup(u, player) {
  switch (u.kind.kind) {
    case 'fuel':
      player.fuel = Math.min(player.stats.maxFuel, player.fuel + u.kind.amount);
      return 'fuel';
    case 'repair':
      player.hull = Math.min(player.stats.maxHull, player.hull + u.kind.amount);
      return 'repair';
    case 'coolant':
      player.heat = 0;
      return 'coolant';
    case 'shield':
      player.shield = Math.max(player.shield, u.kind.amount);
      return 'shield';
    case 'boost':
      player.boost = Math.max(player.boost, u.kind.amount);
      return 'boost';
    default:
      return null;
  }
}

// Rates for content buried inside solid rock, per tile. Everything used to
// spawn only in caves, but a descent is mostly drilling through rock: a straight
// dig met ~1 hazard and almost no fuel in 190 tiles, so the run was empty and
// the tank could not be refilled without long detours. Burying some content
// means drilling itself is where the run happens -- a fuel cache you break into,
// a gas pocket you breach. Tuned so a straight descent meets roughly six
// pickups, which is about what the 300-fuel column costs.
const BURIED_PICKUP = 0.042;
// Lowered when ore veins arrived: the rich ones carry their own guards, so the
// background rate came down to keep the total threat roughly where it was.
// Otherwise veins would have added danger everywhere rather than concentrating
// it where the treasure is, which is the whole point -- risk you choose, not
// risk imposed on a shaft that happened to pass nearby.
const BURIED_HAZARD = 0.0085;

export function populate(world, rand, density = 1) {
  const aliens = [];
  const hazards = [];
  const pickups = [];

  for (let y = 6; y < CORE_TOP; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (world.tiles[world.idx(x, y)] !== EMPTY) {
        // Buried: inert until the drill breaks the tile open, since the player
        // can only ever stand in a tile that has been dug out.
        if (rand() < BURIED_PICKUP) {
          pickups.push({ kind: rollPickup(rand, y), x, y, taken: false });
        } else if (rand() < BURIED_HAZARD * density) {
          const pool = HAZARD_KINDS.filter((k) => y >= k.from);
          if (pool.length) {
            const kind = pool[Math.floor(rand() * pool.length)];
            hazards.push({ kind, x, y, t: rand() * 3, cooldown: 0, buried: true });
          }
        }
        continue;
      }

      if (rand() < 0.03 * density) {
        const pool = ALIEN_KINDS.filter((k) => y >= k.from && y < (k.to ?? Infinity));
        if (pool.length) {
          const kind = pool[Math.floor(rand() * pool.length)];
          aliens.push({
            kind, x, y, hp: kind.hp, t: rand() * 4,
            dx: rand() < 0.5 ? -1 : 1, px: x * TILE, py: y * TILE,
          });
        }
      } else if (rand() < 0.035 * density) {
        const pool = HAZARD_KINDS.filter((k) => y >= k.from);
        if (pool.length) {
          const kind = pool[Math.floor(rand() * pool.length)];
          hazards.push({ kind, x, y, t: rand() * 3, cooldown: 0 });
        }
      } else if (rand() < 0.10) {
        // fuel is the real clock, so cells have to be common enough that a
        // careful descent can always reach the core
        pickups.push({ kind: rollPickup(rand, y), x, y, taken: false });
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
    kind: { row: 'guardian', hp: 26, dmg: 9, slam: 12, speed: 1.2, boss: true },
    x: gx, y: gy, hp: 26, t: 0, dx: 1,
    px: gx * TILE, py: gy * TILE, boss: true,
    maxHp: 26, phase: 'armored', phaseT: GUARD_PHASE.armored,
  });

  // The richest veins are guarded, which is what turns "there is treasure over
  // there" into a decision instead of a free detour. Tier 3 and 4 only.
  for (const vein of world.veins || []) {
    if (vein.tier < 3) continue;
    const guards = vein.tier === 4 ? 3 : 2;
    for (let g = 0; g < guards; g++) {
      const x = Math.max(1, Math.min(W - 2, vein.x + Math.floor(rand() * 5) - 2));
      const y = Math.max(6, Math.min(CORE_TOP - 1, vein.y + Math.floor(rand() * 5) - 2));
      const pool = HAZARD_KINDS.filter((k) => y >= k.from);
      if (!pool.length) continue;
      const kind = pool[Math.floor(rand() * pool.length)];
      hazards.push({ kind, x, y, t: rand() * 3, cooldown: 0, buried: world.solid(x, y) });
    }
  }

  // The chamber gets a hand-placed guard detail rather than the scatter rates
  // used above. Running the cave rates over a room that is 100% open packed ~13
  // aliens and ~15 hazards into the one arena the player cannot walk away from,
  // and 63% of all damage in a run landed here. A designed layout keeps the
  // climax a fight instead of a blender: one sentry short of each socket, and a
  // hazard between them so the approach has to be picked.
  // Melee, deliberately. Three Spitters here turned the Guardian fight into a
  // shooting gallery with nothing to break line of sight behind -- measured,
  // that alone took the win rate from 72% to 7%.
  const guard = ALIEN_KINDS.find((k) => k.row === 'rockcrab');
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

// The Guardian used to be one verb: drive in and hold until it died. It now
// runs a cycle, so the fight has a rhythm to read -- its plating shrugs off
// ramming, it opens up for a window worth committing to, and it telegraphs a
// slam that punishes anyone still standing on it.
export const GUARD_PHASE = { armored: 1.8, exposed: 2.8, windup: 0.75, slam: 0.25 };
const GUARD_ORDER = ['armored', 'exposed', 'windup', 'slam'];

function updateGuardian(a, player, dt, onSlam) {
  a.phaseT -= dt;
  if (a.phaseT <= 0) {
    const next = GUARD_ORDER[(GUARD_ORDER.indexOf(a.phase) + 1) % GUARD_ORDER.length];
    a.phase = next;
    a.phaseT = GUARD_PHASE[next];
    if (next === 'slam') {
      const reach = Math.abs(a.x - player.tx) <= 2 && Math.abs(a.y - player.ty) <= 2;
      onSlam?.(a, reach);
    }
  }
}

// How much of a ram lands, given what the boss is currently doing.
export function ramScale(a) {
  if (!a.boss) return 1;
  return a.phase === 'exposed' ? 1.5 : a.phase === 'armored' ? 0.45 : 0.6;
}

export function updateAliens(aliens, world, player, dt, onHit, onSpit, onSlam) {
  for (const a of aliens) if (a.hurt) a.hurt = Math.max(0, a.hurt - dt);
  for (const a of aliens) {
    a.t += dt;
    const near = Math.abs(a.y - player.ty) < 24;
    if (!near) continue;
    if (a.boss && a.hp > 0) updateGuardian(a, player, dt, onSlam);

    // The Spitter is the one alien that does not have to reach you. It needs a
    // clear line down a tunnel, which makes it a reason to pick a different
    // route rather than another thing to ram -- every kind behaved identically
    // before this, so the art was carrying differences the rules did not have.
    if (a.kind.ranged) {
      a.spitCd = (a.spitCd || 0) - dt;
      const dx = player.tx - a.x, dy = player.ty - a.y;
      const straight = (dx === 0) !== (dy === 0);
      const dist = Math.abs(dx) + Math.abs(dy);
      // A shot needs a straight, unobstructed run of tunnel. It holds position
      // only when it actually has one -- holding whenever the player was merely
      // close meant it stopped closing AND could not fire, which quietly turned
      // the game's one ranged enemy into the most harmless thing in it.
      const shot = straight && dist <= a.kind.ranged && clearLine(world, a, player);
      if (shot && a.spitCd <= 0) {
        a.spitCd = 2.5;
        a.spitting = 0.45;
        onSpit?.(a);
      }
      a.spitting = Math.max(0, (a.spitting || 0) - dt);
      if (shot) continue;
    }

    const dist = Math.abs(a.x - player.tx) + Math.abs(a.y - player.ty);

    // A lurker is an ambush predator: it does not patrol, it waits. Nothing
    // gives it away until the drill is close enough, and then it is fast.
    if (a.kind.ambush) {
      a.woke = a.woke || dist <= a.kind.ambush;
      if (!a.woke) continue;
    }

    // drift along open tunnels, turning at walls; chase when the drill is close
    const chasing = dist < (a.kind.ambush ? 9 : 4);
    const rush = a.kind.ambush ? 2.0 : a.kind.erratic ? 1.7 : 1.4;
    const step = a.kind.speed * dt * (chasing ? rush : 1) * 18;

    // swarmlets dart rather than patrol, so they never settle into a line
    if (a.kind.erratic && Math.random() < dt * 2.2) a.dx = -a.dx;

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

    // A grubworm is a burrower: soft strata are not walls to it, so it arrives
    // through the side of a shaft rather than having to find its way round.
    const canPass = !world.solid(tx, ty)
      || (a.kind.burrows && world.hardness(tx, ty) <= a.kind.burrows);

    if (!canPass) {
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
    // a rock crab's shell is the point of it
    const through = (1 - (a.kind.armor || 0)) * ramScale(a);
    const bite = (player.moving || player.drilling ? 14 : 0) * through * dt;
    a.hp -= bite;
    // Flagged so the renderer can flash it and show the bar reacting: without
    // this you drive into the boss, take damage and cannot tell whether you
    // are achieving anything at all.
    if (bite > 0) a.hurt = 0.12;
    if (a.hp <= 0) onKill(a);
  }
}

// Nothing solid between the two, along a straight run of tiles.
function clearLine(world, a, player) {
  const sx = Math.sign(player.tx - a.x), sy = Math.sign(player.ty - a.y);
  let x = a.x + sx, y = a.y + sy;
  while (x !== player.tx || y !== player.ty) {
    if (world.solid(x, y)) return false;
    x += sx; y += sy;
  }
  return true;
}

export function updateHazards(hazards, player, dt, onHit) {
  for (const h of hazards) {
    if (h.spent) continue;
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

  // A hazard sealed in rock is an event you breach, not a standing feature: it
  // vents, falls or discharges once and is done. Leaving them live meant the
  // climb out re-triggered every hazard the descent had already dug through,
  // along the one shaft that exists, with no route around it -- measured, that
  // was 20 of 23 losses for well-played runs, all of them with fuel still in
  // the tank. Hazards sitting in open caves are environmental and persist.
  const spend = (hz) => { if (hz.buried) hz.spent = true; };

  if (row === 'acidpool') {
    // Eats the tank rather than the hull. Fuel is the scarcer currency -- it
    // buys 84.6 hardness of drilling per 100 against the hull's 36.7 -- so a
    // point of fuel is worth ~2.3 hull and the drain has to be divided by that
    // or the number lies about its rank. A flat 26 here cost ~60 hull-equivalent,
    // which quietly made the mid-table entry the worst hazard in the game.
    player.fuel = Math.max(0, player.fuel - h.kind.dmg / FUEL_TO_HULL);
    fx.spawn('acidsplash', player.px + 16, player.py + 16);
    spend(h);
    return 'fuel';
  }

  // a crusher catches you mid-grind, when you cannot move out of the way
  const amount = row === 'crusher' && player.drilling ? h.kind.dmg * 2 : h.kind.dmg;
  if (!damage(player, amount, fx)) return null;
  fx.spawn(row === 'electricvein' ? 'sparks' : 'flash', player.px + 16, player.py + 16);

  // Displacement has to be a setback in both phases. A boulder that always
  // threw the player up the shaft was a mild cost while descending and a
  // straight gift while escaping, where being flung toward the exit is free
  // progress against the clock -- so it knocks you back the way you came
  // instead. Void pits still drop downward, but only ever into an already-open
  // tile, so on the way down they cannot save the fuel of a tile you would
  // otherwise have had to drill.
  const back = player.facing === 'up' ? 1 : -1;
  const shove = row === 'boulder' ? back : row === 'voidpit' ? 1 : 0;
  if (shove && !player.moving && !world.solid(player.tx, player.ty + shove)) {
    player.ty += shove;
    player.py = player.ty * TILE;
    fx.spawn('dustpuff', player.px + 16, player.py + 16);
  }

  // gas keeps burning for a beat instead of hitting once
  if (row === 'gaspocket') h.cooldown = 0.45;
  else spend(h);
  return amount;
}
