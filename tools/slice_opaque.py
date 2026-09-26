"""
Slice the two opaque Alien Digger sheets that the alpha-based slicer skips.

  * the terrain tileset  -> individual tiles, cut on its dark grid gutters
  * the parallax sheet   -> the four background strips, cut on their black rules

Both are found the same way: scan for full-width (or full-height) runs of very
dark pixels and treat those runs as separators.

Usage:  python tools/slice_opaque.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "art"

DARK = 42           # a pixel this dark or darker counts as gutter
DARK_FRAC = 0.94    # fraction of a line that must be dark to be a separator


def dark_lines(img, axis):
    """Return a boolean per column (axis=0) or row (axis=1): is it a separator?"""
    px = img.convert("RGB").load()
    w, h = img.size
    if axis == 0:
        return [
            sum(1 for y in range(h) if max(px[x, y]) <= DARK) >= h * DARK_FRAC
            for x in range(w)
        ]
    return [
        sum(1 for x in range(w) if max(px[x, y]) <= DARK) >= w * DARK_FRAC
        for y in range(h)
    ]


def content_spans(flags, min_size):
    """Spans of consecutive non-separator lines."""
    spans, start = [], None
    for i, sep in enumerate(flags):
        if not sep and start is None:
            start = i
        elif sep and start is not None:
            if i - start >= min_size:
                spans.append((start, i - 1))
            start = None
    if start is not None and len(flags) - start >= min_size:
        spans.append((start, len(flags) - 1))
    return spans


def slice_tileset(path: Path, out_dir: Path):
    img = Image.open(path).convert("RGB")
    cols = content_spans(dark_lines(img, 0), 24)
    rows = content_spans(dark_lines(img, 1), 24)
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for r, (y0, y1) in enumerate(rows):
        for c, (x0, x1) in enumerate(cols):
            name = f"tile_r{r}_c{c}.png"
            img.crop((x0, y0, x1 + 1, y1 + 1)).save(out_dir / name)
            frames.append({
                "name": f"tile_r{r}_c{c}", "row": r, "col": c,
                "file": f"sliced/{path.stem}/{name}",
                "rect": {"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1},
            })
    print(f"  {path.stem}: {len(rows)} rows x {len(cols)} cols -> {len(frames)} tiles")
    return frames


STRIP_NAMES = ["surface", "upper_caverns", "crystal_depths", "magma_core"]


def slice_strips(path: Path, out_dir: Path):
    img = Image.open(path).convert("RGB")
    w, _ = img.size
    rows = content_spans(dark_lines(img, 1), 60)
    out_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for i, (y0, y1) in enumerate(rows):
        label = STRIP_NAMES[i] if i < len(STRIP_NAMES) else f"strip{i}"
        name = f"bg_{label}.png"
        img.crop((0, y0, w, y1 + 1)).save(out_dir / name)
        frames.append({
            "name": f"bg_{label}", "layer": i,
            "file": f"sliced/{path.stem}/{name}",
            "rect": {"x": 0, "y": y0, "w": w, "h": y1 - y0 + 1},
        })
    print(f"  {path.stem}: {len(frames)} strips")
    return frames


def main():
    atlas_path = ART / "atlas.json"
    atlas = json.loads(atlas_path.read_text()) if atlas_path.exists() else {}

    jobs = [
        (ART / "tiles" / "alien_digger_03_terrain_tiles.png", slice_tileset),
        (ART / "backgrounds" / "alien_digger_10_backgrounds.png", slice_strips),
    ]
    print(f"Slicing {len(jobs)} opaque sheets...")
    for path, fn in jobs:
        if not path.exists():
            print(f"  missing: {path}")
            continue
        frames = fn(path, ART / "sliced" / path.stem)
        atlas[path.stem] = {
            "source": str(path.relative_to(ART)).replace("\\", "/"),
            "frames": frames,
        }

    atlas_path.write_text(json.dumps(atlas, indent=2))
    total = sum(len(v["frames"]) for v in atlas.values())
    print(f"\nWrote {atlas_path.relative_to(ROOT)} -- {total} frames across {len(atlas)} sheets")


if __name__ == "__main__":
    main()
