"""Telegram channel photos for CloudIVR (640x640 PNG, artwork kept inside the circle Telegram crops to).
python3 scripts/brand/telegram_avatar.py → frontend/public/civr/brand/telegram/*.png
"""
import os
from collections import deque
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = '/app'
SRC = f'{ROOT}/frontend/public/civr/brand/icon-512.png'
OUT = f'{ROOT}/frontend/public/civr/brand/telegram'
FONT = f'{ROOT}/scripts/brand/fonts/BarlowCondensed-ExtraBold.ttf'
S = 640
BG_DARK = (10, 10, 10)
EMERALD = (52, 211, 153)
SS = 2  # supersample factor for smooth edges


def extract_parrot():
    """icon-512 has the parrot on flat (10,10,10); flood-fill the background from the border → RGBA cut-out."""
    im = Image.open(SRC).convert('RGB')
    w, h = im.size
    px = im.load()
    bg = [[False] * h for _ in range(w)]
    q = deque((x, y) for x in range(w) for y in (0, h - 1)) + deque((x, y) for y in range(h) for x in (0, w - 1))
    near = lambda c: max(abs(c[0] - 10), abs(c[1] - 10), abs(c[2] - 10)) <= 9
    while q:
        x, y = q.popleft()
        if bg[x][y] or not near(px[x, y]):
            continue
        bg[x][y] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[nx][ny]:
                q.append((nx, ny))
    alpha = Image.new('L', (w, h), 255)
    ap = alpha.load()
    for x in range(w):
        for y in range(h):
            if bg[x][y]:
                ap[x, y] = 0
    # soften the 1-px cut edge so it doesn't look jagged on a coloured background
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    rgba = im.convert('RGBA')
    rgba.putalpha(alpha)
    return rgba.crop(rgba.getbbox())


def fit_in_circle(art, radius, center):
    """Scale `art` (RGBA) so every visible pixel sits within `radius` of `center` when its bbox centre is at `center`."""
    a = art.split()[3].load()
    w, h = art.size
    far = max(((x - w / 2) ** 2 + (y - h / 2) ** 2) ** 0.5 for x in range(0, w, 2) for y in range(0, h, 2) if a[x, y] > 40)
    k = radius / far
    return art.resize((round(w * k), round(h * k)), Image.LANCZOS)


def canvas(bg):
    return Image.new('RGBA', (S * SS, S * SS), bg + (255,))


def paste_center(base, art, cx, cy):
    base.alpha_composite(art, (round(cx - art.width / 2), round(cy - art.height / 2)))


def wordmark(base, cy, cloud_rgb, ivr_rgb, size):
    d = ImageDraw.Draw(base)
    f = ImageFont.truetype(FONT, size)
    w1 = d.textlength('CLOUD', font=f)
    w2 = d.textlength('IVR', font=f)
    x = (base.width - (w1 + w2)) / 2
    top = f.getbbox('CLOUDIVR')[1]
    hgt = f.getbbox('CLOUDIVR')[3] - top
    y = cy - hgt / 2 - top
    d.text((x, y), 'CLOUD', font=f, fill=cloud_rgb)
    d.text((x + w1, y), 'IVR', font=f, fill=ivr_rgb)
    return w1 + w2


def finish(img, name):
    out = img.resize((S, S), Image.LANCZOS).convert('RGB')
    out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    path = f'{OUT}/{name}.png'
    out.save(path, optimize=True)
    print(path, os.path.getsize(path) // 1024, 'KB')


def preview_circle(name):
    """Same image masked to a circle, at Telegram list size — for checking only."""
    im = Image.open(f'{OUT}/{name}.png').convert('RGBA')
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).ellipse((0, 0, S - 1, S - 1), fill=255)
    im.putalpha(m)
    bg = Image.new('RGBA', (S + 80, S + 80), (23, 33, 43, 255))  # Telegram dark chat-list colour
    bg.alpha_composite(im, (40, 40))
    bg.convert('RGB').save(f'/app/scripts/brand/preview_{name}.png')


def main():
    os.makedirs(OUT, exist_ok=True)
    parrot = extract_parrot()
    c = S * SS / 2
    themes = {
        'dark': (BG_DARK, (255, 255, 255), EMERALD),
        'green': (EMERALD, (10, 10, 10), (255, 255, 255)),
    }
    for theme, (bg, cloud, ivr) in themes.items():
        # icon only: parrot fills ~78% of the circle
        img = canvas(bg)
        art = fit_in_circle(parrot, 0.80 * c, (c, c))
        paste_center(img, art, c + 0.02 * art.width, c)
        finish(img, f'cloudivr-telegram-icon-{theme}')
        # icon + name: parrot on top, CLOUDIVR below, both inside the circle
        img = canvas(bg)
        art = fit_in_circle(parrot, 0.60 * c, (c, c))
        paste_center(img, art, c + 0.02 * art.width, c - 0.115 * S * SS)
        wordmark(img, c + 0.285 * S * SS, cloud, ivr, round(0.175 * S * SS))
        finish(img, f'cloudivr-telegram-name-{theme}')
    for theme in themes:
        for kind in ('icon', 'name'):
            preview_circle(f'cloudivr-telegram-{kind}-{theme}')


if __name__ == '__main__':
    main()
