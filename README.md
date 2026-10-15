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
python tools/serve.py          # http://localhost:8765, caching off
# or: python -m http.server 8765
```

Use `tools/serve.py` while developing. `python -m http.server` sends no cache
headers, so a browser will happily pair a *new* `main.js` with a *stale*
`audio.js` and throw "X is not a function" -- which looks exactly like a bug in
the code you just wrote. That cost this project an afternoon more than once.

**Keyboard** — `WASD` / arrow keys to drill, `E` to plant a charge, `F` (or `Q`)
to fire the laser, `G` to dump the cheapest ore aboard (hold to repeat), `R` to
restart.
Hold two directions to cut a diagonal: it costs √2 as much to drill and to
cross, so a staircase is never a cheaper way straight down, only a cheaper way
sideways.

**Gamepad** — an Xbox controller (or anything reporting the standard mapping)
is picked up automatically: left stick or d-pad to drill, **A** to plant and to
install upgrades, **Y** or **Start** to restart and to launch. Browsers only
expose a pad after its first button press, so press something to wake it. A
connected pad hides the touch controls. **B** or **RT** fires the laser, **RB**
dumps ore.

**Touch** — an eight-way d-pad and buttons appear automatically on touch devices.
The corners hold two directions at once, so a diagonal takes one thumb rather
than two. Everything is sized against the viewport, and portrait stacks the
picture above the controls instead of overlaying them.

`tools/mobile.html` renders the game in iframes at four real phone viewports,
which is the only way to see the touch layout without a phone: `window.resizeTo`
is a no-op on a maximised desktop browser, and `?touch` forces the layout on.

**Music** — a generative score, not a loop and not a file: the same oscillators
everything else uses, reading the run as it goes. Depth drives tempo and
density, so the surface is a bare bassline and the magma layer is three times as
busy; arming the charges switches it to the escape figure, about five times the
note rate of the surface. Four bars of D minor underneath -- i, VI, III, VII --
which is enough harmony to sit under a game for twenty minutes without
announcing itself. It has its own bus well under the effects.

**Sound** — `M`, **LB**, or the SOUND button toggles it; the choice persists.
Two detuned low oscillators drone under everything, and the filter closes as you
descend, so the world gets heavier underfoot; arming the charges lifts it. Every
voice sums into a compressor, because an explosion peaks nearly five times
higher than an ore chime and layering them clipped. Sequences schedule on the
audio clock rather than through `setTimeout`, and the escape alarm is driven
from the game loop -- an interval drifted and, worse, kept beeping after a
restart because nothing cleared it.
Everything is synthesised at runtime from oscillators and filtered noise, so
there are no audio assets to download. Browsers will not start an AudioContext
without a user gesture, so it wakes on the keypress or tap that starts the run.

Add `?dev` to the URL for `dev.warp(depth)` and `dev.refuel()` in the console.

## Progression

Minerals are banked as credits when a run ends -- the full haul if the planet
cracked, a 40% salvage if the drill did -- and spent at **the Foundry** between
runs on seven upgrades: drill bit, fuel tank, hull plating, scanner, thrusters,
heat sinks and cargo bay. Credits and levels persist in `localStorage`.

Planets get harder as you crack them: tougher rock, busier caves, a tighter
climb out -- and a bigger payout, so the risk is chosen rather than imposed.

They also differ in kind. The Foundry offers three worlds to choose between,
always including a plain one, so the screen asks two questions rather than one:
what to buy, and where to take it. A type has to change what the run *is*, not
just how hard it is -- a **frozen** world is slow rock that lets the bit run
cold, so heat stops being what paces you; a **hollow** one is barely any
drilling and far more company, so the hull binds before the tank does; a
**dense** one is nearly solid, which is quiet and slow and thirsty. Measured
over 60 runs each, they form a ladder rather than a ranking:

| world | escaped | banked |
|---|---|---|
| frozen | 36/60 | 186 CR |
| rocky | 33/60 | 208 CR |
| dense | 23/60 | 224 CR |
| hollow | 23/60 | 213 CR |
| rich | 21/60 | 244 CR |
| volcanic | 19/60 | 258 CR |

Safer is poorer and riskier is richer, which is the shape that makes the choice
worth making. One caveat the simulator cannot settle: FROZEN's real benefit is
heat relief, and the policies already pace heat perfectly, so they value it at
nothing. A human who redlines will rate it higher than that table does.
Upgrades outpace that for a while and then the escalation catches back up, so a
maxed drill on planet 15 is still a real run.

The base game is tuned so a fresh save is hard: simulated, competent play clears
about two runs in three, and a careless straight dig never gets out at all --
it runs the tank dry around 145m, on every seed tried.

The first hour is its own question, and `beeline` is the wrong way to ask it:
holding one key into the dark past a fuel cell two tiles away is worst-possible
play, not inexperience. The `novice` policy is the honest proxy -- it has
understood "go down" and "grab the cans" and nothing else, reacts to the
redline instead of anticipating it, and detours three tiles rather than eight.
Measured over 60 runs at each rung:

| save | novice escapes |
|---|---|
| fresh | 0/60 |
| hull 1, tank 1 | 13/60 |
| hull 2, tank 2, drill 1 | 34/60 |
| hull 3, tank 3, drill 2, thrusters 2 | 51/60 |

A fresh save genuinely never wins on naive play, and that is the first chapter
rather than a flaw: the novice still *reaches the core* about two runs in three
and banks 59 CR of salvage each time, against a 110 CR cheapest upgrade. Two
runs buys the first part, four buys the pair that makes the game winnable.
Where it dies is specific -- 41 of 60 deaths are on the climb out, with fuel
still in the tank -- so the lesson the game teaches is "arrive healthier",
which is exactly what hull plating sells.

This was worth measuring rather than guessing at. The first fix tried for it --
repair kits in the core chamber -- lifted *competent* play from 41/60 to 48/60
and did nothing at all for the novice, who never walks over them. It made the
game easier for the people already winning and was reverted. Upgrades buy the margin
back rather than starting with it: at `drill=2,tank=2,hull=2` competent play
clears 37/40, and the straight dig starts surviving occasionally rather than
never. (The last two numbers used to read "one in twelve" and "more often than
not"; both were measured before the laser landed and neither survived it.)

## How it plays

Ore clusters into visible veins rather than scattering evenly, and the rich ones
sit deep and come guarded -- so a detour costs fuel, heat and hull for a much
bigger haul. That trade is the decision a run is actually about; the background
scatter is just what you pick up on the way past.

Buried in the rock alongside fuel and repairs: coolant that dumps all heat, a
shield that eats hits for a few seconds, and a bit overdrive. The Core Guardian has to be brought down before the
charges will arm, and it runs a cycle worth reading: its plating shrugs off
ramming, it opens for a window worth committing to, and it telegraphs a slam
with a ring you want to be outside. A bar over its head shows which.

Fuel is the real clock. Drilling burns it fast, travelling through open tunnel
burns it slowly, and running dry starts eating your hull. Fuel cells and repair
kits are scattered through the caves, so the descent is a supply problem as much
as a dig.

Once the charges are armed the way out stops being the way in. The core floods
and the lava climbs the shaft behind you, tremors drop rubble into the shaft
above you, and the tremors close in as the clock runs down -- more often, and
more of it each time, so the last fifteen seconds are a different game from the
first fifteen.

The flood is pinned to the same clock as the countdown: it reaches the surface
exactly as the timer hits zero, after a short head start so that planting the
third charge does not drown you where you stand. So it can never lose a run the
clock would have won, and the two can never disagree about how long is left.
What it adds is that the deadline is now something you can *see*. A number in
the HUD can tell you thirty seconds remain; it cannot tell you that thirty
seconds is not enough for the rubble plug directly above you. The lava can,
because it is right there, and it is closer than it was. Measured across 40
runs, a competent climb keeps the surface about ten tiles below it the whole way
up -- close enough to read, far enough to survive. It cuts easily, but the clock is running, so
the climb is something you play rather than hold a key through -- and the ore a
full bay made you leave behind is lying along it, which is the other reason the
way out is not just the way in backwards.

Heat is the other clock. Deep rock heats the bit and a redline eats your hull,
but it sheds fast the moment you stop cutting -- so the deep game is paced, not
ground through, and the ice shelf is worth crossing because it actively cools.

Eight strata get harder as you go down — topsoil, dirt, sandstone, rock, ice,
fungal caverns, crystal, magma — and both the ore and the danger get richer with
depth. Aliens chase when you get close; hazards hit when you share their tile.
Ramming is the main offence and it hurts you too, which makes the Core
Guardian something to dodge rather than fight.

## The cargo bay

The hold is finite -- 16 slots on a fresh save, 32 with the bay maxed -- and
every ore takes one slot whatever it is worth. So the slot is the currency, and
what is in it is the decision: a full bay passing a pulse crystal is a choice to
dump a copper, come back for it later, or leave 50 credits in the rock. `G` (or
**RB**, or DUMP) sheds the cheapest tier aboard into the tile *behind* the
drill, which is what makes the swap one press rather than two -- parked on a
find with a full hold, the copper goes out the back and the crystal comes
aboard the same frame.

Nothing a full bay cannot take is ever destroyed. It stays lying in the tile it
came out of, drawn as a refined gem rather than ore in rock, and it is still
there on the way back up -- so the climb stops being a pure retrace and becomes
a collection route you laid down yourself on the way in. Tremors during the
escape bury those piles rather than deleting them: the ore is still yours, it
just costs seconds you do not have to cut it back out.

The limit is deliberately sized to bind on greed and never on caution. A
straight shaft down the spawn column frees about 8 ore and the fuel-first
descent about 9, so neither comes near 16 slots; a descent that detours for
veins fills it on roughly two runs in five, and banks 70% more for doing so. The
player who ignored the ore never meets the mechanic, which is the point -- it is
a tax on nobody and a decision for anyone who went looking. Maxing the bay eases
that choice rather than ending it: at 32 slots a hard-prospecting run still
fills up about one time in twenty. The first cut gave 7 slots a level instead of
4, which retired the decision entirely by level 2 -- a mechanic that only exists
on a fresh save is not a mechanic.

## The laser

The drill carries a short laser (`F`, **B**/**RT**, or FIRE on touch) that fires
along its heading up to seven tiles. It burns every alien in the beam -- armour
and the Guardian's plating count exactly as they do for ramming, so the boss
still has to be caught open -- and scorches hardness off the first rock it hits,
breaking soft strata outright and softening the rest for the drill.

It is a sidearm, not a replacement for the drill, and it cannot be spammed: one
shot per press (holding does nothing), a 2.4s recharge, and every shot dumps 24
heat into the bit and costs a little fuel. It refuses to fire at all once the
bit is above 76 heat, so it trades against drilling rather than replacing it. A
gauge under the charges reads READY, charging, or HOT, and a refused shot says
why over the drill.

## Reading the aliens

Every alien has an answer, and they are different answers -- before this the
five behaviours all resolved to the same two verbs, so the AI carried
distinctions the player's decisions did not.

- A **rock crab**'s shell only covers the way it faces. Meeting one head-on in a
  corridor costs double; its flank and its back are bare. The plate is drawn on
  the side it actually covers, and the sprite mirrors to its heading.
- A **spitter** opens up for 1.1s after it fires and takes 60% more while it
  vents. It holds its ground whenever it has a clear line, so the answer is to
  eat the shot and close, rather than to route around it forever.
- A **lurker** coils for about half a second before it bolts. It hits harder
  than anything but the boss and used to give no warning at all, which made it a
  tax on walking past rather than something to react to.
- A **grubworm** arrives through the wall, and the **Guardian**'s plating is a
  phase rather than a direction -- no approach angle beats it, so it still has
  to be caught open.

The Guardian also closes up as it loses. It used to run the same cycle on the
same timer at full health and at one hit point, so the climax of a run got
*easier* the longer it went on: you learned the rhythm in the first ten seconds
and then repeated it. Now the open window shortens from 2.8s to 1.6s, the
warning before a slam shortens from 0.75s to 0.47s, and a cornered Guardian
swings three tiles instead of two -- with the telegraph ring growing to match,
because a ring still drawing the old radius would be telling the player they
were clear when they were not. The opening teaches the pattern; the ending
demands you already know it. Measured over 60 runs it did not move the win rate,
but deaths in the chamber went from almost none to four.

Five more kinds joined them, each for an answer the first five did not have. An
**ore leech** robs the cargo bay rather than the hull -- the only enemy whose
damage is counted in credits -- and carries what it took until something kills
it, at which point the haul drops on the floor. A **sentinel** is rooted into
the rock and never takes a step, so it is a place to route around rather than
something that comes to you. A **broodsac** bursts into swarmlets when killed,
which makes killing it at range the whole point. A **magmaling** is fast and
lives where the flood comes from. A **glowfly** passes through any rock at all,
so it is the one thing you cannot wall out.

Three new hazards came with them: a **geyser** is only dangerous while it is
firing and its three frames are the tell, a **sinkhole** drops you several tiles
so it costs climbing rather than hull, and a **magnet node** is the only hazard
that closes the distance, dragging the drill onto itself from one tile away.

Adding them made the game measurably *easier*, which was not obvious up front:
new kinds share the spawn budget rather than adding to it, so a softer kind
displaces a lurker instead of joining it. Competent play went from 27/40 to
31/40 on variety alone. The alien spawn rate went from 0.030 to 0.032 to put it
back on two runs in three.

Things come apart according to what they are made of, rather than all dying as
the same puff of debris: flesh ruptures, shell shatters, a magma creature guts
out to cinders, a machine arcs and buckles, and a spore sac pops into a cloud
that thins away. Each leaves a mark, so a tunnel you fought through looks
fought through. Keyed by material rather than by species -- ten kinds times a
bespoke death would be a sheet nobody wants to draw, and at forty pixels a crab
and a sentinel shattering are the same event. A check fails if any kind ships
without a death behind it.

The ram and the laser resolve through one function, so they can never disagree
about what lands: the ram passes the reverse of the drill's heading, the beam
the reverse of its travel.

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

Each stratum names itself as you break into it -- ICE, 80m, runs cold -- so the
descent has waypoints rather than only a rising number.

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

Open space takes a shadow along every edge it shares with rock, so a shaft you
cut reads as carved rather than as an absence where the background shows
through. The drill carries its own light and the dark closes in with depth. Tile variants
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
node tools/sim.mjs 60                  # whole descents, headless, four policies
node tools/sim.mjs 60 drill=2,hull=2   # ... at a given upgrade level
node tools/sim.mjs 60 drill=5 9        # ... on the 10th planet
node tools/sim.mjs 60 detour=9         # ... prospecting further off the shaft
node tools/supply.mjs 200              # is the deep game still supplyable?
node tools/census.mjs 20               # what a generated world actually contains
```

