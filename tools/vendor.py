"""Vendor Clowder's runtime dependencies so the game runs offline (needed for the Android app).

Downloads three.js (the exact version the import map uses) plus every addon module the game
imports, following their relative imports, and the two Google fonts as local woff2 files.

Usage:  python tools/vendor.py
Output: vendor/three/...  and  vendor/fonts/fonts.css + *.woff2
"""
import os
import re
import sys
import urllib.request

THREE_VERSION = "0.170.0"
CDN = f"https://cdn.jsdelivr.net/npm/three@{THREE_VERSION}/"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "vendor", "three")
ENTRY = [
    "build/three.module.js",
    "examples/jsm/controls/OrbitControls.js",
    "examples/jsm/postprocessing/EffectComposer.js",
    "examples/jsm/postprocessing/RenderPass.js",
    "examples/jsm/postprocessing/UnrealBloomPass.js",
    "examples/jsm/postprocessing/OutputPass.js",
    "examples/jsm/postprocessing/ShaderPass.js",
    "examples/jsm/environments/RoomEnvironment.js",
    "examples/jsm/utils/BufferGeometryUtils.js",
    "examples/jsm/postprocessing/GTAOPass.js",
    "examples/jsm/postprocessing/BokehPass.js",
]
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
IMPORT_RE = re.compile(r"""(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}/[^'"]+)['"]|import\s*['"](\.{1,2}/[^'"]+)['"]""")


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def vendor_three():
    seen, queue = set(), list(ENTRY)
    while queue:
        rel = queue.pop()
        if rel in seen:
            continue
        seen.add(rel)
        data = get(CDN + rel)
        dest = os.path.join(OUT, *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        base = os.path.dirname(rel)
        for a, b in IMPORT_RE.findall(data.decode("utf-8", "replace")):
            dep = os.path.normpath(os.path.join(base, a or b)).replace("\\", "/")
            if dep not in seen:
                queue.append(dep)
        print(f"  three  {rel}  ({len(data) // 1024} KB)")
    return len(seen)


def vendor_fonts():
    out = os.path.join(ROOT, "vendor", "fonts")
    os.makedirs(out, exist_ok=True)
    css_url = "https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@600;700;800;900&display=swap"
    css = get(css_url).decode("utf-8")
    # keep only the latin and latin-ext subsets: that's every glyph the UI uses
    blocks = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*{[^}]*})", css)
    kept, n = [], 0
    for subset, block in blocks:
        if subset not in ("latin", "latin-ext"):
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", block).group(1)
        name = re.search(r"font-family:\s*'([^']+)'", block).group(1).replace(" ", "")
        weight = re.search(r"font-weight:\s*(\d+)", block).group(1)
        fname = f"{name}-{weight}-{subset}.woff2"
        path = os.path.join(out, fname)
        if not os.path.exists(path):
            with open(path, "wb") as f:
                f.write(get(url))
            n += 1
        kept.append(f"/* {subset} */\n" + block.replace(url, fname))
    with open(os.path.join(out, "fonts.css"), "w", encoding="utf-8") as f:
        f.write("\n".join(kept) + "\n")
    print(f"  fonts  {len(kept)} faces ({n} downloaded)")


if __name__ == "__main__":
    print(f"Vendoring three@{THREE_VERSION} and fonts into vendor/ ...")
    count = vendor_three()
    vendor_fonts()
    print(f"Done: {count} three.js modules.")
    sys.exit(0)
