// Renders every visual state the game has into one contact sheet, so they can
// all be eyeballed at once.
//
// tools/check.mjs verifies the rules. It cannot see a sprite pointing the wrong
// way, a banner covering the explosion it announces, or an effect frozen
// mid-animation -- every one of which has shipped here, and every one was found
// by looking at a screenshot rather than by a check going red.
//
// Covers the headings, the strata, the boss phases and the screens, plus the
// bit's heat stages, a full cargo bay, loose ore, the second wave of creatures
// and hazards, the combat tells, every material death, and the rising flood.
//
// Load the game with ?dev, then in the console:
//   await (await fetch('tools/statesheet.js')).text().then(eval)
// A sheet appears over the page. Screenshot it, then press any key to dismiss.

(async () => {
  const dev = globalThis.dev;
  if (!dev) { console.error('statesheet needs ?dev'); return; }

  const src = document.getElementById('screen');
  const shots = [];
  const settle = (n = 3) => { for (let i = 0; i < n; i++) dev.tick(1 / 60); };

  function grab(label) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    shots.push({ label, canvas: c });
  }

  const hold = (code, seconds) => {
    dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    dev.tick(seconds);
    dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    settle();
  };

  // --- every heading, so a sprite pointing the wrong way is obvious
  const HEADINGS = [
    ['down', ['KeyS']], ['up', ['KeyW']], ['left', ['KeyA']], ['right', ['KeyD']],
    ['downleft', ['KeyS', 'KeyA']], ['downright', ['KeyS', 'KeyD']],
    ['upleft', ['KeyW', 'KeyA']], ['upright', ['KeyW', 'KeyD']],
  ];
  for (const [name, codes] of HEADINGS) {
    dev.warp(60); dev.refuel(); settle();
    for (const c of codes) dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true }));
    dev.tick(1.2);
    for (const c of codes) dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true }));
    settle();
    grab('heading ' + name);
  }

  // --- damaged rig, same two representative headings
  dev.warp(60); dev.refuel(); dev.player.hull = 12; settle();
  hold('KeyD', 1.0); grab('hurt right');
  dev.player.hull = 12;
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
  dev.tick(1.0);
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }));
  settle();
  grab('hurt downright');

  // --- one frame per stratum, to catch a layer that renders wrong
  for (const y of [8, 30, 60, 95, 125, 155, 180]) {
    dev.warp(y); dev.refuel(); dev.tick(0.4);
    grab('depth ' + y + 'm');
  }

  // --- boss, every phase
  dev.warp(190); dev.refuel(); settle();
  const boss = dev.aliens.find((a) => a.boss);
  for (const phase of ['armoured', 'opening', 'exposed', 'windup', 'slam']) {
    let guard = 0;
    // The drill is parked in the boss's lap while we wait for a phase, so it
    // has to be kept alive or every boss frame is a death screen.
    while (boss.phase !== phase && guard++ < 2000) {
      dev.refuel();
      dev.player.dead = false;
      dev.state.over = null;
      dev.state.wreck = false;
      dev.tick(1 / 60);
    }
    dev.refuel();
    settle(2);
    grab('boss ' + phase);
  }

  // ------------------------------------------------------------------------
  // Everything below was added alongside the cargo bay, the flood, the second
  // wave of creatures and the reaction sheet. None of it was visible to this
  // tool before, which meant the one thing in the repo that can see a sprite
  // pointing the wrong way could not see most of the game.

  const ENT = await import('./src/entities.js');
  const T = 32;

  // A clear room around the drill, so a state is not hidden behind rock.
  function room(halfW = 8, up = 3, down = 3) {
    const p = dev.player, w = dev.world;
    for (let y = p.ty - up; y <= p.ty + down; y++) {
      for (let x = p.tx - halfW; x <= p.tx + halfW; x++) w.dig(x, y);
    }
  }
  // Resets everything a previous capture could have left set. The escape flag
  // in particular: without clearing it the flood kept rising through every
  // later state, and the death frames were photographed from under forty feet
  // of lava. A contact sheet that lies about one state is worse than one that
  // omits it.
  // Keeps the drill breathing without touching anything else. Used inside the
  // flood capture, which has to stay alive *while* the lava is on.
  function revive() {
    dev.refuel();
    dev.player.dead = false; dev.player.invuln = 99;
    dev.state.over = null; dev.state.wreck = false;
  }
  // A full reset between states. The escape flag in particular: without
  // clearing it the flood kept rising through every later capture, and the
  // death frames were photographed from under forty feet of lava. A contact
  // sheet that lies about one state is worse than one that omits it.
  function alive() {
    revive();
    dev.state.escaping = false; dev.state.lava = null; dev.state.panic = 0;
  }
  function creature(row, ox, oy, extra = {}) {
    const p = dev.player;
    const kind = ENT.ALIEN_KINDS.find((k) => k.row === row);
    if (!kind) return null;
    const x = p.tx + ox, y = p.ty + oy;
    const a = { kind, x, y, hp: kind.hp, maxHp: kind.hp, t: 0, dx: 1,
                face: [1, 0], px: x * T, py: y * T, ...extra };
    dev.aliens.push(a);
    return a;
  }

  // --- the bit's heat stages, which are the player's warning and critical
  // states and must be tellable apart at a glance
  for (const [label, heat] of [['cool', 0], ['warm', 55], ['critical', 90]]) {
    dev.warp(150); dev.refuel(); alive(); settle();
    dev.player.heat = heat;
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', bubbles: true }));
    for (let i = 0; i < 26; i++) { dev.player.heat = heat; dev.tick(1 / 60); }
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
    grab('bit ' + label);
  }

  // --- a full bay, and ore left lying where it could not be carried
  dev.warp(120); dev.refuel(); alive(); room(6, 2, 2); settle();
  {
    const p = dev.player, w = dev.world;
    p.minerals = [p.stats.cargoCap, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) w.drop(p.tx - 2 + i, p.ty + 1, i, i + 1);
    dev.state.bayFlash = 0.7;
    settle(4);
  }
  grab('bay full + loose ore');

  // --- the second wave of creatures, all on screen together so their
  // silhouettes can be compared against each other and the originals
  dev.warp(110); dev.refuel(); alive(); dev.aliens.length = 0; room(9, 3, 2); settle();
  ['oreleech', 'sentinel', 'broodsac', 'magmaling', 'glowfly']
    .forEach((row, i) => creature(row, -6 + i * 3, 0));
  settle(4);
  grab('new creatures');

  // --- the combat tells. A crab's plate must sit on the side it faces, a
  // lurker must ring inward, a spitter must light up while it vents.
  dev.warp(110); dev.refuel(); alive(); dev.aliens.length = 0; room(9, 3, 2); settle();
  creature('rockcrab', -6, 0, { face: [-1, 0] });
  creature('rockcrab', -2, 0, { face: [1, 0] });
  creature('rockcrab', 2, 0, { face: [0, -1] });
  creature('rockcrab', 6, 0, { face: [0, 1] });
  settle(3);
  grab('crab shells, four headings');

  dev.aliens.length = 0;
  creature('lurker', -4, 0, { woke: true, coil: ENT.COIL_TIME * 0.7 });
  creature('spitter', 4, 0, { vent: ENT.VENT_TIME });
  settle(3);
  grab('lurker coiled, spitter vented');

  // --- the new hazards, including a geyser caught mid-eruption
  dev.warp(120); dev.refuel(); alive(); dev.aliens.length = 0; room(8, 2, 2);
  {
    const p = dev.player;
    dev.hazards.length = 0;
    [['geyser', -5, 0.0], ['geyser', -2, 2.4], ['sinkhole', 2, 0], ['magnetnode', 5, 0]]
      .forEach(([row, ox, t]) => {
        const kind = ENT.HAZARD_KINDS.find((k) => k.row === row);
        if (kind) dev.hazards.push({ kind, x: p.tx + ox, y: p.ty + 1, t, cooldown: 9 });
      });
    settle(4);
  }
  grab('new hazards (geyser inert + firing)');

  // --- every material death at once, caught mid-animation. The whole sequence
  // runs in about a third of a second, so this fires and grabs immediately.
  dev.warp(110); dev.refuel(); alive(); dev.aliens.length = 0; room(9, 2, 2);
  {
    const p = dev.player;
    p.facing = 'right'; p.laserCd = 0; p.heat = 0;
    ['rockcrab', 'sentinel', 'magmaling', 'swarmlet', 'spitter']
      .forEach((row, i) => creature(row, 1 + i, 0, { hp: 0.05 }));
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', bubbles: true }));
    dev.tick(1 / 60);
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', bubbles: true }));
    dev.tick(2 / 60);
  }
  grab('deaths by material');

  // --- the flood, early and late. Late also shows the panic vignette, which
  // is the only state in the game drawn over the darkness.
  for (const [label, left] of [['rising', 40], ['closing', 14]]) {
    dev.warp(150); dev.refuel(); alive(); dev.aliens.length = 0; room(9, 4, 4);
    dev.state.escaping = true;
    dev.state.escapeLeft = left;
    for (let i = 0; i < 20; i++) { dev.state.escapeLeft = left; revive(); dev.tick(1 / 60); }
    grab('lava ' + label);
  }
  // --- the run ending, before and after the banner. alive() clears the escape
  // flag the flood section set, so the wreck is photographed in a dry shaft.
  alive();
  dev.player.hull = 0; dev.player.dead = true;
  dev.tick(0.15); grab('death wreck');
  dev.tick(1.1); grab('death banner');

  // --- the other screens
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', bubbles: true }));
  // Seed `levels` in the save before loading the page to see owned upgrade
  // parts; on a fresh save every icon is correctly dimmed, which is its own
  // state worth looking at.
  dev.tick(0.4); grab('foundry');
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyH', bubbles: true }));
  dev.tick(0.4); grab('help');

  // --- compose
  const COLS = 5;
  const TW = 384, TH = 240, PAD = 4, LABEL = 16;
  const rows = Math.ceil(shots.length / COLS);
  const sheet = document.createElement('canvas');
  sheet.width = COLS * (TW + PAD) + PAD;
  sheet.height = rows * (TH + LABEL + PAD) + PAD;
  const g = sheet.getContext('2d');
  g.fillStyle = '#12101a';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = 'bold 12px ui-monospace, monospace';
  g.textBaseline = 'middle';

  shots.forEach((shot, i) => {
    const x = PAD + (i % COLS) * (TW + PAD);
    const y = PAD + Math.floor(i / COLS) * (TH + LABEL + PAD);
    g.fillStyle = '#2fd2e8';
    g.fillText(shot.label, x + 2, y + LABEL / 2);
    g.drawImage(shot.canvas, x, y + LABEL, TW, TH);
  });

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#12101a;'
    + 'overflow:auto;display:flex;align-items:flex-start;justify-content:center';
  sheet.style.cssText = 'image-rendering:pixelated;max-width:100%';
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  addEventListener('keydown', () => overlay.remove(), { once: true });

  console.log(`statesheet: ${shots.length} states`);
  return `${shots.length} states captured`;
})();
