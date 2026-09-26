// One-shot animated effects drawn from the generated FX sheet.

const RATE = 14;   // frames per second

export function createFx(assets) {
  const live = [];
  return {
    spawn(row, x, y, scale = 1) {
      const frames = assets.anim.fx[row];
      if (!frames) return;
      live.push({ frames, x, y, t: 0, scale });
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        live[i].t += dt;
        if (live[i].t * RATE >= live[i].frames.length) live.splice(i, 1);
      }
    },
    draw(ctx, cam) {
      for (const e of live) {
        const img = e.frames[Math.floor(e.t * RATE)];
        if (!img) continue;
        const w = img.width * e.scale, h = img.height * e.scale;
        ctx.drawImage(img, Math.round(e.x - cam.x - w / 2),
                           Math.round(e.y - cam.y - h / 2), w, h);
      }
    },
    clear() { live.length = 0; },
  };
}
