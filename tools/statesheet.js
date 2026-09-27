// Renders every visual state the game has into one contact sheet, so they can
// all be eyeballed at once.
//
// tools/check.mjs verifies the rules. It cannot see a sprite pointing the wrong
// way, a banner covering the explosion it announces, or an effect frozen
// mid-animation -- every one of which has shipped here, and every one was found
// by looking at a screenshot rather than by a check going red.
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

  // --- the run ending, before and after the banner
  dev.player.hull = 0; dev.player.dead = true;
  dev.tick(0.15); grab('death wreck');
  dev.tick(1.1); grab('death banner');

  // --- the other screens
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));
  dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyR', bubbles: true }));
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
