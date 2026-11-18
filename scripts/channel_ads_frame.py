"""Frame captured screens into branded channel-post visuals and turn clips into short MP4s."""
import json, os, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SRC, OUT = '/tmp/chads', '/app/frontend/public/channel-ads'
os.makedirs(OUT, exist_ok=True)
FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
FONT_R = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
BG, ACCENT = (11, 18, 32), (59, 130, 246)

MEDIA = [
    ('home', 'photo', 'Your whole phone system at a glance', 'how'),
    ('ai-campaign', 'photo', 'Tell Emily who to call. She builds the AI campaign.', 'feature'),
    ('ai-conversations', 'photo', 'AI that talks with your leads, in 20 languages', 'feature'),
    ('buy', 'photo', 'A business number in three steps', 'how'),
    ('ivr', 'photo', '"Press 1 for sales" menus in minutes', 'feature'),
    ('live', 'photo', 'Watch every call live, on a map', 'tip'),
    ('quick-call', 'photo', 'Automated calls from one sentence', 'feature'),
    ('renewals', 'photo', 'Every renewal on your calendar', 'tip'),
    ('sip', 'photo', 'Answer on any softphone or desk phone', 'tip'),
    ('emily-ivr', 'video', 'Emily writes the call for you', 'how'),
    ('number-search', 'video', 'Find a local number in seconds', 'how'),
    ('plan-pick', 'video', 'Not sure which plan? Ask Emily', 'feature'),
]

def rounded(im, r):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, *im.size], r, fill=255)
    out = Image.new('RGBA', im.size); out.paste(im, (0, 0), m); return out

def frame(name, title):
    W, H = 1600, 1000
    c = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(c)
    d.text((80, 64), 'CloudIVR', font=ImageFont.truetype(FONT, 30), fill=ACCENT)
    d.text((80, 108), title, font=ImageFont.truetype(FONT, 54), fill=(255, 255, 255))
    shot = Image.open(f'{SRC}/{name}.png').convert('RGB')
    w = W - 160; shot = shot.resize((w, int(shot.height * w / shot.width)))
    shot = shot.crop((0, 0, w, min(shot.height, H - 210)))
    sh = Image.new('RGBA', (shot.width + 40, shot.height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([20, 20, shot.width + 20, shot.height + 20], 22, fill=(0, 0, 0, 160))
    c.paste(sh.filter(ImageFilter.GaussianBlur(14)), (60, 196), sh.filter(ImageFilter.GaussianBlur(14)))
    r = rounded(shot, 18); c.paste(r, (80, 210), r)
    c.save(f'{OUT}/{name}.jpg', quality=86)

def clip(name):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '7.5', '-i', f'{SRC}/{name}.webm', '-t', '18', '-vf', 'scale=1280:-2,fps=24', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-crf', '26', f'{OUT}/{name}.mp4'], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', '5', '-i', f'{OUT}/{name}.mp4', '-frames:v', '1', f'/tmp/{name}_peek.jpg'])

lib = []
for name, kind, title, pillar in MEDIA:
    if not os.path.exists(f'{SRC}/{name}.{"png" if kind == "photo" else "webm"}'): continue
    frame(name, title) if kind == 'photo' else clip(name)
    lib.append({'id': name, 'kind': kind, 'file': f'/channel-ads/{name}.{"jpg" if kind == "photo" else "mp4"}', 'title': title, 'pillar': pillar})
json.dump(lib, open('/app/js/channel-ads-media.json', 'w'), indent=1)
print(len(lib), 'media')
