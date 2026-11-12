"""Generuje ikony PWA do assets/ (wymaga Pillow): python3 tools/make-icons.py"""
import os, random
from PIL import Image, ImageDraw, ImageFilter

BG1, BG2 = (44, 33, 22), (14, 10, 7)
GOLD, GOLD2, GOLD3, INK = (232, 182, 76), (250, 218, 128), (160, 112, 38), (28, 20, 5)
STONE, STONE_L, STONE_D = (176, 172, 160), (214, 210, 196), (112, 108, 100)
RED, RED_L, RED_D = (200, 62, 48), (236, 106, 80), (128, 34, 28)
S = 1024  # rysujemy w 1024 i zmniejszamy (wygładzanie)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def emblem(img, k, cx, cy):
    """Wieża z krenelażem, okapem i chorągwią – światło z lewej góry. k = skala."""
    d = ImageDraw.Draw(img)
    def R(x0, y0, x1, y1, fill, r=0):
        box = [cx + x0 * k, cy + y0 * k, cx + x1 * k, cy + y1 * k]
        d.rounded_rectangle(box, radius=r * k, fill=fill) if r else d.rectangle(box, fill=fill)
    def P(pts, fill):
        d.polygon([(cx + x * k, cy + y * k) for x, y in pts], fill=fill)
    # cień na ziemi
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - 230 * k, cy + 235 * k, cx + 250 * k, cy + 290 * k], fill=(0, 0, 0, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14 * k)))
    d = ImageDraw.Draw(img)
    # korpus: kamień z cieniowaniem walca
    for i in range(300):
        t = i / 299
        c = lerp(STONE_L, STONE_D, t ** 0.9)
        R(-150 + i, -90, -149 + i, 260, c)
    # spoiny murowane
    for row in range(10):
        y = -60 + row * 32
        R(-150, y, 150, y + 3, STONE_D)
        off = 0 if row % 2 else 45
        for j in range(-150 + off, 150, 90):
            R(j, y, j + 3, y + 32, STONE_D)
    # gzyms i krenelaż
    R(-188, -112, 188, -78, GOLD2)
    R(-188, -112, 188, -100, GOLD)
    R(-188, -86, 188, -78, GOLD3)
    for i in range(4):
        x = -150 + i * 100
        R(x, -176, x + 52, -112, STONE)
        R(x, -176, x + 14, -112, STONE_L)
        R(x + 40, -176, x + 52, -112, STONE_D)
        R(x - 4, -186, x + 56, -172, GOLD2)
    # brama z łukiem i okno
    R(-52, 90, 52, 260, INK, 52)
    R(-52, 150, 52, 260, INK)
    R(-34, 130, 34, 260, (74, 46, 23), 34)
    R(-34, 190, 34, 260, (74, 46, 23))
    R(-4, 130, 4, 260, INK)
    R(-26, -30, 26, 56, INK, 26)
    R(-18, -22, 18, 52, (255, 214, 110), 18)
    R(-4, -22, 4, 52, INK)
    # maszt i chorągiew z falą
    R(-6, -360, 6, -186, GOLD2)
    d.ellipse([cx - 16 * k, cy - 378 * k, cx + 16 * k, cy - 346 * k], fill=GOLD)
    P([(6, -350), (70, -338), (130, -352), (112, -316), (130, -280), (70, -294), (6, -282)], RED)
    P([(6, -350), (70, -338), (130, -352), (122, -338), (70, -326), (6, -334)], RED_L)
    P([(6, -300), (70, -312), (130, -280), (70, -294), (6, -282)], RED_D)

def make(size, scale, maskable):
    img = Image.new('RGBA', (S, S))
    px = img.load()
    for y in range(S):                       # tło: ciepła poświata u góry, ciemno na dole
        t = y / (S - 1)
        for x in range(S):
            dx, dy = (x - S / 2) / S, (y - S * 0.42) / S
            glow = max(0.0, 1 - (dx * dx + dy * dy) * 5.2)
            px[x, y] = lerp(lerp(BG1, BG2, t), (92, 64, 34), glow * 0.55) + (255,)
    random.seed(7)
    d = ImageDraw.Draw(img)
    for _ in range(900):                     # delikatne ziarno
        x, y = random.randrange(S), random.randrange(S)
        v = random.randint(-14, 14)
        r, g, b, _a = img.getpixel((x, y))
        d.point((x, y), fill=(max(0, r + v), max(0, g + v), max(0, b + v), 255))
    emblem(img, scale, S // 2, int(S * 0.56))
    return img.convert('RGB').resize((size, size), Image.LANCZOS)

out = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(out, exist_ok=True)
# "any": emblem większy; "maskable": mieści się w bezpiecznym kole (środkowe 80%)
make(192, 1.2, False).save(os.path.join(out, 'icon-192.png'))
make(512, 1.2, False).save(os.path.join(out, 'icon-512.png'))
make(512, 0.88, True).save(os.path.join(out, 'icon-maskable-512.png'))
make(64, 1.2, False).save(os.path.join(out, 'favicon.png'))
print('gotowe:', sorted(os.listdir(out)))
