"""
Slice the ChatGPT-generated Alien Digger sprite sheets into individual frames.

The sheets are AI-generated, so frames are NOT on an exact pixel grid. Instead of
assuming a fixed cell size we find rows via a horizontal alpha projection, then
find frames within each row via a vertical projection. Output is one PNG per
frame plus a JSON atlas describing every frame's source rect.

Usage:  python tools/slice_sheets.py
"""
import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"
OUT = ROOT / "art" / "sliced"

ALPHA_MIN = 128     # pixel counts as "ink" above this alpha
ROW_GAP = 2         # blank rows needed to end a row band
COL_GAP = 2         # blank columns needed to end a frame
MIN_ROW_H = 24      # ignore row bands thinner than this
MIN_COL_W = 24      # ignore frames narrower than this
PAD = 1             # transparent padding around each exported frame

# ChatGPT's cutouts leave stray specks and faint halos in the gutters, so a
# scanline only counts as "blank" when its ink falls under a fraction of the
# perpendicular dimension rather than exactly zero. We split with the aggressive
# SPLIT_FRAC to get the band count right, then grow each band back out to
# NOISE_FRAC so nothing gets clipped off the sprites.
SPLIT_FRAC = 0.05
NOISE_FRAC = 0.004

# Row labels per sheet, in top-to-bottom order. Extra rows fall back to rowN.
ROW_NAMES = {
    "alien_digger_01_drill_sheet": ["right", "down", "damage", "thruster"],
    "alien_digger_02_aliens_sheet": [
        "grubworm", "rockcrab", "spitter", "swarmlet", "lurker", "guardian",
    ],
    "alien_digger_04_minerals_sheet": ["ore", "gem", "pickup", "sparkle"],
    "alien_digger_05_hazards_sheet": [
        "lavavent", "gaspocket", "acidpool", "crusher",
        "boulder", "electricvein", "spiketrap", "voidpit",
    ],
    "alien_digger_07_fx_sheet": [
        "explosion", "dustpuff", "debris", "sparks",
        "flash", "smoke", "acidsplash", "shieldhit",
    ],
    "alien_digger_08_charges_props": [
        "charge", "planted", "armed", "coreprop", "surfaceprop",
    ],
    "alien_digger_06_hud_sheet": ["hud"],
    "alien_digger_09_ui_kit": ["ui"],
}


def _spans(profile, gap, min_size, floor):
    """Turn a 1-D occupancy profile into (start, end) spans."""
    out, start, blank = [], None, 0
    for i, c in enumerate(profile):
        if c > floor:
            if start is None:
                start = i
            blank = 0
        elif start is not None:
            blank += 1
            if blank >= gap:
                end = i - blank
                if end - start + 1 >= min_size:
                    out.append((start, end))
                start, blank = None, 0
    if start is not None:
        end = len(profile) - 1
        if end - start + 1 >= min_size:
            out.append((start, end))
    return out


def bands(profile, gap, min_size, perpendicular):
    """Split a profile into bands, then grow each band back to its true extent.

    Splitting uses an aggressive floor so bands whose sprites nearly touch still
    separate; growing uses a near-zero floor so tall or thin sprites keep their
    full height. Growth stops at the midpoint of the gutter so bands never
    swallow their neighbours.
    """
    split_floor = max(1, int(perpendicular * SPLIT_FRAC))
    grow_floor = max(0, int(perpendicular * NOISE_FRAC))

    core = _spans(profile, gap, min_size, split_floor)
    if not core:
        return _spans(profile, gap, min_size, grow_floor)

    grown = []
    for i, (a, b) in enumerate(core):
        lo_limit = 0 if i == 0 else (core[i - 1][1] + a) // 2
        hi_limit = len(profile) - 1 if i == len(core) - 1 else (b + core[i + 1][0]) // 2
        while a > lo_limit and profile[a - 1] > grow_floor:
            a -= 1
        while b < hi_limit and profile[b + 1] > grow_floor:
            b += 1
        grown.append((a, b))
    return grown


