// Alien Digger - playable vertical slice.
// Drill to the core, plant three charges, then climb out before they blow.

import { loadAssets } from './assets.js';
import { createInput } from './input.js';
import { TILE, W, D, CORE_TOP, EMPTY, STRATA, World, rng, strataAt } from './world.js';
import { createPlayer, updatePlayer, damage, cargoUsed, cargoRoom, stowOre, dumpOre } from './player.js';
import { populate, updateAliens, updateHazards, updatePickups, ramAliens, applyHazard, applyPickup, collectOre, runTremor, TREMOR, COIL_TIME, lavaLevel, lavaBurn, LAVA, leechSteal, dropLoot, splitBrood, hazardArmed, DEATH_OF, staggerOf, SCORCH_FOR, guardRage, guardReach, guardPhaseTime } from './entities.js';
import { updateLaser, laserReady, LASER } from './laser.js';
import { createFx } from './fx.js';
import { createFloaters } from './floaters.js';
import { drawHud, drawBanner } from './hud.js';
import { createTitle } from './title.js';
import { createFoundry } from './foundry.js';
import { createHelp } from './help.js';
import { createTips } from './tips.js';
import { load, store, statsFor, valueOf, difficultyFor, offeredPlanets } from './progress.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const CW = canvas.width, CH = canvas.height;
const VIEW_TOP = 63;                 // HUD height
const SCANNER = 7;                   // tiles: how far buried caches read through rock

ctx.imageSmoothingEnabled = false;

// Devices without a real keyboard get the on-screen pad.
// ?touch forces the touch layout on a desktop, which is the only way to see it
// without a phone in hand -- tools/mobile.html leans on this.
const COARSE = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
            || new URLSearchParams(location.search).has('touch');
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
const ORE_NAMES = ['Cu', 'Ir', 'Vd', 'Am', 'Pc'];
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
// ?dev skips the title, and the title is where the audio context is woken from
// its first gesture -- so a dev session was silent for its whole life, which is
// a poor way to work on sound.
if (screen === 'playing') {
  const wake = () => audio.resume();
  addEventListener('pointerdown', wake, { once: true });
  addEventListener('keydown', wake, { once: true });
}

let world, player, aliens, hazards, pickups, props, state, cam, hazardAt, diff;
// Terrain cache state. Declared up here because reset() runs at module load and
// invalidates the cache, which would hit the temporal dead zone otherwise.
let cacheOX = null, cacheOY = null;

function reset(seed = Date.now() & 0xffff) {
  diff = difficultyFor(save.cracked, save.planet);
  world = new World(seed, diff.hardness, diff.mods);
  const rand = rng(seed ^ 0x9e37);
  player = createPlayer(save.levels);
  ({ aliens, hazards, pickups, props } = populate(world, rand, diff.density, diff.mods));
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
    wreck: false, overT: 0, deepest: 0,
    over: null,           // 'dead' | 'won' | 'boom'
    banked: 0,           // set once when the run ends
  };
}
reset();

// ---------------------------------------------------------------- rendering

// Depths at which the parallax strip changes. The change used to be a hard cut
// on a single frame, which is the one moment the background ever drew attention
// to itself, so the strips now cross-fade over the tiles either side.
const BG_BANDS = [24, 110, 172];
const BG_FADE = 14;        // tiles of overlap between two strips

function bgLayers(depth) {
  const list = assets.backgrounds;
  let i = 0;
  while (i < BG_BANDS.length && depth >= BG_BANDS[i]) i++;
  const next = BG_BANDS[i];
  if (next !== undefined && depth > next - BG_FADE) {
    return {
      a: assets.bg[list[i]],
      b: assets.bg[list[i + 1]],
      t: (depth - (next - BG_FADE)) / BG_FADE,
    };
  }
  return { a: assets.bg[list[i]], b: null, t: 0 };
}

// The strip is drawn taller than the viewport and panned down across the whole
// descent, so the background slides against the terrain instead of sitting dead
// still. It is a straight map from depth rather than a wrapped offset: a wrap
// would snap back to the top at the seam, which is exactly the artefact
// parallax is supposed to hide.
function drawStrip(img, alpha) {
  if (!img) return;
  const vh = CH - VIEW_TOP;
  const scale = (vh * 1.3) / img.height;
  const w = img.width * scale, h = img.height * scale;
  const drift = Math.max(0, h - vh);
  const y = VIEW_TOP - drift * Math.max(0, Math.min(1, player.ty / D));
  const offset = -((cam.x * 0.35) % w);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let x = offset - w; x < CW; x += w) {
    ctx.drawImage(img, Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
  }
  ctx.restore();
}

function drawBackground() {
  const { a, b, t } = bgLayers(player.ty);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEW_TOP, CW, CH - VIEW_TOP);
  ctx.clip();
  drawStrip(a, 1);
  if (b && t > 0) drawStrip(b, Math.min(1, t));
  ctx.restore();
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

