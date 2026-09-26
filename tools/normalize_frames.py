"""
Turn the raw sliced frames into game-ready animation assets.

The slicers find frames by looking at ink, which gets three things wrong that
matter once you actually try to play an animation:

  1. Frames whose sprites nearly touch come out merged into one wide frame.
  2. Detached bits (a spark, a thrown acid blob) come out as their own frames.
  3. Every frame is cropped to its own ink, so a 4-frame cycle jitters wildly.

Inferring the cell size from the frames themselves does not survive contact with
particle effects, where a sprite legitimately grows and shrinks across the cycle.
So the frame count per row is declared instead: it comes from the generation
prompt, which asked for an exact number of frames in each row. Knowing N, the
row's ink span divides evenly into N cells, which is what the sheets actually
are. Each cell is then re-rendered onto one shared canvas so the animation sits
still, downsampled to a sane sprite size, and quantized back to a tight palette,
so the result is real pixel art rather than a shrunken illustration.

Usage:  python tools/normalize_frames.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"
OUT = ART / "game"

PALETTE = 48            # colours kept per sheet after downsampling
ALPHA_CUT = 128         # alpha is re-hardened at this threshold

# Longest edge, in pixels, for each sheet's normalized frames.
TARGET = {
    "alien_digger_01_drill_sheet": 64,
    "alien_digger_02_aliens_sheet": 48,
    "alien_digger_04_minerals_sheet": 32,
    "alien_digger_05_hazards_sheet": 48,
    "alien_digger_07_fx_sheet": 64,
    "alien_digger_08_charges_props": 48,
}
TILE_SHEET = "alien_digger_03_terrain_tiles"
TILE_SIZE = 32
UI_SHEET = "alien_digger_09_ui_kit"
LOGO_HEIGHT = 200      # the title plate, for the start screen
BG_SHEET = "alien_digger_10_backgrounds"
BG_HEIGHT = 180        # parallax strips only ever draw scaled, so cap the height

# Rows that are single oversized characters rather than a uniform cycle.
BIG_ROWS = {"guardian"}

# Frames per row, as requested in the generation prompt. This is the ground
# truth the ink-based slicer cannot recover on its own.
COUNTS = {
    "right": 4, "down": 4, "damage": 3, "thruster": 3,
    "grubworm": 3, "rockcrab": 3, "spitter": 3, "swarmlet": 3,
    "lurker": 3, "guardian": 3,
    "ore": 5, "gem": 5, "pickup": 5, "sparkle": 8,
    "lavavent": 3, "gaspocket": 3, "acidpool": 3, "crusher": 3,
    "boulder": 3, "electricvein": 3, "spiketrap": 3, "voidpit": 3,
    "explosion": 6, "dustpuff": 4, "debris": 4, "sparks": 4,
    "flash": 4, "smoke": 5, "acidsplash": 4, "shieldhit": 4,
    "charge": 3, "planted": 4, "armed": 4, "coreprop": 5, "surfaceprop": 5,
}


def regroup(row, frames):
    """Re-cut a row's ink span into the number of cells the prompt asked for.

    Falls back to the detected frames when a row has no declared count, which is
    what the irregular HUD and UI rows need.
    """
    n = COUNTS.get(row)
    if not n:
        return [dict(f) for f in frames]

    x0 = min(f["rect"]["x"] for f in frames)
    x1 = max(f["rect"]["x"] + f["rect"]["w"] for f in frames)
    y0 = min(f["rect"]["y"] for f in frames)
    y1 = max(f["rect"]["y"] + f["rect"]["h"] for f in frames)
    step = (x1 - x0) / n
    return [
        {"row": row, "rect": {"x": int(x0 + i * step), "y": y0,
                              "w": int(step), "h": y1 - y0}}
        for i in range(n)
    ]


def finish(img, target):
    """Downsample to the target box and harden the result back into pixel art."""
    w, h = img.size
    scale = target / max(w, h)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    small = img.resize(size, Image.BOX)          # area-average, keeps detail
    a = small.getchannel("A").point(lambda v: 255 if v >= ALPHA_CUT else 0)
    rgb = small.convert("RGB").quantize(
        colors=PALETTE, method=Image.MEDIANCUT, dither=Image.NONE
    ).convert("RGB")
    rgb.putalpha(a)
    return rgb


def main():
    atlas = json.loads((ART / "atlas.json").read_text())
    out_atlas = {}
    OUT.mkdir(parents=True, exist_ok=True)

    for sheet, target in TARGET.items():
        entry = atlas[sheet]
        src = Image.open(ART / entry["source"]).convert("RGBA")
        dest = OUT / sheet
        dest.mkdir(parents=True, exist_ok=True)

        rows = {}
        for f in entry["frames"]:
            rows.setdefault(f["row"], []).append(f)

        anims = {}
        for row, frames in rows.items():
            frames = regroup(row, sorted(frames, key=lambda f: f["rect"]["x"]))

            # one shared canvas for the whole row: centred across, sat on the floor
            cw = max(f["rect"]["w"] for f in frames)
            ch = max(f["rect"]["h"] for f in frames)
            box = target * 2 if row in BIG_ROWS else target

            out_frames = []
            for i, f in enumerate(frames):
                r = f["rect"]
                cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
                cell.paste(src.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])),
                           ((cw - r["w"]) // 2, ch - r["h"]))
                name = f"{row}_{i:02d}.png"
                finish(cell, box).save(dest / name)
                out_frames.append(f"game/{sheet}/{name}")

            anims[row] = {"frames": out_frames, "count": len(out_frames)}
            print(f"  {sheet}/{row:14s} {len(rows[row]):2d} -> {len(frames):2d} frames")

        out_atlas[sheet] = {"animations": anims}

    # tiles just need squaring off to the grid size
    tiles = atlas[TILE_SHEET]
    src = Image.open(ART / tiles["source"]).convert("RGBA")
    dest = OUT / TILE_SHEET
    dest.mkdir(parents=True, exist_ok=True)
    tile_files = []
    for f in tiles["frames"]:
        r = f["rect"]
        crop = src.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
        out = crop.resize((TILE_SIZE, TILE_SIZE), Image.BOX).convert("RGB")
        out = out.quantize(colors=PALETTE, method=Image.MEDIANCUT,
                           dither=Image.NONE).convert("RGB")
        name = f["name"] + ".png"
        out.save(dest / name)
        tile_files.append(f"game/{TILE_SHEET}/{name}")
    out_atlas[TILE_SHEET] = {"tiles": tile_files, "size": TILE_SIZE}
    print(f"  {TILE_SHEET}: {len(tile_files)} tiles at {TILE_SIZE}x{TILE_SIZE}")

    # the title logo is the leftmost element of the UI kit's top row
    ui = atlas[UI_SHEET]
    top = min(ui["frames"], key=lambda f: (f["rect"]["y"], f["rect"]["x"]))
    src = Image.open(ART / ui["source"]).convert("RGBA")
    r = top["rect"]
    band = src.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
    alpha = band.getchannel("A").load()
    col = [sum(1 for y in range(band.height) if alpha[x, y] > ALPHA_CUT)
           for x in range(band.width)]
    # There is no blank gutter after the logo: its rubble runs into the panels'
    # shadows and the emptiest column is still ~12% ink. So cut at the deepest
    # valley in the band's left half rather than looking for a clean break.
    lo, hi = int(band.width * 0.20), int(band.width * 0.55)
    end = min(range(lo, hi), key=lambda x: col[x])
    logo = band.crop((0, 0, end, band.height))
    logo = logo.crop(logo.getbbox())
    dest = OUT / UI_SHEET
    dest.mkdir(parents=True, exist_ok=True)
    finish(logo, round(LOGO_HEIGHT * logo.width / logo.height)).save(dest / "logo.png")
    out_atlas[UI_SHEET] = {"logo": f"game/{UI_SHEET}/logo.png"}
    print(f"  {UI_SHEET}: logo cut at {end}px wide")

    # parallax strips come along so that art/game/ is the whole shipping bundle
    bg = atlas[BG_SHEET]
    src = Image.open(ART / bg["source"]).convert("RGB")
    dest = OUT / BG_SHEET
    dest.mkdir(parents=True, exist_ok=True)
    bg_files = []
    for f in bg["frames"]:
        r = f["rect"]
        crop = src.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"]))
        scale = BG_HEIGHT / crop.height
        crop = crop.resize((round(crop.width * scale), BG_HEIGHT), Image.BOX)
        crop = crop.quantize(colors=64, method=Image.MEDIANCUT,
                             dither=Image.NONE).convert("RGB")
        name = f["name"] + ".png"
        crop.save(dest / name)
        bg_files.append(f"game/{BG_SHEET}/{name}")
    out_atlas[BG_SHEET] = {"strips": bg_files}
    print(f"  {BG_SHEET}: {len(bg_files)} strips at {BG_HEIGHT}px tall")

    (OUT / "atlas.json").write_text(json.dumps(out_atlas, indent=2))
    total = sum(a["count"] for s in out_atlas.values()
                for a in s.get("animations", {}).values()) + len(tile_files)
    print(f"\nWrote {(OUT / 'atlas.json').relative_to(ROOT)} -- {total} game-ready frames")


if __name__ == "__main__":
    main()
