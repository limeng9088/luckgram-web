#!/usr/bin/env python3
"""Luckgram icon set for the web app (luckgram-specs#137).

Reads  src/luckgram/brand/icon-512.png  (the app icon, same as Android / the website)
       src/luckgram/brand/plane.path    (the plane traced from it, SVG path data in a 512 box)
Writes src/luckgram/brand/img/*         under the file names upstream uses in public/assets/img,
so scripts/luckgram/assemble.mjs only has to copy them over upstream's Telegram icons.

Run by hand after the icon changes (needs Pillow); the output is committed.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'luckgram', 'brand')
OUT = os.path.join(ROOT, 'img')
os.makedirs(OUT, exist_ok=True)
icon = Image.open(os.path.join(ROOT, 'icon-512.png')).convert('RGBA')
plane = open(os.path.join(ROOT, 'plane.path')).read().strip()
INK = '#1b1e23'


def square(size):
    return icon.resize((size, size), Image.LANCZOS)


def rounded(size, radius=0.22):
    big = icon.resize((size * 4, size * 4), Image.LANCZOS)
    mask = Image.new('L', big.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big.size[0] - 1, big.size[1] - 1], int(big.size[0] * radius), fill=255)
    big.putalpha(mask)
    return big.resize((size, size), Image.LANCZOS)


def wide(width, height):
    canvas = Image.new('RGBA', (width, height), icon.getpixel((2, 2)))
    side = min(width, height)
    canvas.paste(square(side), ((width - side) // 2, (height - side) // 2))
    return canvas


def save(image, name):
    image.save(os.path.join(OUT, name), optimize=True)


for s in (36, 48, 72, 96, 144, 192, 256, 384, 512):
    save(square(s), f'android-chrome-{s}x{s}.png')
for s in (192, 384, 512):
    save(rounded(s), f'icon_square_{s}.png')
save(square(180), 'apple-touch-icon.png')
save(square(180), 'apple-touch-icon-precomposed.png')
for s in (16, 32, 194):
    save(rounded(s), f'favicon-{s}x{s}.png')
for s in (70, 144, 150, 310):
    save(square(s), f'mstile-{s}x{s}.png')
save(wide(310, 150), 'mstile-310x150.png')
save(square(512), 'logo_512.png')
save(rounded(512), 'logo_filled_rounded.png')

ico = rounded(64)
ico.save(os.path.join(OUT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
unread = rounded(64)
ImageDraw.Draw(unread).ellipse([38, 0, 63, 25], fill='#ff3b30', outline='#ffffff', width=3)
unread.save(os.path.join(OUT, 'favicon_unread.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])


def svg(name, view_box, style_fill=True):
    # paintQrCode.ts recolours the logo through /(fill:).+?(;)/, so the fill stays in a style attribute
    fill = f'style="fill:{INK};"' if style_fill else 'fill="currentColor"'
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"><path {fill} fill-rule="evenodd" d="{plane}"/></svg>\n')


TIGHT = '56 80 388 330'       # the plane with a little air
PADDED = '-40 -40 592 592'    # the centre of a QR code
for name in ('logo.svg', 'logo_filled.svg', 'logo_plain.svg', 'masked.svg', 'masked copy.svg', 'safari-pinned-tab.svg'):
    svg(name, TIGHT)
svg('logo_padded.svg', PADDED)
print('written', len(os.listdir(OUT)), 'files to', os.path.relpath(OUT))
