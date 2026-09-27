# Alien Digger — Game Plan

## Concept
You pilot the **SUPER DRILL**, a heavily-armored boring machine dropped onto a hostile alien
world. Dig from the crust to the planetary core, plant fusion charges, and escape before
detonation. The blast shatters the planet and you harvest the precious minerals.

## Core Loop
1. **Descend** — drill downward through procedurally stacked strata.
2. **Survive** — fuel drains constantly, hazards and subterranean aliens damage the hull.
3. **Harvest** — collect minerals for upgrades; collect fuel cells to extend the run.
4. **Plant** — reach the core chamber, plant N charges in sequence.
5. **Escape** — timer flips to countdown, drill back up to the surface.
6. **Payout** — planet detonates, minerals banked, spend at the Foundry, next planet.

> **Status.** This is the design, not a description of the build. The Foundry
> and all six upgrades are in, and minerals now buy them, so ore density is
> live tuning, and the Spitter now spits. Still unbuilt: heat and 8-directional
> drilling (the drill moves on 4). Two of the five pickup art frames are unused.

## Systems
- **Digger**: 8-directional drill; drilling speed varies per material. Hull HP, fuel, heat.
- **Fuel**: burns while drilling (fast) and idling (slow). Refuel from fuel cells / pods.
- **HUD**: hull health bar, mission timer, fuel gauge, depth meter, mineral tally, charge count.
- **Strata** (top to bottom): topsoil, sandstone, rock, ice shelf, fungal caverns,
  crystal layer, magma layer, core shell, **CORE CHAMBER**.
- **Hazards**: lava vents, pressurized gas pockets, acid pools, cave-ins/falling boulders,
  crusher rocks, electric mineral veins, void pits.
- **Aliens**: Grubworm (burrower), Rock Crab (armored, blocks tunnels), Spitter (ranged acid
  down a clear tunnel; closes to melee without a line),
  Swarmlet (fast, packs), Tunnel Lurker (ambush), Core Guardian (boss).
- **Minerals**: Copper, Iridium, Voidstone, Alien Amber, Pulse Crystal (rarity ascending).
- **Upgrades**: drill bit tier, hull plating, fuel tank, cargo bay, scanner, thrusters.

## Tech
- Web build: HTML5 canvas + TypeScript, or Godot 4 (2D). Tile grid 32x32.
- Sprites authored at 32x32 / 64x64, rendered nearest-neighbor, integer scaled 3x-4x.

## Art Manifest

> Generated and sliced. See `docs/ART_NOTES.md` for the pipeline and known rough edges.
| # | File | Folder | Contents |
|---|------|--------|----------|
| 1 | drill_sheet.png | sprites | Super Drill: idle, drill cycle, damaged, thruster |
| 2 | aliens_sheet.png | sprites | 6 alien enemies, 2-3 frames each |
| 3 | terrain_tiles.png | tiles | Strata tileset, 32x32 grid |
| 4 | minerals_sheet.png | sprites | 5 mineral ores + refined gems |
| 5 | hazards_sheet.png | tiles | Lava vent, gas, acid, spikes, crusher, boulder |
| 6 | hud_sheet.png | hud | Health/fuel bars, timer, depth, icons |
| 7 | fx_sheet.png | fx | Explosion, dust, sparks, drill debris |
| 8 | charges_sheet.png | sprites | Fusion charges, planted/armed/blinking |
| 9 | ui_sheet.png | ui | Title logo, buttons, panels, upgrade frames |
| 10 | backgrounds.png | backgrounds | Parallax cave layers + surface + core chamber |

## Art Direction
- 16-bit era pixel art, chunky readable shapes, hard 1px black-ish outlines.
- Palette: rust orange + gunmetal for the drill; violet/teal alien biology;
  ochre/umber earth strata; hot magenta-orange magma; cyan HUD glow.
- Transparent backgrounds on all sprite sheets; no anti-aliasing, no gradients.