// ------------------------------------------------------------------ scenery
// One decoration row per stratum, so a cavern looks like the ground it was cut
// out of: roots near the surface, fossils in sandstone, abandoned kit in the
// rock, stalactites in the ice, fungus in the fungal caverns, shards and
// obelisks in the crystal, scorched vents in the magma.
//
// This is render-only. It is painted into the terrain cache and never consulted
// by collision, movement or spawning -- decoration that could block a shaft
// would be a hazard wearing scenery's clothes.
const DECOR = [
  { row: 'roots' },
  { row: 'scrap' },
  { row: 'fossil' },
  { row: 'mining' },
  { row: 'stalactite', hang: true },
  { row: 'mushroom', alt: 'spore' },
  { row: 'crystalform', alt: 'obelisk' },
  { row: 'ventrock' },
];
// Percent of open tiles that roll for scenery. Most of them then fail the
// anchor test -- caves are blobby and only their floors and walls touch rock --
// so the number that actually land is far lower: measured at 69 pieces a world,
// about 13% of open tiles. At the first value of 11 it was 11 pieces in a whole
// planet, which is not decoration, it is a rumour of decoration.
const DECOR_PCT = 38;

// Deterministic per tile, so nothing has to be stored and a dirty repaint of a
// single tile reproduces exactly what was there before.
function decorHash(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

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

        // Ore lying on open ground: what a full bay could not take, or what was
        // dumped on purpose. Drawn from the refined-gem row rather than the
        // ore-in-rock row, so a pile you can drive over never looks like a vein
        // you still have to cut -- and it rides the terrain cache, so a stash
        // left at 170m costs nothing to keep on screen for the climb back.
        // Scenery goes down first so loose ore, drawn below, sits on top of it
        // -- a stash must never end up hidden behind a mushroom.
        const h = decorHash(x, y);
        if (h % 100 < DECOR_PCT && world.ore[i] < 0) {
          const set = DECOR[strataAt(y).row];
          // Anchored to real rock, so nothing floats in mid-cave: stalactites
          // want a ceiling, everything else a floor -- or failing that a side
          // wall to stand against, which is what most cave tiles actually touch
          // and without which the scenery only ever lined cave floors.
          const anchored = set && (set.hang
            ? world.solid(x, y - 1)
            : world.solid(x, y + 1) || world.solid(x - 1, y) || world.solid(x + 1, y));
          if (anchored) {
            const frames = assets.anim.decor?.[set.alt && (h & 8) ? set.alt : set.row];
            const img = frames && frames[(h >>> 8) % frames.length];
            if (img) {
              const k = Math.min(TILE / img.width, TILE / img.height);
              const dw = Math.round(img.width * k), dh = Math.round(img.height * k);
              tctx.drawImage(img, sx + ((TILE - dw) >> 1),
                             set.hang ? sy : sy + TILE - dh, dw, dh);
            }
          }
        }

        const loose = world.ore[i];
        if (loose >= 0) {
          const gem = assets.anim.minerals.gem?.[loose];
          if (gem) tctx.drawImage(gem, sx + 7, sy + 7, TILE - 14, TILE - 14);
          const n = world.oreCount[i];
          if (n > 1) {
            tctx.font = 'bold 9px ui-monospace, monospace';
            tctx.fillStyle = 'rgba(8,5,16,0.85)';
            tctx.fillText(`x${n}`, sx + TILE - 17, sy + TILE - 3);
            tctx.fillStyle = ORE_TINT[loose];
            tctx.fillText(`x${n}`, sx + TILE - 18, sy + TILE - 4);
          }
        }
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

// The planet closing in. Built once into an offscreen canvas and blitted with a
// varying alpha, rather than allocating a radial gradient every frame -- the
// same reason the depth light is cached.
const vignette = document.createElement('canvas');
{
  const vh = CH - VIEW_TOP;
  vignette.width = CW;
  vignette.height = vh;
  const vc = vignette.getContext('2d');
  const g = vc.createRadialGradient(CW / 2, vh / 2, Math.min(CW, vh) * 0.28,
                                    CW / 2, vh / 2, Math.max(CW, vh) * 0.72);
  g.addColorStop(0, 'rgba(120,10,4,0)');
  g.addColorStop(0.55, 'rgba(120,10,4,0.30)');
  g.addColorStop(1, 'rgba(150,20,6,0.85)');
  vc.fillStyle = g;
  vc.fillRect(0, 0, CW, vh);
}

// The flood itself. The body is painted rather than tiled from art: a sprite
// stretched across the full width would have to tile seamlessly at every zoom,
// and a flat fill of the sheet's own colours is both exact and free. The art
// does the part art is good at -- the churning crest along the top, the crust
// riding on it, and the bubbles.
function drawLava() {
  const level = state.lava;
  if (!state.escaping || level == null || level > D + 1) return;
  const top = Math.round(level * TILE - cam.y);
  if (top > CH) return;                       // still below the view
  const lo = Math.max(VIEW_TOP, top);

  // Body: flat bands, hot at the surface and falling away fast to near-black.
  // Two bands was not enough -- it put a slab of bright orange across the whole
  // lower screen, which read as a wall of paint rather than as depth, and it
  // out-shouted the drill. The heat belongs at the waterline, which is the only
  // part the player is actually judging.
  ctx.fillStyle = '#e0541f';
  ctx.fillRect(0, lo, CW, CH - lo);
  ctx.fillStyle = '#9c2410';
  ctx.fillRect(0, Math.min(CH, lo + TILE * 1.2), CW, CH);
  ctx.fillStyle = '#5c1408';
  ctx.fillRect(0, Math.min(CH, lo + TILE * 2.6), CW, CH);
  ctx.fillStyle = '#2e0a04';
  ctx.fillRect(0, Math.min(CH, lo + TILE * 4.5), CW, CH);

  // Crest and crust along the surface, picked per column so the line churns
  // instead of repeating one tile across the screen.
  const crest = assets.anim.lava?.crest;
  const crust = assets.anim.lava?.crust;
  if (crest && crest.length && top > VIEW_TOP - TILE) {
    const x0 = Math.floor(cam.x / TILE) - 1;
    for (let i = 0; i <= Math.ceil(CW / TILE) + 1; i++) {
      const tx = x0 + i;
      const sx = Math.round(tx * TILE - cam.x);
      const h = decorHash(tx, Math.floor(level));
      const img = (h & 4) && crust && crust.length
        ? crust[(h >>> 5) % crust.length]
        : crest[(h >>> 3) % crest.length];
      if (img) ctx.drawImage(img, sx, top - TILE, TILE, TILE);
    }
  }

  // A hot rim right on the waterline, so the edge reads even in the dark.
  ctx.fillStyle = '#ffd089';
  ctx.fillRect(0, top - 1, CW, 2);
}

// Drawn over the darkness and under the HUD. The escape had a number counting
// down and a beep; the shaft itself looked exactly like the descent did, which
// is a strange way to render a planet coming apart.
function drawCollapse() {
  const panic = state.panic || 0;
  if (!state.escaping || panic <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(0.75, panic * panic * 0.85);
  ctx.drawImage(vignette, 0, VIEW_TOP);
  ctx.restore();
}

// Short cycles ping-pong rather than wrapping. A three-frame walk played
// 0,1,2,0,1,2 snaps hard on the wrap, which is most of why these read as choppy;
// 0,1,2,1 turns the same three frames into a smooth there-and-back. Two-frame
// cycles are already symmetric, so they just alternate.
// The Guardian's core is described as blazing when it opens, and the core
// chamber is the darkest place in the game, so it should light the room. Drawn
// after the darkness rather than before it, so the glow punches through -- and
// it doubles as the clearest possible tell that the boss is open.
function drawBossGlow() {
  const g = aliens.find((a) => a.boss && a.hp > 0);
  if (!g) return;
  const open = g.phase === 'exposed' ? 1 : g.phase === 'opening' ? 0.45 : 0.12;
  if (open <= 0.12 && g.phase !== 'windup') {
    if (g.phase !== 'armoured') return;
  }
  const pulse = 0.82 + Math.sin(state.time * 7) * 0.18;
  const r = TILE * (g.phase === 'windup' ? 2.2 : 3.4) * (0.6 + open * 0.4);
  const cx = Math.round(g.px + TILE / 2 - cam.x);
  const cy = Math.round(g.py + TILE / 2 - cam.y);

  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  const warm = g.phase === 'windup' ? '255,70,40' : '255,168,70';
  grd.addColorStop(0, `rgba(${warm},${(0.5 * open * pulse).toFixed(3)})`);
  grd.addColorStop(0.5, `rgba(${warm},${(0.22 * open * pulse).toFixed(3)})`);
  grd.addColorStop(1, `rgba(${warm},0)`);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grd;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function frameOf(frames, t, fps = 8) {
  if (!frames || !frames.length) return null;
  const n = frames.length;
  if (n < 3) return frames[Math.floor(t * fps) % n];
  const span = (n - 1) * 2;
  const i = Math.floor(t * fps) % span;
  return frames[i < n ? i : span - i];
}

function drawSprite(img, px, py, box, flip = false) {
  if (!img) return;
  const scale = box / Math.max(img.width, img.height);
  const w = img.width * scale, h = img.height * scale;
  const x = Math.round(px - cam.x + (TILE - w) / 2);
  const y = Math.round(py - cam.y + (TILE - h));
  if (!flip) {
    ctx.drawImage(img, x, y, Math.round(w), Math.round(h));
    return;
  }
  // Mirrored about the sprite's own centre, so flipping does not shift it off
  // its tile. The sheets are all drawn facing right, same as the drill's.
  ctx.save();
  ctx.translate(x + Math.round(w) / 2, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, -Math.round(w) / 2, y, Math.round(w), Math.round(h));
  ctx.restore();
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
    // A geyser spends most of its cycle inert, and its three frames are the
    // tell: wisp, building, firing. Playing them on the hazard's own clock
    // means the sprite and the damage window are the same thing, so a player
    // can read when it is safe to cross instead of guessing.
    const frames = assets.anim.hazards[h.kind.row];
    let img;
    if (h.kind.duty && frames && frames.length >= 3) {
      const phase = (h.t % h.kind.duty) / h.kind.duty;
      img = frames[phase > 0.62 ? 2 : phase > 0.45 ? 1 : 0];
    } else {
      img = frameOf(frames, h.t, 9);
    }
    drawSprite(img, h.x * TILE, h.y * TILE, TILE);
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
    // The Guardian has art per phase now, so the state is in the sprite rather
    // than only in a coloured overlay: sealed and plated, plates splitting, core
    // wide open, fists up, fists down.
    let frames = assets.anim.aliens[a.kind.row];
    let img;
    if (a.boss && a.hp > 0) {
      const boss = assets.anim.boss;
      const set = a.phase === 'exposed' ? boss.exposed
                : a.phase === 'windup' ? boss.windup
                : a.phase === 'slam' ? boss.slam
                : a.phaseT < 0.5 ? boss.opening      // tell just before it opens
                : boss.armoured;
      img = frameOf(set, a.t, a.phase === 'slam' ? 14 : 8);
    } else {
      img = dormant ? (frames && frames[0]) : frameOf(frames, a.t, 10);
    }

    // The boss telegraphs: a ring while it winds up so the blast radius is
    // visible, and a glow while it is open and worth committing to.
    if (a.boss && a.hp > 0) {
      const cx = a.px + TILE / 2 - cam.x, cy = a.py + TILE / 2 - cam.y;
      if (a.phase === 'windup') {
        // The ring is a promise about where the slam will land, so it has to
        // grow with the reach. A hurt Guardian swings three tiles instead of
        // two, and a ring that kept drawing the old radius would be telling
        // the player they were clear when they were not.
        const rage = guardRage(a);
        const reach = guardReach(rage);
        const span = TILE * (reach + 0.5);
        // Against the windup's *current* length, not the constant -- the wind
        // up shortens as it rages, and a ring timed to the old duration would
        // still be opening when the slam already landed.
        const wind = Math.max(0.01, guardPhaseTime('windup', rage));
        const k = 1 - Math.max(0, a.phaseT) / wind;
        ctx.strokeStyle = `rgba(255,70,50,${0.35 + k * 0.5})`;
        ctx.lineWidth = reach > 2 ? 4 : 3;
        ctx.beginPath();
        ctx.arc(cx, cy, span * (0.55 + k * 0.45), 0, Math.PI * 2);
        ctx.stroke();
      } else if (a.phase === 'exposed') {
        ctx.fillStyle = `rgba(47,210,232,${0.10 + Math.sin(state.time * 9) * 0.06})`;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // A coiled lurker: the ring closes in rather than opening out, which reads
    // as something gathering itself instead of something detonating, and it is
    // the only warning the hardest-hitting alien in the game gives.
    if (a.coil > 0) {
      const k = a.coil / COIL_TIME;
      const cx = a.px + TILE / 2 - cam.x, cy = a.py + TILE / 2 - cam.y;
      ctx.strokeStyle = `rgba(255,80,60,${(0.8 - k * 0.35).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * (0.7 + k * 1.7), 0, Math.PI * 2);
      ctx.stroke();
    }

    // A venting spitter is lit from inside: it just fired, it cannot cover
    // itself, and this is the window worth crossing the tunnel for.
    if (a.vent > 0) {
      const cx = a.px + TILE / 2 - cam.x, cy = a.py + TILE / 2 - cam.y;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, TILE * 1.3);
      grd.addColorStop(0, 'rgba(127,224,74,0.42)');
      grd.addColorStop(1, 'rgba(127,224,74,0)');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = grd;
      ctx.fillRect(cx - TILE * 1.3, cy - TILE * 1.3, TILE * 2.6, TILE * 2.6);
      ctx.restore();
    }

    if (inRock) ctx.globalAlpha = 0.45;
    else if (dormant) ctx.globalAlpha = 0.7;
    // Aliens are mirrored to face the way they are moving. They never were, so
    // a crab marching left was drawn marching right -- which did not matter
    // until its shell became the side it is pointing.
    drawSprite(img, a.px, a.py, a.boss ? TILE * 3 : TILE * 1.3,
               !a.boss && a.face && a.face[0] < 0);
    ctx.globalAlpha = 1;

    // The shell, drawn as a plate on the side it actually covers. Without this
    // the armour rule is invisible and the player just sees a crab that
    // sometimes takes double damage for no reason they can name.
    if (a.kind.armor && a.face && (a.face[0] || a.face[1]) && !inRock) {
      const cx = a.px + TILE / 2 - cam.x;
      // Centred on the sprite, not the tile. drawSprite anchors a 1.3-tile box
      // to the bottom of the tile, so the body sits about a third of a tile
      // above the tile centre and a plate drawn on the centre floats off it.
      const cy = a.py + TILE * 0.35 - cam.y;
      const ang = Math.atan2(a.face[1], a.face[0]);
      ctx.save();
      ctx.strokeStyle = 'rgba(205,218,236,0.9)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(cx, cy, TILE * 0.62, ang - 0.9, ang + 0.9);
      ctx.stroke();
      ctx.restore();
    }

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
  if (state.wreck) return;              // it is scrap and smoke now
  if (p.invuln > 0 && Math.floor(state.time * 20) % 2) return;

  const facing = p.facing || 'down';
  const hurt = p.hull < p.stats.maxHull * 0.35;
  // A diagonal has both a vertical and a horizontal part. Testing the string
  // length instead was wrong in a way that only bit one heading: 'right' is
  // five characters, so driving right drew the down-right sprite.
  const diagonal = (facing.startsWith('up') || facing.startsWith('down'))
                && (facing.endsWith('left') || facing.endsWith('right'));

  // Diagonals have their own art now. They are drawn rightward and mirrored for
  // the left headings, the same trick the cardinal sheet already uses.
  let frames;
  if (diagonal) {
    const up = facing.startsWith('up');
    frames = assets.anim.diag[
      up ? (hurt ? 'upright_hurt' : 'upright') : (hurt ? 'downright_hurt' : 'downright')
    ];
  } else {
    let row = 'right';
    if (hurt) row = 'damage';
    else if (facing === 'down') row = 'down';
    else if (facing === 'up') row = 'thruster';
    frames = assets.anim.drill[row];
  }
  if (!frames || !frames.length) return;
  const img = frames[Math.floor(p.frame) % frames.length];
  if (!img) return;

  const box = TILE * 1.6;
  const scale = box / Math.max(img.width, img.height);
  const w = img.width * scale, h = img.height * scale;
  const cx = Math.round(p.px - cam.x + TILE / 2);
  const cy = Math.round(p.py - cam.y + TILE / 2);

  // The rig carries the light but was not lit itself, so against grey rock or
  // blue ice the player had to hunt for their own avatar -- obvious the moment
  // every state was laid out side by side. A small warm pool under it, tinted
  // by what it is doing: cyan idling, hot while cutting.
  const heat = Math.min(1, p.heat / 100);
  const glowR = TILE * (p.drilling ? 1.5 : 1.2);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  const tint = p.drilling ? `255,${Math.round(180 - heat * 90)},90` : '80,200,235';
  glow.addColorStop(0, `rgba(${tint},${p.drilling ? 0.4 : 0.26})`);
  glow.addColorStop(1, `rgba(${tint},0)`);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  if (facing.endsWith('left')) ctx.scale(-1, 1);
  ctx.drawImage(img, Math.round(-w / 2), Math.round(-h / 2), Math.round(w), Math.round(h));
  ctx.restore();
}

// The beam is drawn hot-white at the core with a magenta bloom, fading over
// its short life so a shot reads as a flash rather than a standing line.
function drawBeam() {
  const b = player.beam;
  if (!b || state.wreck) return;
  const k = Math.max(0, b.t / LASER.show);
  const x0 = b.x0 * TILE + TILE / 2 - cam.x, y0 = b.y0 * TILE + TILE / 2 - cam.y;
  const x1 = x0 + b.dx * b.len * TILE, y1 = y0 + b.dy * b.len * TILE;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(255,60,200,${(0.45 * k).toFixed(3)})`;
  ctx.lineWidth = 12 * k + 2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.strokeStyle = `rgba(255,235,255,${(0.95 * k).toFixed(3)})`;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
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

// Ramming and the laser both kill, and a kill pays the same either way.
function alienKilled(a) {
  // Things now come apart according to what they are made of: flesh ruptures,
  // shell shatters, a magma creature guts out to cinders, a machine arcs and
  // buckles. Before this everything in the game died as the same puff of
  // debris, which quietly undid the work of making them look different.
  const row = a.boss ? 'explosion' : (DEATH_OF[a.kind.row] || 'debris');
  fx.spawn(row, a.px + 16, a.py + 16, a.boss ? 2 : 1.25);
  // ...and leaves a mark, so a tunnel you fought through looks fought through.
  const mark = SCORCH_FOR[row];
  if (mark != null) {
    const scorch = assets.anim.react?.scorch?.[mark];
    if (scorch) fx.pop(scorch, a.px + 16, a.py + 24, 1.6, 0);
  }
  a.boss ? audio.explode() : audio.kill();
  state.shake = Math.max(state.shake, a.boss ? 1.2 : 0.35);
  // The bounty goes through the bay like everything else, so a kill cannot
  // smuggle ore past a full hold. It lands at the drill's feet rather than in
  // the alien's tile, which is always open ground -- a burrowed worm dies
  // inside rock, and ore dropped in there would be unrecoverable.
  // Anything it stole falls where it died, so a leech is a theft you can undo
  // rather than a loss you absorb -- which is what makes turning to fight one
  // a decision instead of a chore.
  const recovered = dropLoot(a, world);
  if (recovered > 0) {
    floaters.push(`+${recovered} RECOVERED`, a.px + 16, a.py, '#a77ff0');
  }
  // A broodsac is a delayed swarm. Killing it at range is the whole point.
  if (a.kind.splits) {
    const young = splitBrood(a, world);
    for (const y of young) aliens.push(y);
    if (young.length) {
      fx.spawn('acidsplash', a.px + 16, a.py + 16, 1.2);
      state.shake = Math.max(state.shake, 0.4);
    }
  }
  const tier = a.boss ? 4 : Math.min(4, Math.floor(a.y / 45));
  stowOre(player, world, tier, a.boss ? 5 : 1, player.tx, player.ty);
  // keep the ore-pop logic from mistaking the bounty for something dug
  for (let i = 0; i < player.minerals.length; i++) lastMinerals[i] = player.minerals[i];
}

function update(dt) {
  // Gamepads are polled, not evented, and this has to happen wherever the game
  // steps -- the dev harness drives update() directly and never runs the loop.
  input.poll();

  if (input.tapped('mute')) audio.toggleMute();
  // The score runs on every screen, not just during a run, so it is ticked
  // before the screen guards below return. It schedules against the audio
  // clock, so this only ever tops up a queue.
  audio.tick(dt);
  audio.musicCalm(screen !== 'playing');

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

  // Once a run is over the only way on is through the Foundry. The world stops
  // simulating, but effects and timers must not: this returned before
  // fx.update, so the wreck froze mid-explosion, and before state.time
  // advanced, so the banner that waits on it would never have appeared.
  if (state.over) {
    state.overT += dt;
    fx.update(dt);
    floaters.update(dt);
    tips.update(dt);
    state.shake = Math.max(0, state.shake - dt * 3.4);
    if (input.tapped('restart') || input.tapped('plant')) screen = 'foundry';
    return;
  }
  if (input.tapped('restart')) { reset(); return; }

  state.time += dt;
  const oreBefore = cargoUsed(player);
  updatePlayer(player, world, input, dt, playerFx);
  // Loose ore underfoot is stowed before the pop below, so picking a pile back
  // up on the climb reads exactly like cutting it out of the rock did -- same
  // gem, same floater, same chime. It is the same ore.
  collectOre(world, player);
  if (cargoUsed(player) > oreBefore) {
    // Freeing ore is the moment the run pays you, and it used to be one small
    // sparkle. Now the refined gem pops out of the rock, the value floats off
    // it, and both the size and the chime climb with the tier -- so a pulse
    // crystal reads as a find and copper reads as copper.
    for (let tier = 0; tier < player.minerals.length; tier++) {
      // Only a gain pops. Dumping drops a count, and testing for "changed"
      // would have fired the collection flourish for ore going over the side.
      if (player.minerals[tier] <= lastMinerals[tier]) continue;

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

  // ------------------------------------------------------------------- heat
  // Heat was a bar in a HUD the player is not looking at -- they are looking at
  // the bit. So the bit says it: friction sparks while it is cutting cool, an
  // orange tip past the line where the game first warns about heat, a red one
  // at the point the laser refuses to fire. Those two thresholds are reused
  // deliberately rather than invented, so the art marks the same lines the
  // rules already treat as meaningful.
  if (player.drilling && player.drillTarget) {
    state.tipT = (state.tipT || 0) - dt;
    if (state.tipT <= 0) {
      const t = player.drillTarget;
      const crit = player.heat >= LASER.lockout;
      const warm = player.heat >= 45;
      // The row names stay as literals inside the call rather than going via a
      // variable, so check.mjs can still see which rows this spawns. A typo
      // here fails silently at runtime, which is the whole reason that check
      // exists -- routing the name through a local would hide it again.
      // The cool-cutting sparks are deliberately the smallest of the three:
      // they fire four times a second for the whole descent, and at the same
      // size as the heat warnings they drowned the thing they exist to contrast
      // with. Hot and critical are bigger because they are news.
      fx.spawn(crit ? 'tipcrit' : warm ? 'tiphot' : 'friction',
               t.x * TILE + TILE / 2, t.y * TILE + TILE / 2, warm ? 0.8 : 0.42);
      state.tipT = warm ? 0.17 : 0.26;
    }
  } else if (player.heat > 30) {
    // Shedding. The ice shelf and a pause off the trigger both cool the bit,
    // and neither of them used to look like anything at all.
    state.steamT = (state.steamT || 0) - dt;
    if (state.steamT <= 0) {
      fx.spawn('steam', player.px + 16, player.py + 10, 0.6);
      state.steamT = 0.5;
    }
  }

  // ------------------------------------------------------------------ cargo
  // A full bay is the one thing in the game that turns a find into a decision,
  // so it must be impossible to miss. Three cues, because the player is looking
  // at the shaft and not at the HUD: the ore stays visibly lying in the tile it
  // came out of, the gauge flashes, and the drill says so in words.
  if (player.spilled) {
    const { tier, count } = player.spilled;
    player.spilled = null;
    floaters.push('BAY FULL', player.px + 16, player.py - 12, '#ff8c3a', 0.95);
    floaters.push(`${count} LEFT HERE`, player.px + 16, player.py + 4, ORE_TINT[tier], 0.8);
    audio.warn();
    state.bayFlash = 0.7;
    if (tips.show('cargo')) store(save);
  }
  state.bayFlash = Math.max(0, (state.bayFlash || 0) - dt);

  // Jettison the cheapest ore aboard. Holding repeats, because clearing a dozen
  // copper one press at a time to make room for a vein is busywork rather than
  // a decision -- the decision is which tier to keep, and that is made once.
  state.dumpT = Math.max(0, (state.dumpT || 0) - dt);
  state.dumpNagT = Math.max(0, (state.dumpNagT || 0) - dt);
  if (input.tapped('dump') || (input.held('dump') && state.dumpT <= 0)) {
    const out = dumpOre(player, world);
    state.dumpT = 0.14;
    if (typeof out === 'object') {
      floaters.push(`-1 ${ORE_NAMES[out.tier]}`,
                    out.x * TILE + TILE / 2, out.y * TILE, ORE_TINT[out.tier], 0.85);
      fx.spawn('dustpuff', out.x * TILE + TILE / 2, out.y * TILE + TILE / 2, 0.6);
      audio.dump();
    } else if (state.dumpNagT <= 0) {
      floaters.push(out === 'empty' ? 'BAY EMPTY' : 'NOWHERE TO DUMP',
                    player.px + 16, player.py, '#8c85a0', 0.8);
      state.dumpNagT = 0.8;
    }
  }

  audio.drill(player.drilling, player.drillTarget
    ? world.hardness(player.drillTarget.x, player.drillTarget.y) : 1);
  audio.ambience(player.ty / CORE_TOP, state.escaping);

  updateAliens(aliens, world, player, dt, (a) => {
    if (a.hp <= 0) return;
    // A leech robs the bay rather than denting the hull. It is the only enemy
    // whose damage is counted in credits, and it keeps what it takes.
    if (a.kind.steals) {
      if (player.invuln > 0) return;
      const took = leechSteal(a, player, world);
      player.invuln = 0.75;
      if (took > 0) {
        floaters.push(`-${took} ORE`, player.px + 16, player.py, '#a77ff0');
        fx.spawn('sparks', player.px + 16, player.py + 16, 0.7);
        audio.warn();
        state.shake = Math.max(state.shake, 0.3);
        if (tips.show('leech')) store(save);
      }
      return;
    }
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
    // It just opened itself up to fire at you. Say so the first time, while the
    // window is actually open.
    if (tips.show('vent')) store(save);
  }, (a, reach, radius) => {
    // the slam lands wherever you are standing when the windup ends
    fx.spawn('explosion', a.px + 16, a.py + 16, 1.4 + (radius || 2) * 0.2);
    state.shake = Math.max(state.shake, reach ? 1.1 : 0.5);
    audio.explode();
    if (reach && damage(player, a.kind.slam, fx)) {
      fx.spawn('flash', player.px + 16, player.py + 16);
      floaters.push(`-${a.kind.slam}`, player.px + 16, player.py, '#ff6b5b');
    }
  });
  // The shell tip fires on the first ram the armour actually eats, which is the
  // moment it is confusing -- the crab flashed, the bar barely moved, and
  // nothing on screen said why.
  ramAliens(aliens, player, dt, alienKilled, (a, through) => {
    if (a.kind.armor && through < 1 && tips.show('shell')) store(save);
    // A visible reaction on the thing being hit, picked by what it is made of:
    // a shell skids the hit off, flesh recoils. Rate-limited, because ramming
    // lands every frame and this would otherwise be a wall of sprites.
    a.reactT = (a.reactT || 0) - dt;
    if (a.reactT <= 0 && a.hp > 0) {
      a.reactT = 0.34;
      fx.spawn(staggerOf(a), a.px + 16, a.py + 16, 0.85);
    }
  });

  // The laser. One shot per press, gated by its own cooldown and by heat, so
  // holding or mashing the button does nothing the cooldown has not allowed.
  const shot = updateLaser(player, world, aliens, input.tapped('fire'), dt);
  if (shot === 'hot' || shot === 'cooling') {
    // Say why, but only once per refusal burst -- mashing should not spam text.
    if (!state.laserNagT || state.laserNagT <= 0) {
      floaters.push(shot === 'hot' ? 'LASER TOO HOT' : 'LASER CHARGING',
                    player.px + 16, player.py, shot === 'hot' ? '#ff8c3a' : '#8c85a0', 0.8);
      audio.warn();
      state.laserNagT = 0.8;
    }
  } else if (shot) {
    audio.laser();
    state.shake = Math.max(state.shake, 0.14);
    // Muzzle flash at the emitter, so a shot reads as leaving the drill and not
    // merely as a line that appeared.
    // The beam rows are drawn firing right, so they are rotated onto the
    // actual heading -- otherwise a shot straight down paints a sideways beam.
    const beamAng = Math.atan2(shot.dy, shot.dx);
    fx.spawn('beamfire', player.px + 16, player.py + 16, 0.9, beamAng);
    for (const h of shot.hits) {
      const a = h.alien;
      floaters.push(`-${Math.max(1, Math.round(h.dmg))}`, a.px + 16, a.py, '#ff4fd8', 0.8);
      fx.spawn('beamarmour', a.px + 16, a.py + 16, 0.8, beamAng);
      if (h.killed) alienKilled(a);
    }
    if (shot.rock) {
      const rx = shot.rock.x * TILE + 16, ry = shot.rock.y * TILE + 16;
      fx.spawn(shot.broke ? 'dustpuff' : 'beamrock', rx, ry, 0.8, shot.broke ? 0 : beamAng);
      if (shot.ore >= 0 && shot.kept > 0) {
        fx.pop(assets.anim.minerals.gem?.[shot.ore], rx, ry, 0.55 + shot.ore * 0.09, 22 + shot.ore * 7);
        floaters.push(`+${Math.round((shot.ore + 1) * 10 * player.stats.cargoMult * diff.payout)}`,
                      rx, ry - 16, ORE_TINT[shot.ore], 1 + shot.ore * 0.22);
        audio.ore(shot.ore);
        lastMinerals[shot.ore] = player.minerals[shot.ore];
      }
    }
  }
  state.laserNagT = Math.max(0, (state.laserNagT || 0) - dt);

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
  }, (h) => {
    // The magnet drags the drill onto its own tile from one step away, where
    // it then shocks you like any other hazard. It is the only hazard that
    // closes the distance, so a corridor past one is timed rather than walked.
    if (player.moving || player.dead) return;
    player.tx = h.x; player.ty = h.y;
    player.px = h.x * TILE; player.py = h.y * TILE;
    fx.spawn('sparks', player.px + 16, player.py + 16, 0.9);
    floaters.push('PULLED', player.px + 16, player.py, '#39d7e8');
    audio.warn();
    state.shake = Math.max(state.shake, 0.45);
    if (tips.show('magnet')) store(save);
  });

  updatePickups(pickups, player, (u) => {
    const kind = applyPickup(u, player);
    fx.spawn(kind === 'coolant' ? 'steam' : 'sparkle', player.px + 16, player.py + 16);
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
    // How far through the escape window we are, 0 to 1. Everything about the
    // collapse leans on this, so the planet is visibly losing its fight with
    // itself rather than ticking down a number.
    const panic = Math.max(0, Math.min(1, 1 - state.escapeLeft / diff.escape));
    state.panic = panic;   // the renderer leans on this too

    // The flood. Pinned to the same clock as the countdown, so it reaches the
    // surface exactly as the timer expires -- it cannot lose a run the clock
    // would have won, it just makes the deadline something you can see coming
    // up the shaft behind you.
    state.lava = lavaLevel(state.escapeLeft, diff.escape);
    const burned = lavaBurn(player, state.lava, dt);
    if (burned > 0) {
      state.shake = Math.max(state.shake, 0.5);
      state.lavaHurtT = (state.lavaHurtT || 0) - dt;
      if (state.lavaHurtT <= 0) {
        state.lavaHurtT = 0.28;
        floaters.push('BURNING', player.px + 16, player.py, '#ff8c3a');
        fx.spawn('magmaburst', player.px + 16, player.py + 16, 1.1);
        audio.hurt();
      }
    }
    // Bubbles and embers along the surface, only where it is actually on
    // screen. A flat fill reads as a wall of paint; it is the things breaking
    // out of it that make it read as molten.
    const onScreen = state.lava * TILE - cam.y;
    if (onScreen > VIEW_TOP - TILE && onScreen < CH + TILE) {
      state.boilT = (state.boilT || 0) - dt;
      if (state.boilT <= 0) {
        state.boilT = 0.16 + Math.random() * 0.2;
        const bx = cam.x + Math.random() * CW;
        // Just *above* the waterline. Effects draw before the flood does, so
        // anything spawned inside the body is painted straight over -- and
        // breaking out of the surface is what they should look like anyway.
        fx.spawn(Math.random() < 0.55 ? 'bubble' : 'ember',
                 bx, state.lava * TILE - TILE * 0.45, 0.8);
      }
    }

    // It announces itself before it arrives: the bubbling is audible and the
    // surface is lit from below well before it is a problem.
    const gap = state.lava - player.ty;
    if (gap > 0 && gap < LAVA.warn) {
      state.lavaNear = (state.lavaNear || 0) - dt;
      if (state.lavaNear <= 0) {
        state.lavaNear = 1.0;
        audio.rumble();
        if (tips.show('lava')) store(save);
      }
    }

    state.tremor -= dt;
    if (state.tremor <= 0) {
      state.tremor = TREMOR.gap(panic) + Math.random() * TREMOR.jitter(panic);
      const dropped = runTremor(world, player, panic, Math.random, (x, y) => {
        fx.spawn('dustpuff', x * TILE + 16, y * TILE + 16);
      });
      if (dropped) {
        state.shake = Math.max(state.shake, 0.5 + panic * 0.55);
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
    fx.spawn('sputter', player.px + 16, player.py + 16);
    audio.warn();
  }

  if (player.dead && !state.wreck) {
    // The drill simply stopped existing before: no blast, no wreck, the banner
    // just appeared over a rig sitting perfectly intact in its own shaft.
    state.wreck = true;
    const cx = player.px + TILE / 2, cy = player.py + TILE / 2;
    fx.spawn('explosion', cx, cy, 2.2);
    fx.spawn('debris', cx, cy, 1.6);
    for (let i = 0; i < 3; i++) {
      fx.spawn('smoke', cx + (Math.random() - 0.5) * 30, cy - i * 10, 1 + i * 0.3);
    }
    state.shake = 1.4;
    audio.explode();
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

    // A run that ends badly still leaves a mark. Without this the only trace of
    // a deep run that died at 180m was the credits it salvaged, which says
    // nothing about how close it came.
    // A save written before bests existed has no `best`, and a missing field
    // should not take down the end of a run.
    if (!save.best) save.best = { depth: 0, haul: 0 };
    const deepest = Math.max(player.ty, state.deepest || 0);
    const beatDepth = deepest > save.best.depth;
    const beatHaul = state.banked > save.best.haul;
    if (beatDepth) save.best.depth = deepest;
    if (beatHaul) save.best.haul = state.banked;
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
      deepest,
      beatDepth,
      beatHaul,
    };
  }

  state.deepest = Math.max(state.deepest || 0, player.ty);

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
  drawBeam();
  fx.draw(ctx, cam);
  drawLight();
  drawBossGlow();
  // After the darkness, so the flood lights the shaft rather than being dimmed
  // by it -- the one thing down there that should be impossible to miss.
  drawLava();
  drawCollapse();
  floaters.draw(ctx, cam);
  ctx.restore();

  drawHud(ctx, player, state, CW, audio.muted, STRATA, CORE_TOP + 7, diff,
          { cd: player.laserCd || 0, max: LASER.cooldown, ready: laserReady(player),
            hot: player.heat >= LASER.lockout });
  tips.draw(ctx, CW, CH);

  if (!state.over && player.ty > CORE_TOP) {
    const socket = nearestSocket();
    let hint = null;
    const pad = input.hasGamepad();
    // "Blocked" told the player they were stuck without telling them the way
    // out, and the drill has no weapon to make ramming obvious.
    if (guardianAlive()) {
      const g = aliens.find((a) => a.boss);
      hint = g && g.phase === 'exposed' ? 'THE GUARDIAN IS OPEN - RAM OR BLAST IT NOW'
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

  // Hold the banner back so the wreck is visible first. It lands across the
  // middle of the screen, which is exactly where the drill is, so it was
  // covering the explosion it was announcing.
  if (state.over && state.overT > 0.85) {
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
