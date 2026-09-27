// How to play. Reached from the title, and dismissed with anything.
//
// The control list is built from whatever the player is actually holding rather
// than listing all three schemes, since a phone player has no use for "press E"
// and a pad player has no use for the touch buttons.

const INK = '#d7d2e0';
const DIM = '#8c85a0';
const TRIM = '#2fd2e8';
const GOLD = '#e8b02b';
const WARN = '#ff6b5b';

const LEFT = [
  {
    head: 'THE JOB', color: TRIM,
    lines: [
      'Drill down to the planetary core,',
      'plant three fusion charges, then',
      'climb back out before they blow.',
      'You keep whatever you dug.',
    ],
  },
  {
    head: 'FUEL IS THE CLOCK', color: GOLD,
    lines: [
      'Drilling burns fuel fast; coasting',
      'burns it slowly. A full tank is about',
      'a third of the way down, so you must',
      'refuel en route. On empty the rig',
      'burns HULL and the drill crawls.',
    ],
  },
  {
    head: 'HEAT IS THE PACE', color: '#ff8c3a',
    lines: [
      'Deep rock heats the bit. Redline it',
      'and it eats your hull. Stop cutting',
      'and it sheds fast, so pace rather than',
      'push. The ice shelf actively cools.',
    ],
  },
  {
    head: 'READ THE ROCK', color: INK,
    lines: [
      'Each stratum is harder and hotter.',
      'Buried in the rock: fuel, repairs,',
      'coolant that dumps heat, a shield, and',
      'a bit overdrive. Your scanner finds',
      'the ones worth a detour.',
    ],
  },
];

const RIGHT = [
  {
    head: 'WHAT IS DOWN THERE', color: WARN,
    lines: [
      'Hazards are sealed in the rock. A tile',
      'FLASHES RED before you break in - back',
      'off and lose the drilling spent, or eat',
      'it. Worms burrow, crabs are armoured,',
      'spitters fire down clear tunnels,',
      'lurkers wait. Driving into a thing',
      'hurts it, and hurts you too.',
    ],
  },
  {
    head: 'VEINS ARE THE PAYDAY', color: '#7a4fd6',
    lines: [
      'Ore clusters into veins you can see in',
      'the rock. The rich ones sit deep and',
      'come guarded: a detour costs fuel, heat',
      'and hull for a much bigger haul.',
    ],
  },
  {
    head: 'THE CORE', color: TRIM,
    lines: [
      'The Guardian blocks the charges. Drive',
      'into it and hold - it is far slower',
      'than you, so back off and re-engage.',
      'Once armed, tremors drop rubble into',
      'the shaft above you. It cuts easily,',
      'but the clock is running.',
    ],
  },
  {
    head: 'THE FOUNDRY', color: GOLD,
    lines: [
      'Minerals bank as credits: all of them',
      'if the planet cracks, 40% if you die.',
      'Spend between runs. Each planet you',
      'crack makes the next one harder.',
    ],
  },
];

function controlsFor(coarse, pad) {
  if (pad) {
    return ['Stick / d-pad  drill (hold two for a diagonal)',
            '(A) plant charge and install    (Y) restart',
            '(LB) sound'];
  }
  if (coarse) {
    return ['D-pad  drill (press two for a diagonal)',
            'PLANT  plant charge and install',
            'RESTART  restart    SOUND  mute'];
  }
  return ['WASD / arrows  drill (hold two for a diagonal)',
          'E  plant charge and install    R  restart',
          'M  sound    H  this screen'];
}

export function createHelp() {
  return {
    t: 0,
    update(dt, input) {
      this.t += dt;
      // anything dismisses it
      return input.tapped('plant') || input.tapped('restart')
          || input.tapped('help') || input.direction() !== null;
    },

    draw(ctx, cw, ch, assets, coarse, pad) {
      ctx.fillStyle = '#0d0a14';
      ctx.fillRect(0, 0, cw, ch);
      const strip = assets.bg[assets.backgrounds[2]];
      if (strip) {
        ctx.globalAlpha = 0.22;
        const scale = Math.max(cw / strip.width, ch / strip.height);
        ctx.drawImage(strip, 0, Math.round(ch - strip.height * scale),
                      Math.ceil(strip.width * scale), Math.ceil(strip.height * scale));
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(13,10,20,0.8)';
      ctx.fillRect(0, 0, cw, ch);

      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.font = 'bold 22px ui-monospace, monospace';
      ctx.fillText('HOW TO PLAY', cw / 2, 38);

      ctx.textAlign = 'left';
      const col = (sections, x) => {
        let y = 68;
        for (const s of sections) {
          ctx.fillStyle = s.color;
          ctx.font = 'bold 12px ui-monospace, monospace';
          ctx.fillText(s.head, x, y);
          y += 15;
          ctx.fillStyle = DIM;
          ctx.font = '11px ui-monospace, monospace';
          for (const line of s.lines) { ctx.fillText(line, x, y); y += 13; }
          y += 12;
        }
      };
      col(LEFT, 60);
      col(RIGHT, cw / 2 + 20);

      // The one sentence that answers "how do I win", set apart so it is not
      // just another bullet in a wall of them.
      const bw = 560, bh = 54, bx = (cw - bw) / 2, by = ch - 154;
      ctx.fillStyle = 'rgba(47,210,232,0.10)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = TRIM;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = TRIM;
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillText('TO WIN', cw / 2, by + 16);
      ctx.fillStyle = INK;
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('Plant all three charges, then get back to the surface',
                   cw / 2, by + 32);
      ctx.fillText('before the countdown reaches zero.', cw / 2, by + 46);

      // controls, built for whatever is in the player's hands
      ctx.textAlign = 'center';
      ctx.fillStyle = TRIM;
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.fillText('CONTROLS', cw / 2, ch - 74);
      ctx.fillStyle = DIM;
      ctx.font = '11px ui-monospace, monospace';
      controlsFor(coarse, pad).forEach((line, i) => {
        ctx.fillText(line, cw / 2, ch - 58 + i * 13);
      });

      if (Math.floor(this.t * 1.6) % 2 === 0) {
        ctx.fillStyle = INK;
        ctx.font = 'bold 12px ui-monospace, monospace';
        ctx.fillText(pad ? 'PRESS (A) TO GO BACK'
                   : coarse ? 'TAP TO GO BACK' : 'PRESS ANY KEY TO GO BACK',
                     cw / 2, ch - 12);
      }
      ctx.textAlign = 'left';
    },
  };
}
