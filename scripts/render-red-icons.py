#!/usr/bin/env python3
"""Render the T3 Code Red icons by recoloring the prod icons.

Usage: python3 -I scripts/render-red-icons.py <repo-root> <out-dir> [#RRGGBB]
From the repo root: python3 -I scripts/render-red-icons.py . assets/red

It recolors each prod rendition at its own size, black to red and white to white, and
keeps the exported alpha. The default red, #B91C1C, is dark enough for the #e5484d
unread badge to show on top of it. Needs Pillow. Rerun it after assets/prod changes.
"""

import io
import struct
import sys
from pathlib import Path

from PIL import Image

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
# Peak alpha of the macOS icon's black drop shadow, which stays black.
MAC_SHADOW_MAX_ALPHA = 44
PNG_SOURCES = {
    "red-universal-1024.png": "black-universal-1024.png",
    "red-web-apple-touch-180.png": "t3-black-web-apple-touch-180.png",
    "red-web-icon-192x192.png": "t3-black-web-icon-192x192.png",
    "red-web-icon-512x512.png": "t3-black-web-icon-512x512.png",
    "red-web-favicon-16x16.png": "t3-black-web-favicon-16x16.png",
    "red-web-favicon-32x32.png": "t3-black-web-favicon-32x32.png",
}


def recolor_png(source, red, keep_shadow=False):
    with Image.open(source) as image:
        r, g, b, alpha = image.convert("RGBA").split()
    rgb = Image.merge("RGB", (r, g, b))
    tinted = rgb.point([round(c + v * (255 - c) / 255) for c in red for v in range(256)])
    if keep_shadow:
        span = 255 - MAC_SHADOW_MAX_ALPHA
        body = alpha.point(lambda v: max(0, round((v - MAC_SHADOW_MAX_ALPHA) * 255 / span)))
        tinted = Image.composite(tinted, rgb, body)
    output = Image.merge("RGBA", (*tinted.split(), alpha))
    buffer = io.BytesIO()
    # Pillow would carry over the Display P3 profile of the 192 and 512 sources; the red is sRGB.
    output.save(buffer, "PNG", optimize=True, icc_profile=None)
    return buffer.getvalue()


def read_png_ico(path):
    data = path.read_bytes()
    (count,) = struct.unpack_from("<H", data, 4)
    entries = {}
    for index in range(count):
        width, _height, _colors, _reserved, _planes, _bpp, length, offset = struct.unpack_from(
            "<BBBBHHII", data, 6 + 16 * index
        )
        entries[width or 256] = data[offset : offset + length]
    return entries


def encode_png_ico(renditions):
    """The layout of encodePngIco in scripts/lib/icon-export.ts: PNG entries, 1 plane, 32 bpp."""
    offset = 6 + 16 * len(renditions)
    directory = b""
    for size, png in renditions:
        encoded = 0 if size == 256 else size
        directory += struct.pack("<BBBBHHII", encoded, encoded, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
    header = struct.pack("<HHH", 0, 1, len(renditions))
    return header + directory + b"".join(png for _, png in renditions)


def main():
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    repo_root, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    hex_color = (sys.argv[3] if len(sys.argv) > 3 else "#B91C1C").lstrip("#")
    red = tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    prod = repo_root / "assets" / "prod"
    out_dir.mkdir(parents=True, exist_ok=True)

    for target, source in PNG_SOURCES.items():
        (out_dir / target).write_bytes(recolor_png(prod / source, red))
    mac = recolor_png(prod / "black-macos-1024.png", red, keep_shadow=True)
    (out_dir / "red-macos-1024.png").write_bytes(mac)

    entries = read_png_ico(prod / "t3-black-windows.ico")
    assert sorted(entries) == list(ICO_SIZES), f"prod ICO sizes changed: {sorted(entries)}"
    renditions = [(size, recolor_png(io.BytesIO(entries[size]), red)) for size in ICO_SIZES]
    ico = encode_png_ico(renditions)
    (out_dir / "red-windows.ico").write_bytes(ico)
    (out_dir / "red-web-favicon.ico").write_bytes(ico)


if __name__ == "__main__":
    main()
