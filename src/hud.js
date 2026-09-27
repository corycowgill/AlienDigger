// HUD drawn with primitives in the sheet's palette, so it stays crisp at any
// canvas size and does not depend on slicing the irregular HUD sheet.

const INK = '#d7d2e0';
const PANEL = '#161222';
const TRIM = '#2fd2e8';
const DIM = '#8c85a0';

const ORE_COLORS = ['#e07a2b', '#d8dbe6', '#7a4fd6', '#e8b02b', '#39d7e8'];

// One swatch per stratum, shallowest first, so the descent bar reads as the
// ground it is cutting through rather than an abstract percentage.
const STRATA_COLORS = [
  '#6b4a2f', '#8a5a33', '#c19a5b', '#7b7d84',
  '#8fc6de', '#2f7d6b', '#7a4fd6', '#d2521f',
];

// A vertical slice of the planet with the drill's position on it. Depth in
// metres alone says how far you have come and nothing about how far is left,
// which is the number that actually governs whether to turn back.
function descentBar(ctx, x, y, w, h, depth, maxDepth, strata) {
  ctx.fillStyle = '#0c0a12';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);

  let prev = 0;
  strata.forEach((band, i) => {
    const y0 = y + h * (prev / maxDepth);
    const y1 = y + h * (Math.min(band.depth, maxDepth) / maxDepth);
    ctx.fillStyle = STRATA_COLORS[i] || '#555';
    ctx.fillRect(x, y0, w, Math.max(1, y1 - y0));
    prev = band.depth;
  });

  // the core chamber sits at the bottom
  ctx.fillStyle = '#ff7b2b';
  ctx.fillRect(x, y + h - 3, w, 3);

  const at = y + h * Math.min(1, depth / maxDepth);
  ctx.fillStyle = '#0d0a14';
  ctx.fillRect(x - 3, Math.round(at) - 2, w + 6, 4);
  ctx.fillStyle = TRIM;
  ctx.fillRect(x - 3, Math.round(at) - 1, w + 6, 2);

  ctx.strokeStyle = '#2b2438';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
}

function bar(ctx, x, y, w, h, frac, fill, label) {
  ctx.fillStyle = PANEL; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#0c0a12'; ctx.fillRect(x, y, w, h);
  const n = Math.round(w * Math.max(0, Math.min(1, frac)));
  ctx.fillStyle = fill; ctx.fillRect(x, y, n, h);
  ctx.strokeStyle = TRIM; ctx.lineWidth = 1;
  ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
  ctx.fillStyle = INK; ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(label, x, y - 6);
}

export function drawHud(ctx, p, state, cw, muted, strata, maxDepth) {
  ctx.save();
  ctx.fillStyle = 'rgba(13,10,20,0.82)';
  ctx.fillRect(0, 0, cw, 62);
  ctx.fillStyle = TRIM; ctx.fillRect(0, 62, cw, 1);

  const hullFrac = p.hull / p.stats.maxHull;
  bar(ctx, 14, 26, 180, 12, hullFrac,
      hullFrac > 0.5 ? '#e0453a' : (Math.floor(state.time * 6) % 2 ? '#ff7b6b' : '#7a1f18'),
      'HULL');
  bar(ctx, 218, 22, 150, 11, p.fuel / p.stats.maxFuel, '#e8b02b', 'FUEL');

  // Heat only earns space once it is doing something. Below a quarter it is a
  // thin idle strip; hot it fills and, redlined, it flashes -- because the
  // player is watching the shaft, not the gauge.
  const heat = Math.max(0, Math.min(1, p.heat / 100));
  const redline = p.heat >= 100;
  ctx.fillStyle = '#0c0a12';
  ctx.fillRect(218, 42, 150, 7);
  ctx.fillStyle = redline
    ? (Math.floor(state.time * 8) % 2 ? '#ff6b5b' : '#5a1a12')
    : heat > 0.6 ? '#ff8c3a' : '#c2571f';
  ctx.fillRect(218, 42, Math.round(150 * heat), 7);
  ctx.strokeStyle = redline ? '#ff6b5b' : '#2b2438';
  ctx.lineWidth = 1;
  ctx.strokeRect(217.5, 41.5, 151, 8);
  ctx.fillStyle = redline ? '#ff6b5b' : DIM;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText(redline ? 'OVERHEAT' : 'HEAT', 374, 49);

  ctx.fillStyle = INK;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(state.escaping ? 'ESCAPE' : 'TIME', 392, 20);
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.fillStyle = state.escaping ? '#ff6b5b' : TRIM;
  const t = Math.max(0, state.escaping ? state.escapeLeft : state.time);
  ctx.fillText(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`, 392, 39);

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = INK;
  ctx.fillText('DEPTH', 486, 20);
  ctx.font = 'bold 20px ui-monospace, monospace';
  ctx.fillText(`${p.ty}m`, 486, 39);
  if (strata) descentBar(ctx, 552, 8, 10, 46, p.ty, maxDepth, strata);

  // mineral tally
  ctx.font = '11px ui-monospace, monospace';
  p.minerals.forEach((count, i) => {
    const x = 596 + i * 42;
    ctx.fillStyle = ORE_COLORS[i];
    ctx.fillRect(x, 26, 10, 10);
    ctx.fillStyle = INK;
    ctx.fillText(String(count), x + 14, 35);
  });

  // charges remaining
  ctx.fillStyle = INK;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText('CHARGES', 824, 20);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < p.charges ? '#39d7e8' : '#2b2438';
    ctx.fillRect(824 + i * 16, 26, 11, 12);
  }
  if (muted) {
    ctx.fillStyle = '#6f6883';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText('MUTED [M]', cw - 12, 52);
    ctx.textAlign = 'left';
  }

  ctx.restore();
}

export function drawBanner(ctx, cw, ch, title, sub) {
  ctx.save();
  ctx.fillStyle = 'rgba(13,10,20,0.86)';
  ctx.fillRect(0, ch / 2 - 60, cw, 120);
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = 'bold 34px ui-monospace, monospace';
  ctx.fillText(title, cw / 2, ch / 2 - 4);
  ctx.fillStyle = '#8c85a0';
  ctx.font = '14px ui-monospace, monospace';
  ctx.fillText(sub, cw / 2, ch / 2 + 28);
  ctx.restore();
}
