/* =========================================================================
   Mini Plemiona – INTERFEJS
   Ekrany: Wioska, Mapa, Wojsko, Raporty + okna (atak, raport, menu).
   Ekran jest przebudowywany tylko, gdy zmieni się jego "sygnatura"
   (stan, który pokazuje). Liczniki czasu odświeżane są co sekundę.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const E = MP.Engine;
  const S = MP.Sprites;
  const $ = (sel, el) => (el || document).querySelector(sel);

  const UI = {
    screen: 'village', vid: null, sel: null, filter: 'all',
    recruit: {}, atk: {}, form: {}, gather: null, troops: null, sigs: {}, modal: null, toastQueue: []
  };

  /* ---------- formatowanie ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Math.floor(n).toLocaleString('pl-PL');
  const pad = n => String(n).padStart(2, '0');
  function dur(ms) {
    let s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  function clock(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function dayClock(ts) {
    const d = new Date(ts), now = new Date();
    const same = d.toDateString() === now.toDateString();
    return (same ? '' : pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  const xy = (x, y) => '(' + x + ':' + y + ')';
  const ico = name => '<span class="ico">' + S.icon(name) + '</span>';
  function flag(state, owner) {
    return '<span class="flag" style="--fc:' + E.ownerColor(state, owner) + '"></span>' + esc(E.ownerName(state, owner));
  }
  function costChips(v, cost, mult) {
    mult = mult || 1;
    return '<span class="cost">' + E.RES.map(r => {
      const need = cost[r] * mult;
      const lack = Math.floor(v.res[r]) < need ? ' lack' : '';
      return '<span class="chip' + lack + '" title="' + C.RESOURCES[r].name + '">' + ico(r) + fmt(need) + '</span>';
    }).join('') + '</span>';
  }
  function unitsLine(u) {
    const parts = E.UNITS.filter(k => u[k] > 0).map(k => '<span class="uchip" title="' + C.UNITS[k].name + '">' + ico(k) + fmt(u[k]) + '</span>');
    return parts.length ? parts.join('') : '<span class="muted">brak</span>';
  }

  const st = () => MP.Game.state;
  function cur() {
    const s = st();
    let v = s.villages[UI.vid];
    if (!v || v.owner !== 'player') {
      v = E.villagesOf(s, 'player')[0] || null;
      UI.vid = v ? v.id : null;
    }
    return v;
  }

  /* ---------- nagłówek ---------- */
  function renderHeader() {
    const s = st(), v = cur();
    const own = E.villagesOf(s, 'player').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    const sel = $('#villageSelect');
    const optSig = own.map(o => o.id + o.name).join() + ':' + UI.vid;
    if (sel.dataset.sig !== optSig) {
      sel.innerHTML = own.map(o => '<option value="' + o.id + '"' + (o.id === UI.vid ? ' selected' : '') + '>' +
        esc(o.name) + ' ' + xy(o.x, o.y) + '</option>').join('');
      sel.dataset.sig = optSig;
    }
    sel.disabled = own.length === 0;
    if (!v) { $('#resbar').innerHTML = '<span class="muted">Brak wiosek</span>'; return; }
    const cap = E.storageCap(v), p = E.productionPerMin(v);
    const plaque = (icon, val, max, title, extra) => {
      const pct = Math.min(100, val / max * 100);
      return '<div class="res' + (pct >= 100 ? ' full' : '') + '" title="' + title + '">' + ico(icon) +
        '<div class="rv"><b>' + fmt(val) + '</b><small>' + extra + '</small><span class="cap"><i style="width:' + pct.toFixed(1) + '%"></i></span></div></div>';
    };
    const hid = E.hiddenRes(s, v);
    let html = E.RES.map(r => plaque(r, v.res[r], cap, C.RESOURCES[r].name + ': +' + Math.round(p[r]) + '/min, magazyn ' + fmt(cap) + (hid ? ', ukryte przed łupieżcami: ' + fmt(hid) : ''), '+' + Math.round(p[r]) + '/min')).join('');
    const used = E.popUsed(s, v), pc = E.popCap(v);
    html += plaque('pop', used, pc, 'Farma: zajęte ' + fmt(used) + ' z ' + fmt(pc) + ' miejsc', 'z ' + fmt(pc));
    $('#resbar').innerHTML = html;
  }

  function renderNav() {
    const s = st();
    const unread = s.reports.filter(r => !r.read).length;
    const incoming = incomingAttacks(s).length;
    document.querySelectorAll('[data-screen]').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === UI.screen);
      b.setAttribute('aria-current', b.dataset.screen === UI.screen ? 'page' : 'false');
    });
    setBadge('reports', unread, '');
    setBadge('army', incoming, 'danger');
  }
  function setBadge(screen, n, cls) {
    const b = document.querySelector('[data-screen="' + screen + '"] .badge');
    if (!b) return;
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = n === 0;
    b.className = 'badge ' + cls;
  }

  function incomingAttacks(s) {
    return s.movements.filter(m => m.type === 'attack' && m.owner !== 'player' && s.villages[m.to].owner === 'player');
  }
  function playerMovements(s) {
    return s.movements.filter(m => m.owner === 'player' || (m.type === 'attack' && s.villages[m.to].owner === 'player'))
      .sort((a, b) => a.arrive - b.arrive);
  }

  /* ---------- ekran: WIOSKA ---------- */
  function effectText(v, key, next) {
    const B = C.BUILDINGS[key], L = v.buildings[key];
    switch (key) {
      case 'hq': return 'Magazyn ' + fmt(B.storage[L]) + (next ? ' → ' + fmt(B.storage[next]) : '') +
        ', czas budowy ' + Math.round(B.buildSpeed[L] * 100) + '%' + (next ? ' → ' + Math.round(B.buildSpeed[next] * 100) + '%' : '');
      case 'wood': case 'clay': case 'iron': {
        return B.prod[L] + (next ? ' → ' + B.prod[next] : '') + ' ' +
          { wood: 'drewna', clay: 'gliny', iron: 'żelaza' }[key] + ' na minutę';
      }
      case 'farm': return 'Miejsca dla wojska: ' + fmt(B.pop[L]) + (next ? ' → ' + fmt(B.pop[next]) : '');
      case 'wall': return 'Obrona +' + Math.round(B.bonus[L] * 100) + '%' + (next ? ' → +' + Math.round(B.bonus[next] * 100) + '%' : '') +
        ', mur sam broni siłą ' + B.flat[L] + (next ? ' → ' + B.flat[next] : '');
      case 'market': return 'Kupcy: ' + B.merchants[L] + (next ? ' → ' + B.merchants[next] : '') + ', każdy wiezie do ' + fmt(C.MERCHANT.capacity) + ' surowców';
      case 'barracks': {
        let t = 'Czas szkolenia ' + Math.round(B.recruitSpeed[L] * 100) + '%' + (next ? ' → ' + Math.round(B.recruitSpeed[next] * 100) + '%' : '');
        const unlock = next ? E.UNITS.filter(u => C.UNITS[u].barracks === next).map(u => C.UNITS[u].name) : [];
        if (unlock.length) t += '. Odblokowuje: ' + unlock.join(', ');
        return t;
      }
    }
    return '';
  }

  function graceLeft(s) { return Math.max(0, E.diff(s).graceMinutes * 60000 - (s.now - s.created)); }
  function graceTag(s) {
    const left = graceLeft(s);
    return left > 0 ? '<span class="ok" title="AI nie atakuje Twoich wiosek">Ochrona przed AI: ' + Math.ceil(left / 60000) + ' min</span>' : '';
  }
  function villageSig(v) {
    const s = st();
    const infos = E.BUILDINGS.map(k => {
      const i = E.buildInfo(s, v, k);
      return i.code + i.target + (i.cost ? E.RES.map(r => Math.floor(v.res[r]) >= i.cost[r] ? 1 : 0).join('') : '');
    });
    return JSON.stringify([v.id, v.name, v.buildings, v.buildQueue.map(e => e.id), infos, Math.floor(v.loyalty), v.units, v.owner, E.merchantsFree(s, v), Math.ceil(graceLeft(s) / 60000), s.difficulty]);
  }

  function renderVillage() {
    const s = st(), v = cur(), el = $('#screen-village');
    if (!v) { el.innerHTML = noVillages(); return; }
    const sig = villageSig(v);
    if (UI.sigs.village === sig) return;
    UI.sigs.village = sig;
    const p = E.productionPerMin(v);

    const used = E.popUsed(s, v), cap = E.popCap(v);
    let html = '<section class="vhero">' +
      '<div class="vh-title"><div class="vh-crest">' + S.icon('hq') + '</div><div><h1>' + esc(v.name) + '</h1>' +
      '<p class="tags"><span>' + xy(v.x, v.y) + '</span><span>' + E.points(v) + ' pkt</span>' +
      (v.loyalty < C.LOYALTY.max ? '<span class="warn">Poparcie ' + Math.floor(v.loyalty) + '%</span>' : '') + graceTag(s) + '</p></div></div>' +
      '<div class="vh-prod">' +
      E.RES.map(r => '<span class="prod" title="' + C.RESOURCES[r].name + ' na minutę">' + ico(r) + '<b>+' + Math.round(p[r]) + '</b><small>/min</small></span>').join('') +
      '<span class="prod" title="Miejsca na farmie">' + ico('pop') + '<b>' + fmt(used) + '</b><small>/' + fmt(cap) + '</small></span>' +
      '</div><div class="vh-units"><span class="muted">W wiosce</span>' + unitsLine(v.units) + '</div></section>';

    html += '<section class="panel"><h2>Kolejka budowy <small>' + v.buildQueue.length + '/' + C.BUILD_QUEUE_MAX + '</small></h2>';
    if (!v.buildQueue.length) html += '<p class="muted">Nic się nie buduje. Wybierz budynek poniżej.</p>';
    else html += '<ul class="queue">' + v.buildQueue.map(e =>
      '<li>' + ico(S.building[e.building]) + '<span class="qname">' + C.BUILDINGS[e.building].name + ' – poziom ' + e.level + '</span>' +
      '<span class="bar"><i data-ps="' + e.start + '" data-pe="' + e.end + '" style="width:' + pct(e.start, e.end) + '%"></i></span>' +
      '<span class="timer" data-end="' + e.end + '"></span></li>').join('') + '</ul>';
    html += '</section><div class="bgrid">';

    E.BUILDINGS.forEach(k => {
      const B = C.BUILDINGS[k], info = E.buildInfo(s, v, k);
      const next = info.code === 'max' ? null : info.target;
      const lv = v.buildings[k];
      let pips = '';
      for (let i = 1; i <= C.MAX_LEVEL; i++) pips += '<i class="' + (i <= lv ? 'on' : i < next ? 'q' : '') + '"></i>';
      html += '<article class="bcard panel" id="b-' + k + '">' +
        '<div class="bicon">' + S.icon(S.building[k]) + '</div>' +
        '<div class="bbody"><h3>' + B.name + ' <span class="lvl">' + lv + '<small>/' + C.MAX_LEVEL + '</small></span></h3>' +
        '<span class="pips" aria-hidden="true">' + pips + '</span>' +
        '<p class="effect">' + effectText(v, k, next) + '</p>';
      if (next) {
        html += costChips(v, info.cost) +
          '<button class="btn" data-act="build" data-k="' + k + '"' + (info.ok ? '' : ' disabled') + '>' +
          'Rozbuduj do poz. ' + next + ' <small>' + dur(info.time) + '</small></button>';
        if (!info.ok) html += '<p class="why">' + info.reason + '</p>';
      } else {
        html += '<p class="done">Maksymalny poziom</p>';
      }
      html += '</div></article>';
    });
    el.innerHTML = html + '</div>';
  }

  function noVillages() {
    return '<div class="panel empty"><h2>Twoje plemię nie ma już wiosek</h2><p>Rozpocznij nową grę w menu.</p>' +
      '<button class="btn" data-act="menu">Otwórz menu</button></div>';
  }

  /* ---------- ekran: WOJSKO ---------- */
  function ago(ts) {
    const min = Math.floor((st().now - ts) / 60000);
    if (min < 1) return 'przed chwilą';
    if (min < 60) return min + ' min temu';
    const h = Math.floor(min / 60);
    return h < 24 ? h + ' godz. temu' : Math.floor(h / 24) + ' dni temu';
  }
  function placeOf(s, m) {
    const v = m.to ? s.villages[m.to] : null;
    return v ? { name: v.name, x: v.x, y: v.y } : { name: 'puste pole', x: m.x, y: m.y };
  }
  function resLine(r) {
    const parts = E.RES.filter(k => r && r[k] > 0).map(k => '<span class="uchip">' + ico(k) + fmt(r[k]) + '</span>');
    return parts.length ? parts.join('') : '<span class="muted">bez ładunku</span>';
  }
  function movementItem(s, m) {
    const from = s.villages[m.from], to = placeOf(s, m);
    let cls, title, extra, icon;
    if (m.owner !== 'player') {
      cls = 'inc'; icon = 'sword';
      title = 'Nadciąga atak na ' + esc(to.name) + ' z ' + esc(from.name) + ' ' + xy(from.x, from.y);
      extra = flag(s, m.owner) + ' <span class="muted">– siła nieznana</span>';
    } else if (m.type === 'attack') {
      cls = 'out'; icon = 'sword';
      title = 'Atak: ' + esc(from.name) + ' → ' + esc(to.name) + ' ' + xy(to.x, to.y);
      extra = unitsLine(m.units);
    } else if (m.type === 'support') {
      cls = 'sup'; icon = 'spear';
      title = (m.stay === false ? 'Wsparcie: ' : 'Przemarsz: ') + esc(from.name) + ' → ' + esc(to.name) + ' ' + xy(to.x, to.y);
      extra = unitsLine(m.units);
    } else if (m.type === 'spy') {
      cls = 'spy'; icon = 'scout';
      title = 'Zwiad: ' + esc(from.name) + ' → ' + esc(to.name) + ' ' + xy(to.x, to.y);
      extra = unitsLine(m.units);
    } else if (m.type === 'transport') {
      cls = 'trade'; icon = 'merchant';
      title = 'Transport: ' + esc(from.name) + ' → ' + esc(to.name);
      extra = resLine(m.res) + ' <span class="muted">' + m.merchants + ' kup.</span>';
    } else if (m.type === 'trade-return') {
      cls = 'trade'; icon = 'merchant';
      title = 'Kupcy wracają do ' + esc(from.name);
      extra = resLine(m.res);
    } else if (m.type === 'settle') {
      cls = 'settle'; icon = 'settler';
      title = 'Osadnicy: ' + esc(from.name) + ' → pole ' + xy(to.x, to.y);
      extra = '<span class="muted">założą nową wioskę</span>';
    } else {
      cls = 'ret'; icon = 'light';
      title = 'Powrót do ' + esc(from.name) + ' z ' + esc(to.name);
      extra = unitsLine(m.units);
      if (m.loot && (m.loot.wood + m.loot.clay + m.loot.iron) > 0) extra += ' <span class="loot">' + E.RES.map(r => ico(r) + fmt(m.loot[r])).join(' ') + '</span>';
    }
    return '<li class="mv ' + cls + '">' + ico(icon) +
      '<div class="mvbody"><b>' + title + '</b><div>' + extra + '</div></div>' +
      '<div class="mvtime"><span class="timer" data-end="' + m.arrive + '"></span><small>' + clock(m.arrive) + '</small></div></li>';
  }

  function armySig(v) {
    const s = st();
    return JSON.stringify([v.id, v.units, v.buildings.barracks, v.buildings.farm,
      v.recruitQueue.map(e => e.id + ':' + e.done),
      E.UNITS.map(u => { const i = E.recruitInfo(s, v, u); return i.code + i.max; }),
      playerMovements(s).map(m => m.id), E.villagesOf(s, 'player').length, v.support, Object.values(s.villages).map(w => w.support && w.support[v.id] ? w.id + JSON.stringify(w.support[v.id]) : '').join()]);
  }

  function renderArmy() {
    const s = st(), v = cur(), el = $('#screen-army');
    if (!v) { el.innerHTML = noVillages(); return; }
    const sig = armySig(v);
    if (UI.sigs.army === sig) return;
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    UI.sigs.army = sig;

    const away = E.emptyUnits();
    s.movements.forEach(m => { if (m.from === v.id && m.owner === 'player') E.UNITS.forEach(k => { away[k] += m.units[k]; }); });

    const used = E.popUsed(s, v), cap = E.popCap(v);
    const totalHome = E.sumUnits(v.units), totalAway = E.sumUnits(away);
    let html = '<section class="army-head panel">' +
      '<div><h1>Wojsko</h1><p class="tags"><span>' + esc(v.name) + ' ' + xy(v.x, v.y) + '</span><span>Koszary poz. ' + v.buildings.barracks + '</span><span>Mur poz. ' + v.buildings.wall + '</span></p></div>' +
      '<div class="army-kpis">' +
      '<div class="kpi"><small>W wiosce</small><b>' + fmt(totalHome) + '</b></div>' +
      '<div class="kpi"><small>Poza wioską</small><b>' + fmt(totalAway) + '</b></div>' +
      '<div class="kpi"><small>Siła ataku</small><b>' + fmt(E.attackPower(v.units)) + '</b></div>' +
      '<div class="kpi" title="Wojsko w wiosce, wsparcie i mur"><small>Obrona wioski</small><b>' + fmt(E.villageDefense(v)) + '</b></div>' +
      '<div class="kpi wide"><small>Farma</small><b>' + fmt(used) + ' / ' + fmt(cap) + '</b><span class="meter"><i style="width:' + Math.min(100, used / cap * 100).toFixed(1) + '%"></i></span></div>' +
      '</div></section>';

    html += '<div class="ugrid">';
    E.UNITS.forEach(k => {
      const U = C.UNITS[k], info = E.recruitInfo(s, v, k);
      const locked = info.code === 'locked';
      html += '<article class="ucard' + (locked ? ' locked' : '') + '">' +
        '<header><span class="u-ico">' + S.icon(k) + '</span><div class="u-name"><h3>' + U.name + '</h3><p>' + U.desc + '</p></div>' +
        '<div class="u-count"><b>' + fmt(v.units[k]) + '</b><small>w wiosce</small>' + (away[k] ? '<small class="away">+' + fmt(away[k]) + ' w drodze</small>' : '') + '</div></header>' +
        '<ul class="u-stats">' +
        '<li><small>Atak</small><b>' + U.att + '</b></li><li><small>Obrona</small><b>' + U.def + '</b></li>' +
        '<li><small>Szybkość</small><b>' + U.speed + ' s</b></li><li><small>Łup</small><b>' + U.carry + '</b></li><li><small>Farma</small><b>' + U.pop + '</b></li></ul>';
      if (locked) {
        html += '<p class="lockmsg">' + info.reason + '</p>';
      } else {
        html += '<div class="u-cost">' + costChips(v, U.cost) + '<span class="u-time">' + dur(info.per) + ' / szt.</span></div>' +
          '<div class="u-form"><div class="stepper">' +
          '<button class="step" data-act="rstep" data-u="' + k + '" data-d="-1" aria-label="Mniej">−</button>' +
          '<input type="number" inputmode="numeric" min="1" step="1" placeholder="0" aria-label="Liczba: ' + U.name + '" data-rin="' + k + '" value="' + esc(UI.recruit[k] || '') + '">' +
          '<button class="step" data-act="rstep" data-u="' + k + '" data-d="1" aria-label="Więcej">+</button></div>' +
          '<button class="btn ghost" data-act="rmax" data-u="' + k + '"' + (info.max > 0 ? '' : ' disabled') + '>Maks. ' + info.max + '</button>' +
          '<button class="btn" data-act="recruit" data-u="' + k + '"' + (info.ok ? '' : ' disabled') + '>Rekrutuj</button></div>';
        if (!info.ok) html += '<p class="why">' + info.reason + '</p>';
      }
      html += '</article>';
    });
    html += '</div>';

    const hosted = Object.entries(v.support || {}).filter(([o]) => s.villages[o]);
    const abroad = Object.values(s.villages).filter(w => w.support && w.support[v.id]);
    if (hosted.length || abroad.length) {
      const row = (title, u, btn) => '<li class="sup-row">' + ico('barracks') + '<div><b>' + title + '</b><div>' + unitsLine(u) + '</div></div>' + btn + '</li>';
      html += '<section class="panel"><h2>Wsparcie</h2>';
      if (hosted.length) html += '<h3 class="sub">Broni tej wioski</h3><ul class="sup-list">' + hosted.map(([o, u]) =>
        row('Z wioski ' + esc(s.villages[o].name) + ' ' + xy(s.villages[o].x, s.villages[o].y), u,
          '<button class="btn ghost" data-act="withdraw" data-host="' + v.id + '" data-origin="' + o + '">Odeślij</button>')).join('') + '</ul>';
      if (abroad.length) html += '<h3 class="sub">Twoje wojsko w innych wioskach</h3><ul class="sup-list">' + abroad.map(w =>
        row('W wiosce ' + esc(w.name) + ' ' + xy(w.x, w.y), w.support[v.id],
          '<button class="btn ghost" data-act="withdraw" data-host="' + w.id + '" data-origin="' + v.id + '">Odwołaj</button>')).join('') + '</ul>';
      html += '</section>';
    }

    html += '<section class="panel"><h2>Kolejka rekrutacji <small>' + v.recruitQueue.length + '/' + C.RECRUIT_QUEUE_MAX + '</small></h2>';
    if (!v.recruitQueue.length) html += '<p class="muted">Koszary są wolne.</p>';
    else html += '<ul class="queue">' + v.recruitQueue.map(e => {
      const end = e.start + e.count * e.per;
      return '<li>' + ico(e.unit) + '<span class="qname">' + C.UNITS[e.unit].name + ' ' + e.done + '/' + e.count + '</span>' +
        '<span class="bar"><i data-ps="' + e.start + '" data-pe="' + end + '" style="width:' + pct(e.start, end) + '%"></i></span><span class="timer" data-end="' + end + '"></span></li>';
    }).join('') + '</ul>';
    html += '</section>';

    const mv = playerMovements(s);
    const others = E.villagesOf(s, 'player').filter(o => o.id !== v.id);
    if (others.length) {
      html += '<section class="panel"><h2>Wyślij wojsko do swojej wioski</h2><p class="muted">Jako wsparcie (możesz je odwołać) albo na stałe.</p><div class="actions left">' +
        others.sort((a, b) => E.dist(a, v) - E.dist(b, v)).slice(0, 6).map(o => '<button class="btn ghost" data-act="support-from" data-id="' + o.id + '">' +
        ico('spear') + esc(o.name) + ' <small>' + E.dist(o, v).toFixed(1) + ' pola</small></button>').join('') + '</div></section>';
    }
    html += '<section class="panel"><h2>Ruchy wojsk</h2>' + (mv.length
      ? '<ul class="mvlist">' + mv.map(m => movementItem(s, m)).join('') + '</ul>'
      : '<p class="muted">Żadne wojska nie są w drodze. Wybierz cel na mapie, aby wysłać atak.</p>') + '</section>';
    el.innerHTML = html;
  }

  /* ---------- ekran: PRZEGLĄD WIOSEK ---------- */
  function renderOverview() {
    const s = st(), el = $('#screen-overview');
    const own = E.villagesOf(s, 'player').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    // odświeżanie co 5 s albo przy zmianie struktury – liczniki czasu tykają same
    const sig = JSON.stringify([own.map(v => [v.id, v.buildQueue.length, v.recruitQueue.length, E.sumUnits(v.units)]), incomingAttacks(s).length, UI.vid, Math.floor(s.now / 5000)]);
    if (UI.sigs.overview === sig) return;
    UI.sigs.overview = sig;
    if (!own.length) { el.innerHTML = noVillages(); return; }
    const inc = incomingAttacks(s);
    const pw = E.accountPower(s, 'player');
    const total = { wood: 0, clay: 0, iron: 0 }, prod = { wood: 0, clay: 0, iron: 0 };
    let army = 0;
    const rows = own.map(v => {
      const cap = E.storageCap(v), p = E.productionPerMin(v);
      E.RES.forEach(r => { total[r] += v.res[r]; prod[r] += p[r]; });
      army += E.sumUnits(v.units);
      const resCell = r => {
        const pct = Math.min(100, v.res[r] / cap * 100);
        return '<td class="num' + (pct >= 100 ? ' full' : pct >= 85 ? ' near' : '') + '"><b>' + fmt(v.res[r]) + '</b><span class="mini"><i style="width:' + pct.toFixed(0) + '%"></i></span></td>';
      };
      const used = E.popUsed(s, v), pc = E.popCap(v);
      const bq = v.buildQueue[0], rq = v.recruitQueue[0];
      const attacks = inc.filter(m => m.to === v.id).sort((a, b) => a.arrive - b.arrive);
      return '<tr' + (v.id === UI.vid ? ' class="cur"' : '') + '>' +
        '<td class="vname"><button class="link" data-act="goto" data-id="' + v.id + '">' + esc(v.name) + '</button><small>' + xy(v.x, v.y) + ', ' + E.points(v) + ' pkt</small></td>' +
        E.RES.map(resCell).join('') +
        '<td class="num farm"><b>' + fmt(used) + '</b><small> / ' + fmt(pc) + '</small></td>' +
        '<td>' + (bq ? ico(S.building[bq.building]) + C.BUILDINGS[bq.building].name + ' ' + bq.level + ' <span class="timer" data-end="' + bq.end + '"></span>' +
          (v.buildQueue.length > 1 ? ' <small class="muted">+' + (v.buildQueue.length - 1) + '</small>' : '') : '<span class="idle">wolne</span>') + '</td>' +
        '<td>' + (rq ? ico(rq.unit) + (rq.count - rq.done) + ' <span class="timer" data-end="' + (rq.start + rq.count * rq.per) + '"></span>' : '<span class="idle">wolne</span>') + '</td>' +
        '<td class="units-cell">' + unitsLine(v.units) + '</td>' +
        '<td>' + (attacks.length ? '<span class="alert">' + ico('sword') + attacks.length + ' <span class="timer" data-end="' + attacks[0].arrive + '"></span></span>' : '') + '</td></tr>';
    }).join('');
    el.innerHTML = '<section class="ov-head panel"><div><h1>Przegląd wiosek</h1><p class="tags"><span>' + own.length + ' z ' + E.winVillages(s) + ' wiosek</span>' +
      (inc.length ? '<span class="warn">Nadciągające ataki: ' + inc.length + '</span>' : '') + '</p>' +
      '<div class="actions left"><button class="btn" data-act="gather-open"' + (own.length > 1 ? '' : ' disabled title="Potrzebujesz co najmniej dwóch wiosek"') + '>' + ico('merchant') + 'Zbierz / rozdziel surowce</button>' +
      '<button class="btn" data-act="troops-open"' + (own.length > 1 ? '' : ' disabled title="Potrzebujesz co najmniej dwóch wiosek"') + '>' + ico('spear') + 'Zbierz / rozdziel wojsko</button></div></div>' +
      '<div class="army-kpis ov-kpis">' + E.RES.map(r => '<div class="kpi"><small>' + C.RESOURCES[r].name + ' razem</small><b>' + fmt(total[r]) + '</b><small>+' + Math.round(prod[r]) + ' / min</small></div>').join('') +
      '<div class="kpi"><small>Wojsko w wioskach</small><b>' + fmt(army) + '</b></div>' +
      '<div class="kpi"><small>Moc konta</small><b>' + fmt(pw.total) + '</b><small>bud. ' + fmt(pw.buildings) + ' + woj. ' + fmt(pw.army) + '</small></div></div></section>' +
      '<section class="panel"><div class="tablewrap"><table class="units ov">' +
      '<thead><tr><th>Wioska</th><th>' + ico('wood') + 'Drewno</th><th>' + ico('clay') + 'Glina</th><th>' + ico('iron') + 'Żelazo</th><th>' + ico('pop') + 'Farma</th><th>Budowa</th><th>Rekrutacja</th><th>Wojsko</th><th>Ataki</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></section>';
  }

  /* ---------- ekran: RAPORTY ---------- */
  function reportTitle(s, r) {
    if (r.kind === 'news') {
      if (r.eliminated) return esc(E.ownerName(s, r.eliminated)) + ' traci ostatnią wioskę i znika z mapy';
      if (r.settled) return esc(E.ownerName(s, r.attacker)) + ' zakłada osadę ' + esc(r.toName) + ' ' + xy(r.toX, r.toY);
      return esc(E.ownerName(s, r.attacker)) + ' zdobywa ' + esc(r.toName) + ' ' + xy(r.toX, r.toY);
    }
    if (r.kind === 'spy') return 'Zwiad: ' + esc(r.toName) + ' ' + xy(r.toX, r.toY) + ' – ' + (r.success ? 'udany' : 'zwiadowcy zginęli');
    if (r.kind === 'spydef') return 'Wrogi zwiad w ' + esc(r.toName) + ' – ' + (r.success ? 'wróg przejrzał wioskę' : 'zatrzymany');
    if (r.kind === 'attack') return 'Atak na ' + esc(r.toName) + ' ' + xy(r.toX, r.toY) + ' – ' +
      (r.conquered ? 'wioska przejęta' : r.attackerWon ? 'zwycięstwo' : 'porażka');
    return esc(E.ownerName(s, r.attacker)) + ' atakuje ' + esc(r.toName) + ' – ' +
      (r.conquered ? 'wioska utracona' : r.attackerWon ? 'obrona przegrana' : 'atak odparty');
  }
  function reportTone(r) {
    if (r.kind === 'news') return 'news';
    if (r.kind === 'spy') return r.success ? 'win' : 'loss';
    if (r.kind === 'spydef') return r.success ? 'loss' : 'win';
    const playerWon = r.kind === 'attack' ? r.attackerWon : !r.attackerWon;
    return playerWon ? 'win' : 'loss';
  }

  function renderReports() {
    const s = st(), el = $('#screen-reports');
    const list = s.reports.filter(r => UI.filter === 'all' || r.kind === UI.filter || (UI.filter === 'spy' && r.kind === 'spydef'));
    const sig = JSON.stringify([UI.filter, s.reports.length, s.reports[0] && s.reports[0].id, s.reports.filter(r => !r.read).length]);
    if (UI.sigs.reports === sig) return;
    UI.sigs.reports = sig;
    const filters = [['all', 'Wszystkie'], ['attack', 'Moje ataki'], ['defense', 'Obrona'], ['spy', 'Zwiad'], ['news', 'Kronika świata']];
    let html = '<section class="panel"><h2>Raporty</h2><div class="toolbar">' +
      filters.map(f => '<button class="btn tab' + (UI.filter === f[0] ? ' on' : '') + '" data-act="filter" data-f="' + f[0] + '">' + f[1] + '</button>').join('') +
      '<span class="spacer"></span><button class="btn ghost" data-act="read-all"' + (s.reports.some(r => !r.read) ? '' : ' disabled') + '>Oznacz jako przeczytane</button>' +
      '<button class="btn ghost" data-act="clear-reports"' + (s.reports.length ? '' : ' disabled') + '>Usuń wszystkie</button></div>';
    if (!list.length) {
      html += '<p class="muted">Brak raportów. Raport pojawi się po pierwszej bitwie.</p>';
    } else {
      html += '<ul class="rlist">' + list.map(r =>
        '<li><button class="ritem ' + reportTone(r) + (r.read ? '' : ' unread') + '" data-act="report" data-id="' + r.id + '">' +
        ico(r.kind === 'news' ? (r.settled ? 'settler' : 'noble') : r.kind === 'attack' ? 'sword' : r.kind === 'spy' || r.kind === 'spydef' ? 'scout' : 'barracks') +
        '<span class="rtitle">' + reportTitle(s, r) + '</span><span class="rtime">' + dayClock(r.time) + '</span></button></li>').join('') + '</ul>';
    }
    el.innerHTML = html + '</section>';
  }

  function intelHtml(I) {
    if (!I) return '';
    let h = '<div class="intel"><h3>' + ico('scout') + 'Wiadomości ze zwiadu <small>' + ago(I.time) + '</small></h3>' +
      '<p><span class="muted">Wojsko w wiosce:</span> ' + unitsLine(I.units) + '</p>';
    if (I.res) h += '<p><span class="muted">Surowce:</span> ' + resLine(I.res) + '</p>';
    if (I.buildings) h += '<p class="blist">' + E.BUILDINGS.map(k => '<span>' + C.BUILDINGS[k].name + ' <b>' + I.buildings[k] + '</b></span>').join('') + '</p>';
    return h + '</div>';
  }

  // Tabela bitwy: tylko jednostki, które brały udział (reszta to same zera), nagłówek dwupoziomowy,
  // układ stały – mieści się na wąskim ekranie bez przewijania w bok.
  function reportUnitsTable(r, hideDef) {
    const kinds = E.UNITS.filter(k => r.attUnits[k] || r.attLoss[k] || (!hideDef && (r.defUnits[k] || r.defLoss[k])));
    if (!kinds.length) return '';
    const cell = (v, loss) => '<td class="num' + (loss && v ? ' loss' : '') + (v ? '' : ' zero') + '">' + (v || '–') + '</td>';
    return '<table class="units rep"><colgroup><col class="c-name"><col><col><col><col></colgroup>' +
      '<thead><tr><th rowspan="2">Jednostka</th><th colspan="2" class="grp">Atak</th><th colspan="2" class="grp">Obrona</th></tr>' +
      '<tr><th>wysł.</th><th>strat.</th><th>stan</th><th>strat.</th></tr></thead><tbody>' +
      kinds.map(k => '<tr><td class="uname" title="' + C.UNITS[k].name + '">' + ico(k) + '<span>' + C.UNITS[k].name + '</span></td>' +
        cell(r.attUnits[k], false) + cell(r.attLoss[k], true) +
        (hideDef ? '<td class="num">?</td><td class="num">?</td>' : cell(r.defUnits[k], false) + cell(r.defLoss[k], true)) + '</tr>').join('') +
      '</tbody></table>';
  }
  function reportModal(r) {
    const s = st();
    let html = '<h2>' + reportTitle(s, r) + '</h2><p class="muted">' + new Date(r.time).toLocaleString('pl-PL') + '</p>';
    if (r.kind === 'spy' || r.kind === 'spydef') {
      html += '<div class="sides"><p><b>Zwiadowcy:</b> ' + flag(s, r.attacker) + ', ' + esc(r.fromName) + ' ' + xy(r.fromX, r.fromY) + '</p>' +
        '<p><b>Cel:</b> ' + flag(s, r.defender) + ', ' + esc(r.toName) + ' ' + xy(r.toX, r.toY) + '</p></div>' +
        '<p>Wysłano ' + r.sent + ' zwiadowców, zginęło ' + r.lost + '.</p>';
      if (r.kind === 'spy') html += r.success ? intelHtml(r.intel) : '<p class="muted">Obrońca miał więcej zwiadowców. Wyślij liczniejszy oddział zwiadu.</p>';
      else html += '<p>' + (r.success ? 'Wróg zobaczył Twoje wojsko i surowce. Więcej zwiadowców w wiosce lepiej ją chroni.' : 'Twoi zwiadowcy nie dopuścili wroga do wioski.') + '</p>';
    } else if (r.kind === 'news') {
      html += '<p>' + (r.settled ? 'Na pustej równinie ' + xy(r.toX, r.toY) + ' powstała nowa wioska frakcji ' + flag(s, r.attacker) + '.' : r.eliminated ? 'Frakcja ' + esc(E.ownerName(s, r.eliminated)) + ' została wyeliminowana z gry.'
        : 'Wioska ' + esc(r.toName) + ' ' + xy(r.toX, r.toY) + ' należy teraz do frakcji ' + flag(s, r.attacker) + '.') + '</p>';
    } else {
      const hideDef = r.kind === 'attack' && !r.attackerWon;
      html += '<div class="sides"><p><b>Atakujący:</b> ' + flag(s, r.attacker) + ', ' + esc(r.fromName) + ' ' + xy(r.fromX, r.fromY) + '</p>' +
        '<p><b>Obrońca:</b> ' + flag(s, r.defender) + ', ' + esc(r.toName) + ' ' + xy(r.toX, r.toY) + '</p></div>' +
        reportUnitsTable(r, hideDef);
      if (hideDef) html += '<p class="muted">Nikt nie wrócił z bitwy – brak informacji o obrońcach.</p>';
      html += '<p>Szczęście atakującego: ' + (r.luck > 0 ? '+' : '') + r.luck + '%</p>';
      if (r.wallBefore) html += '<p>Mur obronny: poziom ' + r.wallBefore + (r.wallFight < r.wallBefore ? ', w bitwie osłabiony taranami do ' + r.wallFight : '') +
        (r.wallAfter < r.wallBefore ? '. Tarany zburzyły go do poziomu ' + r.wallAfter + '.' : '.') + '</p>';
      if (r.hadSupport) html += '<p class="muted">W obronie walczyło też wsparcie z innych wiosek – straty liczone łącznie.</p>';
      const lootSum = r.loot.wood + r.loot.clay + r.loot.iron;
      if (lootSum > 0) {
        html += '<p>' + (r.kind === 'defense' ? 'Wróg zrabował: ' : 'Łup: ') + E.RES.map(rs => ico(rs) + fmt(r.loot[rs])).join(' ') +
          (r.lootCapacity ? ' <span class="muted">(udźwig oddziału: ' + fmt(r.lootCapacity) + ')</span>' : '') + '</p>';
      } else if (r.attackerWon && E.sumUnits(E.UNITS.reduce((o, k) => { o[k] = r.attUnits[k] - r.attLoss[k]; return o; }, {})) > 0) {
        const why = r.lootCapacity === 0 ? 'ocalałe jednostki nie przenoszą surowców'
          : r.lootHidden ? 'wszystkie surowce były w schowku (chronione do ' + fmt(r.lootHidden) + ' każdego surowca)'
          : 'w wiosce nie było surowców';
        html += '<p>' + (r.kind === 'defense' ? 'Wróg niczego nie zrabował' : 'Łup: brak') + ' – ' + why + '.</p>';
      }
      if (r.loyaltyBefore != null) html += '<p>Poparcie: ' + r.loyaltyBefore + '% → ' + (r.loyaltyAfter != null ? r.loyaltyAfter : r.loyaltyBefore) + '%</p>';
      if (r.kind === 'attack' && r.attackerWon && !r.conquered && r.defender !== null && !(r.attUnits.noble > 0)) {
        html += '<p class="muted">Wioska należy do frakcji – aby ją przejąć, wyślij Dowódcę podboju razem z armią.</p>';
      }
      if (r.intel) html += intelHtml(r.intel);
      if (r.conquered) html += '<p class="big">' + (r.attacker === 'player' ? 'Wioska należy teraz do Ciebie.' : 'Wioska została utracona.') + '</p>';
    }
    html += '<div class="actions"><button class="btn ghost" data-act="show-on-map" data-x="' + r.toX + '" data-y="' + r.toY + '">Pokaż na mapie</button>' +
      '<button class="btn" data-act="close">Zamknij</button></div>';
    return html;
  }

  /* ---------- ekran: MAPA ---------- */
  function mapCtx() {
    const s = st();
    const incoming = new Set(incomingAttacks(s).map(m => m.to));
    const outgoing = new Set(s.movements.filter(m => m.owner === 'player' && m.type === 'attack').map(m => m.to));
    return { current: UI.vid, incoming, outgoing, sel: UI.sel };
  }
  function renderMap(force) {
    const s = st();
    const ctx = mapCtx();
    const sig = JSON.stringify([s.created, UI.vid, Object.values(s.villages).map(v => v.owner + E.points(v)), [...ctx.incoming], [...ctx.outgoing]]);
    if (force || UI.sigs.map !== sig) {
      UI.sigs.map = sig;
      MP.Map.render(s, ctx);
    }
    MP.Map.renderMoves(s, playerMovements(s));
    renderLegend(s);
    renderDetails();
  }
  // Legenda mapy zależy od liczby frakcji w danym świecie.
  function renderLegend(s) {
    const el = document.querySelector('.legend');
    if (!el) return;
    const key = s.created + ':' + Object.keys(s.factions).length;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    const fs = Object.values(s.factions);
    el.classList.toggle('many', fs.length > 7);
    el.innerHTML = fs.map(f => '<span><i class="flag" style="--fc:' + f.color + '"></i>' + (f.id === 'player' ? 'Ty' : esc(f.name)) + '</span>').join('') +
      '<span><i class="flag" style="--fc:#8a6b4d"></i>Wolne osady</span>';
  }

  function renderDetails() {
    const s = st(), el = $('#mapDetails');
    const sel = UI.sel;
    const v0 = cur();
    let sig = 'none';
    let tile = null, v = null;
    if (sel) {
      tile = E.tileAt(s, sel.x, sel.y);
      v = tile.village ? s.villages[tile.village] : null;
      sig = JSON.stringify([sel, v && [v.owner, E.points(v), Math.floor(v.loyalty), v.owner === 'player' ? [v.units, E.merchantsFree(s, v)] : 0, s.intel[v.id] && s.intel[v.id].time],
        v0 && v0.id, UI.vid, s.movements.filter(m => (v && (m.to === v.id || m.from === v.id)) || (m.type === 'settle' && m.x === sel.x && m.y === sel.y)).map(m => m.id),
        E.villagesOf(s, 'player').map(o => o.units.settler), Object.keys(s.villages).length]);
    }
    if (UI.sigs.details === sig) return;
    UI.sigs.details = sig;
    el.classList.toggle('open', !!sel);
    if (!sel) {
      el.innerHTML = '<p class="muted hint">Kliknij pole, aby zobaczyć szczegóły. Dwuklik na swojej wiosce ustawia ją jako aktywną, a na obcej otwiera okno ataku. Przeciągaj, aby przesuwać mapę.</p>';
      return;
    }
    let html = '<button class="sheet-close" data-act="deselect" aria-label="Zamknij szczegóły">×</button>';
    if (!v) {
      const names = { forest: 'Las', mountain: 'Góry', plain: 'Równina' };
      html += '<h2>' + names[tile.terrain] + ' ' + xy(tile.x, tile.y) + '</h2>';
      const why = E.settleCheck(s, tile.x, tile.y);
      const pending = s.movements.filter(m => m.type === 'settle' && m.x === tile.x && m.y === tile.y && m.owner === 'player');
      if (why) {
        html += '<p class="muted">' + (tile.terrain === 'plain' ? why + '.' : 'Teren nie nadaje się do zasiedlenia.') + '</p>';
      } else if (pending.length) {
        html += '<p>Twoi osadnicy już tu zmierzają.</p>';
      } else {
        const ready = E.villagesOf(s, 'player').filter(o => o.units.settler > 0);
        html += '<p class="muted">Wolna równina – można tu założyć nową wioskę.</p>';
        if (v0 && ready.length) {
          const d = Math.min(...ready.map(o => E.dist(o, tile)));
          html += '<dl class="facts"><dt>Najbliższy osadnik</dt><dd>' + d.toFixed(1) + ' pola, ' + dur(d * C.UNITS.settler.speed * 1000) + '</dd></dl>' +
            '<div class="actions"><button class="btn" data-act="settle-open" data-x="' + tile.x + '" data-y="' + tile.y + '">' + ico('settler') + 'Załóż osadę</button></div>';
        } else {
          html += '<p class="hint-box">' + ico('settler') + 'Zrekrutuj Osadnika w Koszarach (wymaga Ratusza poz. ' + C.UNITS.settler.hq + ').</p>';
        }
      }
      if (pending.length) html += '<ul class="mvlist compact">' + pending.map(m => movementItem(s, m)).join('') + '</ul>';
      el.innerHTML = html;
      return;
    }
    const d = v0 ? E.dist(v0, v) : 0;
    html += '<h2><span class="flag" style="--fc:' + E.ownerColor(s, v.owner) + '"></span>' + esc(v.name) + ' ' + xy(v.x, v.y) + '</h2>' +
      '<dl class="facts"><dt>Właściciel</dt><dd>' + esc(E.ownerName(s, v.owner)) +
      (v.owner && s.factions[v.owner].ai ? ' <span class="muted">(' + C.AI.personalities[s.factions[v.owner].personality].label + ')</span>' : '') + '</dd>' +
      '<dt>Punkty</dt><dd>' + E.points(v) + '</dd>';
    if (v.owner !== null) html += '<dt>Poparcie</dt><dd>' + Math.floor(v.loyalty) + '%</dd>';
    if (v0 && v0.id !== v.id) {
      html += '<dt>Odległość</dt><dd>' + d.toFixed(1) + ' pola od ' + esc(v0.name) + '</dd>' +
        '<dt>Marsz</dt><dd>' + ico('axe') + dur(d * C.UNITS.axe.speed * 1000) + '  ' + ico('light') + dur(d * C.UNITS.light.speed * 1000) +
        '  ' + ico('noble') + dur(d * C.UNITS.noble.speed * 1000) + '</dd>';
    }
    html += '</dl>';
    if (v.owner === 'player') {
      const many = E.villagesOf(s, 'player').length > 1;
      const sup = Object.keys(v.support || {}).length ? E.defenders(v) : null;
      if (sup) E.UNITS.forEach(k => { sup[k] -= v.units[k]; });
      html += '<p><span class="muted">W wiosce:</span> ' + unitsLine(v.units) + '</p>' +
        (sup ? '<p><span class="muted">Wsparcie:</span> ' + unitsLine(sup) + '</p>' : '') +
        '<p><span class="muted">Mur:</span> <b>poz. ' + v.buildings.wall + '</b></p>' +
        '<p><span class="muted">Kupcy:</span> <b>' + E.merchantsFree(s, v) + '/' + E.merchantsTotal(v) + '</b></p><div class="actions">' +
        (many ? '<button class="btn ghost" data-act="support-open" data-id="' + v.id + '">' + ico('spear') + 'Wyślij tu wojsko</button>' +
          '<button class="btn ghost" data-act="transport-open" data-id="' + v.id + '">' + ico('merchant') + 'Wyślij tu surowce</button>' : '') +
        (v.id !== UI.vid ? '<button class="btn ghost" data-act="activate" data-id="' + v.id + '">Ustaw jako aktywną</button>' : '') +
        '<button class="btn" data-act="goto" data-id="' + v.id + '">Zarządzaj wioską</button></div>' +
        '<p class="muted tip">' + (v.id === UI.vid ? 'To Twoja aktywna wioska.' : 'Dwuklik na wiosce na mapie też ustawia ją jako aktywną.') + '</p>';
    } else if (v0) {
      const I = s.intel[v.id];
      html += I ? intelHtml(I) : '<p class="hint-box">' + ico('scout') + 'Nie wiesz, co jest w tej wiosce. Wyślij zwiadowców.</p>';
      html += '<p class="muted">' + (v.owner === null
        ? 'Wygrana bitwa oznacza przejęcie osady.'
        : 'Aby przejąć wioskę, pokonaj obrońców z Dowódcą podboju w armii, aż poparcie spadnie do zera.') + '</p>' +
        '<p class="muted tip">Dwuklik na tej wiosce otwiera okno ataku z ' + esc(v0.name) + '.</p>' +
        '<div class="actions"><button class="btn ghost" data-act="spy-open" data-id="' + v.id + '">' + ico('scout') + 'Zwiad</button>' +
        '<button class="btn danger" data-act="attack-open" data-id="' + v.id + '">' + ico('sword') + 'Atakuj</button></div>';
    }
    const rel = s.movements.filter(m => (m.to === v.id || m.from === v.id) && (m.owner === 'player' || (m.type === 'attack' && s.villages[m.to].owner === 'player')));
    if (rel.length) html += '<h3>Ruchy wojsk</h3><ul class="mvlist compact">' + rel.map(m => movementItem(s, m)).join('') + '</ul>';
    el.innerHTML = html;
  }

  /* ---------- okno ataku ---------- */
  function attackModal() {
    const s = st(), m = UI.modal, target = s.villages[m.target];
    const own = E.villagesOf(s, 'player').sort((a, b) => E.dist(a, target) - E.dist(b, target));
    if (!own.some(o => o.id === m.from)) m.from = own[0] && own[0].id;
    const from = s.villages[m.from];
    E.tickVillage(s, from, s.now);
    let html = '<h2>' + ico('sword') + 'Atak na ' + esc(target.name) + ' ' + xy(target.x, target.y) + '</h2>' +
      '<p>' + flag(s, target.owner) + ', ' + E.points(target) + ' pkt</p>' +
      '<label class="field">Wyślij z wioski <select id="atkFrom">' + own.map(o => '<option value="' + o.id + '"' + (o.id === m.from ? ' selected' : '') + '>' +
      esc(o.name) + ' ' + xy(o.x, o.y) + ', ' + E.dist(o, target).toFixed(1) + ' pola</option>').join('') + '</select></label>' +
      '<div class="tablewrap"><table class="units atk"><thead><tr><th>Jednostka</th><th>Dostępne</th><th>Wyślij</th></tr></thead><tbody>';
    E.UNITS.filter(k => k !== 'settler').forEach(k => {
      const avail = from.units[k];
      html += '<tr><td>' + ico(k) + C.UNITS[k].name + '</td><td><button class="link" data-act="amax" data-u="' + k + '"' + (avail ? '' : ' disabled') + '>' + fmt(avail) + '</button></td>' +
        '<td><input type="number" inputmode="numeric" min="0" max="' + avail + '" step="1" placeholder="0" data-ain="' + k + '" aria-label="' + C.UNITS[k].name + '" value="' + esc(UI.atk[k] || '') + '"' + (avail ? '' : ' disabled') + '></td></tr>';
    });
    html += '</tbody></table></div><div class="actions left"><button class="btn ghost" data-act="aall">Wszystkie jednostki</button>' +
      '<button class="btn ghost" data-act="anone">Wyczyść</button></div>' +
      '<div id="atkSummary" class="summary"></div>' +
      '<p class="muted">' + (target.owner === null ? 'Wygrana bitwa = przejęcie osady.' : 'Dowódca podboju obniża poparcie tylko wtedy, gdy przeżyje zwycięską bitwę.') + '</p>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn danger" data-act="send-attack">Wyślij atak</button></div>';
    return html;
  }
  function attackUnits() {
    const u = E.emptyUnits();
    E.UNITS.forEach(k => { u[k] = Math.max(0, Math.floor(Number(UI.atk[k]) || 0)); });
    return u;
  }
  function updateAttackSummary() {
    const box = $('#atkSummary');
    if (!box || !UI.modal || UI.modal.type !== 'attack') return;
    const s = st(), from = s.villages[UI.modal.from], target = s.villages[UI.modal.target];
    if (!from || !target) return;
    const u = attackUnits();
    const total = E.sumUnits(u);
    if (!total) { box.innerHTML = '<p class="muted">Wpisz liczbę jednostek albo kliknij liczbę dostępnych.</p>'; return; }
    const tt = E.travelTime(from, target, u);
    const over = E.UNITS.some(k => u[k] > from.units[k]);
    const I = s.intel[target.id];
    let est = 'nieznana';
    if (I) {
      const wallKnown = I.buildings ? I.buildings.wall || 0 : 0;
      const wall = Math.max(0, wallKnown - Math.floor(E.ramCount(u) / C.RAM.fightPerLevel));
      est = fmt(E.defenseFrom(I.units, wall)) + (I.buildings ? (wallKnown ? ' (mur ' + wall + ')' : '') : ' (mur nieznany)');
    }
    box.innerHTML = '<div><span>Siła ataku</span><b>' + fmt(E.attackPower(u)) + '</b></div>' +
      '<div><span>Obrona celu' + (I ? ' (zwiad ' + ago(I.time) + ')' : '') + '</span><b>' + est + '</b></div>' +
      '<div><span>Czas marszu</span><b>' + dur(tt) + '</b></div>' +
      '<div><span>Przybycie</span><b>' + clock(s.now + tt) + '</b></div>' +
      '<div><span>Powrót najpóźniej</span><b>' + clock(s.now + 2 * tt) + '</b></div>' +
      (over ? '<p class="why">Wpisano więcej jednostek, niż jest w wiosce.</p>' : '');
  }

  /* ---------- okna: zwiad, transport, osadnik ---------- */
  function fromSelect(list, selected, target) {
    return '<label class="field">Z wioski <select data-from>' + list.map(o => '<option value="' + o.id + '"' + (o.id === selected ? ' selected' : '') + '>' +
      esc(o.name) + ' ' + xy(o.x, o.y) + (target ? ', ' + E.dist(o, target).toFixed(1) + ' pola' : '') + '</option>').join('') + '</select></label>';
  }
  function spyModal() {
    const s = st(), m = UI.modal, target = s.villages[m.target];
    const own = E.villagesOf(s, 'player').sort((a, b) => (b.units.scout > 0) - (a.units.scout > 0) || E.dist(a, target) - E.dist(b, target));
    if (!own.some(o => o.id === m.from)) m.from = own[0].id;
    const from = s.villages[m.from];
    E.tickVillage(s, from, s.now);
    return '<h2>' + ico('scout') + 'Zwiad: ' + esc(target.name) + ' ' + xy(target.x, target.y) + '</h2>' +
      '<p>' + flag(s, target.owner) + ', ' + E.points(target) + ' pkt</p>' + fromSelect(own, m.from, target) +
      '<label class="field">Zwiadowcy (dostępnych: ' + from.units.scout + ')<span class="inrow"><input type="number" inputmode="numeric" min="1" step="1" placeholder="0" data-fin="scout" value="' + esc(UI.form.scout || '') + '"' + (from.units.scout ? '' : ' disabled') + '>' +
      '<button class="btn ghost" data-act="fmax" data-k="scout" data-v="' + from.units.scout + '"' + (from.units.scout ? '' : ' disabled') + '>Wszyscy</button></span></label>' +
      (from.units.scout ? '' : '<p class="why">W tej wiosce nie ma zwiadowców. Zrekrutuj ich w Koszarach.</p>') +
      '<div id="formSummary" class="summary"></div>' +
      '<p class="muted">Zwiad się uda, jeśli wyślesz więcej zwiadowców niż ma obrońca. Zobaczysz wojsko, surowce i budynki.</p>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="send-spy">Wyślij zwiad</button></div>';
  }
  function transportModal() {
    const s = st(), m = UI.modal, target = s.villages[m.target];
    const own = E.villagesOf(s, 'player').filter(o => o.id !== target.id).sort((a, b) => E.merchantsFree(s, b) - E.merchantsFree(s, a) || E.dist(a, target) - E.dist(b, target));
    if (!own.some(o => o.id === m.from)) m.from = own[0].id;
    const from = s.villages[m.from];
    E.tickVillage(s, from, s.now);
    return '<h2>' + ico('merchant') + 'Transport do ' + esc(target.name) + ' ' + xy(target.x, target.y) + '</h2>' + fromSelect(own, m.from, target) +
      '<p>Kupcy w wiosce ' + esc(from.name) + ': <b>' + E.merchantsFree(s, from) + ' wolnych z ' + E.merchantsTotal(from) + '</b>, każdy wiezie do ' + fmt(C.MERCHANT.capacity) + '.</p>' +
      (E.merchantsTotal(from) ? '' : '<p class="why">Ta wioska nie ma Targowiska. Zbuduj je, aby wysyłać surowce.</p>') +
      '<div class="tablewrap"><table class="units atk"><tbody>' + E.RES.map(k =>
        '<tr><td>' + ico(k) + C.RESOURCES[k].name + '</td><td><button class="link" data-act="fmax" data-k="' + k + '" data-v="' + Math.floor(from.res[k]) + '">' + fmt(from.res[k]) + '</button></td>' +
        '<td><input type="number" inputmode="numeric" min="0" step="100" placeholder="0" data-fin="' + k + '" value="' + esc(UI.form[k] || '') + '"></td></tr>').join('') +
      '</tbody></table></div><div id="formSummary" class="summary"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="send-transport">Wyślij kupców</button></div>';
  }
  /* ---------- okno: zbieranie / rozdzielanie surowców ---------- */
  function gatherDefaults(target) {
    return { target, mode: 'gather', res: { wood: true, clay: true, iron: true }, reserve: 20, capToRoom: true, off: {} };
  }
  function gatherArgs(g) { return { mode: g.mode, res: g.res, reservePct: g.reserve, capToRoom: g.capToRoom, off: g.off }; }
  function gatherModal() {
    const s = st(), g = UI.gather, own = E.villagesOf(s, 'player').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    if (!own.some(o => o.id === g.target)) g.target = own[0].id;
    const spread = g.mode === 'spread';
    return '<h2>' + ico('merchant') + (spread ? 'Rozdziel surowce' : 'Zbierz surowce') + '</h2>' +
      '<div class="seg"><button class="btn' + (spread ? ' ghost' : '') + '" data-act="gather-mode" data-m="gather">Zbierz do jednej wioski</button>' +
      '<button class="btn' + (spread ? '' : ' ghost') + '" data-act="gather-mode" data-m="spread">Rozdziel z jednej wioski</button></div>' +
      '<label class="field">' + (spread ? 'Wioska źródłowa' : 'Wioska docelowa') + ' <select data-gtarget>' + own.map(o => '<option value="' + o.id + '"' + (o.id === g.target ? ' selected' : '') + '>' +
        esc(o.name) + ' ' + xy(o.x, o.y) + '</option>').join('') + '</select></label>' +
      '<div class="gopts"><div class="field">Surowce<span class="gres">' + E.RES.map(k => '<label class="chk"><input type="checkbox" data-gres="' + k + '"' + (g.res[k] ? ' checked' : '') + '>' + ico(k) + C.RESOURCES[k].name + '</label>').join('') + '</span></div>' +
      '<label class="field">Zostaw w wiosce wysyłającej (% magazynu)<input type="number" inputmode="numeric" min="0" max="100" step="5" data-greserve value="' + esc(g.reserve) + '"></label></div>' +
      '<label class="chk"><input type="checkbox" data-gcap' + (g.capToRoom ? ' checked' : '') + '>Nie wysyłaj więcej, niż mieści magazyn ' + (spread ? 'celów' : 'celu') + '</label>' +
      '<div id="gatherPlan"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="gather-send" id="gatherSend">Wyślij kupców</button></div>';
  }
  function updateGatherPlan() {
    const box = $('#gatherPlan');
    if (!box || !UI.modal || UI.modal.type !== 'gather') return;
    const s = st(), g = UI.gather, spread = g.mode === 'spread', T = s.villages[g.target];
    const plan = E.planGather(s, g.target, gatherArgs(g), s.now);
    const sendable = plan.rows.filter(r => !r.skip && r.total > 0);
    let html = '<div class="tablewrap"><table class="units gather"><thead><tr><th></th><th>' + (spread ? 'Do wioski' : 'Z wioski') + '</th><th>Surowce</th><th>Kupcy</th><th>Droga</th></tr></thead><tbody>' +
      plan.rows.map(r => {
        const v = s.villages[r.villageId];
        return '<tr class="' + (r.skip ? 'skipped' : '') + '"><td><input type="checkbox" data-gsrc="' + v.id + '"' + (r.off ? '' : ' checked') + '></td>' +
          '<td>' + esc(v.name) + '<small>' + E.dist(v, T).toFixed(1) + ' pola</small></td>' +
          '<td>' + (r.skip ? '<span class="muted">' + esc(r.skip) + '</span>' : resLine(r.res)) + '</td>' +
          '<td class="num">' + (r.merchants || '') + '</td><td class="num">' + (r.skip ? '' : dur(r.time)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<div class="summary"><div><span>Razem surowców</span><b>' + fmt(plan.total) + '</b></div>' +
      '<div><span>Kupców</span><b>' + plan.merchants + '</b></div>' +
      '<div><span>Transportów</span><b>' + sendable.length + '</b></div>' +
      (sendable.length ? '<div><span>Pierwsza dostawa za</span><b>' + dur(Math.min.apply(null, sendable.map(r => r.time))) + '</b></div>' : '') +
      (!spread && sendable.length ? '<div class="wide"><span>Po dostawie w ' + esc(T.name) + '</span><b>' + E.RES.map(k => {
        const add = plan.rows.reduce((a, r) => a + r.res[k], 0);
        return ico(k) + fmt(Math.floor(T.res[k]) + E.incomingRes(s, T.id)[k] + add) + ' / ' + fmt(E.storageCap(T));
      }).join(' ') + '</b></div>' : '') +
      (plan.lost ? '<p class="why">Część surowców nie zmieści się w magazynie celu i przepadnie.</p>' : '') +
      (!plan.rows.length ? '<p class="muted">Brak innych wiosek.</p>' : '') +
      (plan.rows.length && !sendable.length ? '<p class="muted">Nic do wysłania z obecnymi ustawieniami.</p>' : '') + '</div>';
    box.innerHTML = html;
    const btn = $('#gatherSend'); if (btn) btn.disabled = !sendable.length;
  }
  /* ---------- okno: zbieranie / rozdzielanie wojska ---------- */
  function troopsDefaults(target) {
    const units = {}; E.UNITS.forEach(k => { units[k] = k !== 'settler' && k !== 'scout'; });
    return { target, mode: 'gather', stay: false, units, reserve: 0, capToRoom: true, off: {} };
  }
  function troopsArgs(g) { return { mode: g.mode, stay: g.stay, units: g.units, reservePct: g.reserve, capToRoom: g.capToRoom, off: g.off }; }
  function troopsModal() {
    const s = st(), g = UI.troops, own = E.villagesOf(s, 'player').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    if (!own.some(o => o.id === g.target)) g.target = own[0].id;
    const spread = g.mode === 'spread';
    return '<h2>' + ico('spear') + (spread ? 'Rozdziel wojsko' : 'Zbierz wojsko') + '</h2>' +
      '<div class="seg"><button class="btn' + (spread ? ' ghost' : '') + '" data-act="troops-mode" data-m="gather">Zbierz do jednej wioski</button>' +
      '<button class="btn' + (spread ? '' : ' ghost') + '" data-act="troops-mode" data-m="spread">Rozdziel z jednej wioski</button></div>' +
      '<label class="field">' + (spread ? 'Wioska źródłowa' : 'Wioska docelowa') + ' <select data-ttarget>' + own.map(o => '<option value="' + o.id + '"' + (o.id === g.target ? ' selected' : '') + '>' +
        esc(o.name) + ' ' + xy(o.x, o.y) + '</option>').join('') + '</select></label>' +
      '<label class="field">Rodzaj wysyłki <select data-tstay>' +
        '<option value="0"' + (g.stay ? '' : ' selected') + '>Wsparcie – wojsko zostaje Twoje i można je odwołać</option>' +
        '<option value="1"' + (g.stay ? ' selected' : '') + '>Przeniesienie na stałe – zajmuje farmę celu</option></select></label>' +
      '<div class="gopts"><div class="field">Jednostki<span class="gres">' + E.UNITS.map(k => '<label class="chk"><input type="checkbox" data-tunit="' + k + '"' + (g.units[k] ? ' checked' : '') + '>' + ico(k) + C.UNITS[k].name + '</label>').join('') + '</span></div>' +
      '<label class="field">Zostaw w wiosce wysyłającej (% wojska)<input type="number" inputmode="numeric" min="0" max="100" step="5" data-treserve value="' + esc(g.reserve) + '"></label></div>' +
      (g.stay ? '<label class="chk"><input type="checkbox" data-tcap' + (g.capToRoom ? ' checked' : '') + '>Nie wysyłaj więcej, niż mieści farma ' + (spread ? 'celów' : 'celu') + '</label>' : '') +
      '<div id="troopsPlan"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="troops-send" id="troopsSend">Wyślij wojsko</button></div>';
  }
  function updateTroopsPlan() {
    const box = $('#troopsPlan');
    if (!box || !UI.modal || UI.modal.type !== 'troops') return;
    const s = st(), g = UI.troops, spread = g.mode === 'spread', T = s.villages[g.target];
    const plan = E.planTroops(s, g.target, troopsArgs(g), s.now);
    const sendable = plan.rows.filter(r => !r.skip && r.total > 0);
    let html = '<div class="tablewrap"><table class="units gather"><thead><tr><th></th><th>' + (spread ? 'Do wioski' : 'Z wioski') + '</th><th>Wojsko</th><th>Droga</th></tr></thead><tbody>' +
      plan.rows.map(r => {
        const v = s.villages[r.villageId];
        return '<tr class="' + (r.skip ? 'skipped' : '') + '"><td><input type="checkbox" data-tsrc="' + v.id + '"' + (r.off ? '' : ' checked') + '></td>' +
          '<td>' + esc(v.name) + '<small>' + E.dist(v, T).toFixed(1) + ' pola</small></td>' +
          '<td>' + (r.skip ? '<span class="muted">' + esc(r.skip) + '</span>' : unitsLine(r.units)) + '</td>' +
          '<td class="num">' + (r.skip ? '' : dur(r.time)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '<div class="summary"><div><span>Razem jednostek</span><b>' + fmt(plan.total) + '</b></div>' +
      '<div><span>Oddziałów</span><b>' + sendable.length + '</b></div>' +
      (sendable.length ? '<div><span>Pierwsze przybycie za</span><b>' + dur(Math.min.apply(null, sendable.map(r => r.time))) + '</b></div>' +
        '<div><span>Ostatnie przybycie za</span><b>' + dur(Math.max.apply(null, sendable.map(r => r.time))) + '</b></div>' : '') +
      (!spread && sendable.length ? '<div class="wide"><span>Farma w ' + esc(T.name) + (g.stay ? ' po przybyciu' : '') + '</span><b>' + ico('pop') + fmt(E.popUsed(s, T) + (g.stay ? plan.pop : 0)) + ' / ' + fmt(E.popCap(T)) + '</b></div>' : '') +
      (!plan.rows.length ? '<p class="muted">Brak innych wiosek.</p>' : '') +
      (plan.rows.length && !sendable.length ? '<p class="muted">Nic do wysłania z obecnymi ustawieniami.</p>' : '') + '</div>';
    box.innerHTML = html;
    const btn = $('#troopsSend'); if (btn) btn.disabled = !sendable.length;
  }
  function settleModal() {
    const s = st(), m = UI.modal, tile = { x: m.x, y: m.y };
    const own = E.villagesOf(s, 'player').filter(o => o.units.settler > 0).sort((a, b) => E.dist(a, tile) - E.dist(b, tile));
    if (!own.some(o => o.id === m.from)) m.from = own[0] && own[0].id;
    return '<h2>' + ico('settler') + 'Nowa osada na polu ' + xy(m.x, m.y) + '</h2>' +
      (own.length ? fromSelect(own, m.from, tile) : '<p class="why">Żadna wioska nie ma Osadnika.</p>') +
      '<div id="formSummary" class="summary"></div>' +
      '<p class="muted">Osadnik założy wioskę z Ratuszem, Tartakiem, Cegielnią, Kopalnią i Farmą na poziomie 1 oraz niewielkim zapasem surowców. Jeśli ktoś zajmie pole wcześniej, Osadnik wróci.</p>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="send-settle"' + (own.length ? '' : ' disabled') + '>Wyślij Osadnika</button></div>';
  }
  function supportModal() {
    const s = st(), m = UI.modal, target = s.villages[m.target];
    const own = E.villagesOf(s, 'player').filter(o => o.id !== target.id)
      .sort((a, b) => (E.sumUnits(b.units) > 0) - (E.sumUnits(a.units) > 0) || E.dist(a, target) - E.dist(b, target));
    if (!own.some(o => o.id === m.from)) m.from = own[0].id;
    const from = s.villages[m.from];
    E.tickVillage(s, from, s.now);
    const mode = UI.form.mode || 'support';
    let html = '<h2>' + ico('spear') + 'Wojsko do ' + esc(target.name) + ' ' + xy(target.x, target.y) + '</h2>' +
      '<div class="seg" role="radiogroup" aria-label="Rodzaj wysyłki">' +
      '<button role="radio" aria-checked="' + (mode === 'support') + '" class="' + (mode === 'support' ? 'on' : '') + '" data-act="smode" data-m="support">Wsparcie</button>' +
      '<button role="radio" aria-checked="' + (mode === 'stay') + '" class="' + (mode === 'stay' ? 'on' : '') + '" data-act="smode" data-m="stay">Przeniesienie na stałe</button></div>' +
      '<p class="muted seg-note">' + (mode === 'support'
        ? 'Jednostki bronią celu, ale należą do wioski macierzystej: zajmują jej farmę i możesz je w każdej chwili odwołać.'
        : 'Jednostki przechodzą do wioski docelowej na stałe i zajmują miejsce na jej farmie.') + '</p>' +
      fromSelect(own, m.from, target) +
      '<div class="tablewrap"><table class="units atk"><thead><tr><th>Jednostka</th><th>Dostępne</th><th>Wyślij</th></tr></thead><tbody>';
    E.UNITS.forEach(k => {
      const avail = from.units[k];
      html += '<tr><td>' + ico(k) + C.UNITS[k].name + '</td><td><button class="link" data-act="fmax" data-k="' + k + '" data-v="' + avail + '"' + (avail ? '' : ' disabled') + '>' + fmt(avail) + '</button></td>' +
        '<td><input type="number" inputmode="numeric" min="0" step="1" placeholder="0" data-fin="' + k + '" aria-label="' + C.UNITS[k].name + '" value="' + esc(UI.form[k] || '') + '"' + (avail ? '' : ' disabled') + '></td></tr>';
    });
    return html + '</tbody></table></div><div class="actions left"><button class="btn ghost" data-act="fall">Całe wojsko</button><button class="btn ghost" data-act="fnone">Wyczyść</button></div>' +
      '<div id="formSummary" class="summary"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="send-support">' + (mode === 'support' ? 'Wyślij wsparcie' : 'Przenieś wojsko') + '</button></div>';
  }
  function formUnits() { const u = E.emptyUnits(); E.UNITS.forEach(k => { u[k] = Math.max(0, Math.floor(Number(UI.form[k]) || 0)); }); return u; }
  function formRes() { const r = {}; E.RES.forEach(k => { r[k] = Math.max(0, Math.floor(Number(UI.form[k]) || 0)); }); return r; }
  function updateFormSummary() {
    const box = $('#formSummary');
    if (!box || !UI.modal) return;
    const s = st(), m = UI.modal, from = s.villages[m.from];
    if (!from) { box.innerHTML = ''; return; }
    if (m.type === 'spy') {
      const target = s.villages[m.target], n = Math.floor(Number(UI.form.scout) || 0);
      const u = E.emptyUnits(); u.scout = Math.max(1, n);
      const tt = E.travelTime(from, target, u);
      box.innerHTML = '<div><span>Czas marszu</span><b>' + dur(tt) + '</b></div><div><span>Przybycie</span><b>' + clock(s.now + tt) + '</b></div>' +
        (n > from.units.scout ? '<p class="why">Masz tylko ' + from.units.scout + ' zwiadowców.</p>' : '');
    } else if (m.type === 'transport') {
      const target = s.villages[m.target], r = formRes(), total = r.wood + r.clay + r.iron;
      const need = Math.ceil(total / C.MERCHANT.capacity), tt = E.merchantTime(from, target);
      const room = E.storageCap(target);
      box.innerHTML = '<div><span>Razem</span><b>' + fmt(total) + '</b></div><div><span>Potrzebni kupcy</span><b>' + need + ' / ' + E.merchantsFree(s, from) + '</b></div>' +
        '<div><span>Czas drogi</span><b>' + dur(tt) + '</b></div><div><span>Dostawa</span><b>' + clock(s.now + tt) + '</b></div>' +
        (need > E.merchantsFree(s, from) ? '<p class="why">Za mało wolnych kupców.</p>' : '') +
        (E.RES.some(k => target.res[k] + r[k] > room) ? '<p class="muted">Magazyn celu mieści ' + fmt(room) + ' – nadwyżka przepadnie.</p>' : '');
    } else if (m.type === 'support') {
      const target = s.villages[m.target], u = formUnits();
      if (!E.sumUnits(u)) { box.innerHTML = '<p class="muted">Wpisz liczbę jednostek albo kliknij liczbę dostępnych.</p>'; return; }
      const tt = E.travelTime(from, target, u), room = E.supportRoom(s, target), need = E.unitsPop(u);
      const over = E.UNITS.some(k => u[k] > from.units[k]);
      const stay = UI.form.mode === 'stay';
      const combined = E.defenders(target);
      E.UNITS.forEach(k => { combined[k] += u[k]; });
      box.innerHTML = '<div><span>Czas marszu</span><b>' + dur(tt) + '</b></div><div><span>Przybycie</span><b>' + clock(s.now + tt) + '</b></div>' +
        (stay ? '<div><span>Miejsce na farmie celu</span><b>' + fmt(need) + ' / ' + fmt(Math.max(0, room)) + '</b></div>' : '<div><span>Obrona celu po przybyciu</span><b>' + fmt(E.defenseFrom(combined, target.buildings.wall)) + '</b></div>') +
        (stay && need > room ? '<p class="why">Za mało miejsca na farmie w ' + esc(target.name) + '. Rozbuduj tam Farmę albo wyślij mniej.</p>' : '') +
        (over ? '<p class="why">Wpisano więcej jednostek, niż jest w wiosce.</p>' : '');
    } else if (m.type === 'settle') {
      const u = E.emptyUnits(); u.settler = 1;
      const tt = E.travelTime(from, { x: m.x, y: m.y }, u);
      box.innerHTML = '<div><span>Czas marszu</span><b>' + dur(tt) + '</b></div><div><span>Nowa wioska</span><b>' + clock(s.now + tt) + '</b></div>';
    }
  }

  /* ---------- menu ---------- */
  function menuModal() {
    const s = st();
    const own = E.villagesOf(s, 'player').length;
    const rows = Object.values(s.factions).map(f => {
      const vs = E.villagesOf(s, f.id);
      return { f, n: vs.length, pts: vs.reduce((a, v) => a + E.points(v), 0) };
    }).sort((a, b) => b.n - a.n || b.pts - a.pts);
    return '<h2>Menu</h2>' +
      '<section><h3>Cel gry</h3><p>Zdobądź ' + E.winVillages(s) + ' wiosek. Masz ' + own + '.</p>' +
      '<div class="goal"><i style="width:' + Math.min(100, own / E.winVillages(s) * 100) + '%"></i></div></section>' +
      powerSection(s) +
      '<section><h3>Ranking</h3><div class="tablewrap"><table class="units"><thead><tr><th>Frakcja</th><th>Wioski</th><th>Punkty</th></tr></thead><tbody>' +
      rows.map(r => '<tr' + (r.f.id === 'player' ? ' class="me"' : '') + '><td><span class="flag" style="--fc:' + r.f.color + '"></span>' + esc(r.f.name) +
        (r.f.ai ? ' <span class="muted">' + C.AI.personalities[r.f.personality].label + '</span>' : '') + (r.n ? '' : ' <span class="muted">(pokonana)</span>') +
        '</td><td>' + r.n + '</td><td>' + r.pts + '</td></tr>').join('') +
      '<tr><td><span class="flag" style="--fc:' + C.NEUTRAL.color + '"></span>Wolne osady</td><td>' + E.villagesOf(s, null).length + '</td><td></td></tr>' +
      '</tbody></table></div></section>' +
      '<section><h3>Poziom trudności</h3>' + diffPicker(s.difficulty, 'set-diff') +
      '<p class="muted seg-note">' + E.diff(s).desc + ' Zmiana działa od razu.</p></section>' +
      '<section><h3>Zapis gry</h3><p class="muted">Gra zapisuje się sama. Kopia zapasowa przyda się przy zmianie przeglądarki lub urządzenia.</p>' +
      '<div class="actions left"><button class="btn" data-act="export">Pobierz kopię zapisu (JSON)</button>' +
      '<button class="btn ghost" data-act="import">Wczytaj zapis z pliku</button>' +
      '<input type="file" id="importFile" accept=".json,application/json" hidden></div></section>' +
      '<section><h3>Jak grać</h3><ul class="help">' +
      '<li>Surowce rosną same, także gdy gra jest zamknięta. Rozbudowuj Tartak, Cegielnię i Kopalnię.</li>' +
      '<li>Ratusz powiększa magazyn i pozwala budować wyżej. Farma daje miejsce na wojsko.</li>' +
      '<li>Toporniki i kawaleria atakują, pikinierzy bronią. Szybkość oddziału = najwolniejsza jednostka.</li>' +
      '<li>Wolną osadę przejmujesz, wygrywając bitwę. Wioskę frakcji – Dowódcą podboju (Koszary 5).</li>' +
      '<li>Zwiadowcy odkrywają siłę obrony celu. Targowisko pozwala przewozić surowce, a Osadnik zakłada wioski na pustych równinach.</li>' +
      '<li>Mur obronny zwiększa obronę wioski, a tarany go burzą. Wsparcie broni innej Twojej wioski i możesz je odwołać na ekranie Wojsko.</li>' +
      '<li>Ekran Przegląd pokazuje wszystkie wioski naraz: surowce, kolejki, wojsko i nadciągające ataki.</li>' +
      '<li>Przez pierwsze ' + E.diff(s).graceMinutes + ' minut frakcje AI Cię nie atakują. ' + Math.round(E.diff(s).lootProtect * 100) + '% pojemności magazynu jest ukryte przed łupieżcami.</li></ul></section>' +
      '<section><h3>Nowa gra</h3><div class="actions left"><button class="btn danger" data-act="new-game">Zacznij od nowa</button></div></section>' +
      '<div class="actions"><button class="btn" data-act="close">Wróć do gry</button></div>';
  }

  // Moc konta gracza: punkty budynków + wojska oraz siła ataku i obrony całej armii.
  function powerSection(s) {
    const p = E.accountPower(s, 'player');
    const row = (a, b) => '<tr><td>' + a + '</td><td class="num">' + b + '</td></tr>';
    return '<section><h3>Moc konta</h3><div class="tablewrap"><table class="units"><tbody>' +
      row('Wioski', p.villages) + row('Punkty budynków', fmt(p.buildings)) + row('Punkty wojska (' + fmt(p.units) + ' jedn.)', fmt(p.army)) +
      row('Siła ataku', fmt(p.attack)) + row('Siła obrony (bez muru)', fmt(p.defense)) +
      '<tr class="me"><td><b>Razem</b></td><td class="num"><b>' + fmt(p.total) + '</b></td></tr></tbody></table></div>' +
      '<p class="muted seg-note">Wojsko liczy się razem z oddziałami w marszu i na wsparciu. Punkty jednostki = koszt / ' + C.SCORE.costDivisor + '.</p></section>';
  }

  function diffPicker(current, act) {
    return '<div class="seg seg3" role="radiogroup" aria-label="Poziom trudności">' + Object.entries(C.DIFFICULTY).map(([k, d]) =>
      '<button role="radio" aria-checked="' + (k === current) + '" class="' + (k === current ? 'on' : '') + '" data-act="' + act + '" data-d="' + k + '">' + d.label + '</button>').join('') + '</div>';
  }
  function worldPicker(current) {
    return '<div class="seg seg4" role="radiogroup" aria-label="Rozmiar świata">' + Object.entries(C.WORLDS).map(([k, w]) =>
      '<button role="radio" aria-checked="' + (k === current) + '" class="' + (k === current ? 'on' : '') + '" data-act="pick-world" data-w="' + k + '">' + w.label + '</button>').join('') + '</div>';
  }
  function newGameModal() {
    const d = UI.modal.diff || C.DEFAULT_DIFFICULTY, w = UI.modal.world || C.DEFAULT_WORLD;
    return '<h2>Nowa gra</h2><h3 class="pick-h">Rozmiar świata</h3>' + worldPicker(w) +
      '<p class="muted seg-note">' + C.WORLDS[w].desc + '</p>' +
      '<h3 class="pick-h">Poziom trudności</h3>' + diffPicker(d, 'pick-diff') +
      '<p class="muted seg-note">' + C.DIFFICULTY[d].desc + '</p>' +
      '<p class="why">Obecna rozgrywka zostanie usunięta. Jeśli chcesz ją zachować, najpierw pobierz kopię zapisu.</p>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn danger" data-act="new-game-now">Zacznij nową grę</button></div>';
  }

  function endModal() {
    const s = st(), win = s.ended.type === 'victory';
    return '<div class="endgame ' + (win ? 'win' : 'loss') + '">' + S.icon(win ? 'noble' : 'sword') +
      '<h2>' + (win ? 'Zwycięstwo!' : 'Twoje plemię upadło') + '</h2>' +
      '<p>' + (win ? 'Zdobyłeś ' + E.winVillages(s) + ' wiosek i zdominowałeś mapę. Możesz grać dalej albo zacząć nową kampanię.'
        : 'Straciłeś ostatnią wioskę. Spróbuj ponownie – tym razem z mocniejszą obroną.') + '</p>' +
      '<div class="actions">' + (win ? '<button class="btn ghost" data-act="close">Graj dalej</button>' : '') +
      '<button class="btn" data-act="new-game-now">Nowa gra</button></div></div>';
  }

  /* ---------- okna ---------- */
  function openModal(type, data) {
    UI.modal = Object.assign({ type }, data || {});
    renderModal();
  }
  function renderModal() {
    const box = $('#modal');
    if (!UI.modal) { box.hidden = true; box.innerHTML = ''; return; }
    let inner = '';
    const s = st();
    if (UI.modal.type === 'attack') inner = attackModal();
    else if (UI.modal.type === 'spy') inner = spyModal();
    else if (UI.modal.type === 'transport') inner = transportModal();
    else if (UI.modal.type === 'support') inner = supportModal();
    else if (UI.modal.type === 'settle') inner = settleModal();
    else if (UI.modal.type === 'gather') inner = gatherModal();
    else if (UI.modal.type === 'troops') inner = troopsModal();
    else if (UI.modal.type === 'report') inner = reportModal(s.reports.find(r => r.id === UI.modal.id));
    else if (UI.modal.type === 'menu') inner = menuModal();
    else if (UI.modal.type === 'newgame') inner = newGameModal();
    else if (UI.modal.type === 'end') inner = endModal();
    else if (UI.modal.type === 'confirm') inner = '<h2>' + UI.modal.title + '</h2><p>' + UI.modal.text + '</p><div class="actions">' +
      '<button class="btn ghost" data-act="close">Anuluj</button><button class="btn danger" data-act="' + UI.modal.ok + '">' + UI.modal.okLabel + '</button></div>';
    box.innerHTML = '<div class="dialog" role="dialog" aria-modal="true">' + inner + '</div>';
    box.hidden = false;
    if (UI.modal.type === 'attack') updateAttackSummary();
    updateFormSummary();
    updateGatherPlan();
    updateTroopsPlan();
    const first = box.querySelector('input:not([disabled]), button');
    if (first && !['attack', 'spy', 'transport', 'settle', 'support', 'gather', 'troops'].includes(UI.modal.type)) first.focus({ preventScroll: true });
  }
  function closeModal() {
    const wasEnd = UI.modal && UI.modal.type === 'end';
    UI.modal = null;
    renderModal();
    if (wasEnd) st().ended.seen = true;
  }

  /* ---------- panel boczny (komputer) ---------- */
  function renderAside() {
    const s = st(), el = $('#aside');
    if (!el || getComputedStyle(el).display === 'none') return;
    const own = E.villagesOf(s, 'player');
    const mv = playerMovements(s);
    const pw = E.accountPower(s, 'player');
    const sig = JSON.stringify([own.map(v => v.id + E.points(v)), pw.total, mv.map(m => m.id), Object.values(s.factions).map(f => E.villagesOf(s, f.id).length)]);
    if (UI.sigs.aside === sig) return;
    UI.sigs.aside = sig;
    let html = '<section class="panel"><h2>Imperium</h2><p>' + own.length + ' z ' + E.winVillages(s) + ' wiosek</p>' +
      '<div class="goal"><i style="width:' + Math.min(100, own.length / E.winVillages(s) * 100) + '%"></i></div>' +
      '<p class="tags"><span>Moc: ' + fmt(pw.total) + ' pkt</span><span>Atak ' + fmt(pw.attack) + '</span><span>Obrona ' + fmt(pw.defense) + '</span></p>' +
      '<ul class="vlist">' + own.map(v => '<li><button class="link" data-act="goto" data-id="' + v.id + '">' + esc(v.name) + '</button> <span class="muted">' + xy(v.x, v.y) + ', ' + E.points(v) + ' pkt</span></li>').join('') + '</ul></section>';
    html += '<section class="panel"><h2>Ruchy wojsk</h2>' + (mv.length ? '<ul class="mvlist compact">' + mv.slice(0, 8).map(m => movementItem(s, m)).join('') + '</ul>'
      : '<p class="muted">Brak ruchów wojsk.</p>') + '</section>';
    html += '<section class="panel"><h2>Frakcje</h2><ul class="vlist">' + Object.values(s.factions).map(f =>
      '<li><span class="flag" style="--fc:' + f.color + '"></span>' + esc(f.name) + ' <span class="muted">' + E.villagesOf(s, f.id).length + ' wiosek</span></li>').join('') + '</ul></section>';
    el.innerHTML = html;
  }

  /* ---------- liczniki i paski postępu ---------- */
  // Postęp liczony z bieżącego zegara – pasek ma od razu właściwą szerokość i rośnie płynnie.
  function pct(a, b, now) {
    now = now == null ? Date.now() : now;
    const p = b > a ? Math.max(0, Math.min(1, (now - a) / (b - a))) : 1;
    return (p * 100).toFixed(2);
  }
  function updateBars() {
    const now = Date.now();
    document.querySelectorAll('[data-pe]').forEach(el => { el.style.width = pct(Number(el.dataset.ps), Number(el.dataset.pe), now) + '%'; });
  }
  function updateTimers() {
    const now = st().now;
    document.querySelectorAll('[data-end]').forEach(el => { el.textContent = dur(Number(el.dataset.end) - now); });
    updateBars();
  }
  let barsLoop = false;
  function startBarsLoop() {
    if (barsLoop) return;
    barsLoop = true;
    let last = 0;
    const frame = ts => {
      if (!document.hidden && ts - last > 50) { last = ts; updateBars(); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* ---------- powiadomienia ---------- */
  // Wyskakujące powiadomienia są wyłączone (zasłaniały grę). Zostaje tylko komunikat o błędzie akcji
  // wewnątrz otwartego okna, żeby nieudana wysyłka nie wyglądała jak brak reakcji.
  function toast(kind, text) {
    if (kind !== 'bad' || !UI.modal) return;
    const dlg = document.querySelector('#modal .dialog');
    if (!dlg) return;
    let el = dlg.querySelector('.modal-err');
    if (!el) {
      el = document.createElement('p');
      el.className = 'why modal-err'; el.setAttribute('role', 'alert');
      dlg.insertBefore(el, dlg.querySelector('.actions:last-of-type'));
    }
    el.textContent = text;
  }
  function drainNotices() {
    const s = st();
    return s.notices.splice(0);
  }

  /* ---------- główny render ---------- */
  function render() {
    const s = st();
    if (!s) return;
    renderHeader();
    renderNav();
    document.querySelectorAll('.screen').forEach(el => { el.hidden = el.id !== 'screen-' + UI.screen; });
    if (UI.screen === 'village') renderVillage();
    else if (UI.screen === 'army') renderArmy();
    else if (UI.screen === 'reports') renderReports();
    else if (UI.screen === 'overview' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#screen-overview'))) renderOverview();
    else if (UI.screen === 'map') renderMap(false);
    renderAside();
    updateTimers();
    if (UI.modal && UI.modal.type === 'attack') updateAttackSummary();
    if (UI.modal) updateFormSummary();
    if (s.ended && !s.ended.seen && !UI.modal) openModal('end');
  }

  // Telefon: panel szczegółów wysuwa się od dołu – wybrane pole ma zostać widoczne nad nim.
  function revealSelected() {
    const sheet = $('#mapDetails'), vp = $('#mapViewport');
    if (!UI.sel || window.innerWidth > 760 || !sheet.classList.contains('open')) { MP.Map.revealAbove(0, 0, 0); return; }
    const vpRect = vp.getBoundingClientRect();
    const sheetTop = window.innerHeight - $('.nav').offsetHeight - sheet.offsetHeight;
    MP.Map.revealAbove(UI.sel.x, UI.sel.y, Math.max(0, vpRect.bottom - sheetTop));
  }
  function switchVillage(id) {
    const s = st();
    if (!s.villages[id] || s.villages[id].owner !== 'player') return;
    if (UI.vid !== id) {
      UI.vid = id; UI.recruit = {};
      invalidate(); render();
      toast('info', 'Aktywna wioska: ' + s.villages[id].name + ' ' + xy(s.villages[id].x, s.villages[id].y));
    }
  }
  function stepVillage(dir) {
    const own = E.villagesOf(st(), 'player').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    if (own.length < 2) return;
    const i = Math.max(0, own.findIndex(o => o.id === UI.vid));
    const next = own[(i + dir + own.length) % own.length];
    switchVillage(next.id);
    if (UI.screen === 'map') MP.Map.centerOn(next.x, next.y);
  }

  function show(screen) {
    UI.screen = screen;
    document.body.classList.toggle('on-map', screen === 'map' || screen === 'overview');
    UI.sigs = {};
    render();
    if (screen === 'map') {
      requestAnimationFrame(() => {
        if (!MP.Map.view.fitted) { const v = cur() || { x: 7, y: 7 }; MP.Map.fit(v.x, v.y); }
        else { MP.Map.clamp(); MP.Map.apply(); }
      });
    }
    $('#main').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function invalidate() { UI.sigs = {}; }

  /* ---------- obsługa zdarzeń ---------- */
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function onClick(e) {
    const scr = e.target.closest('[data-screen]');
    if (scr) { show(scr.dataset.screen); return; }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const G = MP.Game, act = b.dataset.act;
    switch (act) {
      case 'build': {
        const r = G.action(s => E.queueBuild(s, cur(), b.dataset.k, s.now));
        if (!r.ok) toast('bad', r.reason);
        break;
      }
      case 'rmax': {
        const info = E.recruitInfo(st(), cur(), b.dataset.u);
        UI.recruit[b.dataset.u] = info.max;
        const inp = document.querySelector('[data-rin="' + b.dataset.u + '"]');
        if (inp) inp.value = info.max;
        break;
      }
      case 'rstep': {
        const u = b.dataset.u, inp = document.querySelector('[data-rin="' + u + '"]');
        const max = E.recruitInfo(st(), cur(), u).max;
        const n = Math.max(0, Math.min(max, (Math.floor(Number(inp.value) || 0)) + Number(b.dataset.d)));
        inp.value = n || ''; UI.recruit[u] = inp.value;
        break;
      }
      case 'recruit': {
        const u = b.dataset.u;
        const inp = document.querySelector('[data-rin="' + u + '"]');
        const n = Math.floor(Number(inp && inp.value) || 0);
        const r = G.action(s => E.queueRecruit(s, cur(), u, n, s.now));
        if (r.ok) { UI.recruit[u] = ''; toast('info', 'Rekrutacja: ' + n + ' × ' + C.UNITS[u].name); }
        else toast('bad', r.reason);
        if (inp) inp.blur();
        UI.sigs.army = null; render();
        break;
      }
      case 'filter': UI.filter = b.dataset.f; render(); break;
      case 'read-all': G.action(s => { s.reports.forEach(r => { r.read = true; }); }); break;
      case 'clear-reports':
        openModal('confirm', { title: 'Usunąć wszystkie raporty?', text: 'Tej operacji nie można cofnąć.', ok: 'clear-reports-ok', okLabel: 'Usuń raporty' });
        break;
      case 'clear-reports-ok': G.action(s => { s.reports = []; }); closeModal(); break;
      case 'report': {
        const id = b.dataset.id;
        G.action(s => { const r = s.reports.find(x => x.id === id); if (r) r.read = true; });
        openModal('report', { id });
        break;
      }
      case 'show-on-map':
        closeModal();
        UI.sel = { x: Number(b.dataset.x), y: Number(b.dataset.y) };
        show('map');
        requestAnimationFrame(() => MP.Map.centerOn(UI.sel.x, UI.sel.y));
        break;
      case 'goto':
        UI.vid = b.dataset.id; UI.recruit = {};
        show('village');
        break;
      case 'deselect': UI.sel = null; MP.Map.setSelected(null); renderDetails(); MP.Map.revealAbove(0, 0, 0); break;
      case 'zoom-in': MP.Map.zoomBy(1.25); break;
      case 'vprev': stepVillage(-1); break;
      case 'vnext': stepVillage(1); break;
      case 'activate': switchVillage(b.dataset.id); break;
      case 'grid-toggle': MP.Map.toggleGrid(); break;
      case 'zoom-out': MP.Map.zoomBy(0.8); break;
      case 'center': { const v = cur(); if (v) MP.Map.centerOn(v.x, v.y); break; }
      case 'attack-open':
        UI.atk = {};
        openModal('attack', { target: b.dataset.id, from: UI.vid });
        break;
      case 'amax': {
        const k = b.dataset.u, from = st().villages[UI.modal.from];
        UI.atk[k] = from.units[k];
        document.querySelector('[data-ain="' + k + '"]').value = from.units[k];
        updateAttackSummary();
        break;
      }
      case 'aall': {
        const from = st().villages[UI.modal.from];
        E.UNITS.filter(k => k !== 'settler' && k !== 'scout').forEach(k => { UI.atk[k] = from.units[k] || ''; const i = document.querySelector('[data-ain="' + k + '"]'); if (i) i.value = UI.atk[k]; });
        updateAttackSummary();
        break;
      }
      case 'anone':
        UI.atk = {};
        document.querySelectorAll('[data-ain]').forEach(i => { i.value = ''; });
        updateAttackSummary();
        break;
      case 'send-attack': {
        const m = UI.modal;
        const r = G.action(s => E.sendAttack(s, m.from, m.target, attackUnits(), s.now));
        if (r.ok) {
          toast('info', 'Wojsko wyruszyło. Przybycie za ' + dur(r.movement.arrive - st().now) + '.');
          UI.atk = {};
          closeModal();
          invalidate(); render();
        } else toast('bad', r.reason);
        break;
      }
      case 'spy-open': UI.form = {}; openModal('spy', { target: b.dataset.id, from: UI.vid }); break;
      case 'support-open': UI.form = {}; openModal('support', { target: b.dataset.id, from: UI.vid }); break;
      case 'withdraw': {
        const r = G.action(s => E.withdrawSupport(s, b.dataset.host, b.dataset.origin, s.now));
        if (r.ok) toast('info', 'Wsparcie wraca do domu. Powrót za ' + dur(r.movement.arrive - st().now) + '.'); else toast('bad', r.reason);
        UI.sigs = {}; render();
        break;
      }
      case 'smode': UI.form.mode = b.dataset.m; renderModal(); break;
      case 'support-from': UI.form = {}; openModal('support', { target: b.dataset.id, from: UI.vid }); break;
      case 'fall': {
        const from = st().villages[UI.modal.from];
        E.UNITS.forEach(k => { UI.form[k] = from.units[k] || ''; const i = document.querySelector('[data-fin="' + k + '"]'); if (i) i.value = UI.form[k]; });
        updateFormSummary();
        break;
      }
      case 'fnone':
        UI.form = {};
        document.querySelectorAll('[data-fin]').forEach(i => { i.value = ''; });
        updateFormSummary();
        break;
      case 'transport-open': UI.form = {}; openModal('transport', { target: b.dataset.id, from: UI.vid }); break;
      case 'gather-open': UI.gather = gatherDefaults(UI.vid || (cur() && cur().id)); openModal('gather'); break;
      case 'gather-mode': UI.gather.mode = b.dataset.m; renderModal(); break;
      case 'gather-send': {
        const g = UI.gather;
        const r = G.action(s => E.sendGather(s, E.planGather(s, g.target, gatherArgs(g), s.now), s.now));
        if (r.ok) {
          const n = r.sent.length;
          toast('info', 'Wysłano ' + n + ' transport' + (n === 1 ? '' : n < 5 ? 'y' : 'ów') + ' (' + fmt(r.total) + ' surowców). Pierwsza dostawa za ' + dur(r.first - st().now) + '.' +
            (r.failed.length ? ' Pominięto: ' + r.failed.length + '.' : ''));
          UI.gather = null;
          closeModal(); invalidate(); render();
        } else toast('bad', r.reason);
        break;
      }
      case 'troops-open': UI.troops = troopsDefaults(UI.vid || (cur() && cur().id)); openModal('troops'); break;
      case 'troops-mode': UI.troops.mode = b.dataset.m; renderModal(); break;
      case 'troops-send': {
        const g = UI.troops;
        const r = G.action(s => E.sendTroops(s, E.planTroops(s, g.target, troopsArgs(g), s.now), s.now));
        if (r.ok) {
          UI.troops = null;
          closeModal(); invalidate(); render();
        } else toast('bad', r.reason);
        break;
      }
      case 'settle-open': UI.form = {}; openModal('settle', { x: Number(b.dataset.x), y: Number(b.dataset.y), from: UI.vid }); break;
      case 'fmax': {
        UI.form[b.dataset.k] = b.dataset.v;
        const i = document.querySelector('[data-fin="' + b.dataset.k + '"]');
        if (i) i.value = b.dataset.v;
        updateFormSummary();
        break;
      }
      case 'send-spy': case 'send-transport': case 'send-settle': case 'send-support': {
        const m = UI.modal;
        const r = G.action(s => act === 'send-support' ? E.sendSupport(s, m.from, m.target, formUnits(), s.now, UI.form.mode || 'support')
          : act === 'send-spy' ? E.sendSpy(s, m.from, m.target, UI.form.scout, s.now)
          : act === 'send-transport' ? E.sendTransport(s, m.from, m.target, formRes(), s.now)
          : E.sendSettler(s, m.from, m.x, m.y, s.now));
        if (r.ok) {
          toast('info', (act === 'send-support' ? (UI.form.mode === 'stay' ? 'Wojsko wyruszyło' : 'Wsparcie wyruszyło') : act === 'send-spy' ? 'Zwiadowcy wyruszyli' : act === 'send-transport' ? 'Kupcy wyruszyli' : 'Osadnik wyruszył') +
            '. Na miejscu za ' + dur(r.movement.arrive - st().now) + '.');
          UI.form = {};
          closeModal(); invalidate(); render();
        } else toast('bad', r.reason);
        break;
      }
      case 'menu': openModal('menu'); break;
      case 'close': closeModal(); break;
      case 'export': {
        const d = new Date();
        download('mini-plemiona-zapis-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json', MP.DB.serialize(st()));
        toast('info', 'Pobrano kopię zapisu.');
        break;
      }
      case 'import': $('#importFile').click(); break;
      case 'new-game': openModal('newgame', { diff: st().difficulty, world: st().world || C.DEFAULT_WORLD }); break;
      case 'pick-diff': UI.modal.diff = b.dataset.d; renderModal(); break;
      case 'pick-world': UI.modal.world = b.dataset.w; renderModal(); break;
      case 'set-diff':
        G.action(s => { s.difficulty = b.dataset.d; });
        toast('info', 'Poziom trudności: ' + C.DIFFICULTY[b.dataset.d].label + '.');
        renderModal();
        break;
      case 'new-game-now': {
        const d = UI.modal && UI.modal.diff, w = UI.modal && UI.modal.world;
        closeModal();
        G.newGame(d, w);
        break;
      }
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.dataset.rin) UI.recruit[t.dataset.rin] = t.value;
    if (t.dataset.ain) { UI.atk[t.dataset.ain] = t.value; updateAttackSummary(); }
    if (t.dataset.fin) { UI.form[t.dataset.fin] = t.value; updateFormSummary(); }
    if (t.hasAttribute && t.hasAttribute('data-treserve')) { UI.troops.reserve = Math.max(0, Math.min(100, Number(t.value) || 0)); updateTroopsPlan(); }
    if (t.hasAttribute && t.hasAttribute('data-greserve')) { UI.gather.reserve = Math.max(0, Math.min(100, Number(t.value) || 0)); updateGatherPlan(); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'villageSelect') { UI.vid = t.value; UI.recruit = {}; invalidate(); render(); }
    else if (t.id === 'atkFrom') { UI.modal.from = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-from')) { UI.modal.from = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-ttarget')) { UI.troops.target = t.value; UI.troops.off = {}; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-tstay')) { UI.troops.stay = t.value === '1'; renderModal(); }
    else if (t.dataset && t.dataset.tunit) { UI.troops.units[t.dataset.tunit] = t.checked; updateTroopsPlan(); }
    else if (t.dataset && t.dataset.tsrc) { if (t.checked) delete UI.troops.off[t.dataset.tsrc]; else UI.troops.off[t.dataset.tsrc] = true; updateTroopsPlan(); }
    else if (t.hasAttribute && t.hasAttribute('data-tcap')) { UI.troops.capToRoom = t.checked; updateTroopsPlan(); }
    else if (t.hasAttribute && t.hasAttribute('data-gtarget')) { UI.gather.target = t.value; UI.gather.off = {}; renderModal(); }
    else if (t.dataset && t.dataset.gres) { UI.gather.res[t.dataset.gres] = t.checked; updateGatherPlan(); }
    else if (t.dataset && t.dataset.gsrc) { if (t.checked) delete UI.gather.off[t.dataset.gsrc]; else UI.gather.off[t.dataset.gsrc] = true; updateGatherPlan(); }
    else if (t.hasAttribute && t.hasAttribute('data-gcap')) { UI.gather.capToRoom = t.checked; updateGatherPlan(); }
    else if (t.id === 'importFile' && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        MP.Game.importText(String(reader.result))
          .then(() => { closeModal(); toast('good', 'Wczytano zapis gry.'); })
          .catch(err => toast('bad', 'Nie wczytano zapisu: ' + err.message));
      };
      reader.readAsText(t.files[0]);
      t.value = '';
    }
  }
  function onKey(e) {
    const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (!typing && !UI.modal && (e.key === '[' || e.key === ']')) { stepVillage(e.key === ']' ? 1 : -1); return; }
    if (e.key === 'Escape' && UI.modal && UI.modal.type !== 'end') closeModal();
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.rin) {
      const btn = document.querySelector('[data-act="recruit"][data-u="' + e.target.dataset.rin + '"]');
      if (btn) btn.click();
    }
  }

  function init() {
    startBarsLoop();
    document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = S.icon(el.dataset.icon); });
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKey);
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && UI.modal.type !== 'end') closeModal(); });
    MP.Map.mount($('#mapViewport'), $('#mapWorld'), $('#minimap'), sel => {
      UI.sel = sel;
      MP.Map.setSelected(sel);
      renderDetails();
      revealSelected();
    }, sel => {
      // dwuklik: własna wioska → staje się aktywna; obca → okno ataku z aktywnej wioski
      const s = st(), t = E.tileAt(s, sel.x, sel.y), v = t.village ? s.villages[t.village] : null;
      if (!v) return;
      if (v.owner === 'player') switchVillage(v.id);
      else if (cur()) { UI.atk = {}; openModal('attack', { target: v.id, from: UI.vid }); }
    });
    if (root.ResizeObserver) {
      new ResizeObserver(() => { if (UI.screen === 'map' && MP.Map.view.fitted) { MP.Map.clamp(); MP.Map.apply(); } }).observe($('#mapViewport'));
    }
    window.addEventListener('resize', () => { if (UI.screen === 'map') { MP.Map.clamp(); MP.Map.apply(); } invalidate(); render(); });
  }

  MP.UI = { init, render, show, toast, drainNotices, invalidate, state: UI, closeModal };
})(typeof window !== 'undefined' ? window : globalThis);
