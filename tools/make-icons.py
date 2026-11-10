"""Generuje ikony PWA do assets/ (wymaga Pillow): python3 tools/make-icons.py"""
import os
from PIL import Image, ImageDraw

BG1, BG2 = (23, 31, 40), (14, 19, 24)
GOLD, GOLD2, INK = (232, 182, 76), (246, 207, 116), (28, 20, 5)
S = 1024  # rysujemy w 1024 i zmniejszamy (wygładzanie)

def emblem(d, k, cx, cy):
    """Wieża z krenelażem i chorągwią. k = skala (1 = wieża ok. 60% wysokości płótna)."""
    def R(x0, y0, x1, y1, fill, r=0):
        box = [cx + x0 * k, cy + y0 * k, cx + x1 * k, cy + y1 * k]
        d.rounded_rectangle(box, radius=r * k, fill=fill) if r else d.rectangle(box, fill=fill)
    # korpus
    R(-150, -90, 150, 260, GOLD)
    R(-150, -90, -60, 260, GOLD2)            # jaśniejszy lewy bok
    # krenelaż
    for i in range(4):
        x = -150 + i * 100
        R(x, -170, x + 50, -90, GOLD)
    R(-190, -110, 190, -80, GOLD2)           # gzyms
    # brama i okno
    R(-50, 110, 50, 260, INK, 50)
    R(-50, 160, 50, 260, INK)
    R(-22, -30, 22, 50, INK, 22)
    # maszt i chorągiew
    R(-6, -330, 6, -170, GOLD2)
    d.polygon([(cx + 6 * k, cy - 330 * k), (cx + 120 * k, cy - 290 * k), (cx + 6 * k, cy - 245 * k)], fill=(229, 83, 75))

def make(size, scale, maskable):
    img = Image.new('RGB', (S, S), BG2)
    px = img.load()
    for y in range(S):                       # delikatny gradient pionowy
        t = y / (S - 1)
        c = tuple(int(BG1[i] + (BG2[i] - BG1[i]) * t) for i in range(3))
        for x in range(S):
            px[x, y] = c
    d = ImageDraw.Draw(img)
    emblem(d, scale, S // 2, int(S * 0.56))
    return img.resize((size, size), Image.LANCZOS)

out = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(out, exist_ok=True)
# "any": emblem większy; "maskable": mieści się w bezpiecznym kole (środkowe 80%)
make(192, 1.35, False).save(os.path.join(out, 'icon-192.png'))
make(512, 1.35, False).save(os.path.join(out, 'icon-512.png'))
make(512, 0.95, True).save(os.path.join(out, 'icon-maskable-512.png'))
make(64, 1.35, False).save(os.path.join(out, 'favicon.png'))
print('gotowe:', sorted(os.listdir(out)))
