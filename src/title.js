// Title screen. Runs on the same loop as the game and hands control over once
// the viewer presses or taps anything.

const INK = '#d7d2e0';
const DIM = '#8c85a0';
const TRIM = '#2fd2e8';

const LINES = [
  'Drill to the core of a hostile world.',
  'Plant three charges. Climb out before they blow.',
];

export function createTitle(assets, coarse, save) {
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
        ctx.fillText(prompt, cw / 2, ch * 0.80);
      }

      // Progression belongs on the title too, or a returning player has no sign
      // their last run mattered until they have already died again.
      if (save && save.runs > 0) {
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = '#8c85a0';
        const planets = save.cracked === 1 ? '1 planet cracked' : `${save.cracked} planets cracked`;
        const next = save.cracked > 0 ? `   next: planet ${save.cracked + 1}` : '';
        ctx.fillText(`${save.runs} ${save.runs === 1 ? 'run' : 'runs'}   ${planets}${next}`, cw / 2, ch - 95);
        ctx.fillStyle = '#e8b02b';
        ctx.fillText(`${save.credits} CR banked`, cw / 2, ch - 81);
        if (save.best && (save.best.depth || save.best.haul)) {
          ctx.fillStyle = '#6f6883';
          ctx.fillText(`best ${save.best.depth}m   biggest haul ${save.best.haul} CR`,
                       cw / 2, ch - 67);
        }
      }

      ctx.fillStyle = '#6f6883';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(pad ? '(X) how to play' : coarse ? 'HELP  how to play' : 'H  how to play',
                   cw / 2, ch - 38);

      ctx.fillStyle = '#5b556b';
      ctx.fillText('HALLUCINATED GAMES', cw / 2, ch - 22);
      ctx.textAlign = 'left';
    },
  };
}
