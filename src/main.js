// Alien Digger - playable vertical slice.
// Drill to the core, plant three charges, then climb out before they blow.

import { loadAssets } from './assets.js';
import { createInput } from './input.js';
import { TILE, W, D, CORE_TOP, EMPTY, STRATA, World, rng, strataAt } from './world.js';
import { createPlayer, updatePlayer, damage } from './player.js';
import { populate, updateAliens, updateHazards, updatePickups, ramAliens, applyHazard, applyPickup } from './entities.js';
import { createFx } from './fx.js';
import { createFloaters } from './floaters.js';
import { drawHud, drawBanner } from './hud.js';
import { createTitle } from './title.js';
import { createFoundry } from './foundry.js';
import { createHelp } from './help.js';
import { createTips } from './tips.js';
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
const floaters = createFloaters();
const ORE_TINT = ['#e07a2b', '#d8dbe6', '#a77ff0', '#e8b02b', '#39d7e8'];
const lastMinerals = [0, 0, 0, 0, 0];
const audio = createAudio();

const save = load();
const title = createTitle(assets, COARSE, save);
const foundry = createFoundry(save);
const help = createHelp();
const tips = createTips(save);
let helpReturn = 'title';
let lastRun = null;

// 'title' until the viewer starts, then 'playing'. ?dev skips straight in so
// the test hooks do not have to clear the screen first.
let screen = new URLSearchParams(location.search).has('dev') ? 'playing' : 'title';

let world, player, aliens, hazards, pickups, props, state, cam, hazardAt, diff;
// Terrain cache state. Declared up here because reset() runs at module load and
// invalidates the cache, which would hit the temporal dead zone otherwise.
let cacheOX = null, cacheOY = null;

