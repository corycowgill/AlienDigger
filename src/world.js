// Terrain: a grid of tiles arranged in strata that get harder with depth,
// with caves carved through them and contents scattered inside.

export const TILE = 32;
export const W = 34;          // tiles across
export const D = 200;         // tiles deep
export const CORE_TOP = D - 14;

export const EMPTY = -1;

// One entry per strata row in the tileset, shallowest first.
// `heat` is degrees per second of drilling in that stratum. Ice is negative on
// purpose: the shelf is the one place a hot drill can shed heat, which gives
// the layer a reason to exist beyond being expensive to cross.
export const STRATA = [
  { name: 'topsoil',   row: 0, hardness: 0.35, depth: 6,   heat: 0 },
  { name: 'dirt',      row: 1, hardness: 0.5,  depth: 24,  heat: 0 },
  { name: 'sandstone', row: 2, hardness: 0.7,  depth: 48,  heat: 0.5 },
  { name: 'rock',      row: 3, hardness: 1.0,  depth: 80,  heat: 1.5 },
  { name: 'ice',       row: 4, hardness: 1.3,  depth: 110, heat: -8 },
  { name: 'fungal',    row: 5, hardness: 1.45, depth: 140, heat: 3 },
  { name: 'crystal',   row: 6, hardness: 1.7,  depth: 172, heat: 5 },
  { name: 'magma',     row: 7, hardness: 2.4,  depth: D,   heat: 7.5 },
];

export function strataAt(y) {
  for (const s of STRATA) if (y < s.depth) return s;
  return STRATA[STRATA.length - 1];
}

// Small deterministic PRNG so a seed reproduces a planet exactly.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function smoothNoise(rand, w, h, scale) {
  const gw = Math.ceil(w / scale) + 2;
  const gh = Math.ceil(h / scale) + 2;
  const g = Array.from({ length: gh }, () => Array.from({ length: gw }, rand));
  const lerp = (a, b, t) => a + (b - a) * t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const a = lerp(g[y0][x0], g[y0][x0 + 1], tx);
    const b = lerp(g[y0 + 1][x0], g[y0 + 1][x0 + 1], tx);
    return lerp(a, b, ty);
  };
}

export class World {
  constructor(seed = 1337, hardnessScale = 1) {
    const rand = rng(seed);
    this.rand = rand;
    this.tiles = new Int8Array(W * D);      // strata row, or EMPTY
    this.variant = new Uint8Array(W * D);
    this.ore = new Int8Array(W * D).fill(-1);   // index into the ore row
    this.hp = new Float32Array(W * D);          // drill progress per tile

    const cave = smoothNoise(rand, W, D, 7);
    // A second, finer noise field picks tile variants and blends the strata
    // boundaries. Variants used to be drawn uniformly at random, which scattered
    // six unrelated textures across every layer and made the rock read as
    // static -- worst in magma, where bright molten tiles and dark runed bedrock
    // landed side by side with no logic. Driving them from noise instead makes
    // similar tiles cluster into patches, the way real strata bed.
    const grain = smoothNoise(rand, W, D, 3.2);
    const edgeNoise = smoothNoise(rand, W, D, 2.4);

    for (let y = 0; y < D; y++) {
      const si = STRATA.findIndex((b) => y < b.depth);
      const s = STRATA[si < 0 ? STRATA.length - 1 : si];
      const prevDepth = si > 0 ? STRATA[si - 1].depth : 0;

      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        this.variant[i] = Math.min(5, Math.floor(grain(x, y) * 6));

        // open sky above the surface, an open room at the core
        if (y < 3 || y >= CORE_TOP + 3) { this.tiles[i] = EMPTY; continue; }

        // Bleed the two strata into each other near their boundary, so the
        // change of rock is a ragged seam rather than a ruled line across the
        // screen. Hardness still steps cleanly; this is purely what you see.
        let row = s.row;
        const toNext = s.depth - y;
        const fromPrev = y - prevDepth;
        const e = edgeNoise(x, y);
        if (toNext <= 3 && si < STRATA.length - 1 && e > 0.30 + toNext * 0.17) {
          row = STRATA[si + 1].row;
        } else if (fromPrev < 3 && si > 0 && e < 0.30 - fromPrev * 0.07) {
          row = STRATA[si - 1].row;
        }

        // caves thin out with depth so the descent stays a dig, not a fall
        const openness = cave(x, y);
        const threshold = 0.72 + (y / D) * 0.16;
        const edge = x < 2 || x > W - 3;          // keep the shaft walls solid
        this.tiles[i] = (!edge && openness > threshold) ? EMPTY : row;
        this.hp[i] = s.hardness * hardnessScale;
      }
    }

