// First-time hints. Each fires once per save, the moment the thing it explains
// is actually happening, then never again.
//
// The help screen covers all of this, but a player who never opens it currently
// learns that heat exists by dying of it. These teach in place and get out of
// the way -- they are not a tutorial and nothing waits for input.

const LIFE = 5.0;
const FADE = 0.8;

export const TIPS = {
  heat: 'HEAT BUILDS WHILE YOU CUT — STOP DRILLING AND IT SHEDS FAST',
  fuel: 'FUEL IS RUNNING LOW — CACHES ARE BURIED IN THE ROCK NEARBY',
  hazard: 'RED MEANS SOMETHING IS BURIED IN THAT TILE — BREAK IN OR GO ROUND',
  vein: 'ORE RUNS IN VEINS — THE RICH ONES SIT DEEP AND COME GUARDED',
  dry: 'THE TANK IS EMPTY — THE RIG IS BURNING HULL TO KEEP CUTTING',
  guardian: 'WATCH THE BAR — RAM IT WHEN IT IS OPEN, CLEAR THE RING ON A SLAM',
};

const BANNER_LIFE = 2.6;

export function createTips(save) {
  // taught is part of the save, so a hint survives the run that triggered it
  if (!save.taught) save.taught = {};
  let current = null;
  let banner = null;

  return {
    // returns true if it fired, so the caller knows to persist the save
    show(key) {
      if (save.taught[key] || !TIPS[key]) return false;
      save.taught[key] = 1;
      current = { text: TIPS[key], t: 0 };
      return true;
    },

    // Not gated by the save: this fires every time, because it is telling you
    // where you are rather than teaching you something once.
    announce(text, sub) {
      banner = { text, sub, t: 0 };
    },

    update(dt) {
      if (banner) {
        banner.t += dt;
        if (banner.t >= BANNER_LIFE) banner = null;
      }
      if (!current) return;
      current.t += dt;
      if (current.t >= LIFE) current = null;
    },

    clear() { current = null; banner = null; },

    draw(ctx, cw, ch) {
      if (banner) {
        const k = banner.t / BANNER_LIFE;
        const a = k < 0.15 ? k / 0.15 : k > 0.72 ? (1 - k) / 0.28 : 1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(8,5,16,0.55)';
        ctx.fillRect(0, ch * 0.30, cw, 48);
        ctx.fillStyle = '#d7d2e0';
        ctx.font = 'bold 20px ui-monospace, monospace';
        ctx.fillText(banner.text, cw / 2, ch * 0.30 + 24);
        if (banner.sub) {
          ctx.fillStyle = '#8c85a0';
          ctx.font = '11px ui-monospace, monospace';
          ctx.fillText(banner.sub, cw / 2, ch * 0.30 + 40);
        }
        ctx.restore();
        ctx.textAlign = 'left';
      }

      if (!current) return;
      const k = current.t;
      const alpha = k < FADE ? k / FADE
                  : k > LIFE - FADE ? (LIFE - k) / FADE : 1;

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const w = Math.min(cw - 40, ctx.measureText(current.text).width + 36);
      const x = (cw - w) / 2, y = ch - 84;

      ctx.fillStyle = 'rgba(10,6,20,0.92)';
      ctx.fillRect(x, y, w, 28);
      ctx.strokeStyle = '#2fd2e8';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 27);
      ctx.fillStyle = '#d7d2e0';
      ctx.fillText(current.text, cw / 2, y + 18);
      ctx.restore();
      ctx.textAlign = 'left';
    },
  };
}