def split_short(spans, profile, expected):
    """If fewer bands turned up than the sheet declares, split the tall outliers.

    Two rows whose sprites nearly touch merge into one over-tall band, which
    silently shifts every label below it. Splitting only ever runs when the count
    comes up short, so sheets with a legitimately tall row (a boss) are untouched.
    """
    spans = list(spans)
    while len(spans) < expected:
        heights = sorted(b - a + 1 for a, b in spans)
        med = heights[len(heights) // 2]
        i = max(range(len(spans)), key=lambda j: (spans[j][1] - spans[j][0] + 1) / med)
        a, b = spans[i]
        if (b - a + 1) < med * 1.5:
            break                      # nothing is tall enough to be two rows
        mid = min(range(a + med // 2, b - med // 2 + 1),
                  key=lambda y: profile[y])   # cut at the emptiest scanline
        spans[i:i + 1] = [(a, mid - 1), (mid + 1, b)]
    return spans


def slice_sheet(path: Path):
    stem = path.stem
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    alpha = img.getchannel("A").load()

    if img.getchannel("A").getextrema()[0] == 255:
        print(f"  {stem}: fully opaque, not a sprite sheet -- skipping slice")
        return []

    row_profile = [
        sum(1 for x in range(w) if alpha[x, y] > ALPHA_MIN) for y in range(h)
    ]
    row_spans = bands(row_profile, ROW_GAP, MIN_ROW_H, w)
    names = ROW_NAMES.get(stem, [])
    if names:
        row_spans = split_short(row_spans, row_profile, len(names))

    frames = []
    dest = OUT / stem
    dest.mkdir(parents=True, exist_ok=True)

    for r, (y0, y1) in enumerate(row_spans):
        label = names[r] if r < len(names) else f"row{r}"
        col_profile = [
            sum(1 for y in range(y0, y1 + 1) if alpha[x, y] > ALPHA_MIN)
            for x in range(w)
        ]
        col_spans = bands(col_profile, COL_GAP, MIN_COL_W, y1 - y0 + 1)
        for c, (x0, x1) in enumerate(col_spans):
            box = (x0, y0, x1 + 1, y1 + 1)
            frame = img.crop(box)
            # tighten to the frame's own ink, then pad
            bbox = frame.getbbox()
            if bbox:
                frame = frame.crop(bbox)
                box = (box[0] + bbox[0], box[1] + bbox[1],
                       box[0] + bbox[2], box[1] + bbox[3])
            canvas = Image.new("RGBA", (frame.width + PAD * 2, frame.height + PAD * 2))
            canvas.paste(frame, (PAD, PAD))
            name = f"{label}_{c:02d}.png"
            canvas.save(dest / name)
            frames.append({
                "name": f"{label}_{c:02d}",
                "row": label,
                "index": c,
                "file": f"sliced/{stem}/{name}",
                "rect": {"x": box[0], "y": box[1],
                         "w": box[2] - box[0], "h": box[3] - box[1]},
            })
    print(f"  {stem}: {len(row_spans)} rows -> {len(frames)} frames")
    return frames


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    atlas = {}
    sheets = sorted(p for p in ART.glob("*/*.png") if p.parent.name != "sliced")
    print(f"Slicing {len(sheets)} sheets...")
    for p in sheets:
        frames = slice_sheet(p)
        if frames:
            atlas[p.stem] = {
                "source": str(p.relative_to(ART)).replace("\\", "/"),
                "frames": frames,
            }
    out = ART / "atlas.json"
    out.write_text(json.dumps(atlas, indent=2))
    total = sum(len(v["frames"]) for v in atlas.values())
    print(f"\nWrote {out.relative_to(ROOT)} -- {total} frames across {len(atlas)} sheets")


if __name__ == "__main__":
    main()
