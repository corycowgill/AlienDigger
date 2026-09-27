// The Foundry: spend banked credits between runs.
//
// Reached after a run ends, whether the planet cracked or the drill did, so a
// bad run still pays something and the next one starts stronger.

import { UPGRADES, costOf, buy, statsFor, store } from './progress.js';

const ORE_NAMES = ['Cu', 'Ir', 'Vd', 'Am', 'Pc'];
const ORE_COLORS = ['#e07a2b', '#d8dbe6', '#7a4fd6', '#e8b02b', '#39d7e8'];

const INK = '#d7d2e0';
const DIM = '#8c85a0';
const TRIM = '#2fd2e8';
const GOLD = '#e8b02b';
const PANEL = '#161222';

export function createFoundry(save) {
  let sel = 0;
  // >0 briefly after a purchase, <0 after a refusal, 0 for neither. It decays
  // toward zero from both sides rather than past it, or the first frame of the
  // screen reads as a refusal nobody made.
  let flash = 0;

  return {
    save,
    t: 0,

    update(dt, input) {
      this.t += dt;
      if (flash > 0) flash = Math.max(0, flash - dt);
      else if (flash < 0) flash = Math.min(0, flash + dt);

      if (input.tapped('up')) sel = (sel + UPGRADES.length - 1) % UPGRADES.length;
      if (input.tapped('down')) sel = (sel + 1) % UPGRADES.length;

      if (input.tapped('plant')) {
        const bought = buy(save, UPGRADES[sel]);
        // Persist immediately: banking at the end of a run was the only writer,
        // so an upgrade installed here would apply to the current session and
        // then vanish on reload.
        if (bought) store(save);
        flash = bought ? 0.4 : -0.4;
      }
      // launching is the only way out
      return input.tapped('restart');
    },

    draw(ctx, cw, ch, assets, lastRun, pad) {
      ctx.fillStyle = '#0d0a14';
      ctx.fillRect(0, 0, cw, ch);

      const strip = assets.bg[assets.backgrounds[1]];
      if (strip) {
        ctx.globalAlpha = 0.3;
        const scale = Math.max(cw / strip.width, ch / strip.height);
        ctx.drawImage(strip, 0, Math.round(ch - strip.height * scale),
                      Math.ceil(strip.width * scale), Math.ceil(strip.height * scale));
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(13,10,20,0.72)';
      ctx.fillRect(0, 0, cw, ch);

      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.font = 'bold 26px ui-monospace, monospace';
      ctx.fillText('THE FOUNDRY', cw / 2, 46);

      if (lastRun) {
        ctx.font = 'bold 12px ui-monospace, monospace';
        ctx.fillStyle = lastRun.cracked ? TRIM : '#ff6b5b';
        ctx.fillText(lastRun.line, cw / 2, 66);

        // What the run was actually made of, rather than one number. A salvaged
        // run shows the cut it took, so the cost of dying is legible.
        const mins = Math.floor(lastRun.time / 60);
        const secs = String(lastRun.time % 60).padStart(2, '0');
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = DIM;
        ctx.fillText(`${lastRun.depth}m reached   ${mins}:${secs} elapsed`, cw / 2, 82);

        const total = lastRun.minerals.reduce((a, c) => a + c, 0);
        if (total) {
          const span = lastRun.minerals.length * 54;
          let x = cw / 2 - span / 2 + 10;
          ctx.textAlign = 'left';
          lastRun.minerals.forEach((n, i) => {
            ctx.fillStyle = n ? ORE_COLORS[i] : '#3a3448';
            ctx.fillRect(x, 92, 8, 8);
            ctx.fillStyle = n ? INK : '#4a4458';
            ctx.font = '10px ui-monospace, monospace';
            ctx.fillText(`${ORE_NAMES[i]} ${n}`, x + 12, 100);
            x += 54;
          });
          ctx.textAlign = 'center';
        }
        if (!lastRun.cracked && lastRun.gross > lastRun.banked) {
          ctx.fillStyle = '#7a5a2a';
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(`${lastRun.gross} CR dug, ${lastRun.gross - lastRun.banked} lost with the drill`,
                       cw / 2, 114);
        }
      }

      ctx.font = 'bold 16px ui-monospace, monospace';
      ctx.fillStyle = GOLD;
      ctx.fillText(`${save.credits} CR`, cw / 2, 136);

      // upgrade rows
      const top = 150, rowH = 46, panelW = 620, x0 = (cw - panelW) / 2;
      UPGRADES.forEach((u, i) => {
        const y = top + i * rowH;
        const lvl = save.levels[u.key] | 0;
        const cost = costOf(u, save.levels);
        const picked = i === sel;
        const afford = cost !== null && save.credits >= cost;

        ctx.fillStyle = picked ? 'rgba(47,210,232,0.13)' : PANEL;
        ctx.fillRect(x0, y, panelW, rowH - 8);
        ctx.strokeStyle = picked ? TRIM : '#2b2438';
        ctx.lineWidth = picked ? 2 : 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, panelW - 1, rowH - 9);

        ctx.textAlign = 'left';
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.fillStyle = picked ? INK : DIM;
        ctx.fillText(u.name, x0 + 16, y + 19);
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = '#6f6883';
        ctx.fillText(u.blurb, x0 + 16, y + 34);

        // level pips
        for (let k = 0; k < u.max; k++) {
          ctx.fillStyle = k < lvl ? TRIM : '#2b2438';
          ctx.fillRect(x0 + 330 + k * 16, y + 10, 11, 11);
        }

        ctx.textAlign = 'right';
        ctx.font = 'bold 13px ui-monospace, monospace';
        if (cost === null) {
          ctx.fillStyle = TRIM;
          ctx.fillText('MAX', x0 + panelW - 16, y + 26);
        } else {
          ctx.fillStyle = afford ? GOLD : '#5b4a2a';
          ctx.fillText(`${cost} CR`, x0 + panelW - 16, y + 26);
        }
      });

      // what the next run will actually fly with
      const st = statsFor(save.levels);
      ctx.textAlign = 'center';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = DIM;
      ctx.fillText(
        `hull ${st.maxHull}   fuel ${st.maxFuel}   drill ${st.drillRate.toFixed(2)}`
        + `   scanner ${st.scanner}   haul x${st.cargoMult.toFixed(2)}`,
        cw / 2, top + UPGRADES.length * rowH + 14,
      );

      if (flash < 0) {
        ctx.fillStyle = '#ff6b5b';
        ctx.fillText('NOT ENOUGH CREDITS', cw / 2, top + UPGRADES.length * rowH + 32);
      } else if (flash > 0) {
        ctx.fillStyle = TRIM;
        ctx.fillText('INSTALLED', cw / 2, top + UPGRADES.length * rowH + 32);
      }

      if (Math.floor(this.t * 1.6) % 2 === 0) {
        ctx.fillStyle = TRIM;
        ctx.font = 'bold 15px ui-monospace, monospace';
        ctx.fillText(pad ? '(Y) LAUNCH' : '[R] LAUNCH', cw / 2, ch - 30);
      }
      ctx.fillStyle = '#5b556b';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(pad ? 'd-pad select    (A) install    (Y) launch    (X) help'
                       : 'up / down select    [E] install    [R] launch    [H] help', cw / 2, ch - 12);
      ctx.textAlign = 'left';
    },
  };
}
