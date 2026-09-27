# Alien Digger

Pilot the **Super Drill** down through a hostile alien world, plant three fusion
charges in the planetary core, and climb back out before the planet comes apart.
Every mineral you dug on the way is banked when it blows.

A browser game with no build step: plain ES modules, a 2D canvas, and pixel art
generated with ChatGPT and cut into sprites by the scripts in `tools/`.

## Play

Open `index.html` through any static file server — ES modules will not load from
`file://`:

```bash
python -m http.server 8765
# then open http://localhost:8765/
```

**Keyboard** — `WASD` / arrow keys to drill, `E` to plant a charge, `R` to restart.
Hold two directions to cut a diagonal: it costs √2 as much to drill and to
cross, so a staircase is never a cheaper way straight down, only a cheaper way
sideways.

**Gamepad** — an Xbox controller (or anything reporting the standard mapping)
is picked up automatically: left stick or d-pad to drill, **A** to plant and to
install upgrades, **Y** or **Start** to restart and to launch. Browsers only
expose a pad after its first button press, so press something to wake it. A
connected pad hides the touch controls.

**Touch** — an on-screen d-pad and buttons appear automatically on touch devices.

**Sound** — `M`, **LB**, or the SOUND button toggles it; the choice persists.
Two detuned low oscillators drone under everything, and the filter closes as you
descend, so the world gets heavier underfoot; arming the charges lifts it.
Everything is synthesised at runtime from oscillators and filtered noise, so
there are no audio assets to download. Browsers will not start an AudioContext
without a user gesture, so it wakes on the keypress or tap that starts the run.

Add `?dev` to the URL for `dev.warp(depth)` and `dev.refuel()` in the console.

## Progression

Minerals are banked as credits when a run ends -- the full haul if the planet
cracked, a 40% salvage if the drill did -- and spent at **the Foundry** between
runs on six upgrades: drill bit, fuel tank, hull plating, scanner, thrusters and
cargo bay. Credits and levels persist in `localStorage`.

Planets get harder as you crack them: tougher rock, busier caves, a tighter
climb out -- and a bigger payout, so the risk is chosen rather than imposed.
Upgrades outpace that for a while and then the escalation catches back up, so a
maxed drill on planet 15 is still a real run.

The base game is tuned so a fresh save is hard: simulated, competent play clears
about two runs in three and a careless straight dig about one in twelve. Upgrades
buy the margin back rather than starting with it -- a part-kitted drill clears
~93%, and by then even careless play gets through more often than not.

## How it plays

Ore clusters into visible veins rather than scattering evenly, and the rich ones
sit deep and come guarded -- so a detour costs fuel, heat and hull for a much
bigger haul. That trade is the decision a run is actually about; the background
scatter is just what you pick up on the way past.

Buried in the rock alongside fuel and repairs: coolant that dumps all heat, a
shield that eats hits for a few seconds, and a bit overdrive. The Core Guardian has to be driven into -- there is no weapon -- before the
charges will arm, and it runs a cycle worth reading: its plating shrugs off
ramming, it opens for a window worth committing to, and it telegraphs a slam
with a ring you want to be outside. A bar over its head shows which.

Fuel is the real clock. Drilling burns it fast, travelling through open tunnel
burns it slowly, and running dry starts eating your hull. Fuel cells and repair
kits are scattered through the caves, so the descent is a supply problem as much
as a dig.

Once the charges are armed the way out stops being the way in: tremors drop
rubble into the shaft above you. It cuts easily, but the clock is running, so
the climb is something you play rather than hold a key through.

Heat is the other clock. Deep rock heats the bit and a redline eats your hull,
but it sheds fast the moment you stop cutting -- so the deep game is paced, not
ground through, and the ice shelf is worth crossing because it actively cools.

Eight strata get harder as you go down — topsoil, dirt, sandstone, rock, ice,
fungal caverns, crystal, magma — and both the ore and the danger get richer with
depth. Aliens chase when you get close; hazards hit when you share their tile.
The drill has no gun, so ramming is the only offence: it hurts you too, which
makes the Core Guardian something to dodge rather than fight.

## Layout

