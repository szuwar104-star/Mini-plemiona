/* =========================================================================
   Mini Plemiona – IKONY (rysowane proceduralnie na <canvas>, działa offline)
   Każda ikona jest projektowana w siatce 32 × 32 jednostek, a rasteryzowana
   w 64 × 64 px. Światło pada z lewej góry: każda bryła ma 5-stopniową rampę
   tonów (cień → światło z przesunięciem barwy), krawędzie ze światłem i cieniem,
   delikatny dithering oraz ciemny obrys wokół całej sylwetki.
   Publiczne API bez zmian: icon(name), village(color), terrain(name), building.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP = root.MP || {};
  const U = 32, K = 2, N = U * K;

  /* ---------- kolory ---------- */
  function rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function cl(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function mul(c, f) { return [cl(c[0] * f), cl(c[1] * f), cl(c[2] * f)]; }
  const SHADOW_TINT = [34, 24, 70], LIGHT_TINT = [255, 240, 196];
  const rampCache = {};
  // 5 tonów od cienia do światła; cienie wpadają w fiolet, światła w ciepły żółty
  function ramp(h) {
    if (Array.isArray(h)) return h;
    if (rampCache[h]) return rampCache[h];
    const c = rgb(h);
    return rampCache[h] = [
      mixc(mul(c, 0.46), SHADOW_TINT, 0.28), mixc(mul(c, 0.72), SHADOW_TINT, 0.12), c,
      mixc(c, LIGHT_TINT, 0.30), mixc(c, [255, 248, 222], 0.62)
    ];
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.47);

  /* ---------- kształty (współrzędne w jednostkach 0..32) ---------- */
  const S = {
    rect(x, y, w, h) { return { x0: x, y0: y, x1: x + w, y1: y + h, f: (a, b) => a >= x && a < x + w && b >= y && b < y + h }; },
    rrect(x, y, w, h, r) {
      return {
        x0: x, y0: y, x1: x + w, y1: y + h, f: (a, b) => {
          if (a < x || a >= x + w || b < y || b >= y + h) return false;
          const dx = a < x + r ? x + r - a : a > x + w - r ? a - (x + w - r) : 0;
          const dy = b < y + r ? y + r - b : b > y + h - r ? b - (y + h - r) : 0;
          return dx * dx + dy * dy <= r * r;
        }
      };
    },
    ell(cx, cy, rx, ry) { return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry, f: (a, b) => ((a - cx) / rx) ** 2 + ((b - cy) / ry) ** 2 <= 1 }; },
    circle(cx, cy, r) { return S.ell(cx, cy, r, r); },
    ring(cx, cy, r0, r1) { return { x0: cx - r1, y0: cy - r1, x1: cx + r1, y1: cy + r1, f: (a, b) => { const d = Math.hypot(a - cx, b - cy); return d >= r0 && d <= r1; } }; },
    poly(pts) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      pts.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      return {
        x0, y0, x1, y1, f: (a, b) => {
          let inside = false;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
            if ((yi > b) !== (yj > b) && a < (xj - xi) * (b - yi) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        }
      };
    },
    // kapsuła: odcinek o grubości t (można zwężać: t1 na końcu)
    line(ax, ay, bx, by, t, t1) {
      const tt1 = t1 === undefined ? t : t1, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, m = Math.max(t, tt1) / 2;
      return {
        x0: Math.min(ax, bx) - m, y0: Math.min(ay, by) - m, x1: Math.max(ax, bx) + m, y1: Math.max(ay, by) + m, f: (a, b) => {
          let u = ((a - ax) * dx + (b - ay) * dy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
          return Math.hypot(a - (ax + dx * u), b - (ay + dy * u)) <= (t + (tt1 - t) * u) / 2;
        }
      };
    },
    union(...s) {
      return {
        x0: Math.min(...s.map(q => q.x0)), y0: Math.min(...s.map(q => q.y0)), x1: Math.max(...s.map(q => q.x1)), y1: Math.max(...s.map(q => q.y1)),
        f: (a, b) => s.some(q => q.f(a, b))
      };
    }
  };

  /* ---------- płótno ---------- */
  function Pad() {
    const buf = new Uint8ClampedArray(N * N * 4);
    const api = {
      // paint(kształt, kolor lub rampa, tryb: flat | v | h | d | r, {bev: grubość krawędzi w jednostkach, dith: siła ditheringu})
      paint(sh, color, mode, opt) {
        opt = opt || {};
        const rp = ramp(color), bev = opt.bev === undefined ? 0.8 : opt.bev, dith = opt.dith === undefined ? 0.5 : opt.dith;
        mode = mode || 'v';
        const w = Math.max(0.001, sh.x1 - sh.x0), h = Math.max(0.001, sh.y1 - sh.y0);
        const cx = (sh.x0 + sh.x1) / 2, cy = (sh.y0 + sh.y1) / 2;
        const ya = Math.max(0, Math.floor(sh.y0 * K)), yb = Math.min(N - 1, Math.ceil(sh.y1 * K));
        const xa = Math.max(0, Math.floor(sh.x0 * K)), xb = Math.min(N - 1, Math.ceil(sh.x1 * K));
        for (let py = ya; py <= yb; py++) {
          for (let px = xa; px <= xb; px++) {
            const x = (px + 0.5) / K, y = (py + 0.5) / K;
            if (!sh.f(x, y)) continue;
            const tx = (x - sh.x0) / w, ty = (y - sh.y0) / h;
            let t = 2;
            if (mode === 'v') t = 3.4 - 2.3 * ty;
            else if (mode === 'h') t = 3.4 - 2.3 * tx;
            else if (mode === 'd') t = 3.6 - 2.4 * (tx + ty) / 2;
            else if (mode === 'r') { const dx = (x - cx) / (w / 2) + 0.38, dy = (y - cy) / (h / 2) + 0.38; t = 3.8 - 2.9 * Math.min(1.1, Math.hypot(dx, dy) / 1.35); }
            if (mode !== 'flat') t += BAYER[(py & 3) * 4 + (px & 3)] * dith;
            if (bev > 0 && mode !== 'flat') {
              if (!sh.f(x - bev, y) || !sh.f(x, y - bev)) t += 1.05;
              else if (!sh.f(x + bev, y) || !sh.f(x, y + bev)) t -= 1.05;
            }
            const c = rp[Math.max(0, Math.min(4, Math.round(t)))], i = (py * N + px) * 4;
            buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
          }
        }
        return api;
      },
      flat(sh, color) { return api.paint(sh, color, 'flat', { bev: 0 }); },
      dot(x, y, color, size) { const s = size || 1; return api.flat(S.rect(x, y, s, s), color); },
      // obrys: dokłada ciemne piksele wokół sylwetki, kolor to mocno przyciemniony kolor sąsiada
      outline(thick, col) {
        const base = col || [28, 17, 10];
        for (let it = 0; it < (thick || 1) * K; it++) {
          const add = [];
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            if (buf[(y * N + x) * 4 + 3]) continue;
            let best = null;
            for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + d[0], ny = y + d[1];
              if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
              const j = (ny * N + nx) * 4;
              if (buf[j + 3]) { best = [buf[j], buf[j + 1], buf[j + 2]]; break; }
            }
            if (best) add.push([x, y, mixc(base, mul(best, 0.28), 0.4)]);
          }
          add.forEach(a => { const i = (a[1] * N + a[0]) * 4; buf[i] = a[2][0]; buf[i + 1] = a[2][1]; buf[i + 2] = a[2][2]; buf[i + 3] = 255; });
        }
        return api;
      },
      // miękki cień pod przedmiotem
      shadow(cx, cy, rx, ry, a) {
        const sh = S.ell(cx, cy, rx, ry);
        for (let py = Math.floor(sh.y0 * K); py <= Math.ceil(sh.y1 * K); py++) for (let px = Math.floor(sh.x0 * K); px <= Math.ceil(sh.x1 * K); px++) {
          if (px < 0 || py < 0 || px >= N || py >= N) continue;
          const i = (py * N + px) * 4;
          if (buf[i + 3]) continue;
          if (sh.f((px + 0.5) / K, (py + 0.5) / K)) { buf[i] = 10; buf[i + 1] = 6; buf[i + 2] = 20; buf[i + 3] = Math.round(255 * (a === undefined ? 0.35 : a)); }
        }
        return api;
      },
      url() {
        const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
        cv.getContext('2d').putImageData(new ImageData(buf, N, N), 0, 0);
        return cv.toDataURL('image/png');
      }
    };
    return api;
  }

  /* ---------- paleta ---------- */
  const COL = {
    bark: '#6b4325', cut: '#e6b877', ring: '#b8844a', clay: '#c9573a', mortar: '#e6d0a4', steel: '#b4c2d2', steelD: '#6e8096',
    gold: '#e7b63c', red: '#c23a2b', cream: '#ecdfb9', stone: '#a9aeb5', stoneD: '#7a7f89', blue: '#4f78b8', green: '#5a9a3e',
    brown: '#8d5a2b', woodD: '#74461f', skin: '#eab98c', dark: '#3a2a1c', leaf: '#4c8c34', leafD: '#2f6a2a'
  };

  /* ---------- ikony ---------- */
  function logEnd(c, cx, cy, r) {
    c.paint(S.circle(cx, cy, r), COL.bark, 'd', { bev: 0.5 });
    c.paint(S.circle(cx, cy, r - 1.1), COL.cut, 'r', { bev: 0 });
    c.flat(S.ring(cx, cy, r * 0.52, r * 0.52 + 0.55), COL.ring);
    c.flat(S.circle(cx, cy, r * 0.16 + 0.3), '#a56f3a');
  }
  function brick(c, x, y, w, h) {
    c.paint(S.rect(x, y, w, h), COL.clay, 'v', { bev: 0.7 });
    c.dot(x + 1.2, y + 1, '#e98a63', 1.4);
    c.dot(x + w - 2.4, y + h - 1.8, '#8d3524', 1.2);
  }
  function ingot(c, x, y, w, h) {
    c.paint(S.poly([[x + 0.5, y + 3.2], [x + w - 0.5, y + 3.2], [x + w, y + h], [x, y + h]]), COL.steelD, 'v', { bev: 0.6 });
    c.paint(S.poly([[x + 2.4, y], [x + w - 2.4, y], [x + w - 0.5, y + 3.2], [x + 0.5, y + 3.2]]), '#d3dde8', 'd', { bev: 0 });
    c.dot(x + 2.5, y + 1.2, '#ffffff', 2);
  }

  const DRAW = {
    wood(c) {
      [[7.6, 24.4], [16, 24.4], [24.4, 24.4], [11.8, 17.1], [20.2, 17.1], [16, 9.8]].forEach(p => logEnd(c, p[0], p[1], 4.35));
    },
    clay(c) {
      [[2.5, 23.5], [11.5, 23.5], [20.5, 23.5], [7, 16.5], [16, 16.5], [11.5, 9.5]].forEach(p => brick(c, p[0], p[1], 9, 6));
    },
    iron(c) {
      ingot(c, 2.5, 20.5, 13, 8.5); ingot(c, 16.5, 20.5, 13, 8.5); ingot(c, 9.5, 11.5, 13, 8.5);
    },
    pop(c) {
      c.paint(S.rrect(7, 17, 18, 12.5, 6), '#5a78b0', 'v');
      c.flat(S.rect(13.5, 17, 5, 3.2), COL.skin);
      c.flat(S.rect(7, 24.6, 18, 1.6), '#4a3220');
      c.flat(S.rect(15, 24.4, 2, 2.2), COL.gold);
      c.paint(S.circle(16, 9.8, 6.6), '#7a4a22', 'd');
      c.paint(S.circle(16, 11.2, 5.4), COL.skin, 'r', { bev: 0 });
      c.dot(13.3, 11.2, '#2a1c10', 1.3); c.dot(17.4, 11.2, '#2a1c10', 1.3);
      c.flat(S.rect(14.4, 14, 3.2, 0.9), '#b86a4a');
    },
    hq(c) {
      c.shadow(16, 29.6, 13, 1.4);
      c.paint(S.rect(11.5, 4, 9, 14), COL.stone, 'h');                    // wieża z zegarem
      c.paint(S.poly([[10, 5.5], [16, -0.5 + 1], [22, 5.5]]), COL.red, 'd', { bev: 0.6 });
      c.flat(S.rect(15.9, 0.2, 0.3, 0), COL.gold);
      c.paint(S.circle(16, 9.2, 2.6), COL.cream, 'r', { bev: 0 });
      c.flat(S.rect(15.7, 7.6, 0.7, 2), COL.dark); c.flat(S.rect(15.7, 9.1, 2, 0.7), COL.dark);
      c.paint(S.rect(3, 17.5, 26, 12), COL.cream, 'v');                  // sala
      c.paint(S.poly([[1, 19], [8, 12.5], [24, 12.5], [31, 19]]), COL.red, 'v', { bev: 0.7 });
      for (let i = 0; i < 4; i++) c.flat(S.rect(5 + i * 6.2, 14.6, 3.6, 0.7), '#8a2a20');
      c.paint(S.rrect(13.4, 21.5, 5.2, 8, 2.6), COL.woodD, 'h');
      c.dot(17, 25.6, COL.gold, 1);
      [[5.8, 21.5], [22.2, 21.5]].forEach(p => { c.paint(S.rect(p[0], p[1], 4, 4.4), '#f2d675', 'd', { bev: 0.5 }); c.flat(S.rect(p[0] + 1.8, p[1], 0.5, 4.4), COL.dark); });
    },
    pick(c) {
      c.shadow(17, 30, 12, 1.2, 0.3);
      c.paint(S.line(7, 28, 22.5, 9.5, 3.4), COL.brown, 'h', { bev: 0.5 });
      c.paint(S.poly([[3.5, 14.5], [8, 7], [16, 3.5], [24, 4], [30, 9], [26.5, 10.2], [22.5, 7.8], [16.5, 8.2], [10.5, 11.5], [6.5, 17]]), COL.steel, 'd', { bev: 0.7 });
      c.dot(11, 7.2, '#ffffff', 1.6);
      c.paint(S.ell(25.5, 26, 4.5, 3.2), COL.stoneD, 'r'); c.paint(S.ell(21.5, 27.6, 3, 2.2), COL.stone, 'r');
      c.dot(24.2, 24.6, COL.gold, 1.5); c.dot(21, 26.8, COL.gold, 1.2);
    },
    farm(c) {
      c.shadow(16, 29.6, 14, 1.4);
      c.paint(S.rect(4.5, 14, 23, 15), COL.red, 'v');
      for (let i = 0; i < 6; i++) c.flat(S.rect(7 + i * 3.6, 15.5, 0.5, 13), '#8e2c20');
      c.paint(S.poly([[2.5, 15.2], [7.5, 6], [24.5, 6], [29.5, 15.2]]), '#7a4a2c', 'v', { bev: 0.7 });
      c.flat(S.rect(10, 8.2, 12, 2.2), '#5c341b'); c.flat(S.rect(12, 11.4, 8, 1.2), '#5c341b');
      c.paint(S.rect(11.5, 19, 9, 10), COL.cream, 'v', { bev: 0.5 });
      c.flat(S.poly([[11.5, 19], [12.6, 19], [20.5, 29], [19.4, 29]]), COL.red); c.flat(S.poly([[20.5, 19], [19.4, 19], [11.5, 29], [12.6, 29]]), COL.red);
      c.paint(S.ell(5.5, 27.4, 3, 2), '#e3c35a', 'r'); c.paint(S.ell(26.5, 27.4, 3, 2), '#e3c35a', 'r');
    },
    barracks(c) {
      c.shadow(16, 29.6, 14, 1.4);
      c.paint(S.rect(3, 12, 26, 17), COL.stone, 'v');
      for (let i = 0; i < 4; i++) c.paint(S.rect(3 + i * 7, 7.5, 5, 5), COL.stone, 'v', { bev: 0.6 });
      for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) c.flat(S.rect(3 + ((r % 2) ? 2 : 0) + i * 4.5, 14 + r * 3.6, 0.5, 3.4), COL.stoneD);
      for (let r = 1; r < 5; r++) c.flat(S.rect(3, 13.4 + r * 3.6, 26, 0.5), COL.stoneD);
      c.paint(S.poly([[11, 17.5], [21, 17.5], [21, 29], [11, 29]]), '#3b281a', 'h', { bev: 0 });
      c.paint(S.ell(16, 17.5, 5, 4.2), '#3b281a', 'h', { bev: 0 });
      c.paint(S.poly([[4.5, 14], [9.5, 14], [9.5, 22], [7, 20.2], [4.5, 22]]), COL.red, 'v', { bev: 0.5 });
      c.paint(S.poly([[22.5, 14], [27.5, 14], [27.5, 22], [25, 20.2], [22.5, 22]]), COL.red, 'v', { bev: 0.5 });
    },
    spear(c) {
      c.shadow(16, 30.4, 6, 1);
      c.paint(S.line(16, 10, 16, 30, 2.4), COL.brown, 'h', { bev: 0.5 });
      c.paint(S.poly([[16, 0.8], [20.5, 8.4], [16, 11.4], [11.5, 8.4]]), COL.steel, 'h', { bev: 0.7 });
      c.flat(S.rect(16, 2.8, 0.6, 6), '#e8eef5');
      c.flat(S.rect(13.4, 11, 5.2, 1.5), COL.gold);
      c.paint(S.poly([[17.2, 13], [27, 14.4], [24.4, 17.4], [27, 20.6], [17.2, 20]]), COL.red, 'v', { bev: 0.6 });
    },
    axe(c) {
      c.shadow(16.5, 30.4, 6, 1);
      c.paint(S.line(17, 6, 17, 30, 2.8), COL.brown, 'h', { bev: 0.5 });
      c.paint(S.poly([[17, 4.5], [10, 3], [4, 6.5], [3, 13], [6.5, 18.5], [17, 17]]), COL.steel, 'd', { bev: 0.8 });
      c.paint(S.poly([[17, 5.5], [21.5, 6.5], [21.5, 15.5], [17, 16.5]]), COL.steelD, 'h', { bev: 0.5 });
      c.flat(S.poly([[5.6, 8], [10, 5.4], [10, 6.8], [6.4, 9.4]]), '#f4f8fc');
      c.flat(S.rect(15.6, 18, 2.8, 1.4), COL.gold); c.flat(S.rect(15.6, 25, 2.8, 1.2), '#5c341b');
    },
    light(c) {
      c.paint(S.poly([[8, 29.5], [9.5, 19], [7.5, 13], [9.5, 8], [9, 3], [13, 5.2], [15.4, 8.2], [21, 9.2], [27, 15], [29, 20.5], [27.2, 24.5], [23.4, 23.6], [20.4, 20.6], [17.2, 22.4], [18.4, 29.5]]), '#a2602f', 'd', { bev: 0.7 });
      c.paint(S.poly([[8.5, 4], [4.4, 10.5], [5.6, 17.4], [5.8, 24.5], [8.6, 29.5], [9.8, 19.4], [7.8, 13], [9.8, 8.4]]), '#4a2a14', 'h', { bev: 0.5 });
      c.paint(S.poly([[12.5, 5.5], [14.4, 7.8], [12.4, 8.6]]), '#c27a42', 'flat', { bev: 0 });
      c.flat(S.poly([[24, 13.4], [27.5, 15.4], [28.4, 19.4], [26, 18.6]]), COL.red);   // uzda
      c.flat(S.rect(18.6, 9.8, 1.2, 8), COL.red);
      c.dot(17, 11.4, '#fff4d6', 2.2); c.dot(17.6, 11.9, '#1d130c', 1.2);
      c.dot(25.6, 21.4, '#2a160a', 1.3);
    },
    noble(c) {
      c.shadow(16, 29.4, 12, 1.2);
      c.paint(S.poly([[4, 25], [2.6, 9], [9.6, 15], [16, 4], [22.4, 15], [29.4, 9], [28, 25]]), COL.gold, 'd', { bev: 0.8 });
      c.paint(S.rect(4, 21.6, 24, 6.2), '#cf9a28', 'v', { bev: 0.7 });
      c.flat(S.rect(4, 24, 24, 0.6), '#8c5f14');
      c.paint(S.circle(16, 17.4, 2.3), COL.red, 'r', { bev: 0 });
      c.paint(S.circle(9, 24.6, 1.5), '#4f8ce0', 'r', { bev: 0 }); c.paint(S.circle(23, 24.6, 1.5), '#4f8ce0', 'r', { bev: 0 });
      c.paint(S.circle(16, 24.6, 1.5), '#5cc07a', 'r', { bev: 0 });
      [[2.6, 8], [16, 3], [29.4, 8]].forEach(p => c.paint(S.circle(p[0], p[1], 1.9), '#f4f0e4', 'r', { bev: 0 }));
    },
    archer(c) {
      const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([11 - 7.5 * Math.sin(Math.PI * t), 2.5 + 27 * t]); }
      for (let i = 0; i < pts.length - 1; i++) c.paint(S.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3), COL.brown, 'h', { bev: 0.4, dith: 0.2 });
      c.flat(S.line(11, 2.8, 11, 29.2, 0.7), '#efe6c8');
      c.paint(S.line(7, 16, 27, 16, 1.5), '#d9c9a0', 'v', { bev: 0 });
      c.paint(S.poly([[27, 13.4], [31.2, 16], [27, 18.6]]), COL.steel, 'h', { bev: 0.4 });
      c.flat(S.poly([[7, 16], [3.8, 12.4], [8.6, 13.4], [10, 16]]), COL.red); c.flat(S.poly([[7, 16], [3.8, 19.6], [8.6, 18.6], [10, 16]]), COL.red);
    },
    guard(c) {
      c.shadow(16, 30.4, 9, 1);
      const shape = [[4.5, 3.4], [27.5, 3.4], [27.5, 15.2], [16, 29.6], [4.5, 15.2]];
      c.paint(S.poly(shape), COL.steel, 'd', { bev: 0.8 });
      c.paint(S.poly([[7, 5.8], [25, 5.8], [25, 14.6], [16, 26.4], [7, 14.6]]), COL.blue, 'd', { bev: 0.6 });
      c.paint(S.poly([[16, 5.8], [25, 5.8], [25, 14.6], [16, 26.4]]), '#c23a2b', 'd', { bev: 0 });
      c.paint(S.rect(14.4, 7, 3.2, 17), COL.gold, 'h', { bev: 0.4 });
      c.paint(S.rect(8, 11.2, 16, 3.2), COL.gold, 'v', { bev: 0.4 });
      c.paint(S.circle(16, 12.8, 2.4), '#f4e2a0', 'r', { bev: 0 });
    },
    sword(c) {
      c.shadow(17, 30, 11, 1, 0.28);
      c.paint(S.poly([[27.4, 3.4], [29.2, 7.4], [15.4, 19.2], [12.6, 16.4]]), COL.steel, 'h', { bev: 0.6 });
      c.flat(S.line(26.2, 5.8, 14.6, 17.6, 0.7), '#f7fbff');
      c.paint(S.line(8.6, 12.6, 19.4, 23.4, 3.2), COL.gold, 'v', { bev: 0.5 });
      c.paint(S.line(12.8, 19, 6.6, 25.2, 3), '#6b3f1c', 'h', { bev: 0.4 });
      for (let i = 0; i < 3; i++) c.flat(S.line(11.4 - i * 1.7, 20.6 + i * 1.7, 12.6 - i * 1.7, 21.8 + i * 1.7, 0.8), '#3d2410');
      c.paint(S.circle(5.2, 26.8, 2.3), COL.gold, 'r', { bev: 0 });
    },
    wall(c) {
      c.shadow(16, 30, 14, 1.2);
      [2, 9.4, 16.8, 24.2].forEach(x => c.paint(S.rect(x, 4.5, 5.8, 6.5), COL.stone, 'v', { bev: 0.7 }));
      c.paint(S.rect(2, 10.5, 28, 19), COL.stone, 'v', { bev: 0.8 });
      for (let r = 0; r < 4; r++) {
        c.flat(S.rect(2, 14.4 + r * 4.6, 28, 0.55), COL.stoneD);
        for (let i = 0; i < 5; i++) c.flat(S.rect(2 + ((r % 2) ? 3 : 0) + i * 6, 10.5 + r * 4.6 + (r === 0 ? 0 : 0.4), 0.55, 4.4), COL.stoneD);
      }
      c.dot(4, 12.2, '#ffffff', 1.4); c.dot(19, 17, '#dfe3e8', 1.4);
      c.paint(S.rrect(12.5, 18, 7, 11.5, 3.5), '#3b281a', 'h', { bev: 0 });
    },
    ram(c) {
      c.shadow(16, 30.4, 14, 1.2);
      c.paint(S.poly([[4, 13], [16, 4], [28, 13], [28, 15.4], [4, 15.4]]), '#9c5d30', 'v', { bev: 0.7 });
      for (let i = 0; i < 5; i++) c.flat(S.line(8 + i * 4, 12.2, 11 + i * 4, 8.2, 0.5), '#6a3a1a');
      c.paint(S.rect(5.5, 14.5, 2.6, 11), COL.woodD, 'h', { bev: 0.4 }); c.paint(S.rect(23.9, 14.5, 2.6, 11), COL.woodD, 'h', { bev: 0.4 });
      c.paint(S.line(5, 20, 27, 20, 5), '#a96a38', 'v', { bev: 0.6 });
      c.paint(S.poly([[0.8, 17], [6.4, 16.8], [6.4, 23.2], [0.8, 23]]), COL.steel, 'h', { bev: 0.6 });
      c.paint(S.circle(9.4, 26.2, 4.2), COL.woodD, 'r', { bev: 0.4 }); c.paint(S.circle(23.4, 26.2, 4.2), COL.woodD, 'r', { bev: 0.4 });
      c.flat(S.circle(9.4, 26.2, 1.3), COL.gold); c.flat(S.circle(23.4, 26.2, 1.3), COL.gold);
    },
    scout(c) {
      c.shadow(17, 30, 11, 1, 0.28);
      c.paint(S.line(5.4, 26.6, 12, 20, 5), '#7a4a22', 'h', { bev: 0.5 });
      c.paint(S.line(11.6, 20.4, 19.2, 12.8, 7), '#c99a3c', 'h', { bev: 0.5 });
      c.paint(S.line(18.8, 13.2, 25.6, 6.4, 9.2), '#a8742a', 'h', { bev: 0.5 });
      c.flat(S.line(11, 21, 12.8, 19.2, 7.4), '#e8c25a'); c.flat(S.line(18.4, 13.6, 20, 12, 9.6), '#e8c25a');
      c.paint(S.ell(26.6, 5.4, 2.4, 4.8), '#9fd3f0', 'd', { bev: 0 });
      c.dot(25.6, 3.4, '#ffffff', 1.4);
    },
    settler(c) {
      c.shadow(16, 30.4, 14, 1.2);
      c.paint(S.rect(3.5, 17.6, 25, 7.2), '#8d5a2b', 'v', { bev: 0.6 });
      c.paint(S.poly([[4, 18], [6, 10], [11, 5.4], [18.4, 4.2], [24.6, 8], [27.6, 14.8], [27.6, 18]]), COL.cream, 'd', { bev: 0.7 });
      [10.5, 16, 21.5].forEach(x => c.flat(S.line(x, 18, x, 6.2 + Math.abs(x - 16) * 0.5, 0.6), '#bda878'));
      c.flat(S.rect(4, 17.2, 24, 1.1), '#b8433a');
      c.paint(S.line(0.8, 24.6, 4.2, 22.4, 1.6), COL.woodD, 'h', { bev: 0 });
      [[9.4, 26.4], [23, 26.4]].forEach(p => {
        c.paint(S.circle(p[0], p[1], 4.4), COL.woodD, 'r', { bev: 0.4 });
        c.flat(S.circle(p[0], p[1], 2.6), '#b98a4a'); c.flat(S.circle(p[0], p[1], 0.9), '#3a2a1c');
        c.flat(S.rect(p[0] - 0.3, p[1] - 3, 0.6, 6), '#74461f'); c.flat(S.rect(p[0] - 3, p[1] - 0.3, 6, 0.6), '#74461f');
      });
    },
    coin(c) {
      c.shadow(16, 30, 11, 1.2);
      c.paint(S.circle(16, 15.6, 13.2), '#d79a2a', 'd', { bev: 0.8 });
      c.paint(S.circle(16, 15.6, 10.6), COL.gold, 'r', { bev: 0 });
      c.flat(S.ring(16, 15.6, 9.2, 9.9), '#b77f1c');
      c.paint(S.poly([[16, 7.4], [18.2, 13.4], [24.4, 13.6], [19.4, 17.4], [21.2, 23.6], [16, 20], [10.8, 23.6], [12.6, 17.4], [7.6, 13.6], [13.8, 13.4]]), '#f6d46a', 'd', { bev: 0.4, dith: 0.2 });
      c.dot(8.4, 8.4, '#fff8dc', 1.8);
    },
    market(c) {
      c.shadow(16, 30, 14, 1.2);
      c.paint(S.rect(4.2, 11, 1.8, 18.5), COL.woodD, 'h', { bev: 0 }); c.paint(S.rect(26, 11, 1.8, 18.5), COL.woodD, 'h', { bev: 0 });
      c.paint(S.rect(3.5, 22.5, 25, 7), '#a8703a', 'v', { bev: 0.7 });
      c.flat(S.rect(3.5, 25.6, 25, 0.6), '#74461f');
      [[7.5, 20.6, '#d9442e'], [11.4, 20.8, '#f0c030'], [15.6, 20.4, '#d9442e'], [19.8, 20.8, '#6fb04a'], [24, 20.6, '#f0c030']].forEach(p => c.paint(S.circle(p[0], p[1], 2.1), p[2], 'r', { bev: 0 }));
      for (let i = 0; i < 6; i++) c.paint(S.poly([[3.2 + i * 4.3, 3.4], [7.5 + i * 4.3, 3.4], [7.5 + i * 4.3, 11.2], [3.2 + i * 4.3, 11.2]]), i % 2 ? COL.cream : COL.red, 'v', { bev: 0 });
      for (let i = 0; i < 6; i++) c.paint(S.ell(5.35 + i * 4.3, 11.2, 2.15, 1.9), i % 2 ? COL.cream : COL.red, 'v', { bev: 0 });
      c.paint(S.rect(2.6, 2.2, 26.8, 2.2), '#8a2a20', 'v', { bev: 0.4 });
    },
    merchant(c) {
      c.shadow(16, 30.4, 10, 1.2);
      c.paint(S.ell(16, 20.4, 11.2, 9.6), '#b98a52', 'r', { bev: 0 });
      c.paint(S.poly([[11.6, 12.4], [20.4, 12.4], [24, 5.6], [8, 5.6]]), '#a97a44', 'h', { bev: 0.5 });
      c.paint(S.ell(16, 5.8, 8.2, 2.6), '#cfa467', 'v', { bev: 0 });
      c.paint(S.rect(11, 11.4, 10, 2.2), COL.red, 'v', { bev: 0.4 });
      c.paint(S.circle(16, 21, 5.2), COL.gold, 'r', { bev: 0 });
      c.flat(S.ring(16, 21, 3.6, 4.2), '#b77f1c');
      c.flat(S.rect(15.4, 18.6, 1.2, 4.8), '#b77f1c');
    },
    map(c) {
      c.shadow(16, 30, 13, 1.2);
      c.paint(S.rect(2.5, 4.5, 27, 23), '#ead9a8', 'h', { bev: 0.7 });
      c.paint(S.rect(11.5, 4.5, 9, 23), '#e0cd96', 'h', { bev: 0, dith: 0.2 });
      c.flat(S.rect(11.5, 4.5, 0.6, 23), '#b89c62'); c.flat(S.rect(20, 4.5, 0.6, 23), '#b89c62');
      c.paint(S.poly([[5, 9], [10, 7.4], [14, 10], [12.6, 14.4], [7, 15.6], [4.6, 12.6]]), '#7fb255', 'd', { bev: 0.4 });
      c.paint(S.poly([[19, 20], [25, 18.4], [27.4, 22.4], [22, 25.4]]), '#7fb255', 'd', { bev: 0.4 });
      c.paint(S.ell(23.4, 10, 3.4, 2.4), '#7db8e0', 'd', { bev: 0 });
      for (let i = 0; i < 6; i++) c.dot(8 + i * 2.6, 23.6 - Math.sin(i * 0.9) * 2.4, COL.red, 1.1);
      c.flat(S.line(21.4, 15.6, 26.2, 20.4, 1.7), COL.red); c.flat(S.line(26.2, 15.6, 21.4, 20.4, 1.7), COL.red);
    },
    scroll(c) {
      c.shadow(16, 30.6, 11, 1);
      c.paint(S.rect(7, 6.5, 18, 19), '#efe0b4', 'h', { bev: 0.6 });
      for (let i = 0; i < 5; i++) c.flat(S.rect(9.6, 10 + i * 3.1, i === 4 ? 6 : 12.8, 0.9), '#8a6a3a');
      c.paint(S.rrect(4.6, 3.2, 22.8, 5, 2.5), '#d9bf84', 'v', { bev: 0.5 });
      c.paint(S.rrect(4.6, 23.8, 22.8, 5, 2.5), '#d9bf84', 'v', { bev: 0.5 });
      c.flat(S.circle(5.6, 5.7, 1), '#9b7a44'); c.flat(S.circle(26.4, 5.7, 1), '#9b7a44'); c.flat(S.circle(5.6, 26.3, 1), '#9b7a44'); c.flat(S.circle(26.4, 26.3, 1), '#9b7a44');
      c.paint(S.circle(21, 21.2, 3.2), COL.red, 'r', { bev: 0 });
      c.flat(S.circle(21, 21.2, 1.3), '#8a2a20');
    },
    menu(c) {
      [5.5, 13.2, 20.9].forEach(y => c.paint(S.rrect(4.5, y, 23, 5.6, 2.8), COL.gold, 'v', { bev: 0.7 }));
    },
    village(c, col) {
      const roof = col || '#b8432b';
      c.shadow(16, 29.8, 13, 1.4);
      c.paint(S.rect(5.5, 15.5, 21, 14), COL.cream, 'v');
      c.flat(S.rect(5.5, 24.6, 21, 0.6), '#c5ae7d');
      c.paint(S.poly([[2.5, 17.5], [16, 5.6], [29.5, 17.5], [26, 17.5], [16, 9.6], [6, 17.5]]), roof, 'd', { bev: 0.7 });
      c.paint(S.poly([[3, 18], [16, 6.2], [29, 18], [29, 19.4], [3, 19.4]]), roof, 'v', { bev: 0.6 });
      c.paint(S.rect(21, 6, 3.6, 7), COL.stoneD, 'h', { bev: 0.5 });
      c.paint(S.rrect(13.6, 21, 5, 8.5, 2.4), COL.woodD, 'h', { bev: 0 });
      c.paint(S.rect(7.4, 21, 4, 4, 0), '#f2d675', 'd', { bev: 0.5 });
      c.paint(S.rect(21.6, 21, 4, 4), '#f2d675', 'd', { bev: 0.5 });
    },
    forest(c) {
      c.shadow(16, 30, 13, 1.2);
      const pine = (x, y, w, h) => {
        c.paint(S.rect(x - 1, y + h - 3, 2, 3.4), COL.bark, 'h', { bev: 0 });
        for (let i = 0; i < 3; i++) {
          const top = y + i * h * 0.26, bot = y + h * 0.5 + i * h * 0.17, hw = w * (0.45 + i * 0.28);
          c.paint(S.poly([[x, top], [x + hw, bot], [x - hw, bot]]), COL.leafD, 'd', { bev: 0.5 });
        }
      };
      pine(8, 8, 7, 20); pine(24, 9, 7, 19);
      c.paint(S.rect(15, 21, 2.4, 8), COL.bark, 'h', { bev: 0 });
      c.paint(S.circle(16, 15, 8.4), '#3f7a2f', 'r', { bev: 0 });
      c.paint(S.circle(12.8, 11.6, 4.4), '#68a843', 'r', { bev: 0 }); c.paint(S.circle(19.6, 17.4, 3.4), '#2f6a2a', 'r', { bev: 0 });
    },
    mountain(c) {
      c.shadow(16, 29.6, 14, 1.2);
      c.paint(S.poly([[1.5, 28.5], [10, 12], [18, 28.5]]), '#8a8978', 'd', { bev: 0.6 });
      c.paint(S.poly([[8, 28.5], [19, 4.5], [30.5, 28.5]]), '#a09e8c', 'd', { bev: 0.6 });
      c.paint(S.poly([[19, 4.5], [30.5, 28.5], [19, 28.5], [20, 18]]), '#6c6a5d', 'v', { bev: 0 });
      c.paint(S.poly([[19, 4.5], [24.4, 15.4], [21.4, 14], [19.4, 17.4], [16.4, 13.6], [14, 15.6]]), '#f3f2ea', 'd', { bev: 0.4 });
    }
  };

  /* ---------- API ---------- */
  const cache = {};
  function render(name, arg) {
    if (typeof document === 'undefined') return '';
    const fn = DRAW[name];
    if (!fn) return '';
    const c = Pad();
    fn(c, arg);
    c.outline(1);
    return '<img class="pix" alt="" draggable="false" src="' + c.url() + '">';
  }
  function icon(name) { return cache[name] || (cache[name] = render(name)); }
  function village(color) { const k = 'village' + color; return cache[k] || (cache[k] = render('village', color).replace('class="pix"', 'class="pix tile-art"')); }
  function terrain(name) { const k = 't-' + name; return cache[k] || (cache[k] = render(name).replace('class="pix"', 'class="pix tile-art"')); }

  MP.Sprites = {
    icon, village, terrain,
    building: { hq: 'hq', wood: 'wood', clay: 'clay', iron: 'pick', farm: 'farm', barracks: 'barracks', market: 'market', wall: 'wall' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
