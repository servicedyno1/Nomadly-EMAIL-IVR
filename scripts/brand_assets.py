#!/usr/bin/env python3
"""Generate every brand asset from sms-app/brands/<slug>/source-*.jpg.

Outputs (per brand):
  sms-app/brands/<slug>/mark.png        1024² flat app icon (dark bg + monogram)
  sms-app/brands/<slug>/foreground.png  1024² adaptive-icon foreground (monogram on transparent)
  sms-app/brands/<slug>/wordmark.png    trimmed wordmark on transparent
  sms-app/brands/<slug>/logo.png        wordmark on dark card (for emails / previews)
  js/assets/brand/<slug>/{mark,wordmark,logo}.png   served at /brand/<file> by the bot
With --install <slug>: writes Android mipmaps, adaptive-icon bg colour, splash screens
and www/img/mark.png for that brand (used by scripts/build_apk.sh).
"""
import json, os, sys
from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRANDS = json.load(open(os.path.join(ROOT, 'sms-app', 'brands', 'brands.json')))
RES = os.path.join(ROOT, 'sms-app', 'android', 'app', 'src', 'main', 'res')


def hex_rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def autocrop_dark_square(img, bg_hex):
    """Crop away any light border the generator added around the dark icon square."""
    rgb = img.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    def is_bg(p): return sum(p) < 150  # dark
    # scan for the bounding box of dark pixels
    left = next(x for x in range(w) if any(is_bg(px[x, y]) for y in range(0, h, 8)))
    right = next(x for x in range(w - 1, -1, -1) if any(is_bg(px[x, y]) for y in range(0, h, 8)))
    top = next(y for y in range(h) if any(is_bg(px[x, y]) for x in range(0, w, 8)))
    bottom = next(y for y in range(h - 1, -1, -1) if any(is_bg(px[x, y]) for x in range(0, w, 8)))
    out = rgb.crop((left, top, right + 1, bottom + 1)).resize((1024, 1024), Image.LANCZOS)
    # normalise the background to the exact brand background colour
    bg = hex_rgb(bg_hex)
    o = out.load()
    for y in range(1024):
        for x in range(1024):
            if sum(o[x, y]) < 150: o[x, y] = bg
    return out


def key_out_background(img, accent_hex):
    """Keep only pixels close to the accent colour (flat wordmark/monogram) → RGBA."""
    rgb = img.convert('RGB')
    ar, ag, ab = hex_rgb(accent_hex)
    w, h = rgb.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    src = rgb.load(); dst = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            d = abs(r - ar) + abs(g - ag) + abs(b - ab)
            if d < 120:
                a = 255 if d < 60 else int(255 * (120 - d) / 60)
                dst[x, y] = (ar, ag, ab, a)
    bbox = out.getbbox()
    if bbox: out = out.crop(bbox)
    return out


def pad(img, pad_ratio=0.08):
    w, h = img.size
    p = int(max(w, h) * pad_ratio)
    canvas = Image.new('RGBA', (w + 2 * p, h + 2 * p), (0, 0, 0, 0))
    canvas.paste(img, (p, p), img)
    return canvas


def build(slug):
    b = BRANDS[slug]
    src_dir = os.path.join(ROOT, 'sms-app', 'brands', slug)
    out_js = os.path.join(ROOT, 'js', 'assets', 'brand', slug)
    os.makedirs(out_js, exist_ok=True)

    mark = autocrop_dark_square(Image.open(os.path.join(src_dir, 'source-mark.jpg')), b['bg'])
    mark.save(os.path.join(src_dir, 'mark.png'))
    mark.save(os.path.join(out_js, 'mark.png'))

    fg = key_out_background(mark, b['accent'])
    fg_canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    # adaptive icons are masked to the inner 66% — keep the glyph inside ~50%
    target = 520
    scale = target / max(fg.size)
    fg_small = fg.resize((max(1, int(fg.size[0] * scale)), max(1, int(fg.size[1] * scale))), Image.LANCZOS)
    fg_canvas.paste(fg_small, ((1024 - fg_small.size[0]) // 2, (1024 - fg_small.size[1]) // 2), fg_small)
    fg_canvas.save(os.path.join(src_dir, 'foreground.png'))

    wm = pad(key_out_background(Image.open(os.path.join(src_dir, 'source-wordmark.jpg')), b['accent']))
    wm.save(os.path.join(src_dir, 'wordmark.png'))
    wm.save(os.path.join(out_js, 'wordmark.png'))

    logo = Image.new('RGBA', (1200, 400), hex_rgb(b['bg']) + (255,))
    s = min(1000 / wm.size[0], 260 / wm.size[1])
    wm2 = wm.resize((int(wm.size[0] * s), int(wm.size[1] * s)), Image.LANCZOS)
    logo.paste(wm2, ((1200 - wm2.size[0]) // 2, (400 - wm2.size[1]) // 2), wm2)
    logo.convert('RGB').save(os.path.join(src_dir, 'logo.png'))
    logo.convert('RGB').save(os.path.join(out_js, 'logo.png'))
    print(f'[brand-assets] built {slug}: mark {mark.size}, wordmark {wm.size}')


def install(slug):
    b = BRANDS[slug]
    src_dir = os.path.join(ROOT, 'sms-app', 'brands', slug)
    mark = Image.open(os.path.join(src_dir, 'mark.png')).convert('RGBA')
    fg = Image.open(os.path.join(src_dir, 'foreground.png')).convert('RGBA')
    dens = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for d, size in dens.items():
        folder = os.path.join(RES, f'mipmap-{d}')
        os.makedirs(folder, exist_ok=True)
        icon = mark.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(folder, 'ic_launcher.png'))
        # round variant
        m = Image.new('L', (size, size), 0)
        from PIL import ImageDraw
        ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
        rnd = icon.copy(); rnd.putalpha(m); rnd.save(os.path.join(folder, 'ic_launcher_round.png'))
        fg_size = int(size * 108 / 48)
        fg.resize((fg_size, fg_size), Image.LANCZOS).save(os.path.join(folder, 'ic_launcher_foreground.png'))
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
        f.write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{b["bg"].upper()}</color>\n</resources>\n')
    # splash screens: dark bg + centred mark (existing drawable sizes)
    for folder in os.listdir(RES):
        p = os.path.join(RES, folder, 'splash.png')
        if not (folder.startswith('drawable') and os.path.exists(p)): continue
        w, h = Image.open(p).size
        canvas = Image.new('RGB', (w, h), hex_rgb(b['bg']))
        s = int(min(w, h) * 0.28)
        canvas.paste(mark.resize((s, s), Image.LANCZOS).convert('RGB'), ((w - s) // 2, (h - s) // 2))
        canvas.save(p)
    os.makedirs(os.path.join(ROOT, 'sms-app', 'www', 'img'), exist_ok=True)
    mark.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'sms-app', 'www', 'img', 'mark.png'))
    print(f'[brand-assets] installed {slug} icons/splash into android res + www/img/mark.png')


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['--install']:
        install(args[1])
    else:
        for slug in (args or BRANDS.keys()):
            build(slug)
