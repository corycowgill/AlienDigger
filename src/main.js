// Alien Digger - playable vertical slice.
// Drill to the core, plant three charges, then climb out before they blow.

import { loadAssets } from './assets.js';
import { createInput } from './input.js';
import { TILE, W, D, CORE_TOP, EMPTY, World, rng } from './world.js';
import { createPlayer, updatePlayer, damage } from './player.js';
import { populate, updateAliens, updateHazards, updatePickups, ramAliens, applyHazard } from './entities.js';
import { createFx } from './fx.js';
import { drawHud, drawBanner } from './hud.js';
import { createTitle } from './title.js';
import { createFoundry } from './foundry.js';
import { load, store, statsFor, valueOf } from './progress.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const CW = canvas.width, CH = canvas.height;
const VIEW_TOP = 63;                 // HUD height
const SCANNER = 7;                   // tiles: how far buried caches read through rock

ctx.imageSmoothingEnabled = false;

// Devices without a real keyboard get the on-screen pad.
const COARSE = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
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
const title = createTitle(assets, COARSE);

const save = load();
const foundry = createFoundry(save);
let lastRun = null;

// 'title' until the viewer starts, then 'playing'. ?dev skips straight in so
// the test hooks do not have to clear the screen first.
let screen = new URLSearchParams(location.search).has('dev') ? 'playing' : 'title';

let world, player, aliens, hazards, pickups, state, cam, hazardAt;

function reset(seed = Date.now() & 0xffff) {
  world = new World(seed);
  const rand = rng(seed ^ 0x9e37);
  player = createPlayer(save.levels);
  ({ aliens, hazards, pickups } = populate(world, rand));
  hazardAt = new Set(hazards.map((h) => h.y * W + h.x));
  fx.clear();
  cam = { x: 0, y: 0 };
  state = {
    time: 0, escaping: false, escapeLeft: 60,
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

function drawTerrain() {
  const x0 = Math.max(0, Math.floor(cam.x / TILE));
  const x1 = Math.min(W - 1, Math.ceil((cam.x + CW) / TILE));
  const y0 = Math.max(0, Math.floor((cam.y + VIEW_TOP) / TILE));
  const y1 = Math.min(D - 1, Math.ceil((cam.y + CH) / TILE));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = world.idx(x, y);
      const row = world.tiles[i];
      if (row === EMPTY) continue;

      const sx = Math.round(x * TILE - cam.x);
      const sy = Math.round(y * TILE - cam.y);

      const img = assets.tile(row, world.variant[i]);
      if (img) ctx.drawImage(img, sx, sy, TILE, TILE);

      const ore = world.ore[i];
      if (ore >= 0) {
        const gem = assets.anim.minerals.ore[ore];
        if (gem) ctx.drawImage(gem, sx + 4, sy + 4, TILE - 8, TILE - 8);
      }

      // crack the tile the drill is currently grinding
      if (player.drillTarget && player.drillTarget.x === x && player.drillTarget.y === y) {
        const f = player.drillProgress / Math.max(0.01, world.hardness(x, y));
        const warn = f > 0.7 && hazardAt.has(y * W + x);
        ctx.fillStyle = warn
          ? 'rgba(255,60,40,' + (0.25 + Math.sin(state.time * 22) * 0.18) + ')'
          : 'rgba(255,190,80,' + (0.12 + f * 0.35) + ')';
        ctx.fillRect(sx, sy, TILE, TILE);
      }
    }
  }
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
    drawSprite(frameOf(assets.anim.aliens[a.kind.row], a.t, 7),
               a.px, a.py, a.boss ? TILE * 3 : TILE * 1.3);
  }
}

