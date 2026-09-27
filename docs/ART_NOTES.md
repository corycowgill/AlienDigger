# Alien Digger — Art Pipeline

All source art was generated in ChatGPT in a single conversation so the style and
palette stay consistent across sheets. Raw sheets live in `art/<category>/`,
machine-cut frames in `art/sliced/<sheet>/`, and `art/atlas.json` maps every
frame back to its rect in the source sheet.

## Source sheets

| File | Folder | Alpha | Contents |
|------|--------|-------|----------|
| `alien_digger_01_drill_sheet.png` | sprites | yes | Super Drill: 4 right, 4 down, 3 damage, 3 thruster |
| `alien_digger_02_aliens_sheet.png` | sprites | yes | 6 enemies x 3 frames |
| `alien_digger_03_terrain_tiles.png` | tiles | no | 6x8 strata tileset |
| `alien_digger_04_minerals_sheet.png` | sprites | yes | 5 ores, 5 gems, 5 pickups, sparkle anims |
| `alien_digger_05_hazards_sheet.png` | tiles | yes | 8 hazards x 3 frames |
| `alien_digger_06_hud_sheet.png` | hud | yes | Health, fuel, timer, depth, tally, charges, icons |
| `alien_digger_07_fx_sheet.png` | fx | yes | 8 effects, 4-6 frames each |
| `alien_digger_08_charges_props.png` | sprites | yes | Fusion charges + core and surface props |
| `alien_digger_09_ui_kit.png` | ui | yes | Title logo, panels, buttons, icons |
| `alien_digger_10_backgrounds.png` | backgrounds | no | 4 stacked parallax strips |

The tileset and the background sheet are intentionally opaque; everything else
carries a real alpha channel.

## Tileset rows (top to bottom)

`topsoil, packed dirt, sandstone, rock, ice shelf, fungal cavern, crystal vein,
magma + bedrock` — six variants per row, cut to `tile_r<row>_c<col>.png`.

## Background strips

`bg_surface`, `bg_upper_caverns`, `bg_crystal_depths`, `bg_magma_core` —
each ~1774px wide, meant to tile horizontally and scroll at different rates.

## Slicing

```
python tools/slice_sheets.py    # alpha sheets -> frames + atlas.json
python tools/slice_opaque.py    # tileset + backgrounds -> tiles/strips
```

`slice_sheets.py` cannot assume a fixed grid, because generated sheets are never
pixel-aligned. It builds an alpha occupancy profile, splits it into bands with an
aggressive noise floor to get the row and frame counts right, then grows each
band back out at a near-zero floor so tall or thin sprites keep their full
extent. `slice_opaque.py` instead looks for full-width runs of near-black pixels,
which is how both the tileset gutters and the background rules read.

Current output: **226 frames across 10 sheets.**

## Later sheets

Two sheets were generated after the game had been built, to replace places where
the code was compensating for missing art:

- `alien_digger_11_guardian_states` gives the boss a sprite per phase. The fight
  reads its state from the art now rather than from a coloured overlay on the
  same three frames.
- `alien_digger_12_drill_diagonals` covers the four diagonal headings. Eight-way
  drilling had been folding onto the nearest cardinal sprite.

Both were prompted in the original ChatGPT conversation so the palette matched
without having to re-describe it.

## Known rough edges

These are AI-generated sheets, so a few frames need a human pass before they ship:

- The drill sheet's thruster row merges a couple of frames that sit very close.
- Scattered-particle FX rows (sparks, debris) over-split, since loose particles
  read as separate frames. Harmless, but the extra frames are noise.
- Frame sizes vary slightly frame to frame. For animation, re-center each frame
  on a common canvas before use.
- Nothing is snapped to a true 32x32 pixel grid. Downsample to the target
  resolution with nearest-neighbour before shipping, or repaint by hand.

## Style reference for future generations

Prompt additions that produced consistent results: *"crisp 16-bit pixel art, hard
1-pixel dark outlines, limited palette, NO anti-aliasing, NO gradients, no text,
transparent background"*, plus an explicit row-by-row layout description. Keeping
every request in one ChatGPT conversation is what held the palette together.
