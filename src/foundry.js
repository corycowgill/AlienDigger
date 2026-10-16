// The Foundry: spend banked credits between runs.
//
// Reached after a run ends, whether the planet cracked or the drill did, so a
// bad run still pays something and the next one starts stronger.

import { UPGRADES, costOf, buy, statsFor, store, offeredPlanets } from './progress.js';

const ORE_NAMES = ['Cu', 'Ir', 'Vd', 'Am', 'Pc'];

// Upgrade key -> the art row that draws it. Kept here rather than on the
// UPGRADES entries so progress.js stays free of anything the simulator cannot
// import, which is the rule that lets sim.mjs run the real progression.
const UPG_ART = {
  drill: 'upgdrill', tank: 'upgtank', hull: 'upghull', scanner: 'upgscan',
  thruster: 'upgthrust', cooling: 'upgheat', cargo: 'upgcargo',
};
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

      // Left and right pick the world to take next. Those two directions did
      // nothing on this screen before, so the second decision costs no new
      // control -- and it is stored straight away, because launching is not
      // the only way a player leaves this page.
      //
      // Both taps are read once, up front. Calling tapped() inside the branch
      // as well consumes a second time and reads false, which made the
      // direction unreliable in a way that looked like a dropped keypress.
      const offer = offeredPlanets(save.runs);
      const left = input.tapped('left');
      const right = input.tapped('right');

      // The offer changes when the run count does, so a world chosen last time
      // may not be on the table now. Snapping back to the first entry keeps the
      // selection and the highlight agreeing -- otherwise findIndex returns -1,
      // the cursor silently sits on ROCKY, and the first press appears to do
      // nothing because it moves from a position the player could not see.
      if (!offer.some((o) => o.key === save.planet)) {
        save.planet = offer[0].key;
        store(save);
      }

      if (left || right) {
        const at = offer.findIndex((o) => o.key === save.planet);
        const step = left ? offer.length - 1 : 1;
        save.planet = offer[(at + step) % offer.length].key;
        store(save);
      }

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
        ctx.globalAlpha = 0.42;
        const scale = Math.max(cw / strip.width, ch / strip.height);
        ctx.drawImage(strip, 0, Math.round(ch - strip.height * scale),
                      Math.ceil(strip.width * scale), Math.ceil(strip.height * scale));
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(13,10,20,0.66)';
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
        const deepest = lastRun.deepest ?? lastRun.depth;
        ctx.fillText(`${deepest}m deepest   ${mins}:${secs} elapsed`, cw / 2, 82);

        if (lastRun.beatDepth || lastRun.beatHaul) {
          ctx.fillStyle = '#4ae06b';
          ctx.font = 'bold 11px ui-monospace, monospace';
          const what = lastRun.beatDepth && lastRun.beatHaul ? 'DEEPEST RUN AND BIGGEST HAUL'
                     : lastRun.beatDepth ? 'DEEPEST RUN YET' : 'BIGGEST HAUL YET';
          ctx.fillText(what, cw / 2, 128);
        }

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
                       cw / 2, 113);
        }
      }

      ctx.font = 'bold 16px ui-monospace, monospace';
      ctx.fillStyle = GOLD;
      ctx.fillText(`${save.credits} CR`, cw / 2, 148);

      // upgrade rows
      const top = 162, rowH = 42, panelW = 620, x0 = (cw - panelW) / 2;
      UPGRADES.forEach((u, i) => {
        const y = top + i * rowH;
        const lvl = save.levels[u.key] | 0;
        const cost = costOf(u, save.levels);
        const picked = i === sel;
        const afford = cost !== null && save.credits >= cost;

        ctx.fillStyle = picked ? 'rgba(47,210,232,0.13)' : PANEL;
        ctx.fillRect(x0, y, panelW, rowH - 6);
        ctx.strokeStyle = picked ? TRIM : '#2b2438';
        ctx.lineWidth = picked ? 2 : 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, panelW - 1, rowH - 7);

        // The part itself, so an upgrade is a thing you can see rather than a
        // row of pips. The row shows what you currently fly with; at level 0 it
        // shows what you would be buying, dimmed, because "here is the gear you
        // do not have yet" is a better pitch than an empty slot.
        const art = assets?.anim?.upg?.[UPG_ART[u.key]];
        if (art && art.length) {
          const img = art[Math.max(0, Math.min(art.length - 1, lvl - 1))];
          if (img) {
            const box = rowH - 14;
            const k = Math.min(box / img.width, box / img.height);
            const iw = Math.round(img.width * k), ih = Math.round(img.height * k);
            ctx.save();
            ctx.globalAlpha = lvl > 0 ? 1 : 0.32;
            ctx.drawImage(img, Math.round(x0 + 14 + (box - iw) / 2),
                          Math.round(y + 4 + (box - ih) / 2), iw, ih);
            ctx.restore();
          }
        }

        ctx.textAlign = 'left';
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.fillStyle = picked ? INK : DIM;
        ctx.fillText(u.name, x0 + 60, y + 17);
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillStyle = '#6f6883';
        ctx.fillText(u.blurb, x0 + 60, y + 31);

        // level pips
        for (let k = 0; k < u.max; k++) {
          ctx.fillStyle = k < lvl ? TRIM : '#2b2438';
          ctx.fillRect(x0 + 330 + k * 16, y + 11, 11, 11);
        }

        ctx.textAlign = 'right';
        ctx.font = 'bold 13px ui-monospace, monospace';
        if (cost === null) {
          ctx.fillStyle = TRIM;
          ctx.fillText('MAX', x0 + panelW - 16, y + 24);
        } else {
          ctx.fillStyle = afford ? GOLD : '#5b4a2a';
          ctx.fillText(`${cost} CR`, x0 + panelW - 16, y + 24);
        }
      });

      // what the next run will actually fly with
      const st = statsFor(save.levels);
      ctx.textAlign = 'center';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = DIM;
      ctx.fillText(
        `hull ${st.maxHull}  fuel ${st.maxFuel}  drill ${st.drillRate.toFixed(2)}`
        + `  heat x${st.cooling.toFixed(2)}  scanner ${st.scanner}`
        + `  bay ${st.cargoCap}  haul x${st.cargoMult.toFixed(2)}`,
        cw / 2, top + UPGRADES.length * rowH + 14,
      );

      if (flash < 0) {
        ctx.fillStyle = '#ff6b5b';
        ctx.fillText('NOT ENOUGH CREDITS', cw / 2, 134);
      } else if (flash > 0) {
        ctx.fillStyle = TRIM;
        ctx.fillText('INSTALLED', cw / 2, top + UPGRADES.length * rowH + 32);
      }

      if (Math.floor(this.t * 1.6) % 2 === 0) {
        ctx.fillStyle = TRIM;
        ctx.font = 'bold 15px ui-monospace, monospace';
        // --- which world to take next. Three on offer, always including ROCKY,
      // so the second decision of the screen sits beside the first rather than
      // behind a menu.
      //
      // Only the selected world explains itself. Printing all three blurbs at
      // once overflowed the cards and collided with the launch prompt, and
      // three sentences competing for attention is not a clearer choice than
      // one -- the names and the multipliers carry the comparison.
      {
        const offer = offeredPlanets(save.runs);
        const py = top + UPGRADES.length * rowH + 30;
        ctx.textAlign = 'center';
        ctx.fillStyle = DIM;
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(pad ? 'NEXT WORLD   -   d-pad left / right'
                         : 'NEXT WORLD   -   left / right', cw / 2, py);

        const cardW = 196, gap = 10, cardH = 34;
        const span = offer.length * cardW + (offer.length - 1) * gap;
        let chosen = offer[0];
        offer.forEach((o, i) => {
          const x = cw / 2 - span / 2 + i * (cardW + gap);
          const on = o.key === save.planet;
          if (on) chosen = o;
          ctx.fillStyle = on ? 'rgba(47,210,232,0.13)' : PANEL;
          ctx.fillRect(x, py + 8, cardW, cardH);
          ctx.strokeStyle = on ? TRIM : '#2b2438';
          ctx.lineWidth = on ? 2 : 1;
          ctx.strokeRect(x + 0.5, py + 8.5, cardW - 1, cardH - 1);

          ctx.fillStyle = on ? INK : DIM;
          ctx.font = 'bold 11px ui-monospace, monospace';
          ctx.fillText(o.name, x + cardW / 2, py + 23);
          ctx.fillStyle = on ? GOLD : '#6f6883';
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(`x${o.payout.toFixed(2)} haul`, x + cardW / 2, py + 36);
        });

        ctx.fillStyle = '#8c85a0';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(chosen.blurb, cw / 2, py + 60);
      }

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