```
index.html                 the page
intro/                     Hallucinated Games studio ident (vendored)
src/                       game modules (assets, input, world, player, entities,
                           fx, hud, audio, title, help, foundry, progress, main)
art/<category>/            raw generated sheets, as downloaded
art/game/                  the shipping bundle: cut, normalized, downsampled
art/atlas.json             every sliced frame's rect in its source sheet
tools/                     the slicing pipeline
docs/GAME_PLAN.md          design: loop, systems, strata, upgrades
docs/ART_NOTES.md          art pipeline and its known rough edges
```

`art/sliced/` is intermediate output and is not committed. Regenerate it with:

```bash
python tools/slice_sheets.py     # alpha sheets -> frames + atlas.json
python tools/slice_opaque.py     # tileset + backgrounds
python tools/normalize_frames.py # -> art/game/, the bundle the game loads
```

Only `art/game/` is needed at runtime; the raw sheets are kept as the source of
truth for re-cutting.

## Deploying

The repo is a static site with nothing to build, so any static host works. On
[Render](https://render.com), create a **Static Site** from this repo with:

| Setting | Value |
|---|---|
| Branch | `main` |
| Root Directory | *(blank)* |
| Build Command | *(blank)* |
| Publish Directory | `.` |

`index.html` sits at the repo root, so the game loads at the site root.

## Teaching

Six first-time hints fire the moment the thing they explain is actually
happening -- heat climbing, the tank running low, a tile flashing red, ore
coming up in a vein, the Guardian's cycle -- then never again. They are stored
in the save, not the run, so a hint earned in a run you lost stays learned.
Nothing waits for input; the help screen (`H`) is still the full reference.

## Feedback

Anything that changes your state says so where you are looking, which is the
shaft rather than the HUD: the refined gem pops out of the rock and its value
floats off it, sized and pitched by tier; damage floats a number in the colour
of whatever dealt it; any alien you have hurt carries a small health bar, and
the Guardian a full one naming what it is doing.

## Motion

Short animation cycles ping-pong rather than wrap: a three-frame walk played
0,1,2,0,1,2 snaps on the wrap, and 0,1,2,1 turns the same frames into a smooth
there-and-back, which is most of what made them read as choppy. Tile-to-tile
movement carries its overshoot into the next tile instead of discarding it,
which used to stall the drill for a fraction of a tile at every single step. The
camera uses frame-rate independent smoothing, so it lags the same amount at 30fps
as at 60.

## Look

The drill carries its own light and the dark closes in with depth. Tile variants
are chosen from a noise field rather than at random, so similar rock clusters
into patches instead of scattering six unrelated textures across every layer,
and the seam between two strata is bled together over a few tiles rather than
ruled straight across the screen.

## Rendering

Terrain is drawn into an offscreen canvas and blitted, rather than issuing a
drawImage per visible tile per frame. The cache scrolls rather than rebuilding:
crossing a tile boundary shifts the existing pixels and repaints only the strip
that came into view, and a dug tile repaints just itself via `world.dirty`. The
cache is sized to a whole number of tiles, which matters -- at 664px it was
20.75 tiles tall, so the bottom row straddled the edge and a scroll left stale
rock behind it in visible horizontal streaks.

Measured at depth while drilling: mean frame 1.94ms to 0.38ms, p90 8.1ms to
0.6ms, p99 19.8ms to 3.5ms. The p99 is the one that matters for how the game
feels -- that is the periodic hitch, and it is what a full rebuild was costing
several times a second.

## Balance tooling

```bash
node tools/sim.mjs 60                  # whole descents, headless, two policies
node tools/sim.mjs 60 drill=2,hull=2   # ... at a given upgrade level
node tools/sim.mjs 60 drill=5 9        # ... on the 10th planet
node tools/supply.mjs 200              # is the deep game still supplyable?
node tools/census.mjs 20               # what a generated world actually contains
```

`sim.mjs` drives the real modules in Node and splits deaths into "died with fuel
left" versus "ran dry", because a win rate alone averages that distinction away
-- a run lost to chip damage it could not avoid reads identically to one lost to
bad routing, and only the second is a game working.

## Studio ident

`intro/hallucinated-intro.js` is vendored from `gameCentral/intro/` so this game
stays a self-contained deploy; re-copy that file to take an update. It has to be
started from a classic script at the top of `<body>`, not from the module: a
module is deferred until the document has parsed and its imports have resolved,
which would let the loading screen paint first. The promise goes on
`window.__studioIntro` and `main.js` awaits it before revealing the title, so the
art loads underneath the ident and the ident is never cut off.