function reset(seed = Date.now() & 0xffff) {
  diff = difficultyFor(save.cracked);
  world = new World(seed, diff.hardness);
  const rand = rng(seed ^ 0x9e37);
  player = createPlayer(save.levels);
  ({ aliens, hazards, pickups, props } = populate(world, rand, diff.density));
  hazardAt = new Set(hazards.map((h) => h.y * W + h.x));
  cacheOX = cacheOY = null;   // new world, cached terrain is meaningless
  audio.alarm(false);   // a restart mid-escape used to leave this beeping
  audio.drill(false);
  fx.clear();
  floaters.clear();
  tips.clear();
  lastMinerals.fill(0);
  cam = { x: 0, y: 0 };
  state = {
    time: 0, escaping: false, escapeLeft: diff.escape, shake: 0, tremor: 3, band: null,
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
// Sized to a whole number of tiles. It was CH + TILE*2 = 664px, which is 20.75
// tiles, so the bottom row straddled the canvas edge and a scroll left an
// 8-pixel band of stale rock behind it -- visible as horizontal streaks across
// the lower half of the screen.
// Cached one-pixel-wide gradients, stamped and stretched rather than built per
// tile -- there are a few hundred edges on screen and createLinearGradient is
// not free.
const edgeStrip = {};
function shadeEdge(x, y, w, h, dx, dy) {
  const key = `${dx},${dy}`;
  let g = edgeStrip[key];
  if (!g) {
    g = tctx.createLinearGradient(0, 0, dx * EDGE, dy * EDGE);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,1,6,0.62)');
    edgeStrip[key] = g;
  }
  tctx.save();
  tctx.translate(dx > 0 ? x : dx < 0 ? x + w : x, dy > 0 ? y : dy < 0 ? y + h : y);
  tctx.fillStyle = g;
  tctx.fillRect(dx < 0 ? -w : 0, dy < 0 ? -h : 0, w, h);
  tctx.restore();
}

const CACHE_COLS = Math.ceil((CW + TILE * 2) / TILE);
const CACHE_ROWS = Math.ceil((CH + TILE * 2) / TILE);

const terrain = document.createElement('canvas');
terrain.width = CACHE_COLS * TILE;
terrain.height = CACHE_ROWS * TILE;
const tctx = terrain.getContext('2d');
tctx.imageSmoothingEnabled = false;

// Depth of the shadow cast into open space by the rock around it.
const EDGE = 7;

function paintTiles(ox, oy, x0, y0, x1, y1) {
  for (let ty = y0; ty < y1; ty++) {
    const y = oy + ty;
    for (let tx = x0; tx < x1; tx++) {
      const x = ox + tx;
      const sx = tx * TILE, sy = ty * TILE;
      tctx.clearRect(sx, sy, TILE, TILE);
      if (x < 0 || x >= W || y < 0 || y >= D) continue;

      const i = world.idx(x, y);
      const row = world.tiles[i];

      // Open space next to rock gets a shadow along the shared edge. Without
      // it a tunnel is just an absence -- the background showing through a hole
      // -- and a shaft you cut reads exactly like a cavern you walked into.
      if (row === EMPTY) {
        if (world.solid(x, y - 1)) shadeEdge(sx, sy, TILE, EDGE, 0, 1);
        if (world.solid(x, y + 1)) shadeEdge(sx, sy + TILE - EDGE, TILE, EDGE, 0, -1);
        if (world.solid(x - 1, y)) shadeEdge(sx, sy, EDGE, TILE, 1, 0);
        if (world.solid(x + 1, y)) shadeEdge(sx + TILE - EDGE, sy, EDGE, TILE, -1, 0);
        continue;
      }

      const img = assets.tile(row, world.variant[i]);
      if (img) tctx.drawImage(img, sx, sy, TILE, TILE);

      const ore = world.ore[i];
      if (ore >= 0) {
        const gem = assets.anim.minerals.ore[ore];
        if (gem) tctx.drawImage(gem, sx + 4, sy + 4, TILE - 8, TILE - 8);
      }
    }
  }
}

const scratch = document.createElement('canvas');
scratch.width = terrain.width;
scratch.height = terrain.height;
const sctx = scratch.getContext('2d');
sctx.imageSmoothingEnabled = false;

// Scroll the cache rather than rebuilding it. A full rebuild is ~570 tiles in a
// single frame, and the camera crosses a tile boundary several times a second
// while descending, so that spike landed constantly. Shifting the existing
// pixels and repainting only the strip that just came into view turns it into
// about 30 tiles.
function syncTerrainCache(ox, oy) {
  if (cacheOX === null
      || Math.abs(ox - cacheOX) >= CACHE_COLS || Math.abs(oy - cacheOY) >= CACHE_ROWS) {
    paintTiles(ox, oy, 0, 0, CACHE_COLS, CACHE_ROWS);
    cacheOX = ox; cacheOY = oy;
    world.dirty.length = 0;
    return;
  }

  if (ox === cacheOX && oy === cacheOY) {
    // just the tiles that changed since last frame
    for (let k = 0; k < world.dirty.length; k += 2) {
      const tx = world.dirty[k] - ox, ty = world.dirty[k + 1] - oy;
      if (tx >= 0 && tx < CACHE_COLS && ty >= 0 && ty < CACHE_ROWS) {
        paintTiles(ox, oy, tx, ty, tx + 1, ty + 1);
      }
    }
    world.dirty.length = 0;
    return;
  }

  const dx = ox - cacheOX, dy = oy - cacheOY;
  // Shift through a scratch buffer rather than drawing the cache onto itself.
  // The self-copy left horizontal streaks of stale rows: a canvas is allowed to
  // be its own source, but combining that with a 'copy' composite is asking for
  // trouble and it delivered.
  sctx.clearRect(0, 0, scratch.width, scratch.height);
  sctx.drawImage(terrain, 0, 0);
  tctx.clearRect(0, 0, terrain.width, terrain.height);
  tctx.drawImage(scratch, -dx * TILE, -dy * TILE);

  // repaint whatever the shift exposed
  if (dx > 0) paintTiles(ox, oy, CACHE_COLS - dx, 0, CACHE_COLS, CACHE_ROWS);
  else if (dx < 0) paintTiles(ox, oy, 0, 0, -dx, CACHE_ROWS);
  if (dy > 0) paintTiles(ox, oy, 0, CACHE_ROWS - dy, CACHE_COLS, CACHE_ROWS);
  else if (dy < 0) paintTiles(ox, oy, 0, 0, CACHE_COLS, -dy);

  // anything dug this frame may have been inside the region we just shifted
  for (let k = 0; k < world.dirty.length; k += 2) {
    const tx = world.dirty[k] - ox, ty = world.dirty[k + 1] - oy;
    if (tx >= 0 && tx < CACHE_COLS && ty >= 0 && ty < CACHE_ROWS) {
      paintTiles(ox, oy, tx, ty, tx + 1, ty + 1);
    }
  }
  world.dirty.length = 0;
  cacheOX = ox; cacheOY = oy;
}

function drawTerrain() {
  const ox = Math.floor(cam.x / TILE) - 1;
  const oy = Math.floor(cam.y / TILE) - 1;
  syncTerrainCache(ox, oy);
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

// Short cycles ping-pong rather than wrapping. A three-frame walk played
// 0,1,2,0,1,2 snaps hard on the wrap, which is most of why these read as choppy;
// 0,1,2,1 turns the same three frames into a smooth there-and-back. Two-frame
// cycles are already symmetric, so they just alternate.
function frameOf(frames, t, fps = 8) {
  if (!frames || !frames.length) return null;
  const n = frames.length;
  if (n < 3) return frames[Math.floor(t * fps) % n];
  const span = (n - 1) * 2;
  const i = Math.floor(t * fps) % span;
  return frames[i < n ? i : span - i];
}

function drawSprite(img, px, py, box) {
  if (!img) return;
  const scale = box / Math.max(img.width, img.height);
  const w = img.width * scale, h = img.height * scale;
  ctx.drawImage(img, Math.round(px - cam.x + (TILE - w) / 2),
                     Math.round(py - cam.y + (TILE - h)), Math.round(w), Math.round(h));
}

function drawEntities() {
  // Surface dressing. Only ever near the top, so it costs nothing at depth.
  if (player.ty < 26) {
    const frames = assets.anim.props.surfaceprop;
    for (const pr of props) {
      drawSprite(frames && frames[pr.row], pr.x * TILE, pr.y * TILE,
                 pr.big ? TILE * 2.4 : TILE * 1.5);
    }
  }

  for (const h of hazards) {
    if (Math.abs(h.y - player.ty) > 22) continue;
    if (world.solid(h.x, h.y)) continue;      // still buried
    drawSprite(frameOf(assets.anim.hazards[h.kind.row], h.t, 9),
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
    const img = s.planted ? frameOf(frames, state.time, 10) : (frames && frames[0]);
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
    const img = dormant ? (frames && frames[0]) : frameOf(frames, a.t, 10);

    // The boss telegraphs: a ring while it winds up so the blast radius is
    // visible, and a glow while it is open and worth committing to.
    if (a.boss && a.hp > 0) {
      const cx = a.px + TILE / 2 - cam.x, cy = a.py + TILE / 2 - cam.y;
      if (a.phase === 'windup') {
        const grow = 1 - a.phaseT / 0.75;
        ctx.strokeStyle = `rgba(255,70,50,${0.35 + grow * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 2.5 * (0.55 + grow * 0.45), 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.phase === 'exposed') {
        ctx.fillStyle = `rgba(47,210,232,${0.10 + Math.sin(state.time * 9) * 0.06})`;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (inRock) ctx.globalAlpha = 0.45;
    else if (dormant) ctx.globalAlpha = 0.7;
    drawSprite(img, a.px, a.py, a.boss ? TILE * 3 : TILE * 1.3);
    ctx.globalAlpha = 1;

    // A flinch on every landed hit. Anything you can damage should show it,
    // but it matters most on the boss, where without it you cannot tell a
    // fight you are winning from one you are losing.
    if (a.hurt > 0) {
      const box = a.boss ? TILE * 3 : TILE * 1.3;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.55, a.hurt * 4);
      ctx.fillStyle = '#ffd9a0';
      ctx.fillRect(Math.round(a.px - cam.x + (TILE - box) / 2),
                   Math.round(a.py - cam.y + TILE - box), box, box);
      ctx.restore();
    }

    // Any alien you have hurt shows a small bar, so ramming a thing reads as
    // progress rather than a gamble. The boss gets the full treatment below.
    if (!a.boss && a.hp > 0 && a.maxHp && a.hp < a.maxHp) {
      const w = 26, bx = Math.round(a.px + TILE / 2 - cam.x - w / 2);
      const by = Math.round(a.py - cam.y - 6);
      ctx.fillStyle = 'rgba(8,5,16,0.8)';
      ctx.fillRect(bx - 1, by - 1, w + 2, 5);
      ctx.fillStyle = '#ff7b3a';
      ctx.fillRect(bx, by, Math.round(w * Math.max(0, a.hp / a.maxHp)), 3);
    }

    // Boss health, floating above it, so progress is legible from the cockpit.
    if (a.boss && a.hp > 0) {
      const w = 104, bx = Math.round(a.px + TILE / 2 - cam.x - w / 2);
      const by = Math.round(a.py - cam.y - TILE * 1.5);
      const frac = Math.max(0, a.hp / a.maxHp);
      ctx.fillStyle = 'rgba(8,5,16,0.85)';
      ctx.fillRect(bx - 2, by - 2, w + 4, 12);
      ctx.fillStyle = '#3a1410';
      ctx.fillRect(bx, by, w, 8);
      ctx.fillStyle = a.phase === 'exposed' ? '#ff7b3a' : '#8c3a2a';
      ctx.fillRect(bx, by, Math.round(w * frac), 8);
      ctx.strokeStyle = a.phase === 'exposed' ? '#2fd2e8' : '#5b4a52';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 2.5, by - 2.5, w + 5, 13);
      ctx.fillStyle = a.phase === 'exposed' ? '#2fd2e8' : '#8c85a0';
      ctx.font = 'bold 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(a.phase === 'exposed' ? 'OPEN' : a.phase === 'windup' ? 'SLAM INCOMING' : 'ARMOURED',
                   bx + w / 2, by - 6);
      ctx.textAlign = 'left';
    }
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
  const oreBefore = player.minerals.reduce((a, c) => a + c, 0);
  updatePlayer(player, world, input, dt, playerFx);
  if (player.minerals.reduce((a, c) => a + c, 0) > oreBefore) {
    // Freeing ore is the moment the run pays you, and it used to be one small
    // sparkle. Now the refined gem pops out of the rock, the value floats off
    // it, and both the size and the chime climb with the tier -- so a pulse
    // crystal reads as a find and copper reads as copper.
    for (let tier = 0; tier < player.minerals.length; tier++) {
      if (player.minerals[tier] === lastMinerals[tier]) continue;

      const gx = player.px + TILE / 2, gy = player.py + TILE / 2;
      const gem = assets.anim.minerals.gem?.[tier];
      fx.pop(gem, gx, gy, 0.55 + tier * 0.09, 22 + tier * 7);
      fx.spawn('sparkle', gx, gy, 0.8 + tier * 0.25);

      const worth = Math.round((tier + 1) * 10 * player.stats.cargoMult * diff.payout);
      floaters.push(`+${worth}`, gx, player.py, ORE_TINT[tier], 1 + tier * 0.22);

      if (tier >= 2 && tips.show('vein')) store(save);

      // the rare ones are worth feeling
      if (tier >= 3) {
        state.shake = Math.max(state.shake, 0.18 + tier * 0.06);
        fx.spawn('flash', gx, gy, 0.7);
      }
      audio.ore(tier);
      break;
    }
  }
  for (let i = 0; i < player.minerals.length; i++) lastMinerals[i] = player.minerals[i];
  audio.drill(player.drilling, player.drillTarget
    ? world.hardness(player.drillTarget.x, player.drillTarget.y) : 1);
  audio.ambience(player.ty / CORE_TOP, state.escaping);
  audio.tick(dt);

  updateAliens(aliens, world, player, dt, (a) => {
    if (a.hp <= 0) return;
    if (damage(player, a.kind.dmg, fx)) {
      fx.spawn('sparks', player.px + 16, player.py + 16);
      floaters.push(`-${a.kind.dmg}`, player.px + 16, player.py, '#ff6b5b');
      audio.hurt();
      state.shake = Math.max(state.shake, 0.5);
    }
  }, (a) => {
    if (damage(player, a.kind.spitDmg, fx)) {
      floaters.push(`-${a.kind.spitDmg}`, player.px + 16, player.py, '#7fe04a');
      // draw the acid leaving and arriving, not just the damage landing
      fx.spawn('acidsplash', a.px + 16, a.py + 16, 0.6);
      fx.spawn('acidsplash', player.px + 16, player.py + 16);
      audio.hurt();
      state.shake = Math.max(state.shake, 0.4);
    }
  }, (a, reach) => {
    // the slam lands wherever you are standing when the windup ends
    fx.spawn('explosion', a.px + 16, a.py + 16, 1.6);
    state.shake = Math.max(state.shake, reach ? 1.1 : 0.5);
    audio.explode();
    if (reach && damage(player, a.kind.slam, fx)) {
      fx.spawn('flash', player.px + 16, player.py + 16);
      floaters.push(`-${a.kind.slam}`, player.px + 16, player.py, '#ff6b5b');
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
    if (typeof r === 'number') {
      floaters.push(`-${r}`, player.px + 16, player.py, '#ff6b5b');
      audio.hurt();
      state.shake = Math.max(state.shake, 0.55);
    } else if (r === 'fuel') {
      floaters.push('FUEL -11', player.px + 16, player.py, '#e8b02b');
      audio.warn();
    }
  });

  updatePickups(pickups, player, (u) => {
    const kind = applyPickup(u, player);
    fx.spawn(kind === 'coolant' ? 'shieldhit' : 'sparkle', player.px + 16, player.py + 16);
    const said = { fuel: [`+${u.kind.amount} FUEL`, '#e8b02b'], repair: [`+${u.kind.amount} HULL`, '#4ae06b'],
                   coolant: ['HEAT PURGED', '#39d7e8'], shield: ['SHIELD UP', '#39d7e8'],
                   boost: ['OVERDRIVE', '#e8b02b'] }[kind];
    if (said) floaters.push(said[0], player.px + 16, player.py, said[1]);
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
        audio.rumble();
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

  // Name each stratum as you break into it, so the descent has waypoints rather
  // than just a rising number.
  const band = strataAt(player.ty);
  if (band !== state.band) {
    if (state.band) {
      tips.announce(band.name.toUpperCase(),
                    `${player.ty}m   ${band.heat > 6 ? 'runs hot' : band.heat < 0 ? 'runs cold' : ''}`.trim());
    }
    state.band = band;
  }

  // Teach each mechanic the first time it bites, once per save.
  let taught = false;
  if (player.heat > 45) taught = tips.show('heat') || taught;
  if (player.fuel <= 0) taught = tips.show('dry') || taught;
  if (player.drillTarget && hazardAt.has(player.drillTarget.y * W + player.drillTarget.x)
      && player.drillProgress > 0.7 * world.hardness(player.drillTarget.x, player.drillTarget.y)) {
    taught = tips.show('hazard') || taught;
  }
  if (player.ty > CORE_TOP && guardianAlive()) taught = tips.show('guardian') || taught;
  if (taught) store(save);

  const lowFuel = player.fuel > 0 && player.fuel < player.stats.maxFuel * 0.22;
  if (player.heat >= 100) {
    state.heatWarn = (state.heatWarn || 0) - dt;
    if (state.heatWarn <= 0) { audio.redline(); state.heatWarn = 0.7; }
  }

  if (lowFuel && tips.show('fuel')) store(save);
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
  floaters.update(dt);
  tips.update(dt);

  // camera trails the drill, clamped to the world
  const targetX = player.px + TILE / 2 - CW / 2;
  const targetY = player.py + TILE / 2 - (CH + VIEW_TOP) / 2;
  // Exponential smoothing done frame-rate independently. The old form moved a
  // fixed fraction per frame, so the camera lagged differently at 30fps than at
  // 60 and jittered whenever a frame ran long.
  const follow = 1 - Math.exp(-9 * dt);
  cam.x += (targetX - cam.x) * follow;
  cam.y += (targetY - cam.y) * follow;
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
  floaters.draw(ctx, cam);
  ctx.restore();

  drawHud(ctx, player, state, CW, audio.muted, STRATA, CORE_TOP + 7, diff);
  tips.draw(ctx, CW, CH);

  if (!state.over && player.ty > CORE_TOP) {
    const socket = nearestSocket();
    let hint = null;
    const pad = input.hasGamepad();
    // "Blocked" told the player they were stuck without telling them the way
    // out, and the drill has no weapon to make ramming obvious.
    if (guardianAlive()) {
      const g = aliens.find((a) => a.boss);
      hint = g && g.phase === 'exposed' ? 'THE GUARDIAN IS OPEN - RAM IT NOW'
           : g && g.phase === 'windup' ? 'GET CLEAR'
           : 'WAIT FOR THE GUARDIAN TO OPEN UP';
    }
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
