// Loads the generated art described by art/game/atlas.json.
// Every animation row becomes an array of Images; tiles become a flat array
// indexed by strata row, then variant.

const ART = 'art/';

const SHEETS = {
  drill: 'alien_digger_01_drill_sheet',
  aliens: 'alien_digger_02_aliens_sheet',
  minerals: 'alien_digger_04_minerals_sheet',
  hazards: 'alien_digger_05_hazards_sheet',
  fx: 'alien_digger_07_fx_sheet',
  props: 'alien_digger_08_charges_props',
  boss: 'alien_digger_11_guardian_states',
  diag: 'alien_digger_12_drill_diagonals',
  heat: 'alien_digger_14_heat_laser',
  collapse: 'alien_digger_15_collapse',
  lava: 'alien_digger_18_lava',
  upg: 'alien_digger_13_upgrades',
  decor: 'alien_digger_16_cavern_decor',
  extra: 'alien_digger_19_enemies',
};

// Sheet 19 carries both creatures and hazards. They are folded into the two
// namespaces the originals already live in, so every lookup in the game stays
// anim.aliens[kind.row] and anim.hazards[kind.row] and no call site has to know
// which sheet a kind happened to be drawn on.
const EXTRA_ALIENS = ['oreleech', 'sentinel', 'broodsac', 'magmaling', 'glowfly'];
const EXTRA_HAZARDS = ['geyser', 'sinkhole', 'magnetnode'];
const TILES = 'alien_digger_03_terrain_tiles';
const BG_SHEET = 'alien_digger_10_backgrounds';
const UI_SHEET = 'alien_digger_09_ui_kit';

const BACKGROUNDS = ['surface', 'upper_caverns', 'crystal_depths', 'magma_core'];

function load(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // a missing frame must not stall the game
    img.src = src;
  });
}

export async function loadAssets(onProgress) {
  const atlas = await fetch(ART + 'game/atlas.json').then((r) => r.json());

  const jobs = [];
  const anim = {};
  for (const [key, sheet] of Object.entries(SHEETS)) {
    anim[key] = {};
    // A sheet the atlas does not carry costs us that sheet, not the whole load.
    // A stale cached atlas took the entire game down with an undefined read,
    // which is a silly way to lose a boot.
    if (!atlas[sheet] || !atlas[sheet].animations) {
      console.warn(`atlas has no animations for ${sheet}`);
      continue;
    }
    for (const [row, data] of Object.entries(atlas[sheet].animations)) {
      const frames = new Array(data.frames.length);
      anim[key][row] = frames;
      data.frames.forEach((file, i) => {
        jobs.push(load(ART + file).then((img) => { frames[i] = img; }));
      });
    }
  }

  const tiles = [];
  atlas[TILES].tiles.forEach((file, i) => {
    jobs.push(load(ART + file).then((img) => { tiles[i] = img; }));
  });
  const tileCols = 6;

  const bg = {};
  atlas[BG_SHEET].strips.forEach((file) => {
    const name = file.split('/').pop().replace(/^bg_|\.png$/g, '');
    jobs.push(load(ART + file).then((img) => { bg[name] = img; }));
  });

  for (const row of EXTRA_ALIENS) if (anim.extra?.[row]) anim.aliens[row] = anim.extra[row];
  for (const row of EXTRA_HAZARDS) if (anim.extra?.[row]) anim.hazards[row] = anim.extra[row];

  let logo = null;
  jobs.push(load(ART + atlas[UI_SHEET].logo).then((img) => { logo = img; }));

  let done = 0;
  const total = jobs.length;
  await Promise.all(jobs.map((p) => p.then(() => onProgress?.(++done, total))));

  return {
    anim,
    bg,
    get logo() { return logo; },
    backgrounds: BACKGROUNDS,
    tiles,
    tileCols,
    tileSize: atlas[TILES].size,
    // tile(row, variant) -> Image for a strata row
    tile(row, variant) {
      return tiles[row * tileCols + (variant % tileCols)];
    },
  };
}