The four policies are ascending competence, not just greed. `beeline` digs
straight down and ignores everything; `novice` grabs what is close once it is
already hurting and reacts to the redline rather than pacing it; `greedy`
manages fuel, hull and heat but walks past every vein in the world; and
`prospector` also detours for ore up to `detour` tiles off its shaft.
The third one exists because the first two free about nine ore in a whole run and
so never fill a sixteen-slot bay -- measuring the cargo limit against them would
have reported, correctly but uselessly, that it does nothing.

How far it is worth straying, at 40 runs a row:

| detour | escaped | bay filled | banked |
|---|---|---|---|
| none (`greedy`) | 27/40 | 4/40 | 144 CR |
| 4 tiles | 24/40 | 10/40 | 190 CR |
| 6 tiles | 21/40 | 18/40 | 224 CR |
| 9 tiles | 10/40 | 32/40 | 209 CR |
| 13 tiles | 0/40 | 35/40 | 165 CR |

Banked credits climb and then collapse, which is the shape the detour is
supposed to have: six tiles off the shaft is the peak at +56% money, nine is
strictly worse than six, and thirteen loses every run to the clock. Greed costs
about fifteen points of win rate at the peak, which is the price it should carry
-- before the collapse escalated it cost almost nothing, so detouring was a
no-brainer rather than a decision. The `beeline` and `greedy` rows never fill
the bay at all, which is the other half of the tuning: a player who did not go
looking for ore never meets the limit.

`tools/statesheet.js` is the visual counterpart: load the game with `?dev` and
run

```js
await (await fetch('tools/statesheet.js')).text().then(eval)
```

and it drives the game through all 37 of its visual states -- every heading, a
damaged rig, each stratum, each boss phase, the bit's heat stages, a full cargo
bay with ore lying where it was left, the second wave of creatures and hazards,
the combat tells, every material death, the rising flood, the wreck, the banner,
the Foundry, the help -- and lays them out as one contact sheet.

Worth knowing what it is for: a contact sheet tile is 0.4x scale, which is the
right size for catching a state that is broken, blank or composed wrong, and the
wrong size for judging a sprite. Judge sprites at full resolution. Updating this
tool immediately found a state leak in it -- the escape flag survived the flood
captures, so the wreck and the banner were being photographed from under forty
feet of lava. `check.mjs` verifies the
rules; it cannot see a sprite pointing the wrong way, a banner covering the
explosion it announces, or an effect frozen mid-animation. All three of those
have shipped here, and all three were caught by looking rather than by a check
going red.

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
