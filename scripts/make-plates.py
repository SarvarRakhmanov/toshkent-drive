#!/usr/bin/env python3
"""Bake the modern-style Uzbekistan licence plates used on the player cars.

White plate, black border, 2-digit region code in its own box on the left,
main characters in black, small Uzbekistan flag with "UZ" on the right edge.
Output: public/textures/plates/<id>.png (512x108, ~0.52 x 0.11 m plate).
Run: python3 scripts/make-plates.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "textures" / "plates"
FONT = "/usr/share/fonts/truetype/sand-box/google/Roboto Condensed/RobotoCondensed-VariableFont_wght.ttf"
PLATES = {"seltos": ("01", "D 666 FB"), "lacetti": ("90", "O 909 BA")}
W, H, S = 512, 108, 4  # draw at 4x and downsample for clean edges


def font(px):
    f = ImageFont.truetype(FONT, px * S)
    try:
        f.set_variation_by_name("Bold")
    except Exception:
        pass
    return f


def text_center(d, box, txt, f):
    x0, y0, x1, y1 = box
    l, t, r, b = d.textbbox((0, 0), txt, font=f)
    d.text(((x0 + x1 - (r - l)) / 2 - l, (y0 + y1 - (b - t)) / 2 - t), txt, font=f, fill="black")


def flag(img, x, y, w, h):
    d = ImageDraw.Draw(img)
    band = h / 3
    d.rectangle([x, y, x + w, y + band], fill="#1eb3e6")              # blue
    d.rectangle([x, y + band, x + w, y + 2 * band], fill="white")
    d.rectangle([x, y + 2 * band, x + w, y + h], fill="#1eb53a")      # green
    r = max(1, h * 0.035)
    d.rectangle([x, y + band - r, x + w, y + band + r], fill="#ce1126")  # thin red fimbriations
    d.rectangle([x, y + 2 * band - r, x + w, y + 2 * band + r], fill="#ce1126")
    # white crescent on the blue band
    cr = band * 0.36
    cx, cy = x + w * 0.2, y + band / 2
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill="white")
    d.ellipse([cx - cr + cr * 0.45, cy - cr, cx + cr + cr * 0.45, cy + cr], fill="#1eb3e6")
    d.rectangle([x, y, x + w, y + h], outline="black", width=S)


def plate(region, main):
    img = Image.new("RGB", (W * S, H * S), "white")
    d = ImageDraw.Draw(img)
    bw = 5 * S
    d.rounded_rectangle([bw // 2, bw // 2, W * S - bw // 2, H * S - bw // 2], radius=10 * S, outline="black", width=bw)
    # region code section
    rx = 82 * S
    d.line([rx, bw, rx, H * S - bw], fill="black", width=4 * S)
    text_center(d, (bw, bw, rx, H * S - bw), region, font(70))
    # flag + UZ on the right edge
    fx0 = W * S - 62 * S
    flag(img, fx0 + 8 * S, 18 * S, 44 * S, 30 * S)
    text_center(d, (fx0, 54 * S, W * S - bw, 96 * S), "UZ", font(34))
    # main characters
    text_center(d, (rx + 6 * S, bw, fx0 - 2 * S, H * S - bw), main, font(84))
    return img.resize((W, H), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
for pid, (region, main) in PLATES.items():
    p = OUT / f"{pid}.png"
    plate(region, main).save(p, optimize=True)
    print(p.relative_to(ROOT), p.stat().st_size, "bytes")
