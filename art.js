/* =========================================================================
   Mini Plemiona – GRAFIKA PROCEDURALNA
   Teren, drogi, lasy, góry, terytoria frakcji, osady i widok wioski
   rysowane piksel po pikselu na <canvas>. Wszystko deterministyczne
   (ten sam świat zawsze wygląda tak samo) i działa offline.
   1 piksel grafiki = 2 piksele ekranu (pole mapy = 28 × 28 pikseli grafiki).
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const AP = 28;

  /* ---------- narzędzia ---------- */
  function hash(x, y, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise(x, y, scale, s) {
    const gx = x / scale, gy = y / scale;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.47);
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function hex(c) { return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function shade(h, f) { return hex(rgb(h).map(v => v * f)); }
  function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); }
  function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  // Rysik pikselowy
  function pen(ctx) {
    return {
      ctx,
      rect(x, y, w, h, c) { if (w <= 0 || h <= 0) return; ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); },
      px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); },
      ellipse(cx, cy, rx, ry, c) {
        ctx.fillStyle = c;
        for (let dy = -ry; dy <= ry; dy++) {
          const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.35) * (ry + 0.35)))) + 0.25);
          ctx.fillRect(Math.round(cx - hw), Math.round(cy + dy), hw * 2 + 1, 1);
        }
      },
      alpha(a) { ctx.globalAlpha = a; }
    };
  }

  const C = {
    out: '#2b1d10', wall: '#e6d3a6', wallSh: '#c5ae7d', wood: '#7a4a22', woodL: '#a2693a', door: '#4a2e17',
    win: '#f4d679', stone: '#a7a59c', stoneL: '#c5c3b8', stoneD: '#7d7b72', dirt: '#a98f5d', dirtL: '#bca26d', dirtD: '#8e7547',
    pineO: '#183219', pineH: '#4b8a3a', pineM: '#336b2c', pineS: '#24522a',
    oakO: '#1d3a1b', oakM: '#3f7a2f', oakH: '#5a9a3e', oakHH: '#79b14f', trunk: '#5a3a1e',
    rockO: '#3c3a2e', rockL: '#b8b39a', rockM: '#99937a', rockS: '#7a7461', snow: '#f3f2ea', snowS: '#cfd3d8'
  };
  const GRASS = ['#517a33', '#5c8839', '#689541', '#76a24a', '#86b056'].map(rgb);
  const FOREST = ['#38592a', '#406530', '#497135', '#527c3a'].map(rgb);
  const ROCK = ['#6f6c56', '#7c7862', '#8a866f', '#97937c'].map(rgb);

  /* ---------- obiekty krajobrazu ---------- */
  function pine(p, x, by, h) {
    p.alpha(0.28); p.ellipse(x + 2, by, 4, 1, '#0d1a08'); p.alpha(1);
    p.rect(x - 1, by - 3, 2, 3, C.trunk);
    const top = by - h, body = h - 3;
    for (let r = 0; r < body; r++) {
      const y = top + r;
      let half = Math.round(0.4 + (r / body) * 4.6);
      if (r > 2 && r % 4 === 0) half -= 1;
      for (let dx = -half; dx <= half; dx++) {
        let c = dx === -half || dx === half ? C.pineO : dx < -half / 3 ? C.pineH : dx <= half / 3 ? C.pineM : C.pineS;
        if (r === 0) c = C.pineO;
        p.px(x + dx, y, c);
      }
    }
  }
  function oak(p, x, by, r) {
    p.alpha(0.28); p.ellipse(x + 2, by, r, 1, '#0d1a08'); p.alpha(1);
    p.rect(x - 1, by - 4, 2, 4, C.trunk);
    const cy = by - 3 - r;
    p.ellipse(x, cy, r, r, C.oakO);
    p.ellipse(x, cy, r - 1, r - 1, C.oakM);
    p.ellipse(x - 1, cy - 1, r - 2, r - 2, C.oakH);
    p.ellipse(x - 2, cy - 2, Math.max(1, r - 4), Math.max(1, r - 4), C.oakHH);
    p.px(x + r - 2, cy + 1, C.oakO); p.px(x + 1, cy + r - 2, C.oakO);
  }
  function mountain(p, cx, by, w, h, seed) {
    p.alpha(0.25); p.ellipse(cx + 3, by, Math.round(w / 2) + 1, 2, '#1a1a10'); p.alpha(1);
    const top = by - h;
    for (let r = 0; r <= h; r++) {
      const y = top + r;
      const half = Math.floor(r * (w / 2) / h);
      const snowLine = h * 0.33 + (hash(r, 3, seed) * 2 - 1) * 1.2;
      for (let dx = -half; dx <= half; dx++) {
        let c;
        if (dx === -half || dx === half || r === 0) c = C.rockO;
        else if (r < snowLine) c = dx < 1 ? C.snow : C.snowS;
        else if (dx < -half * 0.35) c = C.rockL;
        else if (dx < 1) c = (hash(dx + cx, y, seed) < 0.12 ? C.rockL : C.rockM);
        else c = dx > half * 0.6 ? C.rockS : (hash(dx + cx, y, seed + 1) < 0.15 ? C.rockS : '#8b8570');
        p.px(cx + dx, y, c);
      }
    }
  }

  /* ---------- budynki (wspólne dla mapy i widoku wioski) ---------- */
  function house(p, x, by, w, h, roof, opts) {
    opts = opts || {};
    const rl = shade(roof, 1.22), rd = shade(roof, 0.72);
    p.rect(x, by - h, w, h, opts.wall || C.wall);
    p.rect(x + w - 2, by - h, 1, h, opts.wallSh || C.wallSh);
    p.rect(x, by - h, 1, h, C.out); p.rect(x + w - 1, by - h, 1, h, C.out); p.rect(x, by - 1, w, 1, C.out);
    if (w >= 6) p.rect(x + Math.floor(w / 2) - 1, by - 3, 2, 2, C.door);
    if (w >= 6 && h >= 5) { p.px(x + 2, by - h + 2, C.win); if (w >= 9) p.px(x + w - 3, by - h + 2, C.win); }
    const c = x + (w - 1) / 2, rh = Math.min(Math.ceil((w + 1) / 2), opts.roofMax || 99);
    const topHalf = Math.max(0, Math.ceil((w + 1) / 2) - rh);
    for (let r = 0; r <= rh; r++) {
      const y = by - h - rh + r;
      const l = Math.round(c - topHalf - r - 0.5 * (r === rh ? 1 : 0)), rr = Math.round(c + topHalf + r + 0.5 * (r === rh ? 1 : 0));
      for (let xx = l; xx <= rr; xx++) {
        const col = xx === l || xx === rr || r === 0 || r === rh ? C.out : (xx < c ? rl : rd);
        p.px(xx, y, col);
      }
    }
    return { x: x - 1, y: by - h - rh, w: w + 2, h: h + rh };
  }
  function flag(p, x, top, color) {
    p.rect(x, top, 1, 12, C.out);                         // maszt
    p.rect(x + 1, top, 7, 5, C.out);                      // obrys proporca
    p.rect(x + 1, top + 1, 6, 3, color);
    p.rect(x + 1, top + 1, 6, 1, shade(color, 1.35));
    p.rect(x + 1, top + 3, 6, 1, shade(color, 0.7));
    p.px(x + 7, top + 2, 'rgba(0,0,0,0)');
  }
  function tower(p, x, by, w, h, roof, withFlag) {
    p.rect(x, by - h, w, h, C.stone);
    p.rect(x + 1, by - h, 1, h, C.stoneL);
    p.rect(x + w - 2, by - h, 1, h, C.stoneD);
    p.rect(x, by - h, 1, h, C.out); p.rect(x + w - 1, by - h, 1, h, C.out); p.rect(x, by - 1, w, 1, C.out);
    p.rect(x + Math.floor(w / 2), by - h + 3, 1, 2, C.out);
    for (let i = 0; i < w; i += 2) p.rect(x + i, by - h - 1, 1, 1, C.out);
    const c = x + (w - 1) / 2, rh = Math.ceil(w / 2) + 2;
    for (let r = 0; r <= rh; r++) {
      const half = Math.round((r / rh) * (w / 2 + 0.5));
      for (let dx = -half; dx <= half; dx++) {
        const xx = Math.round(c + dx);
        p.px(xx, by - h - 1 - rh + r, dx === -half || dx === half || r === rh ? C.out : dx < 0 ? shade(roof, 1.2) : shade(roof, 0.75));
      }
    }
    if (withFlag) flag(p, Math.round(c), by - h - rh - 12, roof);
    return { x, y: by - h - rh - (withFlag ? 12 : 1), w, h: h + rh + (withFlag ? 12 : 1) };
  }
  function fence(p, cx, cy, rx, ry, front, stone) {
    for (let a = 0; a < 360; a += 4) {
      const rad = a * Math.PI / 180;
      const x = Math.round(cx + Math.cos(rad) * rx), y = Math.round(cy + Math.sin(rad) * ry);
      const isFront = Math.sin(rad) > 0;
      if (isFront !== front) continue;
      if (front && Math.abs(Math.cos(rad)) < 0.18) continue; // brama
      if (stone) { p.rect(x - 1, y - 3, 3, 3, C.stone); p.px(x - 1, y - 3, C.stoneL); p.rect(x - 1, y, 3, 1, C.out); }
      else { p.rect(x, y - 4, 1, 4, C.wood); p.px(x, y - 4, C.woodL); }
    }
  }
  function field(p, x, y, w, h, ripe) {
    p.rect(x, y, w, h, '#6a5a32');
    for (let r = 0; r < h; r++) if (r % 2 === 0) p.rect(x + 1, y + r, w - 2, 1, ripe ? '#d8bc54' : '#7fa346');
  }

  function villageTier(points) { return points <= 9 ? 0 : points <= 20 ? 1 : points <= 38 ? 2 : 3; }

  function drawVillage(p, v, roof, neutral) {
    const cx = Math.round((v.x + 0.5) * AP), by = Math.round((v.y + 0.5) * AP) + 8;
    const tier = villageTier(MP.Engine.points(v));
    const showFlag = !neutral;
    p.alpha(0.28); p.ellipse(cx, by + 1, 15 + tier, 4, '#102008'); p.alpha(1);   // cień pod osadą
    if (tier === 0) {
      field(p, cx + 3, by - 7, 9, 6, true);
      house(p, cx - 9, by, 10, 6, roof);
      if (showFlag) flag(p, cx - 12, by - 21, roof);
    } else if (tier === 1) {
      field(p, cx - 14, by - 3, 6, 5, true);
      house(p, cx - 10, by - 2, 9, 6, roof);
      house(p, cx + 1, by + 1, 11, 7, roof);
      if (showFlag) flag(p, cx + 10, by - 22, roof);
    } else if (tier === 2) {
      fence(p, cx, by - 5, 13, 8, false, false);
      house(p, cx - 12, by - 2, 8, 6, roof);
      house(p, cx + 4, by - 3, 8, 6, roof);
      tower(p, cx - 4, by + 1, 8, 12, roof, showFlag);
      fence(p, cx, by - 5, 13, 8, true, false);
    } else {
      fence(p, cx, by - 5, 14, 9, false, true);
      house(p, cx - 13, by - 1, 8, 6, roof);
      house(p, cx + 5, by - 1, 8, 6, roof);
      tower(p, cx - 6, by + 2, 12, 15, roof, showFlag);
      fence(p, cx, by - 5, 14, 9, true, true);
    }
  }

  /* ---------- MAPA: teren (rysowany raz na grę) ---------- */
  function terrain(state) {
    const N = state.map.size, W = N * AP, tiles = state.map.tiles;
    const seed = (state.created % 2147483647) | 0;
    const R = rng(seed);
    const cv = canvas(W, W), ctx = cv.getContext('2d'), p = pen(ctx);
    const img = ctx.createImageData(W, W), d = img.data;
    const kindMap = new Uint8Array(W * W);   // 0 trawa, 1 las, 2 góry
    const busy = new Uint8Array(W * W);      // drogi i place wiosek

    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const tx = Math.floor(x / AP), ty = Math.floor(y / AP);
        let kind = 0, best = 9;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const t = tiles[ny * N + nx];
            if (t.terrain === 'plain') continue;
            const dist = Math.hypot(x - (nx + 0.5) * AP, y - (ny + 0.5) * AP) / AP;
            const r = (t.terrain === 'forest' ? 0.66 : 0.5) + (noise(x, y, 6, seed + 3) - 0.5) * 0.4;
            if (dist < r && dist < best) { best = dist; kind = t.terrain === 'forest' ? 1 : 2; }
          }
        }
        kindMap[y * W + x] = kind;
        const pal = kind === 1 ? FOREST : kind === 2 ? ROCK : GRASS;
        const n = noise(x, y, 18, seed) * 0.62 + noise(x, y, 6, seed + 11) * 0.38;
        let lv = Math.floor(n * pal.length + BAYER[(y & 3) * 4 + (x & 3)]);
        lv = Math.max(0, Math.min(pal.length - 1, lv));
        const c = pal[lv], i = (y * W + x) * 4;
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Drogi między sąsiednimi osadami
    const vs = Object.values(state.villages);
    const pairs = new Set();
    vs.forEach(a => {
      vs.filter(b => b !== a).map(b => ({ b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .sort((m, n) => m.d - n.d).slice(0, 2)
        .forEach(o => { if (o.d <= 4.6) pairs.add(a.id < o.b.id ? a.id + '|' + o.b.id : o.b.id + '|' + a.id); });
    });
    pairs.forEach(key => {
      const [ia, ib] = key.split('|'), a = state.villages[ia], b = state.villages[ib];
      const ax = (a.x + 0.5) * AP, ay = (a.y + 0.5) * AP + 5, bx = (b.x + 0.5) * AP, byy = (b.y + 0.5) * AP + 5;
      const len = Math.hypot(bx - ax, byy - ay), steps = Math.ceil(len * 1.5);
      const nx = -(byy - ay) / len, ny = (bx - ax) / len, phase = hash(a.x + b.x, a.y + b.y, seed) * 6;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, wob = Math.sin(t * Math.PI * 2 + phase) * 3 * Math.sin(t * Math.PI);
        const x = Math.round(ax + (bx - ax) * t + nx * wob), y = Math.round(ay + (byy - ay) * t + ny * wob);
        p.rect(x - 1, y - 1, 3, 3, C.dirtD);
        p.rect(x - 1, y, 2, 1, C.dirt);
        if (hash(x, y, seed + 5) < 0.2) p.px(x, y - 1, C.dirtL);
        for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < W) busy[yy * W + xx] = 1;
      }
    });
    // Place pod osadami
    vs.forEach(v => {
      const cx = (v.x + 0.5) * AP, cy = (v.y + 0.5) * AP + 3;
      p.ellipse(cx, cy, 13, 9, C.dirtD);
      p.ellipse(cx, cy, 11, 8, C.dirt);
      for (let i = 0; i < 18; i++) p.px(cx + (hash(i, v.x, seed) * 22 - 11), cy + (hash(v.y, i, seed) * 14 - 7), hash(i, i, v.x) < 0.5 ? C.dirtL : C.dirtD);
      for (let yy = cy - 12; yy <= cy + 12; yy++) for (let xx = cx - 15; xx <= cx + 15; xx++) if (xx >= 0 && yy >= 0 && xx < W && yy < W) busy[yy * W + xx] = 1;
    });

    // Drobiazgi: kępki trawy, kwiaty, kamienie
    const flowers = ['#f2d45c', '#f4f1e4', '#e58fb0', '#9fc6ea'];
    for (let i = 0; i < W * W / 70; i++) {
      const x = Math.floor(R() * W), y = Math.floor(R() * W);
      if (busy[y * W + x] || kindMap[y * W + x] !== 0) continue;
      const r = R();
      if (r < 0.6) { p.px(x, y, '#93be62'); p.px(x + 1, y - 1, '#93be62'); p.px(x, y + 1, '#4b7230'); }
      else if (r < 0.85) { p.px(x, y, flowers[Math.floor(R() * flowers.length)]); p.px(x, y + 1, '#3f6129'); }
      else { p.rect(x, y, 2, 1, '#b9b6a6'); p.rect(x, y + 1, 2, 1, '#6d6b5d'); }
    }

    // Drzewa i góry, sortowane wg wysokości (bliższe zasłaniają dalsze)
    const objs = [];
    for (const t of tiles) {
      const ox = t.x * AP, oy = t.y * AP;
      if (t.terrain === 'forest') {
        const n = 5 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) {
          const x = Math.round(ox + 3 + R() * (AP - 6)), by = Math.round(oy + 9 + R() * (AP - 4));
          objs.push(R() < 0.62 ? { y: by, f: () => pine(p, x, by, 11 + Math.floor(R() * 6)) } : { y: by, f: () => oak(p, x, by, 4 + Math.floor(R() * 2)) });
        }
      } else if (t.terrain === 'mountain') {
        const by = oy + AP - 4 + Math.round(R() * 3);
        const x = ox + AP / 2 + Math.round(R() * 6 - 3);
        objs.push({ y: by, f: () => mountain(p, x, by, 22 + Math.round(R() * 6), 17 + Math.round(R() * 5), seed + t.x) });
        if (R() < 0.55) {
          const x2 = x + (R() < 0.5 ? -9 : 9), by2 = by - 4;
          objs.push({ y: by2, f: () => mountain(p, x2, by2, 14 + Math.round(R() * 4), 11 + Math.round(R() * 3), seed + t.y) });
        }
      } else if (t.terrain === 'plain' && hash(t.x, t.y, seed + 77) < 0.16) {
        // pozycje z funkcji haszującej, więc nowa osada nie zmienia reszty krajobrazu
        const x = Math.round(ox + 5 + hash(t.x, t.y, seed + 78) * (AP - 10)), by = Math.round(oy + 8 + hash(t.x, t.y, seed + 79) * (AP - 12));
        const near = t.village || Object.values(state.villages).some(v => Math.abs((v.x + 0.5) * AP - x) < 15 && Math.abs((v.y + 0.5) * AP + 3 - by) < 13);
        if (!near && !busy[by * W + x]) objs.push(hash(t.x, t.y, seed + 80) < 0.5 ? { y: by, f: () => oak(p, x, by, 4) } : { y: by, f: () => pine(p, x, by, 10) });
      }
    }
    objs.sort((a, b) => a.y - b.y).forEach(o => o.f());
    return cv;
  }

  /* ---------- MAPA: terytoria frakcji ---------- */
  function territory(state, cv) {
    const N = state.map.size, W = N * AP;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(W, W), d = img.data;
    const owners = Object.values(state.villages).filter(v => v.owner !== null);
    const colors = {};
    const ownerIdx = new Int16Array(W * W).fill(-1);
    const keys = Object.keys(state.factions);
    keys.forEach((k, i) => { colors[i] = rgb(state.factions[k].color); });
    const R2 = (2.35 * AP) * (2.35 * AP);
    const cs = owners.map(v => ({ x: (v.x + 0.5) * AP, y: (v.y + 0.5) * AP, o: keys.indexOf(v.owner) }));
    for (let y = 0; y < W; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let best = R2, o = -1;
        for (const c of cs) {
          const dx = x - c.x, dy = y - c.y, dd = dx * dx + dy * dy;
          if (dd < best) { best = dd; o = c.o; }
        }
        ownerIdx[y * W + x] = o;
      }
    }
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const o = ownerIdx[y * W + x];
        if (o < 0) continue;
        const i = (y * W + x) * 4, c = colors[o];
        const edge = (x > 0 && ownerIdx[y * W + x - 1] !== o) || (x < W - 1 && ownerIdx[y * W + x + 1] !== o) ||
          (y > 0 && ownerIdx[(y - 1) * W + x] !== o) || (y < W - 1 && ownerIdx[(y + 1) * W + x] !== o);
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        d[i + 3] = edge ? ((x + y) % 4 < 2 ? 235 : 0) : 46;
      }
    }
    ctx.clearRect(0, 0, W, W);
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- MAPA: osady ---------- */
  function villages(state, cv) {
    const ctx = cv.getContext('2d'), p = pen(ctx);
    ctx.clearRect(0, 0, cv.width, cv.height);
    Object.values(state.villages).sort((a, b) => a.y - b.y || a.x - b.x).forEach(v => {
      const neutral = v.owner === null;
      const roof = neutral ? '#8a6b4d' : state.factions[v.owner].color;
      drawVillage(p, v, roof, neutral);
    });
  }

  /* ---------- MINIMAPA ---------- */
  function minimap(state, terrainCv, territoryCv, size) {
    const cv = canvas(size, size), ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainCv, 0, 0, size, size);
    ctx.globalAlpha = 1.6 > 1 ? 1 : 1;
    ctx.drawImage(territoryCv, 0, 0, size, size);
    const N = state.map.size, cell = size / N;
    Object.values(state.villages).forEach(v => {
      ctx.fillStyle = '#1b120a';
      ctx.fillRect(v.x * cell + cell / 2 - 3, v.y * cell + cell / 2 - 3, 6, 6);
      ctx.fillStyle = v.owner === null ? '#c9bfa6' : state.factions[v.owner].color;
      ctx.fillRect(v.x * cell + cell / 2 - 2, v.y * cell + cell / 2 - 2, 4, 4);
    });
    return cv;
  }

  MP.Art = { AP, terrain, territory, villages, minimap, shade, mix, canvas, villageTier };
})(typeof window !== 'undefined' ? window : globalThis);
