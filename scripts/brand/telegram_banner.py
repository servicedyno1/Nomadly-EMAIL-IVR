"""Wide CLOUDIVR banner for pinned Telegram posts / announcements (1280x640 PNG, dark + green), matching the channel photos.
python3 scripts/brand/telegram_banner.py → frontend/public/civr/brand/telegram/cloudivr-telegram-banner-{dark,green}.png
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

from telegram_avatar import extract_parrot, fit_in_circle, OUT

FONTS = '/app/scripts/brand/fonts'
W, H, SS = 1280, 640, 2
EMERALD = (52, 211, 153)
INK = (10, 10, 10)
WHITE = (255, 255, 255)
TAGLINE = 'Your business phone in the cloud'
FEATURES = [('numbers', 'Virtual phone numbers'), ('ivr', 'IVR call menus'), ('ai', 'AI voice agents')]
URL = 'cloudivr.net'


def font(name, size, weight=None):
    f = ImageFont.truetype(f'{FONTS}/{name}', size * SS)
    if weight:
        f.set_variation_by_axes([min(40, size), weight])
    return f


def icon(d, kind, x, y, s, fg):
    """Simple line icons inside an s×s box at (x, y)."""
    if kind == 'numbers':
        f = font('BarlowCondensed-ExtraBold.ttf', round(s / SS * 0.95))
        bb = d.textbbox((0, 0), '#', font=f)
        d.text((x + (s - (bb[2] - bb[0])) / 2 - bb[0], y + (s - (bb[3] - bb[1])) / 2 - bb[1]), '#', font=f, fill=fg)
    elif kind == 'ivr':
        r = s * 0.075
        for i in range(3):
            for j in range(3):
                cx, cy = x + s * (0.22 + 0.28 * i), y + s * (0.22 + 0.28 * j)
                d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fg)
    else:
        bars = [0.30, 0.58, 0.86, 0.50, 0.70, 0.36]
        bw = s * 0.085
        gap = (s * 0.84 - bw * len(bars)) / (len(bars) - 1)
        for i, hgt in enumerate(bars):
            bx = x + s * 0.08 + i * (bw + gap)
            hh = s * hgt
            d.rounded_rectangle((bx, y + (s - hh) / 2, bx + bw, y + (s + hh) / 2), radius=bw / 2, fill=fg)


def grain(img, amount):
    """Fine monochrome noise so the flat dark background doesn't band in Telegram's JPEG re-encode."""
    rnd = random.Random(7)
    n = Image.new('L', img.size)
    n.putdata([128 + rnd.randint(-amount, amount) for _ in range(img.size[0] * img.size[1])])
    return Image.blend(img, Image.merge('RGB', (n, n, n)), 0.035)


def banner(theme, parrot):
    dark = theme == 'dark'
    bg, fg, accent = (INK, WHITE, EMERALD) if dark else (EMERALD, INK, WHITE)
    sub = (212, 212, 216) if dark else (17, 24, 39)
    img = Image.new('RGB', (W * SS, H * SS), bg)
    d = ImageDraw.Draw(img)

    # right: the channel-photo circle (green on dark, dark on green) with the parrot
    cr = 236 * SS
    cx, cy = (W - 96) * SS - cr, H * SS // 2
    if dark:
        glow = Image.new('L', img.size, 0)
        ImageDraw.Draw(glow).ellipse((cx - cr * 1.25, cy - cr * 1.25, cx + cr * 1.25, cy + cr * 1.25), fill=60)
        glow = glow.filter(ImageFilter.GaussianBlur(70 * SS))
        img = Image.composite(Image.new('RGB', img.size, EMERALD), img, glow)
        d = ImageDraw.Draw(img)
    d.ellipse((cx - cr, cy - cr, cx + cr, cy + cr), fill=EMERALD if dark else INK)
    art = fit_in_circle(parrot, 0.80 * cr, (0, 0))
    img.paste(art, (round(cx - art.width / 2 + 0.02 * art.width), round(cy - art.height / 2)), art)

    # left: wordmark, tagline, three features, address
    x = 88 * SS
    wm = font('BarlowCondensed-ExtraBold.ttf', 118)
    top = 92 * SS
    w1 = d.textlength('CLOUD', font=wm)
    oy = wm.getbbox('CLOUD')[1]
    d.text((x, top - oy), 'CLOUD', font=wm, fill=fg)
    d.text((x + w1, top - oy), 'IVR', font=wm, fill=EMERALD if dark else WHITE)
    y = top + (wm.getbbox('CLOUD')[3] - oy) + 26 * SS

    tg = font('BarlowCondensed-SemiBold.ttf', 50)
    d.text((x, y - tg.getbbox(TAGLINE)[1]), TAGLINE, font=tg, fill=sub)
    y += (tg.getbbox(TAGLINE)[3] - tg.getbbox(TAGLINE)[1]) + 46 * SS

    ft = font('DMSans-Variable.ttf', 34, 560)
    chip = 56 * SS
    for kind, label in FEATURES:
        d.rounded_rectangle((x, y, x + chip, y + chip), radius=14 * SS, fill=(24, 24, 27) if dark else INK, outline=(39, 39, 42) if dark else None, width=2 * SS)
        icon(d, kind, x + chip * 0.2, y + chip * 0.2, chip * 0.6, EMERALD)
        bb = ft.getbbox('Hx')  # same box for every row so labels with/without descenders line up
        d.text((x + chip + 22 * SS, y + (chip - (bb[3] - bb[1])) / 2 - bb[1]), label, font=ft, fill=fg)
        y += chip + 16 * SS

    uf = font('DMSans-Variable.ttf', 28, 700)
    uy = (H - 70) * SS
    bb = uf.getbbox(URL)
    d.text((x, uy - bb[3]), URL, font=uf, fill=EMERALD if dark else INK)
    ux = x + d.textlength(URL, font=uf) + 14 * SS
    ay = uy - (bb[3] - bb[1]) / 2
    d.line((ux, ay, ux + 26 * SS, ay), fill=EMERALD if dark else INK, width=4 * SS)
    d.line((ux + 14 * SS, ay - 11 * SS, ux + 26 * SS, ay, ux + 14 * SS, ay + 11 * SS), fill=EMERALD if dark else INK, width=4 * SS, joint='curve')

    out = img.resize((W, H), Image.LANCZOS)
    if dark:
        out = grain(out, 60)
    out = out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=50, threshold=2))
    path = f'{OUT}/cloudivr-telegram-banner-{theme}.png'
    out.save(path, optimize=True)
    print(path, os.path.getsize(path) // 1024, 'KB')


if __name__ == '__main__':
    p = extract_parrot()
    for t in ('dark', 'green'):
        banner(t, p)
