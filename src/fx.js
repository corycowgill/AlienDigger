// One-shot animated effects drawn from the generated FX sheet.

const RATE = 14;   // frames per second

export function createFx(assets) {
  const live = [];

  // Rows come from the fx sheet, plus the minerals sheet's sparkle, which was
  // authored as a twinkle for exactly this and lives on the wrong sheet to be
  // found by name. spawn() returns silently on an unknown row, so every
  // fx.spawn('sparkle') in the game had been a no-op without ever erroring.
  const rows = Object.assign(Object.create(null), assets.anim.fx,
                             { sparkle: assets.anim.minerals.sparkle });
  const pops = [];

  return {
    // A single sprite that leaps, spins up in scale and fades -- used for the
    // refined gem that pops out of a tile when you free the ore, which is the
    // moment the run pays you and it was passing almost unnoticed.
    pop(img, x, y, life = 0.7, rise = 26) {
      if (img) pops.push({ img, x, y, t: 0, life, rise });
    },

    spawn(row, x, y, scale = 1) {
      const frames = rows[row];
      if (!frames) return;
      live.push({ frames, x, y, t: 0, scale });
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        live[i].t += dt;
        if (live[i].t * RATE >= live[i].frames.length) live.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t >= pops[i].life) pops.splice(i, 1);
      }
    },
    draw(ctx, cam) {
      for (const p of pops) {
        const k = p.t / p.life;
        // overshoot then settle, so it reads as a pop rather than a drift
        const scale = 0.5 + Math.sin(Math.min(1, k * 1.7) * Math.PI * 0.5) * 0.9;
        const w = p.img.width * scale, h = p.img.height * scale;
        ctx.save();
        ctx.globalAlpha = k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45;
        ctx.drawImage(p.img,
          Math.round(p.x - cam.x - w / 2),
          Math.round(p.y - cam.y - h / 2 - k * p.rise),
          Math.round(w), Math.round(h));
        ctx.restore();
      }
      for (const e of live) {
        const img = e.frames[Math.floor(e.t * RATE)];
        if (!img) continue;
        const w = img.width * e.scale, h = img.height * e.scale;
        ctx.drawImage(img, Math.round(e.x - cam.x - w / 2),
                           Math.round(e.y - cam.y - h / 2), w, h);
      }
    },
    clear() { live.length = 0; pops.length = 0; },
  };
}
