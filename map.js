/* =========================================================================
   Mini Plemiona – MAPA ŚWIATA
   Warstwy: teren (canvas) → terytoria (canvas) → osady (canvas)
   → pola interaktywne (DOM, każde z danymi) → trasy wojsk (SVG).
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
    const key = state.created + ':' + state.map.size + ':' + Object.keys(state.villages).length;
    if (builtFor === key) return false;
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
      '<div class="tiles" style="grid-template-columns:repeat(' + N + ',' + TILE + 'px);grid-template-rows:repeat(' + N + ',' + TILE + 'px)"></div>' +
      '<svg class="moves" viewBox="0 0 ' + S + ' ' + S + '" width="' + S + '" height="' + S + '" aria-hidden="true"></svg></div>';
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
      tiles: world.querySelector('.tiles'), moves: world.querySelector('.moves') };
    return true;
  }

  /* ---------- warstwy zależne od stanu ---------- */
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
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
      inner = '<span class="vlabel" style="--fc:' + color + '"><i>' + E.points(v) + '</i>' + escapeHtml(v.name) + '</span>';
      title = v.name + ' (' + t.x + ':' + t.y + ') – ' + E.ownerName(state, v.owner) + ', ' + E.points(v) + ' pkt';
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
    let miniDirty = false;
    if (rebuilt || layers.ownerKey !== ownerKey) {
      layers.ownerKey = ownerKey;
      A.territory(state, layers.territory);   // najdroższa warstwa (piksel po pikselu)
      miniDirty = true;
    }
    if (rebuilt || layers.tierKey !== tierKey) {
      layers.tierKey = tierKey;
      A.villages(state, layers.villages);
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
  function villageSig(state, v) { return v.owner + '|' + E.points(v) + '|' + v.name; }
  function syncVillageTiles(state, ctx) {
    Object.values(state.villages).forEach(v => {
      const r = layers.vt.get(v.id);
      if (!r) return;
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

  /* ---------- trasy wojsk ---------- */
  // Marsze na tym samym odcinku (ten sam kierunek i rodzaj) dzielą jedną linię; każdy marsz ma tylko swój znacznik.
  // Elementy SVG są trwałe (klucz = odcinek / id marszu), co tick przesuwamy znaczniki – animacja linii się nie
  // restartuje (to było miganie), a dodanie lub zakończenie marszu nie przebudowuje reszty.
  // Przy tłoku (>MANY_ROUTES odcinków) linie są cienkie i półprzezroczyste, bez obwódek i okręgów celu.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MANY_ROUTES = 14;
  function renderMoves(state, list) {
    if (!layers) return;
    if (!layers.routes) layers.routes = new Map();
    const routes = layers.routes;
    const now = state.now;
    const c = v => ({ x: (v.x + 0.5) * TILE, y: (v.y + 0.5) * TILE });
    const seen = new Set();
    list.forEach(m => {
      const from = state.villages[m.from], to = m.to ? state.villages[m.to] : { x: m.x, y: m.y };
      let a = c(from), b = c(to), kind;
      if (m.type === 'return' || m.type === 'trade-return') { kind = m.type === 'return' ? 'ret' : 'trade'; const t = a; a = b; b = t; }
      else if (m.owner !== 'player') kind = 'inc';
      else kind = { attack: 'out', spy: 'spy', transport: 'trade', settle: 'settle', support: 'sup' }[m.type] || 'out';
      const prog = Math.max(0, Math.min(1, (now - m.start) / Math.max(1, m.arrive - m.start)));
      const px = a.x + (b.x - a.x) * prog, py = a.y + (b.y - a.y) * prog;
      const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const tf = 'translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ') rotate(' + ang.toFixed(1) + ')';
      const id = m.id || (m.type + ':' + m.from + ':' + m.to + ':' + m.start);
      const seg = kind + '|' + a.x + ',' + a.y + '|' + b.x + ',' + b.y;
      let r = routes.get(seg);
      if (!r) {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'route ' + kind);
        g.innerHTML = '<line class="trail" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>' +
          '<line class="path" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>' +
          '<circle class="dest" cx="' + b.x + '" cy="' + b.y + '" r="22"/>';
        layers.moves.appendChild(g);
        r = { g, marks: new Map() };
        routes.set(seg, r);
      }
      let mk = r.marks.get(id);
      if (!mk) {
        const el = document.createElementNS(SVG_NS, 'g');
        el.setAttribute('class', 'mk');
        el.innerHTML = '<circle class="marker" r="9"/><path class="arrow" d="M-4,-4 L5,0 L-4,4 Z"/>';
        r.g.appendChild(el);
        mk = { el, tf: null };
        r.marks.set(id, mk);
      }
      if (mk.tf !== tf) { mk.tf = tf; mk.el.setAttribute('transform', tf); }
      seen.add(seg + '#' + id);
    });
    routes.forEach((r, seg) => {
      r.marks.forEach((mk, id) => { if (!seen.has(seg + '#' + id)) { mk.el.remove(); r.marks.delete(id); } });
      if (!r.marks.size) { r.g.remove(); routes.delete(seg); }
    });
    layers.moves.classList.toggle('many', routes.size > MANY_ROUTES);
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

  function reset() { builtFor = null; view.fitted = false; }
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
