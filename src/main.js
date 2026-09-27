// Alien Digger - playable vertical slice.
// Drill to the core, plant three charges, then climb out before they blow.

import { loadAssets } from './assets.js';
import { createInput } from './input.js';
import { TILE, W, D, CORE_TOP, EMPTY, STRATA, World, rng } from './world.js';
import { createPlayer, updatePlayer, damage } from './player.js';
import { populate, updateAliens, updateHazards, updatePickups, ramAliens, applyHazard, applyPickup } from './entities.js';
import { createFx } from './fx.js';
import { drawHud, drawBanner } from './hud.js';
import { createTitle } from './title.js';
import { createFoundry } from './foundry.js';
import { createHelp } from './help.js';
import { load, store, statsFor, valueOf, difficultyFor } from './progress.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const CW = canvas.width, CH = canvas.height;
const VIEW_TOP = 63;                 // HUD height
const SCANNER = 7;                   // tiles: how far buried caches read through rock

ctx.imageSmoothingEnabled = false;

// Devices without a real keyboard get the on-screen pad.
const COARSE = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
// Screen shake is the one thing here that can make someone ill, so it is opt-out
// at the OS level. The studio ident already honours this; the game should too.
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (COARSE) document.body.classList.add('touch');

// The canvas renders at a fixed 960x600 and is scaled with CSS, so the pixel art
// stays on its own grid no matter the screen. On a phone it fills the viewport;
// on a desktop it is capped so it does not blow up past its native size.
function fit() {
  const pad = COARSE ? 0 : 24;
  const availW = innerWidth - pad;
  const availH = innerHeight - (COARSE ? 0 : 70);
  let scale = Math.min(availW / CW, availH / CH);
  if (!COARSE) scale = Math.min(scale, 2);
  canvas.style.width = Math.floor(CW * scale) + 'px';
  canvas.style.height = Math.floor(CH * scale) + 'px';
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 120));
fit();

const boot = document.getElementById('boot');
const assets = await loadAssets((done, total) => {
  boot.textContent = `loading art... ${done}/${total}`;
});
// Hold the title until the studio ident has finished, so it is never cut off.
// It was started at the top of <body> and ran while the art loaded, so on a
// warm cache this usually resolves immediately.
await (window.__studioIntro || Promise.resolve());
boot.remove();

const input = createInput();
const fx = createFx(assets);
const audio = createAudio();

const save = load();
const title = createTitle(assets, COARSE, save);
const foundry = createFoundry(save);
const help = createHelp();
let helpReturn = 'title';
let lastRun = null;

// 'title' until the viewer starts, then 'playing'. ?dev skips straight in so
// the test hooks do not have to clear the screen first.
let screen = new URLSearchParams(location.search).has('dev') ? 'playing' : 'title';

let world, player, aliens, hazards, pickups, state, cam, hazardAt, diff;
// Terrain cache state. Declared up here because reset() runs at module load and
// invalidates the cache, which would hit the temporal dead zone otherwise.
let cacheOX = null, cacheOY = null, cacheRev = -1;

function reset(seed = Date.now() & 0xffff) {
  diff = difficultyFor(save.cracked);
  world = new World(seed, diff.hardness);
  const rand = rng(seed ^ 0x9e37);
  player = createPlayer(save.levels);
  ({ aliens, hazards, pickups } = populate(world, rand, diff.density));
  hazardAt = new Set(hazards.map((h) => h.y * W + h.x));
  cacheOX = cacheOY = null;   // new world, cached terrain is meaningless
  fx.clear();
  cam = { x: 0, y: 0 };
  state = {
    time: 0, escaping: false, escapeLeft: diff.escape, shake: 0, tremor: 3,
    over: null,           // 'dead' | 'won' | 'boom'
    banked: 0,           // set once when the run ends
  };
}
reset();

// ---------------------------------------------------------------- rendering

function bgFor(depth) {
  const list = assets.backgrounds;
  if (depth < 24) return assets.bg[list[0]];     // through dirt
  if (depth < 110) return assets.bg[list[1]];    // through rock
  if (depth < 172) return assets.bg[list[2]];    // ice, fungal, crystal
  return assets.bg[list[3]];
}

