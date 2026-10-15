"""Turn a drawn transparency checkerboard back into real alpha.

Image generators are asked for a transparent background and sometimes answer by
*drawing* the grey-and-white checkerboard that an image editor uses to display
transparency. The result is a fully opaque PNG that looks transparent, which
`slice_sheets.py` correctly refuses -- it reads alpha to find frames, and an
opaque sheet has none.

Keying by colour alone is wrong: these sheets have white highlights and pale
grey plating, and a straight "delete everything near-white" pass eats them. So
this floods inward from the border instead. The background is one connected
region, every sprite carries a hard 1px dark outline, and a fill cannot cross
that outline -- so an enclosed white highlight is never reached, while the
checkerboard between sprites is.

Usage:  python tools/dekey_checkerboard.py art/fx/sheet.png [--check]
        --check  report what it would do without writing
"""

import sys
from collections import deque

import numpy as np
from PIL import Image

TOL = 26          # how far a pixel may sit from a checker colour and still count
MIN_BACKGROUND = 0.15   # refuse if the flood finds implausibly little background


def checker_colours(rgb):
    """The two most common colours around the border are the checks."""
    h, w, _ = rgb.shape
    border = np.concatenate([
        rgb[0:3].reshape(-1, 3), rgb[h - 3:h].reshape(-1, 3),
        rgb[:, 0:3].reshape(-1, 3), rgb[:, w - 3:w].reshape(-1, 3),
    ])
    colours, counts = np.unique(border, axis=0, return_counts=True)
    order = np.argsort(-counts)
    picked = [colours[order[0]]]
    for i in order[1:]:
        if np.abs(colours[i].astype(int) - picked[0].astype(int)).max() > TOL:
            picked.append(colours[i])
            break
    return picked


def dekey(path, dry_run=False):
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im).astype(np.int16)
    h, w, _ = rgb.shape

    picked = checker_colours(np.asarray(im))
    # Pixels close enough to either check colour to be candidates for the fill.
    candidate = np.zeros((h, w), dtype=bool)
    for c in picked:
        candidate |= (np.abs(rgb - c.astype(np.int16)).max(axis=2) <= TOL)

    # Flood from every border pixel that is a candidate. Only connected
    # background is cleared, so highlights sealed inside an outline survive.
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))

    frac = seen.mean()
    print(f"  checks: {[tuple(int(v) for v in c) for c in picked]}")
    print(f"  flooded {frac * 100:.1f}% of the image from the border")
    if frac < MIN_BACKGROUND:
        print(f"  REFUSED: under {MIN_BACKGROUND:.0%} looks like a real background")
        return False
    if dry_run:
        return True

    out = np.dstack([np.asarray(im), np.where(seen, 0, 255).astype(np.uint8)])
    Image.fromarray(out, "RGBA").save(path)
    print(f"  wrote {path} with real alpha")
    return True


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(2)
    ok = all(dekey(a, "--check" in sys.argv) for a in args)
    sys.exit(0 if ok else 1)
