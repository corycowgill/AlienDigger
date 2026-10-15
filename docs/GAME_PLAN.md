# Alien Digger — Game Plan

## Concept
You pilot the **SUPER DRILL**, a heavily-armored boring machine dropped onto a hostile alien
world. Dig from the crust to the planetary core, plant fusion charges, and escape before
detonation. The blast shatters the planet and you harvest the precious minerals.

## Core Loop
1. **Descend** — drill downward through procedurally stacked strata.
2. **Survive** — fuel drains constantly, hazards and subterranean aliens damage the hull.
3. **Harvest** — collect minerals for upgrades; collect fuel cells to extend the
   run. The hold is finite, so harvesting is a choice of what to carry rather
   than a question of what you happened to pass.
4. **Plant** — reach the core chamber, plant N charges in sequence.
5. **Escape** — timer flips to countdown and the core floods: lava rises up the
   shaft behind you, pinned to the countdown so it breaches the surface exactly
   as the clock expires. Tremors escalate as it runs down. Drill back up.
6. **Payout** — planet detonates, minerals banked, spend at the Foundry, next
   planet — which is tougher, busier and pays more than the last.

> **Status.** This is the design, not a description of the build. The Foundry
> and all seven upgrades are in, and minerals now buy them, so ore density is
> live tuning, the Spitter spits, the drill cuts on all eight headings, and heat
> is in, all five pickup frames are live, the refined-gem row now pops on
> collection, and the cargo bay is finite so the haul is chosen rather than
> merely accumulated. Every art row the generator produced is used except the HUD and
> UI kit sheets, whose job the hand-drawn HUD primitives do instead.
> The drop capsule sits on the surface where the run starts and ends.

## Systems
- **Digger**: 8-directional drill; drilling speed varies per material. Hull HP,
  fuel, and heat — heat builds while cutting deep rock and sheds while not, so
  the deep game is paced rather than ground through. The ice shelf cools.
- **Fuel**: burns while drilling (fast) and idling (slow). Refuel from fuel cells / pods.
- **HUD**: hull health bar, mission timer, fuel gauge, depth meter, mineral tally, charge count.
- **Strata** (top to bottom): topsoil, sandstone, rock, ice shelf, fungal caverns,
  crystal layer, magma layer, core shell, **CORE CHAMBER**.
- **Hazards**: lava vents, pressurized gas pockets, acid pools, cave-ins/falling boulders,
  crusher rocks, electric mineral veins, void pits, geysers (only dangerous
  while firing, and the three frames are the tell), sinkholes (drop you several
  tiles, so they cost climbing rather than hull), magnet nodes (the only hazard
  that closes the distance -- it drags you in from one tile away).
- **Aliens**, each with its own behaviour rather than a shared chase:
  Grubworm (burrows through soft strata, so it arrives through a shaft wall),
  Rock Crab (armored — shrugs off half of ramming), Spitter (ranged acid down a
  clear tunnel; closes to melee without a line),
  Swarmlet (fast and erratic), Tunnel Lurker (dormant until you are close,
  then bolts), Core Guardian (boss, gates the charges).
  A second wave, each added for an answer the first five did not have:
  Ore Leech (robs the cargo bay instead of the hull, and carries what it stole
  until killed), Sentinel (rooted gun-polyp; a position to route around rather
  than a pursuer), Broodsac (bursts into swarmlets when killed, so kill it at
  range), Magmaling (deep and fast, lives where the flood comes from),
  Glowfly (passes through any rock, so it cannot be walled out).
- **Minerals**: Copper, Iridium, Voidstone, Alien Amber, Pulse Crystal (rarity
  ascending). They cluster into visible veins, richer and smaller with depth,
  and tier 3+ veins are guarded.
- **Cargo**: the hold is finite and every tier costs one slot, so the slot is
  the currency and what sits in it is the decision. Ore the bay cannot take is
  left lying in the tile it came from rather than destroyed, so the climb out
  doubles as a collection route; DUMP sheds the cheapest tier behind the drill,
  which makes a swap one press. Sized to bind on a vein-chasing descent and
  never on a straight one.
- **Upgrades**: drill bit, fuel tank, hull plating, scanner, thrusters, heat
  sinks, cargo bay (capacity *and* refining value).

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
| 14 | heat_laser.png | fx | Friction, hot/red bit, steam, beam, shield, hull crack, sputter |
| 16 | cavern_decor.png | sprites | Per-stratum scenery, 4 variants a row |
| 15 | collapse.png | fx | Fractures, rubble, cave-in, magma burst, shockwave, detonation |
| 18 | lava.png | tiles | Tileable molten crest and crust, bubbles, embers, splash, drips |

## Art Direction
- 16-bit era pixel art, chunky readable shapes, hard 1px black-ish outlines.
- Palette: rust orange + gunmetal for the drill; violet/teal alien biology;
  ochre/umber earth strata; hot magenta-orange magma; cyan HUD glow.
- Transparent backgrounds on all sprite sheets; no anti-aliasing, no gradients.