    // Background scatter: thin, and mostly the cheap tiers. This is what you
    // pick up incidentally on the way down rather than something worth steering
    // for.
    for (let y = 4; y < D; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (this.tiles[i] === EMPTY) continue;
        if (rand() > 0.022) continue;
        // Depth sets which tiers are available at all; the curve then makes the
        // good ones rare within that. The old formula did the opposite -- it
        // pushed the tier floor up with depth, so because most of the world is
        // deep, the top tiers ended up the most abundant ore in the game and
        // copper the rarest, inverting both the rarity ladder and the scoring.
        const cap = Math.min(3, Math.floor((y / D) * 5));
        this.ore[i] = Math.floor(Math.pow(rand(), 2.4) * (cap + 1));
      }
    }

    // Veins are the reason to steer. Uniform scatter meant every column was
    // worth the same and the only routing decision was the next fuel cache; a
    // visible cluster of pulse crystal three columns off your shaft is a real
    // question, because the detour costs fuel and heat and the rich ones sit in
    // the deep where both are scarce.
    this.veins = [];
    const veinCount = 15 + Math.floor(rand() * 6);
    for (let v = 0; v < veinCount; v++) {
      const cy = 14 + Math.floor(rand() * (CORE_TOP - 24));
      const cx = 2 + Math.floor(rand() * (W - 4));
      // richer with depth, and the richest are the smallest
      const cap = Math.min(4, Math.floor((cy / D) * 5.4));
      const tier = Math.max(0, cap - (rand() < 0.45 ? 1 : 0));
      const size = Math.max(3, 12 - tier * 2 + Math.floor(rand() * 4));

      let x = cx, y = cy, placed = 0;
      for (let step = 0; step < size * 5 && placed < size; step++) {
        const i = y * W + x;
        if (x > 0 && x < W - 1 && y > 3 && y < D && this.tiles[i] !== EMPTY) {
          this.ore[i] = tier;
          placed++;
        }
        x += Math.floor(rand() * 3) - 1;
        y += Math.floor(rand() * 3) - 1;
      }
      if (placed >= 3) this.veins.push({ x: cx, y: cy, tier, size: placed });
    }

    // Tiles changed since the renderer last looked. Draining this lets a dig
    // repaint one tile instead of forcing a full cache rebuild.
    this.dirty = [];
    this.chargeSockets = [];
    const cy = CORE_TOP + 7;
    for (let k = 0; k < 3; k++) {
      this.chargeSockets.push({
        x: Math.floor(W / 2) + (k - 1) * 6, y: cy, planted: false,
      });
    }
  }

  idx(x, y) { return y * W + x; }
  inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < D; }
  solid(x, y) {
    if (!this.inBounds(x, y)) return true;
    return this.tiles[this.idx(x, y)] !== EMPTY;
  }
  hardness(x, y) {
    if (!this.inBounds(x, y)) return Infinity;
    return this.hp[this.idx(x, y)];
  }

  // Collapse an open tile back to rubble: soft to cut, but it is in the way.
  // Used by the tremors that run once the charges are armed.
  collapse(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.tiles[i] !== EMPTY) return false;
    this.tiles[i] = strataAt(y).row;
    this.hp[i] = 0.45;
    this.ore[i] = -1;
    this.dirty.push(x, y);
    return true;
  }

  // Returns the ore tier freed by the dig, or -1.
  dig(x, y) {
    const i = this.idx(x, y);
    this.tiles[i] = EMPTY;
    this.dirty.push(x, y);
    const ore = this.ore[i];
    this.ore[i] = -1;
    return ore;
  }
}