function drawBackground() {
  const img = bgFor(player.ty);
  if (!img) return;
  const scale = (CH - VIEW_TOP) / img.height;
  const w = img.width * scale;
  const offset = -((cam.x * 0.35) % w);
  for (let x = offset - w; x < CW; x += w) {
    ctx.drawImage(img, Math.round(x), VIEW_TOP, Math.ceil(w), CH - VIEW_TOP);
  }
  ctx.fillStyle = 'rgba(13,10,20,0.45)';
  ctx.fillRect(0, VIEW_TOP, CW, CH - VIEW_TOP);
}

// Terrain is redrawn into an offscreen canvas and blitted, rather than drawing
// every visible tile every frame. Measured before this: the terrain pass was
// ~89% of frame cost (1.94ms mean against 0.22ms with it skipped) because it
// issued roughly 300 drawImage calls a frame for tiles that had not changed.
// The cache is rebuilt only when the camera crosses a tile boundary or a tile
// is dug, so a continuous descent rebuilds a couple of times a second instead
// of sixty.
const terrain = document.createElement('canvas');
terrain.width = CW + TILE * 2;
terrain.height = CH + TILE * 2;
const tctx = terrain.getContext('2d');
tctx.imageSmoothingEnabled = false;

function buildTerrainCache(ox, oy) {
  tctx.clearRect(0, 0, terrain.width, terrain.height);
  const cols = Math.ceil(terrain.width / TILE);
  const rows = Math.ceil(terrain.height / TILE);

  for (let ty = 0; ty < rows; ty++) {
    const y = oy + ty;
    if (y < 0 || y >= D) continue;
    for (let tx = 0; tx < cols; tx++) {
      const x = ox + tx;
      if (x < 0 || x >= W) continue;
      const i = world.idx(x, y);
      const row = world.tiles[i];
      if (row === EMPTY) continue;

      const sx = tx * TILE, sy = ty * TILE;
      const img = assets.tile(row, world.variant[i]);
      if (img) tctx.drawImage(img, sx, sy, TILE, TILE);

      const ore = world.ore[i];
      if (ore >= 0) {
        const gem = assets.anim.minerals.ore[ore];
        if (gem) tctx.drawImage(gem, sx + 4, sy + 4, TILE - 8, TILE - 8);
      }
    }
  }
  cacheOX = ox; cacheOY = oy; cacheRev = world.revision;
}

function drawTerrain() {
  const ox = Math.floor(cam.x / TILE) - 1;
  const oy = Math.floor(cam.y / TILE) - 1;
  if (ox !== cacheOX || oy !== cacheOY || world.revision !== cacheRev) {
    buildTerrainCache(ox, oy);
  }
  ctx.drawImage(terrain, Math.round(ox * TILE - cam.x), Math.round(oy * TILE - cam.y));

  // The tile being ground is dynamic, so it stays a per-frame overlay.
  const t = player.drillTarget;
  if (t) {
    const dg = t.x !== player.tx && t.y !== player.ty;
    const need = Math.max(0.01, world.hardness(t.x, t.y) * (dg ? Math.SQRT2 : 1));
    const f = player.drillProgress / need;
    const warn = f > 0.7 && hazardAt.has(t.y * W + t.x);
    ctx.fillStyle = warn
      ? 'rgba(255,60,40,' + (0.25 + Math.sin(state.time * 22) * 0.18) + ')'
      : 'rgba(255,190,80,' + (0.12 + f * 0.35) + ')';
    ctx.fillRect(Math.round(t.x * TILE - cam.x), Math.round(t.y * TILE - cam.y), TILE, TILE);
  }
}

// Depth darkness. The drill carries its own light and the dark closes in as it
// goes down, which is the one atmospheric lever a game set 200m underground gets
// for free and was not using -- the magma layer was lit exactly like the
// topsoil. Rendered once into an offscreen canvas per radius step and blitted,
// so no gradient is allocated per frame.
const light = document.createElement('canvas');
const lctx = light.getContext('2d');
let lightKey = null;

function buildLight(radius, dark) {
  const size = radius * 2;
  light.width = size;
  light.height = size;
  lctx.clearRect(0, 0, size, size);
  const g = lctx.createRadialGradient(radius, radius, radius * 0.30,
                                      radius, radius, radius);
  g.addColorStop(0, 'rgba(6,3,14,0)');
  g.addColorStop(0.62, `rgba(6,3,14,${(dark * 0.45).toFixed(3)})`);
  g.addColorStop(1, `rgba(6,3,14,${dark.toFixed(3)})`);
  lctx.fillStyle = g;
  lctx.fillRect(0, 0, size, size);
}