function drawPlayer() {
  const p = player;
  if (p.invuln > 0 && Math.floor(state.time * 20) % 2) return;

  let row = 'right';
  if (p.hull < p.stats.maxHull * 0.35) row = 'damage';
  else if (p.facing === 'down') row = 'down';
  else if (p.facing === 'up') row = 'thruster';

  const frames = assets.anim.drill[row];
  if (!frames || !frames.length) return;
  const img = frames[Math.floor(p.frame) % frames.length];
  if (!img) return;

  const box = TILE * 1.6;
  const scale = box / Math.max(img.width, img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.save();
  ctx.translate(Math.round(p.px - cam.x + TILE / 2), Math.round(p.py - cam.y + TILE / 2));
  if (p.facing === 'left') ctx.scale(-1, 1);
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

function update(dt) {
  // Gamepads are polled, not evented, and this has to happen wherever the game
  // steps -- the dev harness drives update() directly and never runs the loop.
  input.poll();

  if (screen === 'title') {
    title.update(dt);
    if (title.wantsStart(input)) {
      screen = 'playing';
      reset();
    }
    return;
  }

  if (screen === 'foundry') {
    if (foundry.update(dt, input)) {
      screen = 'playing';
      reset();
    }
    return;
  }

  // Once a run is over the only way on is through the Foundry.
  if (state.over) {
    if (input.tapped('restart') || input.tapped('plant')) screen = 'foundry';
    return;
  }
  if (input.tapped('restart')) { reset(); return; }

  state.time += dt;
  updatePlayer(player, world, input, dt, fx);

  updateAliens(aliens, world, player, dt, (a) => {
    if (a.hp <= 0) return;
    if (damage(player, a.kind.dmg, fx)) fx.spawn('sparks', player.px + 16, player.py + 16);
  });
  ramAliens(aliens, player, dt, (a) => {
    fx.spawn(a.boss ? 'explosion' : 'debris', a.px + 16, a.py + 16, a.boss ? 2 : 1);
    if (a.boss) player.minerals[4] += 5;
    else player.minerals[Math.min(4, Math.floor(a.y / 45))]++;
  });

  updateHazards(hazards, player, dt, (h) => applyHazard(h, player, world, fx));

  updatePickups(pickups, player, (u) => {
    if (u.kind.kind === 'fuel') {
      player.fuel = Math.min(player.stats.maxFuel, player.fuel + u.kind.amount);
    } else {
      player.hull = Math.min(player.stats.maxHull, player.hull + u.kind.amount);
    }
    fx.spawn('sparkle', player.px + 16, player.py + 16);
  });

  const socket = nearestSocket();
  if (socket && player.charges > 0 && input.tapped('plant')) {
    socket.planted = true;
    player.charges--;
    player.planted++;
    fx.spawn('flash', socket.x * TILE + 16, socket.y * TILE + 16);
    if (player.planted === 3) {
      state.escaping = true;
      state.escapeLeft = 60;
    }
  }

  if (state.escaping) {
    state.escapeLeft -= dt;
    if (player.ty <= 3) {
      state.over = 'won';
    } else if (state.escapeLeft <= 0) {
      state.over = 'boom';
      fx.spawn('explosion', player.px + 16, player.py + 16, 3);
    }
  }

  // Starvation is otherwise invisible: the fuel bar sits empty and the hull
  // drains with no cue that you crossed from low into bleeding.
  if (player.fuel <= 0 && !player.dead && Math.floor(state.time * 3) % 2 === 0
      && Math.floor((state.time - dt) * 3) % 2 !== 0) {
    fx.spawn('sparks', player.px + 16, player.py + 16);
  }

  if (player.dead) state.over = 'dead';

  // Bank once, however the run ended. A lost run still pays out what was dug,
  // at a cut, so a bad descent still moves the Foundry forward instead of being
  // wasted time.
  if (state.over && !state.banked) {
    const full = valueOf(player.minerals, player.stats.cargoMult);
    state.banked = state.over === 'won' ? full : Math.round(full * 0.4);
    save.credits += state.banked;
    save.runs++;
    if (state.over === 'won') save.cracked++;
    store(save);
    lastRun = {
      cracked: state.over === 'won',
      line: state.over === 'won'
        ? `planet cracked -- full haul banked, ${state.banked} CR`
        : `run lost at ${player.ty}m -- salvage only, ${state.banked} CR`,
    };
  }

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

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEW_TOP, CW, CH - VIEW_TOP);
  ctx.clip();
  drawBackground();
  drawTerrain();
  drawEntities();
  drawPlayer();
  fx.draw(ctx, cam);
  ctx.restore();

  drawHud(ctx, player, state, CW);

  if (!state.over && player.ty > CORE_TOP) {
    const socket = nearestSocket();
    let hint = null;
    const pad = input.hasGamepad();
    if (guardianAlive()) hint = 'THE CORE GUARDIAN BLOCKS THE CHARGES';
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
