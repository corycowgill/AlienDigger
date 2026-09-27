// HUD drawn with primitives in the sheet's palette, so it stays crisp at any
// canvas size and does not depend on slicing the irregular HUD sheet.

const INK = '#d7d2e0';
const PANEL = '#161222';
const TRIM = '#2fd2e8';

const ORE_COLORS = ['#e07a2b', '#d8dbe6', '#7a4fd6', '#e8b02b', '#39d7e8'];

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

export function drawHud(ctx, p, state, cw, muted) {
  ctx.save();
  ctx.fillStyle = 'rgba(13,10,20,0.82)';
  ctx.fillRect(0, 0, cw, 62);
  ctx.fillStyle = TRIM; ctx.fillRect(0, 62, cw, 1);

  const hullFrac = p.hull / 100;
  bar(ctx, 14, 26, 180, 12, hullFrac,
      hullFrac > 0.5 ? '#e0453a' : (Math.floor(state.time * 6) % 2 ? '#ff7b6b' : '#7a1f18'),
      'HULL');
  bar(ctx, 218, 26, 150, 12, p.fuel / 100, '#e8b02b', 'FUEL');

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

  // mineral tally
  ctx.font = '11px ui-monospace, monospace';
  p.minerals.forEach((count, i) => {
    const x = 580 + i * 46;
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
