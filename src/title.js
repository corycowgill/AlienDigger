// Title screen. Runs on the same loop as the game and hands control over once
// the viewer presses or taps anything.

const INK = '#d7d2e0';
const DIM = '#8c85a0';
const TRIM = '#2fd2e8';

const LINES = [
  'Drill to the core of a hostile world.',
  'Plant three charges. Climb out before they blow.',
];

export function createTitle(assets, coarse) {
  // The prompt says "any key", so listen for one directly rather than only the
  // handful the game maps. Installed here, which is after the studio ident has
  // resolved, so the gesture that skipped the ident cannot also start the game.
  let ready = false;
  const arm = () => { ready = true; };
  addEventListener('keydown', arm, { once: true });
  addEventListener('pointerdown', arm, { once: true });

  return {
    t: 0,
    update(dt) { this.t += dt; },

    // returns true once the viewer has asked to start. The keydown/pointerdown
    // listener above cannot see a gamepad, so its buttons are checked directly.
    wantsStart(input) {
      return ready || input.direction() !== null
          || input.tapped('plant') || input.tapped('restart');
    },

    draw(ctx, cw, ch, viewTop, pad) {
      const strip = assets.bg[assets.backgrounds[3]];
      if (strip) {
        const scale = Math.max(cw / strip.width, (ch - viewTop) / strip.height);
        const w = strip.width * scale, h = strip.height * scale;
        const drift = (this.t * 8) % w;
        for (let x = -drift; x < cw; x += w) {
          ctx.drawImage(strip, Math.round(x), Math.round(ch - h), Math.ceil(w), Math.ceil(h));
        }
      }
      ctx.fillStyle = 'rgba(13,10,20,0.62)';
      ctx.fillRect(0, 0, cw, ch);

      const logo = assets.logo;
      if (logo) {
        // gentle bob so the plate does not look like a static screenshot
        const bob = Math.sin(this.t * 1.6) * 5;
        const scale = Math.min(1.4, (cw * 0.5) / logo.width);
        const w = logo.width * scale, h = logo.height * scale;
        ctx.drawImage(logo, Math.round((cw - w) / 2), Math.round(ch * 0.13 + bob),
                      Math.round(w), Math.round(h));
      }

      ctx.textAlign = 'center';
      ctx.fillStyle = DIM;
      ctx.font = '14px ui-monospace, monospace';
      LINES.forEach((line, i) => {
        ctx.fillText(line, cw / 2, ch * 0.68 + i * 22);
      });

      // blinking prompt
      if (Math.floor(this.t * 1.6) % 2 === 0) {
        ctx.fillStyle = TRIM;
        ctx.font = 'bold 20px ui-monospace, monospace';
        const prompt = pad ? 'PRESS (A) TO DRILL' : coarse ? 'TAP TO DRILL' : 'PRESS ANY KEY TO DRILL';
        ctx.fillText(prompt, cw / 2, ch * 0.85);
      }

      ctx.fillStyle = '#5b556b';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('HALLUCINATED GAMES', cw / 2, ch - 22);
      ctx.textAlign = 'left';
    },
  };
}
