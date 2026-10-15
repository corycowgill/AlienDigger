// Ambient particles, one character per stratum.
//
// Every layer was a texture you drilled through rather than a place you were
// in: the magma chamber and the topsoil had exactly the same still air. These
// are the cheapest possible fix -- a few dozen single-pixel-ish specks drifting
// in world space, tinted and moving the way that layer should. Embers climb out
// of magma, spores rise through the fungal caverns, frost falls through the ice
// shelf, dust hangs in the dirt. Ice counts as lit rather than dust: frost
// catching the drill's lamp is both the physical answer and the readable one,
// since the shelf is deep enough that unlit specks vanish into the dark.
//
// Deliberately not an FX system: there is no spawn event, nothing to animate
// and nothing to key off. It is a fixed pool recycled forever, so it allocates
// nothing per frame and costs the same at 200m as at 2m.

import { TILE, D, strataAt } from './world.js';

// rise is pixels per second upward; negative falls. drift is horizontal sway.
// `n` is how many of the pool this stratum keeps alive, so the busy layers are
// busy and the quiet ones stay quiet.
// `glow` decides which side of the depth darkness a speck is drawn on. Dust is
// lit by the drill's lamp and dims with everything else; an ember, a spore and
// a crystal glint make their own light, so they punch through. Drawing them all
// under the darkness made the magma chamber -- the one place most in need of
// atmosphere -- look exactly as still as before, because 0.34 alpha under an
// 0.82 black is nothing at all.
const KIND = [
  { color: '180,150,105', rise: -9,  drift: 5,  size: 2, n: 14, twinkle: 0,    glow: false }, // topsoil
  { color: '164,124,80',  rise: -11, drift: 6,  size: 2, n: 16, twinkle: 0,    glow: false }, // dirt
  { color: '206,180,130', rise: -7,  drift: 15, size: 2, n: 20, twinkle: 0,    glow: false }, // sandstone
  { color: '150,152,162', rise: -8,  drift: 4,  size: 2, n: 14, twinkle: 0,    glow: false }, // rock
  { color: '198,232,248', rise: -16, drift: 9,  size: 2, n: 26, twinkle: 0.35, glow: true },  // ice
  { color: '92,222,186',  rise: 15,  drift: 7,  size: 3, n: 26, twinkle: 0.5,  glow: true },  // fungal
  { color: '150,214,240', rise: 3,   drift: 3,  size: 2, n: 22, twinkle: 0.9,  glow: true },  // crystal
  { color: '255,154,60',  rise: 27,  drift: 8,  size: 2, n: 30, twinkle: 0.35, glow: true },  // magma
];

const POOL = 32;          // the most any stratum asks for, allocated once

export function createMotes(viewW, viewH) {
  // x,y are world pixels. Phase keeps each speck's twinkle out of lockstep,
  // or the whole field blinks together like a fault rather than an atmosphere.
  const p = Array.from({ length: POOL }, () => ({
    x: 0, y: 0, vx: 0, vy: 0, phase: Math.random() * Math.PI * 2, seeded: false,
  }));

  // Drop a speck somewhere in view, or just outside the edge it drifts in from,
  // so recycled ones arrive rather than popping into the middle of the screen.
  function place(m, cam, kind, fresh) {
    m.x = cam.x + Math.random() * viewW;
    if (fresh) {
      m.y = cam.y + Math.random() * viewH;
    } else {
      m.y = kind.rise > 0 ? cam.y + viewH + 8 : cam.y - 8;
    }
    m.vx = (Math.random() - 0.5) * kind.drift;
    m.vy = -kind.rise * (0.6 + Math.random() * 0.8);
    m.phase = Math.random() * Math.PI * 2;
    m.seeded = true;
  }

  return {
    // Called on reset, so a new planet does not inherit the last one's air.
    clear() { for (const m of p) m.seeded = false; },

    update(dt, cam, depth) {
      const kind = KIND[strataAt(Math.max(0, Math.min(D - 1, depth))).row] || KIND[0];
      for (let i = 0; i < POOL; i++) {
        const m = p[i];
        if (i >= kind.n) { m.seeded = false; continue; }
        if (!m.seeded) { place(m, cam, kind, true); continue; }
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        // Recycle once it leaves the view in any direction. The margin is
        // generous so a speck never winks out on screen.
        if (m.y < cam.y - 24 || m.y > cam.y + viewH + 24
            || m.x < cam.x - 24 || m.x > cam.x + viewW + 24) {
          place(m, cam, kind, false);
        }
      }
    },

    // `wantGlow` selects which half to draw, so main.js can call this once
    // under the darkness and once over it.
    draw(ctx, cam, depth, top, wantGlow) {
      const kind = KIND[strataAt(Math.max(0, Math.min(D - 1, depth))).row] || KIND[0];
      if (!!kind.glow !== !!wantGlow) return;
      ctx.save();
      if (kind.glow) ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < POOL && i < kind.n; i++) {
        const m = p[i];
        if (!m.seeded) continue;
        const sy = Math.round(m.y - cam.y);
        if (sy < top) continue;              // never over the HUD
        // Twinkle is a sine on the speck's own phase, so a crystal field
        // glitters and a dust field just hangs there.
        // Dust sits under the depth darkness, which multiplies it down hard --
        // 0.34 under an 0.57 black at the ice shelf was invisible. The lit
        // kinds can stay fainter because nothing dims them.
        const a = kind.twinkle
          ? (kind.glow ? 0.22 : 0.4) + 0.45 * (0.5 + 0.5 * Math.sin(m.phase + m.y * 0.04))
          : 0.5;
        ctx.fillStyle = `rgba(${kind.color},${a.toFixed(2)})`;
        ctx.fillRect(Math.round(m.x - cam.x), sy, kind.size, kind.size);
      }
      ctx.restore();
    },
  };
}
