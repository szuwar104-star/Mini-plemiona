/* =========================================================================
   Mini Plemiona – MAPA ŚWIATA
   Warstwy: teren (canvas) → terytoria (canvas) → osady (canvas)
   → pola interaktywne (DOM, każde z danymi); trasy wojsk to osobna warstwa <canvas>
   nad widokiem (patrz „trasy wojsk”), rysowana tylko dla tego, co widać na ekranie.
   Obsługa: przeciąganie, kółko myszy, szczypanie, przyciski, minimapa.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const E = MP.Engine;
  const A = MP.Art;
  const TILE = 56, HEAD = 24;
  const MIN_S = 0.45, MAX_S = 2.6, MINI = 150;

  const view = { s: 1, x: 0, y: 0, fitted: false };
  let bottomInset = 0; // miejsce zasłonięte przez panel szczegółów na telefonie
  let viewport = null, world = null, onSelect = null, onActivate = null, mini = null;
  let lastTap = null;
  let builtFor = null, layers = null, miniBase = null;
  const pointers = new Map();
  let gesture = null;

  let N_ = C.MAP.size;                      // bok mapy bieżącej gry (zależy od wybranego świata)
  function size() { return N_ * TILE; }
  function worldSize() { return HEAD + size(); }

  /* ---------- widok ---------- */
  function apply() {
    if (!world) return;
    world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
    world.classList.toggle('far', view.s < 0.85);
    fx.viewDirty = true; fx.lastView = root.performance.now(); fxKick();
    scheduleMini();
  }
  // Minimapa max. raz na klatkę – przy przeciąganiu i szczypaniu apply() leci po kilka razy na klatkę.
  let miniRaf = 0;
  function scheduleMini() {
    if (!root.requestAnimationFrame) { drawMini(); return; }
    if (miniRaf) return;
    miniRaf = root.requestAnimationFrame(() => { miniRaf = 0; drawMini(); });
  }
  function clamp() {
    const W = worldSize() * view.s;
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const m = 80;
    view.x = W < vw ? (vw - W) / 2 : Math.min(m, Math.max(vw - W - m, view.x));
    view.y = W < vh - bottomInset ? Math.min(m, Math.max((vh - bottomInset - W) / 2, view.y)) : Math.min(m, Math.max(vh - W - m - bottomInset, view.y));
  }
  function zoomAt(px, py, ns) {
    ns = Math.max(MIN_S, Math.min(MAX_S, ns));
    view.x = px - (px - view.x) * (ns / view.s);
    view.y = py - (py - view.y) * (ns / view.s);
    view.s = ns;
    clamp(); apply();
  }
  function zoomBy(f) { zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, view.s * f); }
  function centerOn(x, y) {
    const cx = HEAD + (x + 0.5) * TILE, cy = HEAD + (y + 0.5) * TILE;
    view.x = viewport.clientWidth / 2 - cx * view.s;
    view.y = viewport.clientHeight / 2 - cy * view.s;
    clamp(); apply();
  }
  function fit(x, y) {
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    if (!vw || !vh) return;
    view.s = Math.max(0.7, Math.min(1.25, Math.min(vw, vh) / worldSize()));
    view.fitted = true;
    centerOn(x, y);
  }

  /* ---------- budowa planszy (raz na grę) ---------- */
  function ensureBoard(state) {
    const key = state.created + ':' + state.map.size;
    const nv = Object.keys(state.villages).length;
    if (builtFor === key) {
      // Nowa osada (np. założona przez AI) zmienia tylko drogi i place w terenie – przerysowujemy sam teren,
      // bez przebudowy całej planszy (linijki, 2000+ pól, trasy wojsk).
      if (layers.nv !== nv) {
        layers.nv = nv;
        const cv = A.terrain(state);
        cv.className = 'layer'; cv.style.width = size() + 'px'; cv.style.height = size() + 'px';
        world.querySelector('.terrain').replaceChildren(cv);
        layers.terrain = cv;
        layers.terrainDirty = true;
      }
      return false;
    }
    builtFor = key;
    N_ = state.map.size;
    const N = N_, S = size();
    let html = '<div class="ruler top" style="left:' + HEAD + 'px;width:' + S + 'px">';
    for (let x = 0; x < N; x++) html += '<span>' + x + '</span>';
    html += '</div><div class="ruler left" style="top:' + HEAD + 'px;height:' + S + 'px">';
    for (let y = 0; y < N; y++) html += '<span>' + y + '</span>';
    html += '</div><div class="ruler corner"></div>' +
      '<div class="board" style="left:' + HEAD + 'px;top:' + HEAD + 'px;width:' + S + 'px;height:' + S + 'px">' +
      '<div class="layer-slot terrain"></div><div class="layer-slot territory"></div><div class="layer-slot villages"></div>' +
      '<div class="tiles" style="grid-template-columns:repeat(' + N + ',' + TILE + 'px);grid-template-rows:repeat(' + N + ',' + TILE + 'px)"></div></div>';
    world.innerHTML = html;
    world.style.width = worldSize() + 'px';
    world.style.height = worldSize() + 'px';
    const terrainCv = A.terrain(state);
    const W = N * A.AP;
    const territoryCv = A.canvas(W, W), villagesCv = A.canvas(W, W);
    [terrainCv, territoryCv, villagesCv].forEach(c => { c.className = 'layer'; c.style.width = S + 'px'; c.style.height = S + 'px'; });
    world.querySelector('.terrain').appendChild(terrainCv);
    world.querySelector('.territory').appendChild(territoryCv);
    world.querySelector('.villages').appendChild(villagesCv);
    layers = { terrain: terrainCv, territory: territoryCv, villages: villagesCv,
      tiles: world.querySelector('.tiles'), nv };
    return true;
  }

  /* ---------- warstwy zależne od stanu ---------- */
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function pilotRole(state, v) {
    if (v.owner !== 'player') return null;
    const p = state.pilot;
    return (p && p.on && p.roles && p.roles[v.id]) || null;
  }
  function tileHtml(state, t, ctx) {
    const v = t.village ? state.villages[t.village] : null;
    let cls = 'tile', inner = '', title;
    if (v) {
      const kind = v.owner === 'player' ? 'own' : v.owner === null ? 'neutral' : 'enemy';
      cls += ' has-village ' + kind;
      if (v.id === ctx.current) cls += ' current';
      if (ctx.incoming.has(v.id)) cls += ' under-attack';
      if (ctx.outgoing.has(v.id)) cls += ' targeted';
      const color = E.ownerColor(state, v.owner);
      const role = pilotRole(state, v);   // rola nadana przez Autopilota (podział wiosek): 'off' | 'def' | null
      if (role) cls += ' role-' + role;
      inner = '<span class="vlabel" style="--fc:' + color + '"><i>' + E.points(v) + '</i>' +
        (role ? '<b class="vrole ' + role + '" aria-hidden="true">' + (role === 'off' ? '⚔' : '🛡') + '</b>' : '') + escapeHtml(v.name) + '</span>';
      title = v.name + ' (' + t.x + ':' + t.y + ') – ' + E.ownerName(state, v.owner) + ', ' + E.points(v) + ' pkt' +
        (role ? ', wioska ' + (role === 'off' ? 'ofensywna' : 'defensywna') + ' (Autopilot)' : '');
    } else {
      title = (t.terrain === 'forest' ? 'Las' : t.terrain === 'mountain' ? 'Góry' : 'Równina') + ' (' + t.x + ':' + t.y + ')';
    }
    if (ctx.sel && ctx.sel.x === t.x && ctx.sel.y === t.y) cls += ' selected';
    return '<div class="' + cls + '" data-x="' + t.x + '" data-y="' + t.y + '" title="' + escapeHtml(title) + '"' +
      (v ? ' tabindex="0" role="button"' : '') + '>' + inner + '</div>';
  }

  // Pełna przebudowa mapy tylko gdy naprawdę zmieniła się plansza. Zmiana właściciela / punktów wioski
  // przerysowuje tylko potrzebne warstwy, a stan pól (aktywna, atakowana, cel) to przełączenie klas.
  function render(state, ctx) {
    const rebuilt = ensureBoard(state);
    const vs = Object.values(state.villages);
    const ownerKey = vs.map(v => v.id + ':' + v.owner).join('|');
    const tierKey = vs.map(v => v.id + ':' + v.owner + ':' + A.villageTier(E.points(v))).join('|');
    let miniDirty = !!layers.terrainDirty;
    layers.terrainDirty = false;
    // Zmienione osady (inny właściciel / poziom wyglądu) przerysowują tylko swoje okolice – patrz Art.territory / Art.villages.
    if (rebuilt || layers.ownerKey !== ownerKey) {
      layers.ownerKey = ownerKey;
      const d = trackChanges(vs, rebuilt ? null : layers.ownerMap, v => v.owner);
      layers.ownerMap = d.map;
      A.territory(state, layers.territory, d.changed);
      miniDirty = true;
    }
    if (rebuilt || layers.tierKey !== tierKey) {
      layers.tierKey = tierKey;
      const d = trackChanges(vs, rebuilt ? null : layers.tierMap, v => v.owner + ':' + A.villageTier(E.points(v)));
      layers.tierMap = d.map;
      A.villages(state, layers.villages, d.changed);
      miniDirty = true;
    }
    if (rebuilt) {
      layers.tiles.innerHTML = state.map.tiles.map(t => tileHtml(state, t, ctx)).join('');
      layers.vt = new Map();
      vs.forEach(v => {
        const el = layers.tiles.querySelector('.tile[data-x="' + v.x + '"][data-y="' + v.y + '"]');
        if (el) layers.vt.set(v.id, { el, sig: villageSig(state, v) });
      });
    } else {
      syncVillageTiles(state, ctx);
    }
    if (miniDirty || !miniBase) miniBase = A.minimap(state, layers.terrain, layers.territory, MINI * 2);
    drawMini();
  }
  // Porównuje osady z poprzednim stanem (id -> wartość); changed = null oznacza „brak podstaw, rysuj wszystko”.
  function trackChanges(vs, prev, f) {
    const map = new Map(), changed = prev ? [] : null;
    vs.forEach(v => { const k = f(v); map.set(v.id, k); if (changed && prev.get(v.id) !== k) changed.push(v); });
    return { map, changed: changed && prev.size <= map.size ? changed : null };
  }
  function villageSig(state, v) { return v.owner + '|' + E.points(v) + '|' + v.name + '|' + (pilotRole(state, v) || ''); }
  function syncVillageTiles(state, ctx) {
    Object.values(state.villages).forEach(v => {
      let r = layers.vt.get(v.id);
      if (!r) {   // nowa osada na planszy: pole było puste, podmieniamy je na pole osady
        const old = layers.tiles.querySelector('.tile[data-x="' + v.x + '"][data-y="' + v.y + '"]');
        if (!old) return;
        r = { el: old, sig: null };
        layers.vt.set(v.id, r);
      }
      const sig = villageSig(state, v);
      if (sig !== r.sig) {   // zmienił się właściciel / punkty / nazwa – podmieniamy tylko to jedno pole
        const t = state.map.tiles.find(q => q.x === v.x && q.y === v.y);
        const tmp = document.createElement('div');
        tmp.innerHTML = tileHtml(state, t, ctx);
        const el = tmp.firstChild;
        r.el.replaceWith(el);
        r.el = el; r.sig = sig;
        return;
      }
      const c = r.el.classList;
      c.toggle('current', v.id === ctx.current);
      c.toggle('under-attack', ctx.incoming.has(v.id));
      c.toggle('targeted', ctx.outgoing.has(v.id));
    });
  }

  function setSelected(sel) {
    if (!layers) return;
    layers.tiles.querySelectorAll('.tile.selected').forEach(el => el.classList.remove('selected'));
    if (sel) {
      const el = layers.tiles.querySelector('.tile[data-x="' + sel.x + '"][data-y="' + sel.y + '"]');
      if (el) el.classList.add('selected');
    }
  }

  /* ---------- trasy wojsk: jedna warstwa <canvas> ---------- */
  // Setki marszów jako elementy SVG/DOM zamulały mapę (każdy znacznik = węzeł DOM, każda linia = animacja CSS,
  // a wszystko siedziało w warstwie skalowanej razem ze światem). Teraz:
  //  • dane marszów to zwykłe tablice (zero DOM), budowane raz na tick gry,
  //  • rysuje je jedno płótno wielkości widoku (nie świata), ostre przy każdym zbliżeniu i ekranie Retina,
  //  • linie i znaczniki są rysowane zbiorczo: jedna ścieżka na rodzaj marszu, a elementy poza ekranem pomijane,
  //  • pozycje znaczników liczone z zegara gry w każdej klatce – marsz płynie, a nie skacze co sekundę,
  //  • pętla rysująca śpi, gdy mapa jest ukryta, i rysuje rzadziej, gdy nic się nie przesuwa (tylko animacja kresek).
  // Wygląd odpowiada motywowi „medieval” (grubsze trasy, znacznik jak żeton) i jest taki sam przy 3 i przy 3000 marszów.
  const KINDS = ['sup', 'settle', 'trade', 'spy', 'ret', 'out', 'inc'];   // kolejność rysowania: wrogie ataki na wierzchu
  const KIND_STYLE = {
    out:    { line: '#8fb6ff', fill: '--blue',   fb: '#4f78b8', w: 4 },
    ret:    { line: '#9fe0ae', fill: '--green',  fb: '#6f9a4a', w: 4 },
    inc:    { line: '#ff9a92', fill: '--red',    fb: '#c2463c', w: 5 },
    spy:    { line: '#d6c0ff', fill: '--violet', fb: '#a77bf3', w: 4 },
    trade:  { line: '#ffe08a', fill: null,       fb: '#b88a26', w: 4 },
    settle: { line: '#ffffff', fill: null,       fb: '#8a6b4d', w: 4 },
    sup:    { line: '#8fe6d6', fill: '--teal',   fb: '#2fb5a2', w: 4 }
  };
  const MARK_R = 10, DEST_R = 22, DASH = [10, 8], MARCH = 18;   // MARCH = długość okresu kreskowania (px świata na sekundę)
  const ANIM_MAX = 30;                                           // do tylu widocznych tras kreski „maszerują”; przy większym tłoku są nieruchome (i z pamięci podręcznej)
  const IDLE_MS = 50;                                            // tyle (≈20 kl./s) wystarcza dla kresek i powolnego ruchu znaczników
  const fx = { cv: null, ctx: null, dpr: 1, cw: 0, ch: 0, state: null, segs: [], marks: [], byKind: null, raf: 0, last: 0, viewDirty: true, colors: null,
    ver: 0, sig: '', lastView: 0, animLines: true, cache: null };
  const visSegs = KINDS.map(() => []);

  function fxColors() {
    const cs = root.getComputedStyle ? root.getComputedStyle(root.document.documentElement) : null;
    const out = {};
    KINDS.forEach(k => {
      const st = KIND_STYLE[k], v = cs && st.fill ? cs.getPropertyValue(st.fill).trim() : '';
      out[k] = v || st.fb;
    });
    return out;
  }
  function fxMount(vp, wd) {
    fx.cv = root.document.createElement('canvas');
    fx.cv.className = 'moves-cv';
    fx.cv.setAttribute('aria-hidden', 'true');
    vp.insertBefore(fx.cv, wd.nextSibling);
    fx.ctx = fx.cv.getContext('2d');
    fx.colors = fxColors();
  }
  function fxKick() {
    if (!fx.raf && fx.cv && root.requestAnimationFrame) fx.raf = root.requestAnimationFrame(fxFrame);
  }
  function fxFrame(t) {
    fx.raf = 0;
    if (!viewport || !viewport.clientWidth) return;      // mapa ukryta (inny ekran) – pętla śpi do następnego renderu
    const animating = fx.marks.length > 0;
    if (fx.viewDirty || (animating && t - fx.last >= (fx.animLines ? IDLE_MS : IDLE_MS * 2))) {
      fx.viewDirty = false; fx.last = t;
      fxDraw(t);
    }
    if (animating || fx.viewDirty) fxKick();
  }
  function fxClock() {
    const s = fx.state;
    return s ? E.gameClock(s, Date.now()) : 0;
  }

  // Dane marszów: unikalne odcinki (marsze na tym samym odcinku dzielą linię) + lista znaczników.
  function renderMoves(state, list) {
    if (!layers || !fx.cv) return;
    const segMap = new Map(), segs = [], marks = [];
    const c = v => ({ x: (v.x + 0.5) * TILE, y: (v.y + 0.5) * TILE });
    list.forEach(m => {
      const from = state.villages[m.from], to = m.to ? state.villages[m.to] : { x: m.x, y: m.y };
      if (!from || !to) return;
      let a = c(from), b = c(to), kind;
      if (m.type === 'return' || m.type === 'trade-return') { kind = m.type === 'return' ? 'ret' : 'trade'; const t = a; a = b; b = t; }
      else if (m.owner !== 'player') kind = 'inc';
      else kind = { attack: 'out', spy: 'spy', transport: 'trade', settle: 'settle', support: 'sup' }[m.type] || 'out';
      const key = kind + '|' + a.x + ',' + a.y + '|' + b.x + ',' + b.y;
      let seg = segMap.get(key);
      if (!seg) {
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        seg = { key, k: KINDS.indexOf(kind), ax: a.x, ay: a.y, bx: b.x, by: b.y, dx, dy, cos: dx / len, sin: dy / len,
          x0: Math.min(a.x, b.x) - DEST_R, x1: Math.max(a.x, b.x) + DEST_R, y0: Math.min(a.y, b.y) - DEST_R, y1: Math.max(a.y, b.y) + DEST_R };
        segMap.set(key, seg); segs.push(seg);
      }
      marks.push({ seg, start: m.start, span: Math.max(1, m.arrive - m.start) });
    });
    fx.state = state; fx.segs = segs; fx.marks = marks;
    fx.byKind = KINDS.map((_, k) => marks.filter(mk => mk.seg.k === k));
    // wersja zestawu odcinków rośnie tylko, gdy naprawdę coś doszło lub zniknęło (przy tym samym zestawie bitmapa linii zostaje)
    let sig = ''; for (let i = 0; i < segs.length; i++) sig += segs[i].key + ';';
    if (sig !== fx.sig) { fx.sig = sig; fx.ver++; }
    fx.viewDirty = true; fxKick();
  }

  // Linie (cienie, kreski, okręgi celu) jednego przebiegu rysowania.
  function drawLines(ctx, groups, off) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 9;
    ctx.beginPath();
    for (let q = 0; q < KINDS.length; q++) { const a = groups[q]; for (let i = 0; i < a.length; i++) { ctx.moveTo(a[i].ax, a[i].ay); ctx.lineTo(a[i].bx, a[i].by); } }
    ctx.stroke();
    for (let q = 0; q < KINDS.length; q++) {
      const a = groups[q]; if (!a.length) continue;
      ctx.strokeStyle = KIND_STYLE[KINDS[q]].line;
      ctx.setLineDash(DASH); ctx.lineDashOffset = off; ctx.lineWidth = KIND_STYLE[KINDS[q]].w;
      ctx.beginPath();
      for (let i = 0; i < a.length; i++) { ctx.moveTo(a[i].ax, a[i].ay); ctx.lineTo(a[i].bx, a[i].by); }
      ctx.stroke();
      ctx.setLineDash([5, 5]); ctx.lineDashOffset = 0; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < a.length; i++) { ctx.moveTo(a[i].bx + DEST_R, a[i].by); ctx.arc(a[i].bx, a[i].by, DEST_R, 0, 6.2832); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
  // Odcinki przecinające prostokąt (współrzędne planszy), pogrupowane wg rodzaju. Zwraca ich liczbę.
  function cullSegs(x0, y0, x1, y1, out) {
    out.forEach(a => { a.length = 0; });
    let n = 0;
    for (let i = 0; i < fx.segs.length; i++) {
      const g = fx.segs[i];
      if (g.x1 >= x0 && g.x0 <= x1 && g.y1 >= y0 && g.y0 <= y1) { out[g.k].push(g); n++; }
    }
    return n;
  }
  const cacheSegs = KINDS.map(() => []);
  // Tłok: linie rysowane raz do bitmapy większej od widoku (zapas M px z każdej strony). Przesuwanie mapy to wtedy
  // samo przesunięcie bitmapy (bez ponownego rysowania kresek – to było najdroższe), a zmiana zbliżenia na chwilę skaluje
  // starą bitmapę i dopiero po uspokojeniu rysuje ją od nowa w ostrości.
  function fxCacheDraw(ctx, dpr, cw, ch, s, calm) {
    let c = fx.cache;
    let M = Math.round(Math.max(cw, ch) * 0.25);
    while ((cw + 2 * M) * (ch + 2 * M) * dpr * dpr > 16e6 && M > 60) M -= 20;   // bitmapa ≤ ~16 Mpx (≈64 MB), także na dużych monitorach
    const fresh = c && c.ver === fx.ver && c.dpr === dpr && c.cw === cw && c.ch === ch && c.M === M;
    const sameScale = c && c.s === s;
    const dx = c ? view.x - c.x : 0, dy = c ? view.y - c.y : 0;
    const inside = sameScale && Math.abs(dx) <= M && Math.abs(dy) <= M;
    if (!(fresh && ((sameScale && inside) || !calm))) {
      if (!c) c = fx.cache = { cv: root.document.createElement('canvas') };
      const W = Math.round((cw + 2 * M) * dpr), H = Math.round((ch + 2 * M) * dpr);
      if (c.cv.width !== W || c.cv.height !== H) { c.cv.width = W; c.cv.height = H; }
      const g = c.cv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
      g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (view.x + HEAD * s + M), dpr * (view.y + HEAD * s + M));
      cullSegs(-(view.x + M) / s - HEAD - 6, -(view.y + M) / s - HEAD - 6, (cw + M - view.x) / s - HEAD + 6, (ch + M - view.y) / s - HEAD + 6, cacheSegs);
      drawLines(g, cacheSegs, 0);
      Object.assign(c, { ver: fx.ver, dpr, cw, ch, M, s, x: view.x, y: view.y });
    }
    // przeniesienie bitmapy na ekran: przy tym samym zbliżeniu czyste przesunięcie, inaczej skalowanie tymczasowe
    const r = s / c.s;
    const ex = view.x + HEAD * s - r * (c.x + HEAD * c.s), ey = view.y + HEAD * s - r * (c.y + HEAD * c.s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (r === 1) ctx.drawImage(c.cv, Math.round((ex - M) * dpr), Math.round((ey - M) * dpr));
    else ctx.drawImage(c.cv, (ex - M * r) * dpr, (ey - M * r) * dpr, c.cv.width * r, c.cv.height * r);
    return r === 1;   // false = obraz tymczasowo rozmyty, trzeba wrócić po uspokojeniu widoku
  }

  function fxDraw(t) {
    const cv = fx.cv, ctx = fx.ctx;
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const cw = viewport.clientWidth, ch = viewport.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    }
    fx.dpr = dpr; fx.cw = cw; fx.ch = ch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!fx.marks.length) return;

    const s = view.s, k = dpr * s;
    const m = 6;   // zapas przy przycinaniu do widoku
    const vx0 = -view.x / s - HEAD - m, vy0 = -view.y / s - HEAD - m;
    const vx1 = (cw - view.x) / s - HEAD + m, vy1 = (ch - view.y) / s - HEAD + m;
    const n = cullSegs(vx0, vy0, vx1, vy1, visSegs);
    fx.animLines = n <= ANIM_MAX;
    const now = root.performance.now();
    if (fx.animLines) {
      // mało tras: pełne rysowanie co klatkę, kreski maszerują
      ctx.setTransform(k, 0, 0, k, dpr * (view.x + HEAD * s), dpr * (view.y + HEAD * s));
      drawLines(ctx, visSegs, -((t / 1000) * MARCH) % MARCH);
    } else {
      // dużo tras: linie z bitmapy; po zmianie zbliżenia wróć do ostrego obrazu, gdy widok się uspokoi
      const sharp = fxCacheDraw(ctx, dpr, cw, ch, s, now - fx.lastView > 140);
      if (!sharp) fx.viewDirty = true;
    }

    // znaczniki: pozycja z zegara gry (płynnie między tickami), tylko te w widoku
    ctx.setTransform(k, 0, 0, k, dpr * (view.x + HEAD * s), dpr * (view.y + HEAD * s));
    const gt = fxClock(), rr = MARK_R + 2;
    const ox = [];
    for (let q = 0; q < KINDS.length; q++) {
      const list = fx.byKind[q]; if (!list.length) continue;
      ox.length = 0;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const mk = list[i], g = mk.seg;
        let p = (gt - mk.start) / mk.span; p = p < 0 ? 0 : p > 1 ? 1 : p;
        const x = g.ax + g.dx * p, y = g.ay + g.dy * p;
        if (x < vx0 - rr || x > vx1 + rr || y < vy0 - rr || y > vy1 + rr) continue;
        ctx.moveTo(x + MARK_R, y); ctx.arc(x, y, MARK_R, 0, 6.2832);
        ox.push(x, y, g.cos, g.sin);
      }
      if (!ox.length) continue;
      ctx.fillStyle = fx.colors[KINDS[q]]; ctx.strokeStyle = '#2b1d10'; ctx.lineWidth = 3;
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < ox.length; i += 4) {   // strzałka: trójkąt (-4,-4) (5,0) (-4,4) obrócony o kąt odcinka
        const x = ox[i], y = ox[i + 1], c = ox[i + 2], sn = ox[i + 3];
        ctx.moveTo(x - 4 * c + 4 * sn, y - 4 * sn - 4 * c);
        ctx.lineTo(x + 5 * c, y + 5 * sn);
        ctx.lineTo(x - 4 * c - 4 * sn, y - 4 * sn + 4 * c);
        ctx.closePath();
      }
      ctx.fillStyle = '#fff'; ctx.fill();
    }
  }

  /* ---------- minimapa ---------- */
  function drawMini() {
    if (!mini || !miniBase || !viewport || !viewport.clientWidth) return;
    const ctx = mini.getContext('2d');
    const S = mini.width;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(miniBase, 0, 0, S, S);
    const k = S / size();
    const x = (-view.x / view.s - HEAD) * k, y = (-view.y / view.s - HEAD) * k;
    const w = viewport.clientWidth / view.s * k, h = viewport.clientHeight / view.s * k;
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,12,6,.75)'; ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#f6e3a8'; ctx.strokeRect(x, y, w, h);
  }
  function miniJump(e) {
    const r = mini.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const N = N_;
    centerOn(fx * N - 0.5, fy * N - 0.5);
  }

  /* ---------- gesty ---------- */
  function local(e) {
    const r = viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onDown(e) {
    if (e.target.closest('.map-ui')) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      gesture = { type: 'pan', start: local(e), vx: view.x, vy: view.y, moved: 0, cx: e.clientX, cy: e.clientY };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s, moved: 99 };
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    if (gesture.type === 'pan' && pointers.size === 1) {
      const p = local(e);
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      if (gesture.moved > 5) {
        viewport.classList.add('dragging');
        view.x = gesture.vx + dx; view.y = gesture.vy + dy;
        clamp(); apply();
      }
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.s * d / gesture.d);
    }
  }
  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    viewport.classList.remove('dragging');
    if (gesture && gesture.type === 'pan' && gesture.moved <= 5 && pointers.size === 0) {
      const el = document.elementFromPoint(gesture.cx, gesture.cy);
      const tile = el && el.closest('.tile');
      if (tile && onSelect) {
        const x = Number(tile.dataset.x), y = Number(tile.dataset.y), now = performance.now();
        // dwuklik / podwójne stuknięcie w to samo pole
        if (lastTap && lastTap.x === x && lastTap.y === y && now - lastTap.t < 380) {
          lastTap = null;
          if (onActivate) onActivate({ x, y });
        } else {
          lastTap = { x, y, t: now };
          onSelect({ x, y });
        }
      }
    }
    if (pointers.size === 0) gesture = null;
    else if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      gesture = { type: 'pan', start: p, vx: view.x, vy: view.y, moved: 99 };
    }
  }
  function onWheel(e) {
    if (e.target.closest('.map-ui')) return;
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, view.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }
  function onKey(e) {
    const tile = e.target.closest && e.target.closest('.tile');
    if (tile && onSelect && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onSelect({ x: Number(tile.dataset.x), y: Number(tile.dataset.y) });
    }
  }

  function mount(vp, wd, miniCanvas, selectCb, activateCb) {
    viewport = vp; world = wd; onSelect = selectCb; onActivate = activateCb; mini = miniCanvas;
    fxMount(vp, wd);
    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove);
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', onUp);
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('keydown', onKey);
    const coord = document.getElementById('mapCoord');
    if (coord) {
      vp.addEventListener('mouseover', e => {
        const t = e.target.closest && e.target.closest('.tile');
        if (!t) return;
        coord.textContent = t.dataset.x + ':' + t.dataset.y + (t.title ? ' – ' + t.title.replace(/ \(\d+:\d+\)/, '') : '');
        coord.classList.add('on');
      });
      vp.addEventListener('mouseleave', () => coord.classList.remove('on'));
    }
    let grid = true;
    try { grid = root.localStorage.getItem('mp-grid') !== '0'; } catch (e) { /* brak dostępu */ }
    setGrid(grid);
    if (mini) {
      mini.width = mini.height = MINI * 2;
      let dragging = false;
      mini.addEventListener('pointerdown', e => { e.stopPropagation(); dragging = true; mini.setPointerCapture(e.pointerId); miniJump(e); });
      mini.addEventListener('pointermove', e => { if (dragging) miniJump(e); });
      mini.addEventListener('pointerup', () => { dragging = false; });
    }
  }

  function reset() { builtFor = null; view.fitted = false; fx.segs = []; fx.marks = []; fx.byKind = null; fx.viewDirty = true; fxKick(); }
  // Na telefonie: jeśli panel szczegółów zasłania wybrane pole, przesuń mapę tak, by pole było nad panelem.
  function revealAbove(x, y, coveredFromBottom) {
    bottomInset = coveredFromBottom;
    if (!viewport) return;
    const vpRect = viewport.getBoundingClientRect();
    const visibleBottom = vpRect.height - coveredFromBottom;
    const tileTop = view.y + (HEAD + y * TILE) * view.s, tileBottom = tileTop + TILE * view.s;
    if (coveredFromBottom > 0 && tileBottom > visibleBottom - 12) {
      view.y -= tileBottom - (visibleBottom - 12) + 8;
      clamp(); apply();
    }
  }
  function setGrid(on) {
    world.classList.toggle('nogrid', !on);
    const b = document.querySelector('[data-act="grid-toggle"]');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    try { root.localStorage.setItem('mp-grid', on ? '1' : '0'); } catch (e) { /* brak dostępu */ }
  }
  function toggleGrid() { setGrid(world.classList.contains('nogrid')); }

  MP.Map = { revealAbove, toggleGrid, mount, render, renderMoves, setSelected, zoomBy, centerOn, fit, view, apply, clamp, reset };
})(typeof window !== 'undefined' ? window : globalThis);
