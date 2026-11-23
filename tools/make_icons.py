"""Rasterise the Clowder emblem (the hex badge with the half-Galactic, half-Dino cat face) to PNG
icons for the web app and the Android launcher. Pure Python, no image libraries needed.

Usage: python tools/make_icons.py
Writes icons/*.png and android/app/src/main/res/mipmap-*/ic_launcher*.png
"""
import math
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
INK = (18, 10, 42)
BG = (11, 8, 32)


def hexc(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


HEX = [(50, 3), (93, 27.5), (93, 72.5), (50, 97), (7, 72.5), (7, 27.5)]
HEAD_TOP = [(27, 47), (31, 21), (45, 34), (55, 34), (69, 21), (73, 47)]
EAR_L = [(33.5, 24.5), (36, 15), (41, 23)]
EAR_R = [(66.5, 24.5), (64, 15), (59, 23)]
SPIKE_A = [(71, 18), (74, 13), (75, 18.5)]
SPIKE_B = [(68.5, 15.5), (69.5, 10.5), (72, 15.1)]
NOSE = [(47, 57), (53, 57), (50, 60.4)]


def in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def sample(x, y):
    """Colour of the emblem at viewBox point (x, y), or None outside it."""
    edge = min(seg_dist(x, y, HEX[i], HEX[(i + 1) % 6]) for i in range(6))
    inside = in_poly(x, y, HEX)
    if not inside and edge > 2.5:
        return None
    if edge <= 2.5:
        return INK
    col = hexc("8a55ff") if x < 50 else hexc("7fd84a")
    if y < 50:  # glossy top highlight
        k = 0.45 * (1 - y / 50)
        col = tuple(int(c + (255 - c) * k) for c in col)
    # cat head: pointed-ear top plus a rounded jaw
    head = (y <= 47 and in_poly(x, y, HEAD_TOP)) or (y > 47 and ((x - 50) / 23) ** 2 + ((y - 47) / 25) ** 2 <= 1)
    if head or in_poly(x, y, EAR_L) or in_poly(x, y, EAR_R):
        col = INK
        if (x - 40.5) ** 2 + (y - 48) ** 2 <= 25:
            col = (255, 255, 255) if (x - 42) ** 2 + (y - 46.5) ** 2 <= 2.6 else hexc("6ff6ff")
        elif ((x - 59.5) / 4.6) ** 2 + ((y - 48) / 5.4) ** 2 <= 1:
            col = INK if 58.6 <= x <= 60.4 and 43.5 <= y <= 52.5 else hexc("ffd21a")
        elif in_poly(x, y, NOSE):
            col = hexc("ff7ad9")
    if in_poly(x, y, SPIKE_A) or in_poly(x, y, SPIKE_B):
        col = hexc("ff9a2e")
    return col


def render(size, pad=0.06, background=None, ss=3):
    """RGBA rows; the emblem fills (1 - 2*pad) of the square, optional solid background."""
    rows = []
    scale = 100 / (size * (1 - 2 * pad))
    off = size * pad
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss - off) * scale
                    y = (py + (sy + 0.5) / ss - off) * scale
                    c = sample(x, y)
                    if c is None:
                        if background:
                            r += background[0]; g += background[1]; b += background[2]; a += 255
                        continue
                    r += c[0]; g += c[1]; b += c[2]; a += 255
            n = ss * ss
            if a:
                row += bytes((int(r / (a / 255)), int(g / (a / 255)), int(b / (a / 255)), int(a / n)))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return rows


def circle_mask(rows, size):
    out = []
    for y, row in enumerate(rows):
        r = bytearray(row)
        for x in range(size):
            if (x + 0.5 - size / 2) ** 2 + (y + 0.5 - size / 2) ** 2 > (size / 2) ** 2:
                r[x * 4 + 3] = 0
        out.append(bytes(r))
    return out


def write_png(path, rows, size):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = b"".join(b"\0" + r for r in rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"  {os.path.relpath(path, ROOT)}  ({size}px)")


if __name__ == "__main__":
    print("Rendering Clowder icons ...")
    # web / PWA
    for s in (192, 512):
        write_png(os.path.join(ROOT, "icons", f"icon-{s}.png"), render(s, ss=2 if s > 256 else 3), s)
    # maskable: full-bleed background, emblem kept inside the 80% safe zone
    write_png(os.path.join(ROOT, "icons", "icon-maskable-512.png"), render(512, pad=0.2, background=BG, ss=2), 512)
    # Android launcher (legacy square + round), on the brand's deep-space background
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    for dpi, s in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        rows = render(s, pad=0.14, background=BG)
        write_png(os.path.join(res, f"mipmap-{dpi}", "ic_launcher.png"), rows, s)
        write_png(os.path.join(res, f"mipmap-{dpi}", "ic_launcher_round.png"), circle_mask(rows, s), s)
    print("Done.")