function drawLight() {
  const t = Math.max(0, Math.min(1, (player.ty - 6) / (CORE_TOP - 6)));
  const radius = Math.round(360 - t * 170);
  const dark = +(0.30 + t * 0.52).toFixed(2);
  const key = radius + ':' + dark;
  if (key !== lightKey) { buildLight(radius, dark); lightKey = key; }

  const cx = Math.round(player.px + TILE / 2 - cam.x);
  const cy = Math.round(player.py + TILE / 2 - cam.y);
  const x0 = cx - radius, y0 = cy - radius;
  ctx.drawImage(light, x0, y0);

  // everything outside the lit disc is flat dark
  ctx.fillStyle = `rgba(6,3,14,${dark})`;
  if (x0 > 0) ctx.fillRect(0, VIEW_TOP, x0, CH - VIEW_TOP);
  if (x0 + light.width < CW) ctx.fillRect(x0 + light.width, VIEW_TOP, CW - (x0 + light.width), CH - VIEW_TOP);
  if (y0 > VIEW_TOP) ctx.fillRect(Math.max(0, x0), VIEW_TOP, Math.min(CW, light.width), y0 - VIEW_TOP);
  if (y0 + light.height < CH) ctx.fillRect(Math.max(0, x0), y0 + light.height, Math.min(CW, light.width), CH - (y0 + light.height));
}

function frameOf(frames, t, fps = 8) {
  if (!frames || !frames.length) return null;
  return frames[Math.floor(t * fps) % frames.length];
}

function drawSprite(img, px, py, box) {
  if (!img) return;
  const scale = box / Math.max(img.width, img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, Math.round(px - cam.x + (TILE - w) / 2),
                     Math.round(py - cam.y + (TILE - h)), Math.round(w), Math.round(h));
}

