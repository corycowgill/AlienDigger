// Floating numbers. Small, short-lived, and the only job is to answer "did that
// do anything" without making the player read the HUD mid-fight.
//
// The boss health bar came from a player driving into the Guardian and not
// being able to tell whether they were hurting it. The same gap is everywhere
// else in the game at a smaller scale: ore collected, hull lost, fuel eaten.

const LIFE = 0.9;
const RISE = 34;          // pixels travelled over its life

export function createFloaters() {
  const live = [];

  return {
    push(text, x, y, color, scale = 1) {
      // nudge each one sideways so a burst does not stack into an unreadable pile
      live.push({ text, x: x + (Math.random() - 0.5) * 10, y, color, t: 0, scale });
      if (live.length > 40) live.shift();
    },

    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        live[i].t += dt;
        if (live[i].t >= LIFE) live.splice(i, 1);
      }
    },

    draw(ctx, cam) {
      if (!live.length) return;
      ctx.save();
      ctx.textAlign = 'center';
      for (const f of live) {
        const k = f.t / LIFE;
        ctx.font = `bold ${Math.round(12 * (f.scale || 1))}px ui-monospace, monospace`;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        const x = Math.round(f.x - cam.x);
        const y = Math.round(f.y - cam.y - k * RISE);
        ctx.fillStyle = 'rgba(8,5,16,0.8)';
        ctx.fillText(f.text, x + 1, y + 1);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, x, y);
      }
      ctx.restore();
    },

    clear() { live.length = 0; },
  };
}
