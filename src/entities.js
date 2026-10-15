// Aliens, hazards and pickups. Everything lives on the tile grid and only
// updates when it is near the camera, so depth costs nothing until you get there.

import { TILE, W, D, CORE_TOP, EMPTY } from './world.js';
import { damage, cargoRoom } from './player.js';

// Drilling bought per point: 100 fuel = 84.6 hardness, 100 hull = 36.7.
const FUEL_TO_HULL = 2.31;

// The drill's eight headings, for working out which side a ram landed on.
const RAM_DELTA = {
  left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  upleft: [-1, -1], upright: [1, -1],
  downleft: [-1, 1], downright: [1, 1],
};

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

  // A second wave of kinds, each added for an answer the first five did not
  // have. Spawn rates are unchanged -- these widen the pool rather than deepen
  // it, so a run meets more different things, not more things.
  //   steals   takes ore out of the bay instead of hull off the drill
  //   rooted   never moves; it is a position to route around, not a chase
  //   splits   bursts into this many swarmlets when killed
  //   phases   ignores rock entirely, so it cannot be walled out
  // Tuned up after measuring. The first pass at these numbers made the game
  // *easier*: they share the spawn budget with the original five, so a soft new
  // kind does not add danger, it displaces danger. Greedy play went from 27/40
  // to 31/40 purely on dilution. Variety has to pay its own way.
  { row: 'oreleech',  hp: 7,  dmg: 0,  speed: 2.7, from: 30, to: 165, steals: 4 },
  { row: 'sentinel',  hp: 16, dmg: 11, speed: 0,   from: 60, ranged: 7,
    spitDmg: 15, armor: 0.4, rooted: true },
  { row: 'broodsac',  hp: 7,  dmg: 8,  speed: 1.1, from: 25, to: 120, splits: 3 },
  { row: 'magmaling', hp: 5,  dmg: 13, speed: 2.6, from: 150, erratic: true },
  // Hardness 99 is "any rock at all", which reuses the burrower path rather
  // than inventing a second way to move through walls. It cannot be shut out,
  // so it does not need to be fast to be a problem.
  { row: 'glowfly',   hp: 4,  dmg: 10, speed: 1.2, from: 45, to: 175, burrows: 99 },
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
  // A geyser is only dangerous while it is firing, which its three frames
  // already show -- it is the one hazard you can stand on and then walk off.
  { row: 'geyser',       dmg: 20, from: 45, duty: 3.0 },
  { row: 'sinkhole',     dmg: 9,  from: 55 },
  { row: 'magnetnode',   dmg: 14, from: 70, pull: true },
];

// What a thing is made of, which is what decides how it comes apart. Keyed by
// material rather than by species: ten kinds times a bespoke death would be a
// sheet nobody wants to draw, and at forty pixels a crab and a sentinel
// shattering look like the same event anyway -- because they are.
export const DEATH_OF = {
  grubworm: 'deathgoo',   rockcrab: 'deathchitin', spitter: 'deathgoo',
  swarmlet: 'deathspore', lurker: 'deathgoo',      oreleech: 'deathgoo',
  sentinel: 'deathmachine', broodsac: 'deathgoo',  magmaling: 'deathember',
  glowfly: 'deathspore',
};

// The flinch, for the same reason: a shell skids a hit off, flesh recoils.
export function staggerOf(a) {
  return a.kind.armor ? 'staggerarmour' : 'staggersoft';
}

// The mark left behind, so a cleared tunnel shows it was fought through.
export const SCORCH_FOR = {
  deathgoo: 0, deathchitin: 1, deathember: 2, deathmachine: 3, deathspore: 4,
};