function drawEntities() {
  for (const h of hazards) {
    if (Math.abs(h.y - player.ty) > 22) continue;
    if (world.solid(h.x, h.y)) continue;      // still buried
    drawSprite(frameOf(assets.anim.hazards[h.kind.row], h.t, 6),
               h.x * TILE, h.y * TILE, TILE);
  }
  for (const u of pickups) {
    if (u.taken || Math.abs(u.y - player.ty) > 22) continue;
    const buried = world.solid(u.x, u.y);
    if (buried && Math.abs(u.x - player.tx) + Math.abs(u.y - player.ty) > SCANNER) continue;
    const frames = assets.anim.minerals.pickup;
    if (buried) ctx.globalAlpha = 0.45;
    drawSprite(frames && frames[u.kind.row], u.x * TILE, u.y * TILE, TILE * 0.8);
    ctx.globalAlpha = 1;
  }
  for (const s of world.chargeSockets) {
    const row = s.planted ? (state.escaping ? 'armed' : 'planted') : 'coreprop';
    const frames = assets.anim.props[row];
    const img = s.planted ? frameOf(frames, state.time, 8) : (frames && frames[0]);
    drawSprite(img, s.x * TILE, s.y * TILE, TILE * 1.4);
  }
  for (const a of aliens) {
    if (a.hp <= 0 || Math.abs(a.y - player.ty) > 22) continue;

    // A burrower inside rock and an ambusher that has not woken both need to
    // read differently, or the new behaviours are invisible and the player just
    // sees things behaving oddly.
    const inRock = world.solid(a.x, a.y);
    const dormant = a.kind.ambush && !a.woke;
    const frames = assets.anim.aliens[a.kind.row];
    const img = dormant ? (frames && frames[0]) : frameOf(frames, a.t, 7);

    if (inRock) ctx.globalAlpha = 0.45;
    else if (dormant) ctx.globalAlpha = 0.7;
    drawSprite(img, a.px, a.py, a.boss ? TILE * 3 : TILE * 1.3);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  const p = player;
  if (p.invuln > 0 && Math.floor(state.time * 20) % 2) return;

  // The drill has four sprite sets and eight headings, so a diagonal renders as
  // whichever cardinal it leans on.
  const facing = p.facing || 'down';
  let row = 'right';
  if (p.hull < p.stats.maxHull * 0.35) row = 'damage';
  else if (facing.startsWith('down')) row = 'down';
  else if (facing.startsWith('up')) row = 'thruster';

  const frames = assets.anim.drill[row];
  if (!frames || !frames.length) return;
  const img = frames[Math.floor(p.frame) % frames.length];
  if (!img) return;

  const box = TILE * 1.6;
  const scale = box / Math.max(img.width, img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.save();
  ctx.translate(Math.round(p.px - cam.x + TILE / 2), Math.round(p.py - cam.y + TILE / 2));
  if (facing.endsWith('left')) ctx.scale(-1, 1);
  ctx.drawImage(img, Math.round(-w / 2), Math.round(-h / 2), Math.round(w), Math.round(h));
  ctx.restore();
}

// ------------------------------------------------------------------ update

function guardianAlive() {
  const g = aliens.find((a) => a.boss);
  return !!g && g.hp > 0;
}

function nearestSocket() {
  // The Guardian has to go down first, or it is just scenery in an open room.
  if (guardianAlive()) return null;
  return world.chargeSockets.find(
    (s) => !s.planted && Math.abs(s.x - player.tx) <= 1 && Math.abs(s.y - player.ty) <= 1,
  );
}

// The player module already spawns an effect at every moment worth hearing, so
// the sound rides along with it rather than needing its own hooks threaded
// through updatePlayer -- which would also have to change the simulator.
const playerFx = {
  spawn(row, x, y, scale) {
    fx.spawn(row, x, y, scale);
    if (row === 'dustpuff') {
      audio.breakTile(player.drillTarget
        ? world.hardness(player.drillTarget.x, player.drillTarget.y) : 1);
    } else if (row === 'sparkle') {
      audio.ore();
    }
  },
};

function update(dt) {
  // Gamepads are polled, not evented, and this has to happen wherever the game
  // steps -- the dev harness drives update() directly and never runs the loop.
  input.poll();

  if (input.tapped('mute')) audio.toggleMute();

  if (screen === 'help') {
    if (help.update(dt, input)) screen = helpReturn;
    return;
  }

  if (screen === 'title') {
    title.update(dt);
    if (input.tapped('help')) { helpReturn = 'title'; screen = 'help'; audio.resume(); return; }
    if (title.wantsStart(input)) {
      audio.resume();
      screen = 'playing';
      reset();
    }
    return;
  }

  if (screen === 'foundry') {
    if (input.tapped('help')) { helpReturn = 'foundry'; screen = 'help'; return; }
    if (foundry.update(dt, input)) {
      screen = 'playing';
      reset();
    }
    return;
  }

  if (input.tapped('help')) {
    helpReturn = 'playing';
    screen = 'help';
    audio.drill(false);
    return;
  }

  // Once a run is over the only way on is through the Foundry.
  if (state.over) {
    if (input.tapped('restart') || input.tapped('plant')) screen = 'foundry';
    return;
  }
  if (input.tapped('restart')) { reset(); return; }

  state.time += dt;
  updatePlayer(player, world, input, dt, playerFx);
  audio.drill(player.drilling, player.drillTarget
    ? world.hardness(player.drillTarget.x, player.drillTarget.y) : 1);

  updateAliens(aliens, world, player, dt, (a) => {
    if (a.hp <= 0) return;
    if (damage(player, a.kind.dmg, fx)) {
      fx.spawn('sparks', player.px + 16, player.py + 16);
      audio.hurt();
      state.shake = Math.max(state.shake, 0.5);
    }
  }, (a) => {
    if (damage(player, a.kind.spitDmg, fx)) {
      // draw the acid leaving and arriving, not just the damage landing
      fx.spawn('acidsplash', a.px + 16, a.py + 16, 0.6);
      fx.spawn('acidsplash', player.px + 16, player.py + 16);
      audio.hurt();
      state.shake = Math.max(state.shake, 0.4);
    }
  });
  ramAliens(aliens, player, dt, (a) => {
    fx.spawn(a.boss ? 'explosion' : 'debris', a.px + 16, a.py + 16, a.boss ? 2 : 1);
    a.boss ? audio.explode() : audio.kill();
    state.shake = Math.max(state.shake, a.boss ? 1.2 : 0.35);
    if (a.boss) player.minerals[4] += 5;
    else player.minerals[Math.min(4, Math.floor(a.y / 45))]++;
  });

  updateHazards(hazards, player, dt, (h) => {
    const r = applyHazard(h, player, world, fx);
    if (typeof r === 'number') { audio.hurt(); state.shake = Math.max(state.shake, 0.55); }
    else if (r === 'fuel') audio.warn();
  });

  updatePickups(pickups, player, (u) => {
    const kind = applyPickup(u, player);
    fx.spawn(kind === 'coolant' ? 'shieldhit' : 'sparkle', player.px + 16, player.py + 16);
    if (kind === 'fuel') audio.fuel();
    else if (kind === 'repair') audio.repair();
    else audio.ore();
  });

  const socket = nearestSocket();
  if (socket && player.charges > 0 && input.tapped('plant')) {
    socket.planted = true;
    player.charges--;
    player.planted++;
    fx.spawn('flash', socket.x * TILE + 16, socket.y * TILE + 16);
    audio.plant();
    if (player.planted === 3) {
      state.escaping = true;
      state.escapeLeft = diff.escape;
      audio.alarm(true);
    }
  }

  if (state.escaping) {
    state.escapeLeft -= dt;

    // Three fusion charges are armed under a planet, so the way out does not
    // stay the way in. Tremors drop rubble into the shaft above the drill,
    // which is soft to cut but costs seconds against a clock that is already
    // running -- the climb was a pure retrace of ground already cleared, which
    // made the most dramatic phase of the run the least interesting one.
    state.tremor -= dt;
    if (state.tremor <= 0) {
      state.tremor = 4.5 + Math.random() * 2.5;
      let dropped = 0;
      for (let tries = 0; tries < 24 && dropped < 3; tries++) {
        const y = player.ty - 4 - Math.floor(Math.random() * 10);
        const x = player.tx + Math.floor(Math.random() * 3) - 1;
        if (y < 4) continue;
        if (world.collapse(x, y)) {
          dropped++;
          fx.spawn('dustpuff', x * TILE + 16, y * TILE + 16);
        }
      }
      if (dropped) {
        state.shake = Math.max(state.shake, 0.6);
        audio.hurt();
      }
    }

    if (player.ty <= 3) {
      state.over = 'won';
    } else if (state.escapeLeft <= 0) {
      state.over = 'boom';
      fx.spawn('explosion', player.px + 16, player.py + 16, 3);
      state.shake = 1.6;
    }
  }

  const lowFuel = player.fuel > 0 && player.fuel < player.stats.maxFuel * 0.22;
  if (lowFuel) {
    state.warnAt = (state.warnAt || 0) - dt;
    if (state.warnAt <= 0) { audio.warn(); state.warnAt = 1.4; }
  }

  // Starvation is otherwise invisible: the fuel bar sits empty and the hull
  // drains with no cue that you crossed from low into bleeding.
  if (player.fuel <= 0 && !player.dead && Math.floor(state.time * 3) % 2 === 0
      && Math.floor((state.time - dt) * 3) % 2 !== 0) {
    fx.spawn('sparks', player.px + 16, player.py + 16);
    audio.warn();
  }

  if (player.dead) state.over = 'dead';

  // Bank once, however the run ended. A lost run still pays out what was dug,
  // at a cut, so a bad descent still moves the Foundry forward instead of being
  // wasted time.
  if (state.over) {
    audio.alarm(false);
    audio.drill(false);
  }

  if (state.over && !state.banked) {
    const full = valueOf(player.minerals, player.stats.cargoMult, diff.payout);
    state.banked = state.over === 'won' ? full : Math.round(full * 0.4);
    save.credits += state.banked;
    save.runs++;
    if (state.over === 'won') save.cracked++;
    store(save);
    if (state.over === 'won') audio.win(); else audio.lose();
    lastRun = {
      cracked: state.over === 'won',
      line: state.over === 'won'
        ? 'PLANET CRACKED -- full haul banked'
        : state.over === 'boom' ? 'STILL INSIDE -- salvage only'
        : `DRILL LOST AT ${player.ty}m -- salvage only`,
      depth: player.ty,
      time: Math.round(state.time),
      minerals: [...player.minerals],
      banked: state.banked,
      gross: valueOf(player.minerals, player.stats.cargoMult, diff.payout),
    };
  }

  state.shake = Math.max(0, state.shake - dt * 3.4);
  fx.update(dt);

  // camera trails the drill, clamped to the world
  const targetX = player.px + TILE / 2 - CW / 2;
  const targetY = player.py + TILE / 2 - (CH + VIEW_TOP) / 2;
  cam.x += (targetX - cam.x) * Math.min(1, dt * 8);
  cam.y += (targetY - cam.y) * Math.min(1, dt * 8);
  cam.x = Math.max(0, Math.min(W * TILE - CW, cam.x));
  cam.y = Math.max(-VIEW_TOP, Math.min(D * TILE - CH, cam.y));
}

function render() {
  ctx.fillStyle = '#0d0a14';
  ctx.fillRect(0, 0, CW, CH);

  if (screen === 'title') {
    title.draw(ctx, CW, CH, VIEW_TOP, input.hasGamepad());
    return;
  }
  if (screen === 'foundry') {
    foundry.draw(ctx, CW, CH, assets, lastRun, input.hasGamepad());
    return;
  }
  if (screen === 'help') {
    help.draw(ctx, CW, CH, assets, COARSE, input.hasGamepad());
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEW_TOP, CW, CH - VIEW_TOP);
  ctx.clip();
  // Shake the world, never the HUD -- a jittering fuel gauge is unreadable
  // exactly when the player most needs to read it.
  if (state.shake > 0 && !REDUCED_MOTION) {
    const k = state.shake * state.shake * 7;
    ctx.translate(Math.round((Math.random() - 0.5) * k), Math.round((Math.random() - 0.5) * k));
  }
  drawBackground();
  drawTerrain();
  drawEntities();
  drawPlayer();
  fx.draw(ctx, cam);
  drawLight();
  ctx.restore();

  drawHud(ctx, player, state, CW, audio.muted, STRATA, CORE_TOP + 7, diff);

  if (!state.over && player.ty > CORE_TOP) {
    const socket = nearestSocket();
    let hint = null;
    const pad = input.hasGamepad();
    // "Blocked" told the player they were stuck without telling them the way
    // out, and the drill has no weapon to make ramming obvious.
    if (guardianAlive()) hint = 'DRIVE INTO THE CORE GUARDIAN TO BREAK IT';
    else if (socket && player.charges > 0) hint = pad ? '(A) PLANT CHARGE' : '[E] PLANT CHARGE';
    if (hint) {
      ctx.fillStyle = guardianAlive() ? '#ff6b5b' : '#39d7e8';
      ctx.font = '13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(hint, CW / 2, CH - 24);
      ctx.textAlign = 'left';
    }
  }

  if (state.over) {
    const title = state.over === 'won' ? 'PLANET CRACKED'
                : state.over === 'dead' ? 'DRILL DESTROYED' : 'TOO SLOW';
    const why = state.over === 'boom' ? 'you were still inside  -  ' : '';
    drawBanner(ctx, CW, CH, title,
               `${why}${state.banked} CR banked  -  ${input.hasGamepad() ? '(Y)' : 'press R'} for the Foundry`);
  }
}

// Add ?dev to the URL to expose handles for poking at the late game without
// having to drill there by hand.
if (new URLSearchParams(location.search).has('dev')) {
  globalThis.dev = {
    get player() { return player; },
    get world() { return world; },
    get state() { return state; },
    get aliens() { return aliens; },
    get hazards() { return hazards; },
    get pickups() { return pickups; },
    // carve a clear shaft down to a depth and drop the drill into it
    warp(y) {
      for (let j = 3; j <= y; j++) world.tiles[world.idx(player.tx, j)] = EMPTY;
      player.ty = y;
      player.py = y * TILE;
      player.moving = null;
      cam.y = player.py - CH / 2;
    },
    refuel() { player.fuel = player.stats.maxFuel; player.hull = player.stats.maxHull; },
    // Step the game by hand. requestAnimationFrame is throttled to zero in a
    // background tab, so without this a harness cannot drive a run unless the
    // window happens to be foregrounded.
    tick(seconds, dt = 1 / 60) {
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) { update(dt); render(); }
      return { depth: player.ty, fuel: Math.round(player.fuel),
               hull: Math.round(player.hull), dead: player.dead, over: state.over };
    },
  };
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  input.endFrame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
