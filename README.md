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

**Desktop** — `WASD` / arrow keys to drill, `E` to plant a charge, `R` to restart.
**Mobile** — an on-screen d-pad and buttons appear automatically on touch devices.

Add `?dev` to the URL for `dev.warp(depth)` and `dev.refuel()` in the console.

## How it plays

Fuel is the real clock. Drilling burns it fast, travelling through open tunnel
burns it slowly, and running dry starts eating your hull. Fuel cells and repair
kits are scattered through the caves, so the descent is a supply problem as much
as a dig.

Eight strata get harder as you go down — topsoil, dirt, sandstone, rock, ice,
fungal caverns, crystal, magma — and both the ore and the danger get richer with
depth. Aliens chase when you get close; hazards hit when you share their tile.
The drill has no gun, so ramming is the only offence: it hurts you too, which
makes the Core Guardian something to dodge rather than fight.

## Layout

```
index.html                 the page
intro/                     Hallucinated Games studio ident (vendored)
src/                       game modules (assets, input, world, player,
                           entities, fx, hud, title, main)
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

## Studio ident

`intro/hallucinated-intro.js` is vendored from `gameCentral/intro/` so this game
stays a self-contained deploy; re-copy that file to take an update. It has to be
started from a classic script at the top of `<body>`, not from the module: a
module is deferred until the document has parsed and its imports have resolved,
which would let the loading screen paint first. The promise goes on
`window.__studioIntro` and `main.js` awaits it before revealing the title, so the
art loads underneath the ident and the ident is never cut off.