// A geyser spends two thirds of its cycle inert. Everything else is always on.
export function hazardArmed(h) {
  if (!h.kind.duty) return true;
  return (h.t % h.kind.duty) > h.kind.duty * 0.62;
}

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

      // Raised from 0.030 when the second wave of kinds landed. Five new kinds
      // share the same spawn budget, and the softer ones displace the lurkers
      // and crabs rather than adding to them -- measured, variety alone took
      // competent play from 27/40 to 31/40. More kinds has to mean more of
      // them, or the game gets easier the more there is in it. 0.032 puts it
      // back on 41/60, which is the two-in-three the rest of the balance
      // assumes; 0.036 overshot to 35/60.
      if (rand() < 0.032 * density) {
        const pool = ALIEN_KINDS.filter((k) => y >= k.from && y < (k.to ?? Infinity));
        if (pool.length) {
          const kind = pool[Math.floor(rand() * pool.length)];
          const t = rand() * 4;
          // One roll, used twice. It has to face the way it will first walk --
          // and drawing a second number here would shift the whole PRNG stream
          // and silently regenerate every world behind every tuned figure.
          const dx = rand() < 0.5 ? -1 : 1;
          aliens.push({
            kind, x, y, hp: kind.hp, maxHp: kind.hp, t,
            dx, px: x * TILE, py: y * TILE,
            // Without this a crab that has not moved yet has no armoured side
            // at all, so the toughest alien in the mid game would spawn with
            // its shell switched off.
            face: [dx, 0],
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
      kind: guard, x: sock.x, y: sock.y - 4, hp: guard.hp, maxHp: guard.hp, t: i,
      dx: i % 2 ? 1 : -1, face: [i % 2 ? 1 : -1, 0],
      px: sock.x * TILE, py: (sock.y - 4) * TILE,
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

  // The surface was empty sky and the run just started in it. These are the
  // five frames of the surfaceprop row, which had never been drawn: the drop
  // capsule you came down in sits on the spawn column, so the descent starts
  // somewhere and the climb out has something to climb back to.
  const props = [{ row: 0, x: Math.floor(W / 2), y: 2, big: true }];
  for (let k = 1; k < 5; k++) {
    props.push({
      row: k,
      x: 3 + Math.floor(rand() * (W - 6)),
      y: 2,
    });
  }

  return { aliens, hazards, pickups, props };
}

// How long a spitter stays open after firing, and how much harder it is to hurt
// while it does. 1.1s is a little longer than it takes to cross the tile it was
// shooting down, so closing the moment it fires is a real plan rather than a
// reflex test.
export const VENT_TIME = 1.1;
export const VENT_BONUS = 1.6;

// A lurker coils before it bolts. It hits harder than anything but the boss and
// used to give no warning at all, which made it a tax on walking past rather
// than something to react to. Short enough to still be a scare.
export const COIL_TIME = 0.45;

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

// How much of a hit lands, given what the target is doing and which side it
// came in on. One function for both the ram and the laser, because the moment
// they disagree the player is learning two different games -- and it already
// folds in the armour fraction that both call sites used to apply themselves.
//
// (ax, ay) points from the alien toward whatever hit it. For a ram that is the
// reverse of the drill's heading, since the drill struck with its nose; for a
// beam it is the reverse of the beam's travel.
//
// Every kind now has an answer, and they are different answers. Before this the
// five alien behaviours all resolved to the same two verbs -- drive into it, or
// shoot it -- so the AI carried distinctions the player's decisions did not.
export function hitScale(a, ax = 0, ay = 0) {
  let k = 1;

  if (a.boss) {
    // The Guardian's plating is a phase rather than a direction: there is no
    // behind it worth finding in a room that open.
    k *= a.phase === 'exposed' ? 1.5 : a.phase === 'armored' ? 0.45 : 0.6;
  } else if (a.kind.armor) {
    // A shell only covers the way it is pointing. Meeting a rock crab head-on
    // in a corridor is the expensive way to kill it; its flank and its back are
    // bare. Frontal is the forward hemisphere, not just dead-on, so a step to
    // one side is not enough -- you have to actually get beside or behind it.
    const f = a.face;
    const frontal = f && (f[0] * ax + f[1] * ay) > 0;
    if (frontal) k *= 1 - a.kind.armor;
  }

  // A spitter that has just fired is venting and cannot cover itself. This is
  // the window its whole behaviour is built around: it holds its ground while
  // it has a clear line, so the way to reach it is to eat the shot and close
  // while it recharges, rather than to route around it forever.
  if (a.vent > 0) k *= VENT_BONUS;

  return k;
}

// Kept so a ram and a beam agree on the boss when no direction is to hand.
export function ramScale(a) { return hitScale(a); }

export function updateAliens(aliens, world, player, dt, onHit, onSpit, onSlam) {
  for (const a of aliens) if (a.hurt) a.hurt = Math.max(0, a.hurt - dt);
  for (const a of aliens) {
    a.t += dt;
    // Ticked before the range gate, or a spitter that fired just as you left
    // its band would stay vented until you came back.
    if (a.vent > 0) a.vent = Math.max(0, a.vent - dt);
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
        // Firing opens it up. The shot is the price of the window, which is
        // what turns the one enemy you cannot out-range into a timing problem
        // rather than a wall.
        a.vent = VENT_TIME;
        onSpit?.(a);
      }
      a.spitting = Math.max(0, (a.spitting || 0) - dt);
      if (shot) continue;
    }

    // A sentinel is rooted into the rock. It never takes a step, so it is a
    // place on the map to route around rather than something that comes to
    // you -- and the only alien the player can simply decide not to fight.
    if (a.kind.rooted) {
      if (a.x === player.tx && a.y === player.ty) onHit(a);
      continue;
    }

    const dist = Math.abs(a.x - player.tx) + Math.abs(a.y - player.ty);

    // A lurker is an ambush predator: it does not patrol, it waits. Nothing
    // gives it away until the drill is close enough -- and then it coils, which
    // is the only warning you get, and then it is fast.
    if (a.kind.ambush) {
      if (!a.woke && dist <= a.kind.ambush) {
        a.woke = true;
        a.coil = COIL_TIME;
      }
      if (!a.woke) continue;
      // Coiled: coming, but not yet moving. Half a second to clear the lane.
      if (a.coil > 0) {
        a.coil = Math.max(0, a.coil - dt);
        if (a.x === player.tx && a.y === player.ty) onHit(a);
        continue;
      }
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
      // Which way it is pointing. The renderer mirrors the sprite on this, and
      // a shell is only armour on the side it faces, so this has to be the
      // committed direction rather than the momentary pixel delta.
      if (tx !== a.x || ty !== a.y) a.face = [Math.sign(tx - a.x), Math.sign(ty - a.y)];
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

// Ramming is the main offence (the laser in laser.js is a rationed sidearm). Contact hurts both sides,
// so small aliens clear out of the way and the boss stays something to dodge.
export function ramAliens(aliens, player, dt, onKill, onBite) {
  for (const a of aliens) {
    if (a.hp <= 0) continue;
    if (a.x !== player.tx || a.y !== player.ty) continue;
    // The drill struck with its nose, so it came from behind its own heading --
    // which is the side of the alien the hit landed on. Drive into a crab's
    // face and the shell eats half of it; catch it side-on and it does not.
    const [hx, hy] = RAM_DELTA[player.facing] || RAM_DELTA.down;
    const through = hitScale(a, -hx, -hy);
    const bite = (player.moving || player.drilling ? 14 : 0) * through * dt;
    a.hp -= bite;
    // Flagged so the renderer can flash it and show the bar reacting: without
    // this you drive into the boss, take damage and cannot tell whether you
    // are achieving anything at all.
    if (bite > 0) { a.hurt = 0.12; onBite?.(a, through); }
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

// An ore leech does not hurt the drill, it robs it -- which is a worse outcome
// deep in a run than the hull it would otherwise have taken, and the only
// enemy in the game whose damage is measured in credits. What it takes is
// carried on its body, so killing it drops the haul back on the floor.
export function leechSteal(a, player, world) {
  const want = a.kind.steals || 0;
  if (want <= 0) return 0;
  // Always the best ore aboard. A thief that took copper would be a nuisance;
  // one that takes the pulse crystal is a reason to turn and fight.
  let tier = -1;
  for (let i = player.minerals.length - 1; i >= 0; i--) {
    if (player.minerals[i] > 0) { tier = i; break; }
  }
  if (tier < 0) return 0;
  const took = Math.min(want, player.minerals[tier]);
  player.minerals[tier] -= took;
  a.loot = a.loot || [0, 0, 0, 0, 0];
  a.loot[tier] += took;
  return took;
}

// Everything a leech was carrying falls where it died, as ordinary loose ore.
export function dropLoot(a, world) {
  if (!a.loot) return 0;
  let dropped = 0;
  for (let tier = 0; tier < a.loot.length; tier++) {
    if (a.loot[tier] > 0) dropped += world.drop(a.x, a.y, tier, a.loot[tier]);
  }
  a.loot = null;
  return dropped;
}

// A broodsac is a delayed swarm: cheap to kill, expensive to kill badly.
export function splitBrood(a, world) {
  const n = a.kind.splits || 0;
  if (n <= 0) return [];
  const kind = ALIEN_KINDS.find((k) => k.row === 'swarmlet');
  const young = [];
  for (let i = 0; i < n; i++) {
    const x = Math.max(1, Math.min(W - 2, a.x + (i - 1)));
    if (world.solid(x, a.y)) continue;
    young.push({
      kind, x, y: a.y, hp: kind.hp, maxHp: kind.hp, t: i * 0.3,
      dx: i % 2 ? 1 : -1, face: [i % 2 ? 1 : -1, 0],
      px: x * TILE, py: a.y * TILE,
    });
  }
  return young;
}

export function updateHazards(hazards, player, dt, onHit, onPull) {
  for (const h of hazards) {
    if (h.spent) continue;
    h.t += dt;
    h.cooldown -= dt;
    if (Math.abs(h.y - player.ty) > 20) continue;

    // A magnet node reaches one tile. It is the only hazard that comes to you,
    // which makes a corridor past it a thing to time rather than to walk.
    if (h.kind.pull && inPullRange(h, player) && h.cooldown <= 0) {
      h.cooldown = 1.4;
      onPull?.(h);
      continue;
    }

    if (h.x === player.tx && h.y === player.ty && h.cooldown <= 0) {
      if (!hazardArmed(h)) continue;
      h.cooldown = 1.1;
      onHit(h);
    }
  }
}

// A magnet node reaches exactly one tile. On its own tile it is an ordinary
// hazard; one step away it drags you in.
function inPullRange(h, player) {
  return Math.abs(h.x - player.tx) + Math.abs(h.y - player.ty) === 1;
}

// The planet coming apart, shared by the game and the simulator so the two
// cannot disagree about how hard the climb out is -- the hazard rules drifted
// exactly this way once already.
//
// `panic` runs 0 to 1 across the escape window. Tremors used to fire on a flat
// 4.5-7s timer dropping three tiles whatever the clock said, so the last ten
// seconds of a run felt identical to the first ten. Now they close in: more
// often, and more rubble each time, so the shaft is visibly failing around you
// by the end.
export const TREMOR = {
  gap: (panic) => 4.5 - panic * 2.6,       // seconds between tremors
  jitter: (panic) => 2.5 - panic * 1.5,    // random spread on that
  rocks: (panic) => 3 + Math.round(panic * 4),
};

export function runTremor(world, player, panic, rand = Math.random, onRock) {
  const want = TREMOR.rocks(panic);
  let dropped = 0;
  for (let tries = 0; tries < 40 && dropped < want; tries++) {
    // Rubble lands in the shaft above the drill -- the way out, not the way
    // back down, or the collapse would be pushing the player toward the core.
    const y = player.ty - 3 - Math.floor(rand() * (10 + panic * 8));
    const x = player.tx + Math.floor(rand() * 3) - 1;
    if (y < 4) continue;
    if (world.collapse(x, y)) {
      dropped++;
      onRock?.(x, y);
    }
  }
  return dropped;
}

// ------------------------------------------------------------------- lava
// Once the charges are armed the core floods and the lava climbs the shaft
// behind you. The escape already had a deadline; what it did not have was a
// deadline you could see. A number in the HUD tells you how long is left, but
// it cannot tell you that the thirty seconds you have left are not enough for
// the rubble plug directly above you -- the lava can, because it is right there
// and it is closer than it was.
//
// It is pinned to the same clock as the timer rather than given a speed of its
// own: it reaches the surface exactly as the countdown hits zero. So it never
// makes a run unwinnable that the clock would have allowed, and the two can
// never disagree about how much time is left. What it adds is that the danger
// is now *positional* -- dawdle low and it reaches you long before the clock
// runs out, which a timer alone could never express.
export const LAVA = {
  dps: 52,            // hull per second while standing in it: about two seconds
  // Tiles below the drill at which the game starts shouting. Measured: a
  // competent climb keeps the surface about 10 tiles below it the whole way, so
  // a 6-tile warning would only ever have fired for a run already lost.
  warn: 13,
  headStart: 0.12,    // fraction of the window before it starts climbing
};

// Tile row the lava surface has reached. Above the world (small y) is bad.
export function lavaLevel(escapeLeft, escape) {
  if (escapeLeft == null || escape <= 0) return D + 2;
  const gone = Math.max(0, Math.min(1, 1 - escapeLeft / escape));
  // A short head start, then linear to the surface. Without it the lava is
  // already lapping at the core chamber as the third charge goes in, which
  // reads as a punishment for planting rather than a consequence of it.
  const climb = Math.max(0, (gone - LAVA.headStart) / (1 - LAVA.headStart));
  return D + 2 - (D + 2 - 2) * climb;
}

// Hull damage for a frame spent in the flood. Direct, like heat and starvation:
// routing it through damage() would hand out i-frames and make standing in lava
// survivable, which is the one thing it must never be.
export function lavaBurn(player, level, dt) {
  if (player.dead || player.ty < level) return 0;
  const bite = LAVA.dps * dt;
  player.hull -= bite;
  if (player.hull <= 0) { player.hull = 0; player.dead = true; }
  return bite;
}

// Loose ore lying in an open tile -- spilled by a full bay, jettisoned on
// purpose, or dug back out of rubble a tremor dropped on it -- is picked up by
// driving over it, as much of the pile as the bay will take.
//
// This runs continuously rather than only on arrival, which is what makes the
// swap work: parked on a pulse crystal with a full bay, one press of dump sends
// a copper out behind the drill and the crystal comes aboard the same frame.
export function collectOre(world, player, onTake) {
  if (player.dead) return;
  const tier = world.looseAt(player.tx, player.ty);
  if (tier < 0) return;
  const got = world.take(player.tx, player.ty, cargoRoom(player));
  if (got > 0) {
    player.minerals[tier] += got;
    onTake?.(tier, got);
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
  // A sinkhole takes the floor out from under you: the same downward shove a
  // void pit gives, but it keeps going while there is open space to fall into,
  // so it costs real climbing rather than one tile.
  const shove = row === 'boulder' ? back
              : row === 'voidpit' ? 1
              : row === 'sinkhole' ? 1 : 0;
  if (shove && !player.moving && !world.solid(player.tx, player.ty + shove)) {
    const far = row === 'sinkhole' ? 3 : 1;
    for (let i = 0; i < far; i++) {
      if (world.solid(player.tx, player.ty + shove)) break;
      player.ty += shove;
    }
    player.py = player.ty * TILE;
    fx.spawn('dustpuff', player.px + 16, player.py + 16);
  }

  // gas keeps burning for a beat instead of hitting once
  if (row === 'gaspocket') h.cooldown = 0.45;
  else spend(h);
  return amount;
}
