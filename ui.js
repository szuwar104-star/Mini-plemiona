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
    recruit: {}, atk: {}, form: {}, quick: { ex: '1000', coin: '1', msg: null }, techSel: null, gather: null, troops: null, sigs: {}, modal: null, toastQueue: []
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
  const wall = ts => MP.Game ? MP.Game.wall(ts) : ts;
  function clock(ts) {
    const d = new Date(wall(ts));
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function dayClock(ts) {
    const d = new Date(wall(ts)), now = new Date();
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
    if (!v) { const b0 = $('#resbar'); b0._html = null; b0.innerHTML = '<span class="muted">Brak wiosek</span>'; return; }
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
    // Pasek surowców przebudowujemy tylko, gdy zmieniła się jego treść (inaczej miga co sekundę).
    const bar = $('#resbar');
    if (bar._html !== html) { bar._html = html; bar.innerHTML = html; }
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
      case 'farm': {
        const m = v.owner === 'player' ? E.popMult() : 1;
        return 'Miejsca dla wojska: ' + fmt(Math.floor(B.pop[L] * m)) + (next ? ' → ' + fmt(Math.floor(B.pop[next] * m)) : '');
      }
      case 'wall': return 'Obrona +' + Math.round(B.bonus[L] * 100) + '%' + (next ? ' → +' + Math.round(B.bonus[next] * 100) + '%' : '') +
        ', mur sam broni siłą ' + B.flat[L] + (next ? ' → ' + B.flat[next] : '');
      case 'market': return 'Wymiana surowców (kurs ' + Math.round(E.exchangeRate() * 100) + '%) i zakup monet. Kupcy: ' + B.merchants[L] + (next ? ' → ' + B.merchants[next] : '') + ', każdy wiezie do ' + fmt(E.merchantCap()) + ' surowców';
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

    if (v.buildings.market > 0) html += '<section class="panel quick"><h2>Targowisko – szybkie akcje</h2><div data-quick="village"></div></section>';
    html += '<section class="panel"><h2>Kolejka budowy <small>' + v.buildQueue.length + '/' + E.queueMax(v, 'build') + '</small></h2>';
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
      if (k === 'market' && lv > 0) html += '<button class="btn ghost" data-act="exchange-open">' + ico('merchant') + 'Wymiana i monety</button>';
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
      cls = m.raid ? 'out raid' : 'out'; icon = m.raid ? 'merchant' : 'sword';
      title = (m.raid ? 'Grabież: ' : 'Atak: ') + esc(from.name) + ' → ' + esc(to.name) + ' ' + xy(to.x, to.y);
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
      title = m.bounced ? 'Zawraca do ' + esc(from.name) + ' – ' + esc(to.name) + ' jest już Twoja' : 'Powrót do ' + esc(from.name) + ' z ' + esc(to.name);
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
      '<div class="kpi"><small>Siła ataku</small><b>' + fmt(E.attackPower(v.units, E.upgradesOf(s, v.owner))) + '</b></div>' +
      '<div class="kpi" title="Wojsko w wiosce, wsparcie i mur"><small>Obrona wioski</small><b>' + fmt(E.villageDefense(v, null, E.upgradesOf(s, v.owner))) + '</b></div>' +
      '<div class="kpi" title="Punkty za zniszczone jednostki wroga"><small>Pokonani wrogowie</small><b>' + fmt(Math.round(E.killsOf(s, 'player').total)) + '</b></div>' +
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
      const allBtn = (mode, label, n) => '<button class="btn danger sup-all" data-act="withdraw-all" data-mode="' + mode + '" data-id="' + v.id + '">' + label + ' (' + n + ')</button>';
      if (hosted.length) html += '<div class="sup-head"><h3 class="sub">Broni tej wioski</h3>' + allBtn('hosted', 'Odeślij całe wsparcie', hosted.length) + '</div><ul class="sup-list">' + hosted.map(([o, u]) =>
        row('Z wioski ' + esc(s.villages[o].name) + ' ' + xy(s.villages[o].x, s.villages[o].y), u,
          '<button class="btn ghost" data-act="withdraw" data-host="' + v.id + '" data-origin="' + o + '">Odeślij</button>')).join('') + '</ul>';
      if (abroad.length) html += '<div class="sup-head"><h3 class="sub">Twoje wojsko w innych wioskach</h3>' + allBtn('abroad', 'Odwołaj całe wsparcie', abroad.length) + '</div><ul class="sup-list">' + abroad.map(w =>
        row('W wiosce ' + esc(w.name) + ' ' + xy(w.x, w.y), w.support[v.id],
          '<button class="btn ghost" data-act="withdraw" data-host="' + w.id + '" data-origin="' + v.id + '">Odwołaj</button>')).join('') + '</ul>';
      html += '</section>';
    }

    html += '<section class="panel"><h2>Kolejka rekrutacji <small>' + v.recruitQueue.length + '/' + E.queueMax(v, 'recruit') + '</small></h2>';
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
      html += '<section class="panel"><h2>Wyślij wojsko do swojej wioski</h2><p class="muted">Domyślnie na stałe; w oknie możesz wybrać wsparcie (do odwołania).</p><div class="actions left">' +
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
    const sig = JSON.stringify([own.map(v => [v.id, v.buildQueue.length, v.recruitQueue.length, E.sumUnits(v.units)]), incomingAttacks(s).length, diploOffers(s), UI.vid, Math.floor(s.now / 5000)]);
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
        '<td class="units-cell"><span class="units-wrap">' + unitsLine(v.units) + '</span></td>' +
        '<td>' + (attacks.length ? '<span class="alert">' + ico('sword') + attacks.length + ' <span class="timer" data-end="' + attacks[0].arrive + '"></span></span>' : '') + '</td></tr>';
    }).join('');
    el.innerHTML = '<section class="ov-head panel"><div><h1>Przegląd wiosek</h1><p class="tags"><span>' + own.length + ' z ' + E.winVillages(s) + ' wiosek</span>' +
      (inc.length ? '<span class="warn">Nadciągające ataki: ' + inc.length + '</span>' : '') +
      (diploOffers(s) ? '<span class="warn">Oferty paktów: ' + diploOffers(s) + '</span>' : '') + '</p>' +
      '<div class="actions left"><button class="btn" data-act="gather-open"' + (own.length > 1 ? '' : ' disabled title="Potrzebujesz co najmniej dwóch wiosek"') + '>' + ico('merchant') + 'Zbierz / rozdziel surowce</button>' +
      '<button class="btn" data-act="troops-open"' + (own.length > 1 ? '' : ' disabled title="Potrzebujesz co najmniej dwóch wiosek"') + '>' + ico('spear') + 'Zbierz / rozdziel wojsko</button>' +
      '<button class="btn" data-act="defense-open"' + (own.length > 1 ? '' : ' disabled title="Potrzebujesz co najmniej dwóch wiosek"') + '>' + ico('wall') + 'Wyślij obronę</button>' +
      '<button class="btn" data-act="mass-open">' + ico('barracks') + 'Szkol we wszystkich wioskach</button>' +
      '<button class="btn" data-act="buildall-open">' + ico('hq') + 'Buduj we wszystkich wioskach</button>' +
      '<button class="btn" data-act="auto-open"' + (own.length > 1 ? '' : ' disabled title="Potrzebujesz co najmniej dwóch wiosek"') + '>' + ico('merchant') + 'Konwoje' +
        (s.auto && s.auto.on ? ' <small>(wł.)</small>' : '') + '</button>' +
      '<button class="btn" data-act="tech-open">' + ico('scroll') + 'Technologia</button>' +
      '<button class="btn" data-act="diplo-open">' + ico('scroll') + 'Dyplomacja' + (diploOffers(s) ? ' <small>(' + diploOffers(s) + ')</small>' : '') + '</button></div></div>' +
      '<div class="army-kpis ov-kpis">' + E.RES.map(r => '<div class="kpi"><small>' + C.RESOURCES[r].name + ' razem</small><b>' + fmt(total[r]) + '</b><small>+' + Math.round(prod[r]) + ' / min</small></div>').join('') +
      '<div class="kpi"><small>Wojsko w wioskach</small><b>' + fmt(army) + '</b></div>' +
      '<div class="kpi"><small>Moc konta</small><b>' + fmt(pw.total) + '</b><small>bud. ' + fmt(pw.buildings) + ' + woj. ' + fmt(pw.army) + '</small></div></div></section>' +
      '<section class="panel"><div class="tablewrap"><table class="units ov">' +
      '<thead><tr><th>Wioska</th><th>' + ico('wood') + 'Drewno</th><th>' + ico('clay') + 'Glina</th><th>' + ico('iron') + 'Żelazo</th><th>' + ico('pop') + 'Farma</th><th>Budowa</th><th>Rekrutacja</th><th>Wojsko</th><th>Ataki</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></section>';
  }

  /* ---------- szybkie przyciski: monety i wymiana surowców ---------- */
  const QUICK_EX = [['1000', '1 000'], ['5000', '5 000'], ['half', '50%'], ['max', 'Maks.']];
  const QUICK_COIN = [['1', '1'], ['5', '5'], ['10', '10'], ['max', 'Maks.']];
  const RES_GEN = { wood: 'drewna', clay: 'gliny', iron: 'żelaza' };
  const plVillages = n => n === 1 ? 'wiosce' : 'wioskach';
  const plCoins = n => n === 1 ? 'monetę' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'monety' : 'monet';
  function quickSeg(curMode, opts, act, label) {
    return '<div class="seg s4" role="group" aria-label="' + label + '">' + opts.map(o =>
      '<button class="' + (curMode === o[0] ? 'on' : '') + '" aria-pressed="' + (curMode === o[0]) + '" data-act="' + act + '" data-m="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>';
  }
  function quickMsg(v) {
    const m = UI.quick.msg;
    return m && Date.now() - m.at < 8000 && (m.vid === '*' || m.vid === v.id) ? '<p class="qk-msg" role="status">' + esc(m.text) + '</p>' : '';
  }
  function quickCoinsHtml(v, s, withAll) {
    const mode = UI.quick.coin, tokens = Math.floor(E.mintTokens(v, s.now)), lim = E.mintLimit(v);
    const btns = E.RES.map(r => {
      const q = E.coinQuick(v, r, mode, s.now);
      const lbl = q.count > 0 ? '+' + q.count + ' ' + ico('coin') : 'brak';
      return '<button class="btn qk-btn qk-coinbtn" data-act="qk-coin" data-r="' + r + '"' + (q.ok ? '' : ' disabled') + ' title="Za ' + C.RESOURCES[r].name.toLowerCase() + ' – koszt ' + fmt(q.cost) + '">' +
        '<span class="qk-pay">' + ico(r) + (q.count > 0 ? '<small>' + fmt(q.cost) + '</small>' : '') + '</span><span class="qk-get">' + lbl + '</span></button>';
    }).join('');
    return '<div class="qk-sec"><div class="qk-head"><h3>' + ico('coin') + 'Monety</h3><span class="chip">Masz ' + ico('coin') + fmt(s.factions.player.coins || 0) + '</span></div>' +
      '<p class="muted qk-note">Płacisz surowcem, 1 moneta = ' + fmt(C.TECH.coinPrice) + '. Limit tej wioski: <b>' + tokens + '</b> (+' + lim + '/h).</p>' +
      quickSeg(mode, QUICK_COIN, 'qk-coin-mode', 'Liczba monet') + '<div class="qk-btns">' + btns + '</div>' +
      (withAll ? '<button class="btn ghost qk-all" data-act="qk-coin-all" title="W każdej wiosce z Targowiskiem kupuje maksimum, płacąc jej najobfitszym surowcem">Maks. ze wszystkich wiosek</button>' : '') + '</div>';
  }
  function quickExchangeHtml(v) {
    const mode = UI.quick.ex, s = st();
    const rows = E.RES.map(from => '<div class="qk-row"><span class="qk-from">' + ico(from) + C.RESOURCES[from].name + '</span>' +
      E.RES.filter(to => to !== from).map(to => {
        const q = E.exchangeQuick(v, from, to, mode), fixed = mode === '1000' || mode === '5000';
        const tip = 'Wymień ' + C.RESOURCES[from].name.toLowerCase() + ' → ' + C.RESOURCES[to].name.toLowerCase() + (q.amount ? ': ' + fmt(q.amount) + ' → ' + fmt(q.got) : '');
        return '<button class="btn ghost qk-btn" data-act="qk-ex" data-f="' + from + '" data-t="' + to + '"' + (q.ok ? '' : ' disabled') + ' title="' + tip + '">→ ' + ico(to) +
          (fixed && q.got ? '<small>+' + fmt(q.got) + '</small>' : '') + '</button>';
      }).join('') + '</div>').join('');
    return '<div class="qk-sec"><div class="qk-head"><h3>' + ico('merchant') + 'Wymiana</h3><span class="chip">Kurs ' + Math.round(E.exchangeRate() * 100) + '%</span></div>' +
      '<p class="muted qk-note">Natychmiast, do ' + fmt(E.exchangeMax(v)) + ' naraz (kupcy × udźwig).</p>' +
      quickSeg(mode, QUICK_EX, 'qk-ex-mode', 'Ilość do wymiany') + '<div class="qk-rows">' + rows + '</div></div>';
  }
  function quickHtml(kind, v, s) {
    if (!v) return '';
    if (!((v.buildings.market || 0) > 0)) {
      return '<p class="muted qk-none">Ta wioska nie ma Targowiska – zbuduj je, aby szybko wymieniać surowce i kupować monety.</p>' +
        (kind === 'coins' ? '<button class="btn ghost qk-all" data-act="qk-coin-all">Maks. ze wszystkich wiosek</button>' + quickMsg(v) : '');
    }
    if (kind === 'coins') return quickCoinsHtml(v, s, true) + quickMsg(v);
    return '<div class="qk-grid">' + quickCoinsHtml(v, s, false) + quickExchangeHtml(v) + '</div>' + quickMsg(v);
  }
  // Panel przebudowywany tylko, gdy zmieni się jego treść (co sekundę liczymy HTML, ale DOM ruszamy rzadko).
  function renderQuick() {
    const s = st(), v = cur();
    document.querySelectorAll('[data-quick]').forEach(host => {
      const html = quickHtml(host.dataset.quick, v, s);
      if (host._qh === html) return;
      host._qh = html; host.innerHTML = html;
    });
  }
  // Po przebudowie ekranu fokus klawiatury wraca na ten sam przycisk szybkich akcji / Technologii.
  const FOCUS_KEYS = ['m', 'r', 'f', 't', 'id'];
  function focusDescriptor() {
    const a = document.activeElement;
    return a && a.dataset && /^(qk-|tech-)/.test(a.dataset.act || '') ? Object.assign({}, a.dataset) : null;
  }
  function restoreFocus(d) {
    const a = document.activeElement;
    if (!d || (a && a !== document.body && a.isConnected)) return;
    const sel = '[data-act="' + d.act + '"]' + FOCUS_KEYS.map(k => d[k] ? '[data-' + k + '="' + d[k] + '"]' : '').join('');
    const el = document.querySelector('.screen:not([hidden]) ' + sel);
    if (el && !el.disabled) el.focus({ preventScroll: true });
  }

  /* ---------- ekran: TECHNOLOGIA ---------- */
  const TECH_ICON = { drill: 'barracks', trade: 'market', store: 'hq', agri: 'farm', mint: 'coin', build: 'pick', tools: 'pick', p_wood: 'wood', p_clay: 'clay', p_iron: 'iron', plunder: 'merchant', hide: 'wall',
    admin: 'hq', roads: 'map', medic: 'pop', fort: 'wall', command: 'noble', faith: 'village', militia: 'village', siege: 'ram', tactics: 'map', caravan: 'merchant' };
  function techEffectText(n, lvl, next) {
    const e = n.effect, pc = x => Math.round(x * 1000) / 10;
    const cur = lvl, nxt = next;
    const line = f => f(cur) + (nxt ? ' → ' + f(nxt) : '');
    switch (e.type) {
      case 'unit': return 'Atak i obrona ' + line(l => '+' + pc(l * C.TECH.unitBonus) + '%');
      case 'recruit': return 'Czas szkolenia ' + line(l => '−' + pc(-e.per * l) + '%');
      case 'build': return 'Czas budowy ' + line(l => '−' + pc(-e.per * l) + '%');
      case 'storage': return 'Pojemność magazynów ' + line(l => '+' + pc(e.per * l) + '%');
      case 'exchange': return 'Kurs wymiany ' + line(l => pc(C.MARKET.exchangeRate + e.per * l) + '%');
      case 'prod': return 'Produkcja wszystkich surowców ' + line(l => '+' + pc(e.per * l) + '%');
      case 'prodWood': case 'prodClay': case 'prodIron': return 'Produkcja surowca ' + line(l => '+' + pc(e.per * l) + '%');
      case 'carry': return 'Udźwig łupu ' + line(l => '+' + pc(e.per * l) + '%');
      case 'pop': return 'Miejsce na farmach ' + line(l => '+' + pc(e.per * l) + '%');
      case 'hide': return 'Ukryta część magazynu ' + line(l => '+' + pc(e.per * l) + ' p.p.');
      case 'mint': return 'Limit zakupu monet ' + line(l => '+' + (e.per * l) + '/h na wioskę');
      case 'queue': return 'Kolejka budowy i rekrutacji ' + line(l => '+' + (e.per * l) + ' miejsce');
      case 'march': return 'Czas marszu Twoich wojsk ' + line(l => '−' + pc(Math.min(0.5, -e.per * l)) + '%');
      case 'heal': return 'Ranni wracający z ataków ' + line(l => pc(Math.min(0.3, e.per * l)) + '% poległych');
      case 'fort': return 'Bonus muru ' + line(l => '+' + pc(e.per * l) + '% (mur 10: +' + Math.round(C.BUILDINGS.wall.bonus[C.MAX_LEVEL] * (1 + e.per * l) * 100) + '% obrony)');
      case 'command': return 'Spadek poparcia od Twojego Dowódcy ' + line(l => '+' + (e.per * l) + ' p.p.');
      case 'militia': return 'Stała obrona wioski ' + line(l => '+' + (e.per * l));
      case 'siege': return 'Skuteczność taranów ' + line(l => '+' + pc(e.per * l) + '%');
      case 'caravan': return 'Udźwig kupca ' + line(l => fmt(Math.floor(C.MERCHANT.capacity * (1 + e.per * l))));
      case 'tactics': return 'Złagodzenie pecha w ataku ' + line(l => pc(Math.min(0.8, e.per * l)) + '%');
      case 'faith': return 'Spadek poparcia Twoich wiosek ' + line(l => '−' + pc(Math.min(0.4, e.per * l)) + '%');
    }
    return '';
  }
  const techIcon = n => n.effect.type === 'unit' ? n.effect.unit : (TECH_ICON[n.id] || 'scroll');
  function techPips(n, level) {
    let pips = '';
    for (let i = 1; i <= n.max; i++) pips += '<i class="' + (i <= level ? 'on' : '') + '"></i>';
    return '<span class="pips" style="grid-template-columns:repeat(' + n.max + ',1fr)" aria-hidden="true">' + pips + '</span>';
  }
  // Stan węzła: max – komplet poziomów, ok – można badać, coins – odblokowany, ale brakuje monet, locked – brak wymaganego węzła.
  function techState(info) { return info.code === 'max' ? 'max' : info.ok ? 'ok' : info.code === 'coins' ? 'coins' : 'locked'; }

  function techTile(n, pos, info, coins, sel) {
    const state = techState(info);
    let foot;
    if (state === 'max') foot = '<span class="tt-st done">Maks.</span>';
    else if (state === 'locked') foot = '<span class="tt-st lock">' + info.reason.replace('Wymaga: ', '🔒 ') + '</span>';
    else foot = '<span class="chip' + (coins < info.cost ? ' lack' : '') + '">' + ico('coin') + fmt(info.cost) + '</span>' +
      (state === 'ok' ? '<button class="btn tt-buy" data-act="tech-buy" data-id="' + n.id + '" title="Badaj poz. ' + info.target + ' za ' + fmt(info.cost) + ' monet">Badaj</button>' : '');
    return '<div class="tcell" style="grid-row:' + (pos.row + 1) + ';grid-column:' + (pos.depth * 2 + 1) + ';--d:' + pos.depth + ';order:' + (pos.row * 10 + pos.depth) + '">' +
      '<div class="tt s-' + state + (sel ? ' sel' : '') + '">' +
      '<button class="tt-main" data-act="tech-sel" data-id="' + n.id + '" aria-pressed="' + sel + '"><span class="bicon">' + S.icon(techIcon(n)) + '</span>' +
      '<span class="tt-txt"><span class="tt-top"><b>' + n.name + '</b><span class="lvl">' + info.level + '<small>/' + n.max + '</small></span></span>' + techPips(n, info.level) + '</span></button>' +
      '<div class="tt-foot">' + foot + '</div></div></div>';
  }
  // Układ gałęzi: kolumna = głębokość w drzewku, wiersz = kolejny liść; rodzic stoi w wierszu pierwszego dziecka.
  function techLayout(nodes) {
    const pos = {}, kids = id => nodes.filter(n => (n.req ? n.req.id : null) === id);
    let row = 0, depthMax = 0;
    const place = (n, depth) => {
      depthMax = Math.max(depthMax, depth);
      const ch = kids(n.id);
      ch.forEach(c => place(c, depth + 1));
      pos[n.id] = { depth, row: ch.length ? pos[ch[0].id].row : row++ };
    };
    kids(null).forEach(n => place(n, 0));
    return { pos, rows: row, depths: depthMax + 1 };
  }
  function techLink(n, pos, info) {
    const p = pos[n.req.id], c = pos[n.id], top = Math.min(p.row, c.row), span = Math.abs(p.row - c.row) + 1;
    const py = (p.row - top + .5) / span * 100, cy = (c.row - top + .5) / span * 100;
    const on = info.req && info.req.have >= info.req.min;
    return '<div class="tl' + (on ? ' on' : '') + '" style="grid-column:' + (c.depth * 2) + ';grid-row:' + (top + 1) + '/span ' + span + '" aria-hidden="true">' +
      '<span class="a" style="top:' + py + '%"></span><span class="v" style="top:' + Math.min(py, cy) + '%;height:' + Math.abs(cy - py) + '%"></span><span class="b" style="top:' + cy + '%"></span></div>';
  }
  function techBranchHtml(branch, s, coins) {
    const nodes = C.TECH.nodes.filter(n => n.branch === branch.id), L = techLayout(nodes);
    const cols = new Array(L.depths).fill('minmax(168px,1fr)').join(' 30px ');
    const infos = {}; nodes.forEach(n => { infos[n.id] = E.techInfo(s, n.id); });
    const done = nodes.reduce((a, n) => a + infos[n.id].level, 0), all = nodes.reduce((a, n) => a + n.max, 0);
    return '<section class="panel tech-branch tb-' + branch.id + '"><h2>' + branch.name + '<small>' + done + '/' + all + ' poziomów</small></h2>' +
      '<div class="tech-scroll"><div class="tech-tree" style="grid-template-columns:' + cols + ';grid-template-rows:repeat(' + L.rows + ',1fr)">' +
      nodes.filter(n => n.req).map(n => techLink(n, L.pos, infos[n.id])).join('') +
      nodes.map(n => techTile(n, L.pos[n.id], infos[n.id], coins, UI.techSel === n.id)).join('') + '</div></div></section>';
  }
  function techDetailHtml(s, coins) {
    const n = E.techNode(UI.techSel), info = E.techInfo(s, n.id), state = techState(info);
    const kids = C.TECH.nodes.filter(k => k.req && k.req.id === n.id);
    let toMax = 0;
    for (let l = info.level + 1; l <= n.max; l++) toMax += E.techCost(n, l);
    let req = '';
    if (info.req) {
      const okReq = info.req.have >= info.req.min;
      req = '<p class="td-req ' + (okReq ? 'good' : 'bad') + '">' + (okReq ? '✓' : '✗') + ' Wymaga: ' + info.req.name + ' poz. ' + info.req.min + ' (masz ' + info.req.have + ')</p>';
    }
    let act;
    if (state === 'max') act = '<p class="done">Maksymalny poziom</p>';
    else act = '<div class="tn-buy"><span class="chip' + (coins < info.cost ? ' lack' : '') + '">' + ico('coin') + fmt(info.cost) + '</span>' +
      '<button class="btn" data-act="tech-buy" data-id="' + n.id + '"' + (info.ok ? '' : ' disabled') + '>Badaj poz. ' + info.target + '</button></div>' +
      (state === 'coins' ? '<p class="why">Brakuje ' + fmt(info.cost - coins) + ' monet – kup je poniżej.</p>' : '') +
      (state === 'locked' ? '<p class="why">' + info.reason + '</p>' : '');
    return '<section class="panel tech-detail"><div class="td-top"><div class="bicon">' + S.icon(techIcon(n)) + '</div><div><h2>' + n.name +
      ' <span class="lvl">' + info.level + '<small>/' + n.max + '</small></span></h2><p class="muted">' + n.desc + '</p></div></div>' + techPips(n, info.level) +
      '<p class="effect">' + techEffectText(n, info.level, state === 'max' ? 0 : info.target) + '</p>' + req +
      (kids.length ? '<p class="muted td-kids">Odblokowuje: ' + kids.map(k => k.name + ' (od poz. ' + k.req.min + ')').join(', ') + '</p>' : '') +
      act + (state !== 'max' ? '<p class="muted td-total">Do maksimum: ' + ico('coin') + fmt(toMax) + ' monet</p>' : '') + '</section>';
  }
  function renderTech() {
    const s = st(), el = $('#screen-tech'), f = s.factions.player, coins = f.coins || 0;
    if (UI.techSel && !E.techNode(UI.techSel)) UI.techSel = null; // szczegóły tylko po kliknięciu węzła – bez domyślnego wyboru
    const sig = JSON.stringify([f.coins, f.tech, f.upgrades, UI.techSel]);
    if (UI.sigs.tech === sig) return;
    UI.sigs.tech = sig;
    el.innerHTML = '<section class="panel tech-head"><div><h1>Technologia</h1>' +
      '<p class="muted">Badania płacisz monetami, wspólnymi dla całego plemienia. Kliknij węzeł, aby zobaczyć szczegóły; „Badaj” na kafelku kupuje od razu.</p></div>' +
      '<div class="tech-coins"><span class="chip big">' + ico('coin') + fmt(coins) + '</span></div></section>' +
      '<div class="tech-top">' + (UI.techSel ? techDetailHtml(s, coins) : '') +
      '<section class="panel quick"><h2>Szybki zakup monet<small>aktywna wioska</small></h2><div data-quick="coins"></div></section></div>' +
      C.TECH.branches.map(b => techBranchHtml(b, s, coins)).join('');
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
    if (r.kind === 'attack' && r.raid) return 'Grabież: ' + esc(r.toName) + ' ' + xy(r.toX, r.toY) + ' – ' + (r.attackerWon ? 'udana' : 'porażka');
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

  // Wygląd kroniki: pieczęć z werdyktem (tylko prezentacja, dane bez zmian).
  function reportVerdict(r) {
    const tone = reportTone(r);
    if (r.kind === 'news') return { cls: 'news', label: r.settled ? 'Nowa osada' : r.eliminated ? 'Upadek frakcji' : 'Podbój', sub: 'Kronika świata' };
    if (r.kind === 'spy') return { cls: tone + ' spy', label: r.success ? 'Zwiad udany' : 'Zwiad przepadł', sub: 'Raport zwiadu' };
    if (r.kind === 'spydef') return { cls: tone + ' spy', label: r.success ? 'Wróg przejrzał wioskę' : 'Szpiedzy zatrzymani', sub: 'Wrogi zwiad' };
    if (r.kind === 'attack' && r.raid) return { cls: tone + ' raid', label: r.attackerWon ? 'Udana grabież' : 'Porażka', sub: 'Raport z grabieży' };
    if (r.kind === 'attack') return { cls: tone + (r.conquered ? ' conq' : ''), label: r.conquered ? 'Podbój' : r.attackerWon ? 'Zwycięstwo' : 'Porażka', sub: 'Raport z ataku' };
    return { cls: tone + (r.conquered ? ' conq' : ''), label: r.conquered ? 'Wioska utracona' : r.attackerWon ? 'Obrona przegrana' : 'Obrona udana', sub: 'Raport z obrony' };
  }
  function reportSummary(r, hideDef) {
    const sent = E.sumUnits(r.attUnits), aLoss = E.sumUnits(r.attLoss);
    const dHad = E.sumUnits(r.defUnits), dLoss = E.sumUnits(r.defLoss);
    const loot = r.loot ? r.loot.wood + r.loot.clay + r.loot.iron : 0;
    const cell = (label, val, cls) => '<div class="' + (cls || '') + '"><span>' + label + '</span><b>' + val + '</b></div>';
    let h = '<div class="rsum">' +
      cell('Atakujący – straty', fmt(aLoss) + ' <small>/ ' + fmt(sent) + '</small>', aLoss ? 'bad' : '') +
      cell('Obrońca – straty', hideDef ? '?' : fmt(dLoss) + ' <small>/ ' + fmt(dHad) + '</small>', !hideDef && dLoss ? 'bad' : '') +
      cell(r.kind === 'defense' ? 'Zrabowano' : 'Łup', fmt(loot), loot ? 'gold' : '');
    if (r.loyaltyBefore != null) h += cell('Poparcie', r.loyaltyBefore + '% → ' + (r.loyaltyAfter != null ? r.loyaltyAfter : r.loyaltyBefore) + '%', 'gold');
    return h + '</div>';
  }

  function filteredReports(s) {
    return s.reports.filter(r => UI.filter === 'all' || r.kind === UI.filter || (UI.filter === 'spy' && r.kind === 'spydef'));
  }
  // Przejście do sąsiedniego raportu bez zamykania okna (d = -1 nowszy, +1 starszy).
  function stepReport(d) {
    if (!UI.modal || UI.modal.type !== 'report') return;
    const list = filteredReports(st()), i = list.findIndex(r => r.id === UI.modal.id), n = list[i + d];
    if (!n) return;
    MP.Game.action(s => { const r = s.reports.find(x => x.id === n.id); if (r) r.read = true; }, { allowPaused: true });
    openModal('report', { id: n.id });
    const dlg = document.querySelector('#modal .dialog');
    if (dlg) dlg.scrollTop = 0;
  }

  function renderReports() {
    const s = st(), el = $('#screen-reports');
    const list = filteredReports(s);
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
        '<li><button class="ritem ' + reportTone(r) + ' k-' + r.kind + (r.conquered ? ' conq' : '') + (r.read ? '' : ' unread') + '" data-act="report" data-id="' + r.id + '">' +
        ico(r.kind === 'news' ? (r.settled ? 'settler' : 'noble') : r.kind === 'attack' ? (r.raid ? 'merchant' : 'sword') : r.kind === 'spy' || r.kind === 'spydef' ? 'scout' : 'barracks') +
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
    const vd = reportVerdict(r);
    let html = '<div class="verdict ' + vd.cls + '"><span class="seal" aria-hidden="true"></span><div><small>' + vd.sub + '</small><strong>' + vd.label + '</strong></div></div>' +
      '<h2>' + reportTitle(s, r) + '</h2><p class="muted">' + new Date(wall(r.time)).toLocaleString('pl-PL') + '</p>';
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
        reportSummary(r, hideDef) + reportUnitsTable(r, hideDef);
      if (hideDef && !r.healed) html += '<p class="muted">Nikt nie wrócił z bitwy – brak informacji o obrońcach.</p>';
      if (r.healed) html += '<p>Lazaret: <b>' + fmt(r.healed) + '</b> rannych wraca do zdrowia zamiast zginąć.</p>';
      html += '<p>Szczęście atakującego: ' + (r.luck > 0 ? '+' : '') + r.luck + '%</p>';
      if (r.killPts) {
        const mine = r.attacker === 'player' ? r.killPts.att : r.defender === 'player' ? r.killPts.def : null;
        const theirs = r.attacker === 'player' ? r.killPts.def : r.defender === 'player' ? r.killPts.att : null;
        if (mine != null) html += '<p>Punkty za pokonanych: <b class="ok">+' + fmt(Math.round(mine)) + '</b>' + (theirs ? ' <span class="muted">(wróg zyskał +' + fmt(Math.round(theirs)) + ')</span>' : '') + '</p>';
      }
      if (r.wallBefore) html += '<p>Mur obronny: poziom ' + r.wallBefore + (r.wallFight < r.wallBefore ? ', w bitwie osłabiony taranami do ' + r.wallFight : '') +
        (r.wallAfter < r.wallBefore ? '. Tarany zburzyły go do poziomu ' + r.wallAfter + '.' : '.') + '</p>';
      if (r.hadSupport) html += '<p class="muted">W obronie walczyło też wsparcie z innych wiosek – straty liczone łącznie.</p>';
      const lootSum = r.loot.wood + r.loot.clay + r.loot.iron;
      if (lootSum > 0) {
        html += '<p>' + (r.kind === 'defense' ? 'Wróg zrabował: ' : 'Łup: ') + E.RES.map(rs => ico(rs) + fmt(r.loot[rs])).join(' ') +
          (r.lootCapacity ? ' <span class="muted">(udźwig oddziału: ' + fmt(r.lootCapacity) + ')</span>' : '') + '</p>';
      } else if (r.stayed) {
        html += '<p>' + (r.attacker === 'player' ? 'Twoje wojsko' : 'Wojsko zdobywcy') + ' (' + fmt(r.stayed) + ' jedn.) zostało w przejętej wiosce, surowce zostały na miejscu.</p>';
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
    const list = filteredReports(s), idx = list.findIndex(x => x.id === r.id);
    const nav = '<div class="rnav"><button class="btn ghost" data-act="report-prev"' + (idx > 0 ? '' : ' disabled') + ' aria-label="Nowszy raport">‹ Nowszy</button>' +
      '<span class="muted">' + (idx + 1) + ' / ' + list.length + '</span>' +
      '<button class="btn ghost" data-act="report-next"' + (idx >= 0 && idx < list.length - 1 ? '' : ' disabled') + ' aria-label="Starszy raport">Starszy ›</button></div>';
    html = nav + html;
    const tgt = s.villages[r.to];
    const again = r.kind === 'attack' && r.raid && tgt && tgt.owner === null
      ? '<button class="btn" data-act="raid-again" data-id="' + r.id + '">' + ico('merchant') + 'Powtórz grabież</button>' : '';
    html += '<div class="actions">' + again + '<button class="btn ghost" data-act="show-on-map" data-x="' + r.toX + '" data-y="' + r.toY + '">Pokaż na mapie</button>' +
      '<button class="btn" data-act="close">Zamknij</button></div>' + nav;
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
    el.innerHTML = '<details><summary>Legenda</summary><div class="legend-body">' +
      fs.map(f => '<span><i class="flag" style="--fc:' + f.color + '"></i>' + (f.id === 'player' ? 'Ty' : esc(f.name)) + '</span>').join('') +
      '<span><i class="flag" style="--fc:#8a6b4d"></i>Wolne osady</span></div></details>';
  }

  function renderDetails() {
    const s = st(), el = $('#mapDetails');
    const sel = UI.sel;
    const v0 = cur();
    let sig = 'none:' + (v0 ? v0.id + ':' + E.points(v0) : '');
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
      el.innerHTML = (v0 ? '<div class="md-cur"><span class="md-crest">' + S.icon('hq') + '</span><div><small>Aktywna wioska</small><b>' + esc(v0.name) + ' ' + xy(v0.x, v0.y) + '</b><span class="muted">' + E.points(v0) + ' pkt</span></div>' +
        '<div class="md-act"><button class="btn ghost" data-act="center">Pokaż</button><button class="btn" data-act="select-cur">Szczegóły</button></div></div>' : '') +
        '<p class="muted hint">Kliknij pole, aby zobaczyć szczegóły. Dwuklik na swojej wiosce ustawia ją jako aktywną, a na obcej otwiera okno ataku. Przeciągaj, aby przesuwać mapę.</p>' +
        '<ul class="md-key"><li class="out">Twój atak</li><li class="inc">Wrogi atak</li><li class="sup">Wsparcie</li><li class="ret">Powrót</li><li class="spy">Zwiad</li><li class="trade">Kupcy</li></ul>';
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
    html += '<dt>Poparcie</dt><dd>' + Math.floor(v.loyalty) + '%</dd>';
    if (v.owner === null && v.grown) html += '<dt>Rozwój</dt><dd>+' + v.grown + ' poz. od startu gry</dd>';
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
      const abroad = Object.values(s.villages).filter(w => w.support && w.support[v.id]);
      html += '<p><span class="muted">W wiosce:</span> ' + unitsLine(v.units) + '</p>' +
        (sup ? '<div class="md-sup"><p><span class="muted">Wsparcie:</span> ' + unitsLine(sup) + '</p>' +
          '<button class="btn danger" data-act="withdraw-all" data-mode="hosted" data-id="' + v.id + '">Odeślij całe wsparcie (' + Object.keys(v.support).length + ')</button></div>' : '') +
        (abroad.length ? '<div class="md-sup"><p><span class="muted">Wojsko tej wioski wspiera:</span> ' + abroad.map(w => esc(w.name)).join(', ') + '</p>' +
          '<button class="btn danger" data-act="withdraw-all" data-mode="abroad" data-id="' + v.id + '">Odwołaj całe wsparcie (' + abroad.length + ')</button></div>' : '') +
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
        ? 'Atak: każda wygrana obniża poparcie o ' + C.NEUTRAL.dropMin + '–' + C.NEUTRAL.dropMax + '% (z Dowódcą więcej), przy 0% osada jest Twoja. Grabież: tylko surowce, poparcie bez zmian. Wolne osady same się rozwijają, a ich załoga rośnie.'
        : 'Aby przejąć wioskę, pokonaj obrońców z Dowódcą podboju w armii, aż poparcie spadnie do zera.') + '</p>' +
        '<p class="muted tip">Dwuklik na tej wiosce otwiera okno ataku z ' + esc(v0.name) + '.</p>' +
        '<div class="actions"><button class="btn ghost" data-act="spy-open" data-id="' + v.id + '">' + ico('scout') + 'Zwiad</button>' +
        (v.owner !== null ? '<button class="btn ghost" data-act="diplo-open">' + ico('scroll') + 'Dyplomacja</button>' : '') +
        (v.owner === null ? '<button class="btn" data-act="attack-open" data-mode="raid" data-id="' + v.id + '">' + ico('merchant') + 'Grabież</button>' : '') +
        '<button class="btn danger" data-act="attack-open" data-mode="conquer" data-id="' + v.id + '">' + ico('sword') + 'Atakuj</button></div>';
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
    const raid = target.owner === null && UI.atkMode === 'raid';
    let html = '<h2>' + ico(raid ? 'merchant' : 'sword') + (raid ? 'Grabież: ' : 'Atak na ') + esc(target.name) + ' ' + xy(target.x, target.y) + '</h2>' +
      '<p>' + flag(s, target.owner) + ', ' + E.points(target) + ' pkt</p>' +
      (target.owner === null ? '<div class="seg amode"><button class="btn' + (raid ? ' ghost' : '') + '" data-act="amode" data-m="conquer">' + ico('sword') + 'Podbój</button>' +
        '<button class="btn' + (raid ? '' : ' ghost') + '" data-act="amode" data-m="raid">' + ico('merchant') + 'Grabież</button></div>' : '') +
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
      '<p class="muted">' + (target.owner !== null ? 'Dowódca podboju obniża poparcie tylko wtedy, gdy przeżyje zwycięską bitwę.'
        : raid ? 'Wygrana daje łup do udźwigu ocalałych jednostek, a osada zostaje wolna. Jej załoga odradza się po ' + Math.round(C.NEUTRAL.regenPerHour * 100) + '% na godzinę – można wracać.'
        : 'Wygrana obniża poparcie o ' + C.NEUTRAL.dropMin + '–' + C.NEUTRAL.dropMax + '% (z Dowódcą podboju więcej, dowódca się nie zużywa). Przy 0% osada jest Twoja – zwykle po 2–3 wygranych. Poparcie: ' + Math.floor(target.loyalty) + '%.') + '</p>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn danger" data-act="send-attack">' + (raid ? 'Wyślij grabież' : 'Wyślij atak') + '</button></div>';
    return html;
  }
  // Rodzaj wysyłki wojska do własnej wioski: domyślnie przeniesienie na stałe, wsparcie jako opcja.
  const supMode = () => UI.form.mode || 'stay';
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
      const wall = Math.max(0, wallKnown - Math.floor(E.ramEff(E.ramCount(u), 'player') / C.RAM.fightPerLevel));
      est = fmt(E.defenseFrom(I.units, wall)) + (I.buildings ? (wallKnown ? ' (mur ' + wall + ')' : '') : ' (mur nieznany)');
    }
    box.innerHTML = '<div><span>Siła ataku</span><b>' + fmt(E.attackPower(u, E.upgradesOf(s, 'player'))) + '</b></div>' +
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
      '<p>Kupcy w wiosce ' + esc(from.name) + ': <b>' + E.merchantsFree(s, from) + ' wolnych z ' + E.merchantsTotal(from) + '</b>, każdy wiezie do ' + fmt(E.merchantCap()) + '.</p>' +
      (E.merchantsTotal(from) ? '' : '<p class="why">Ta wioska nie ma Targowiska. Zbuduj je, aby wysyłać surowce.</p>') +
      '<div class="tablewrap"><table class="units atk"><tbody>' + E.RES.map(k =>
        '<tr><td>' + ico(k) + C.RESOURCES[k].name + '</td><td><button class="link" data-act="fmax" data-k="' + k + '" data-v="' + Math.floor(from.res[k]) + '">' + fmt(from.res[k]) + '</button></td>' +
        '<td><input type="number" inputmode="numeric" min="0" step="100" placeholder="0" data-fin="' + k + '" value="' + esc(UI.form[k] || '') + '"></td></tr>').join('') +
      '</tbody></table></div><div id="formSummary" class="summary"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="send-transport">Wyślij kupców</button></div>';
  }
  /* ---------- okno: Targowisko (wymiana surowców i zakup monet) ---------- */
  function exchangeModal() {
    const s = st(), m = UI.modal, v = s.villages[m.from], f = UI.form;
    E.tickVillage(s, v, s.now);
    if (!f.tab) f.tab = 'res';
    if (!f.from) f.from = 'clay';
    if (!f.to) f.to = 'wood';
    if (!f.pay) f.pay = 'clay';
    const tabs = '<div class="seg"><button class="' + (f.tab === 'res' ? 'on' : '') + '" data-act="ex-tab" data-t="res">Wymiana surowców</button>' +
      '<button class="' + (f.tab === 'coin' ? 'on' : '') + '" data-act="ex-tab" data-t="coin">' + ico('coin') + 'Monety</button></div>';
    const pick = (w, cur, act) => E.RES.map(k => '<button class="btn' + (cur === k ? '' : ' ghost') + '" data-act="' + act + '" data-w="' + w + '" data-k="' + k + '">' + ico(k) + C.RESOURCES[k].name + '</button>').join('');
    if (f.tab === 'coin') {
      const have = Math.floor(E.mintTokens(v, s.now)), lim = E.mintLimit(v);
      return '<h2>' + ico('merchant') + 'Targowisko – ' + esc(v.name) + '</h2>' + tabs +
        '<p>1 moneta = ' + fmt(C.TECH.coinPrice) + ' wybranego surowca. Monety są wspólne dla całego plemienia i służą do badań w zakładce Technologia. Masz: <b>' + ico('coin') + fmt(s.factions.player.coins || 0) + '</b>.</p>' +
        '<p class="muted">Płacisz</p><div class="actions left">' + pick('pay', f.pay, 'coin-pick') + '</div>' +
        '<label class="field">Liczba monet (limit teraz: ' + have + ')<span class="inrow"><input type="number" inputmode="numeric" min="0" step="1" placeholder="0" data-fin="coins" value="' + esc(f.coins || '') + '">' +
        '<button class="link" data-act="coin-max">maks.</button></span></label>' +
        '<p class="muted">Limit zakupu w tej wiosce odnawia się o ' + lim + ' monet na godzinę (zapas do ' + lim * C.TECH.mint.bucketHours + '). Wyższy poziom Targowiska i badanie Mennica zwiększają limit.</p>' +
        '<div id="formSummary" class="summary"></div>' +
        '<div class="actions"><button class="btn ghost" data-act="close">Zamknij</button><button class="btn" data-act="coin-buy">Kup monety</button></div>';
    }
    return '<h2>' + ico('merchant') + 'Targowisko – ' + esc(v.name) + '</h2>' + tabs +
      '<p>Za 100 surowca dostajesz ' + Math.round(100 * E.exchangeRate()) + '. Jednorazowo do ' + fmt(E.exchangeMax(v)) + ' (kupcy × udźwig).</p>' +
      '<p class="muted">Oddajesz</p><div class="actions left">' + pick('from', f.from, 'ex-pick') + '</div>' +
      '<p class="muted">Dostajesz</p><div class="actions left">' + pick('to', f.to, 'ex-pick') + '</div>' +
      '<label class="field">Ilość do oddania (masz ' + fmt(v.res[f.from]) + ')<span class="inrow"><input type="number" inputmode="numeric" min="0" step="100" placeholder="0" data-fin="amount" value="' + esc(f.amount || '') + '">' +
      '<button class="link" data-act="ex-max">maks.</button></span></label>' +
      '<div id="formSummary" class="summary"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Zamknij</button><button class="btn" data-act="ex-do">Wymień</button></div>';
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
      '<label class="field">Zostaw w wiosce wysyłającej (% magazynu)<input type="number" inputmode="numeric" min="0" max="100" step="5" placeholder="0" data-greserve value="' + nz(g.reserve) + '"></label></div>' +
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
    let html = '<div class="selbar"><button class="btn ghost" data-act="sel-all" data-w="g" data-on="1">Zaznacz wszystkie</button><button class="btn ghost" data-act="sel-all" data-w="g" data-on="0">Odznacz wszystkie</button></div>' + '<div class="tablewrap"><table class="units gather"><thead><tr><th></th><th>' + (spread ? 'Do wioski' : 'Z wioski') + '</th><th>Surowce</th><th>Kupcy</th><th>Droga</th></tr></thead><tbody>' +
      plan.rows.map(r => {
        const v = s.villages[r.villageId];
        return '<tr class="' + (r.skip ? 'skipped' : '') + '"><td class="g-chk"><input type="checkbox" data-gsrc="' + v.id + '"' + (r.off ? '' : ' checked') + '></td>' +
          '<td class="g-name">' + esc(v.name) + '<small>' + E.dist(v, T).toFixed(1) + ' pola</small></td>' +
          '<td class="g-res">' + (r.skip ? '<span class="muted">' + esc(r.skip) + '</span>' : resLine(r.res)) + '</td>' +
          '<td class="num g-merch" data-l="Kupcy">' + (r.merchants || '') + '</td><td class="num g-time" data-l="Droga">' + (r.skip ? '' : dur(r.time)) + '</td></tr>';
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
    return { target, mode: 'gather', stay: true, units, reserve: 0, capToRoom: true, off: {} };
  }
  /* ustawienia „Wyślij obronę”: tylko jednostki defensywne (role: 'def'), zostaw 90% w wioskach wysyłających */
  function defenseUnits() { const u = {}; E.UNITS.forEach(k => { u[k] = C.UNITS[k].role === 'def'; }); return u; }
  function defenseDefaults(target) {
    const g = troopsDefaults(target); g.units = defenseUnits(); g.reserve = 90; return g;
  }
  function nz(v) { return (v === 0 || v === '0' || v === undefined || v === null) ? '' : esc(v); }
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
        '<option value="1"' + (g.stay ? ' selected' : '') + '>Przeniesienie na stałe (zajmuje farmę)</option>' +
        '<option value="0"' + (g.stay ? '' : ' selected') + '>Wsparcie (można odwołać)</option></select></label>' +
      '<div class="gopts"><div class="field">Jednostki<span class="selbar"><button type="button" class="btn ghost" data-act="tunits-all" data-on="1">Zaznacz wszystkie</button><button type="button" class="btn ghost" data-act="tunits-all" data-on="0">Odznacz wszystkie</button><button type="button" class="btn ghost" data-act="tunits-def">Tylko obrona</button></span><span class="gres ugrid">' + E.UNITS.map(k => '<label class="chk"><input type="checkbox" data-tunit="' + k + '"' + (g.units[k] ? ' checked' : '') + '>' + ico(k) + C.UNITS[k].name + '</label>').join('') + '</span></div>' +
      '<label class="field">Zostaw w wiosce wysyłającej (% wojska)<input type="number" inputmode="numeric" min="0" max="100" step="5" placeholder="0" data-treserve value="' + nz(g.reserve) + '"></label></div>' +
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
    let html = '<div class="selbar"><button class="btn ghost" data-act="sel-all" data-w="t" data-on="1">Zaznacz wszystkie</button><button class="btn ghost" data-act="sel-all" data-w="t" data-on="0">Odznacz wszystkie</button></div>' + '<div class="tablewrap"><table class="units gather"><thead><tr><th></th><th>' + (spread ? 'Do wioski' : 'Z wioski') + '</th><th>Wojsko</th><th>Droga</th></tr></thead><tbody>' +
      plan.rows.map(r => {
        const v = s.villages[r.villageId];
        return '<tr class="' + (r.skip ? 'skipped' : '') + '"><td class="g-chk"><input type="checkbox" data-tsrc="' + v.id + '"' + (r.off ? '' : ' checked') + '></td>' +
          '<td class="g-name">' + esc(v.name) + '<small>' + E.dist(v, T).toFixed(1) + ' pola</small></td>' +
          '<td class="g-res">' + (r.skip ? '<span class="muted">' + esc(r.skip) + '</span>' : unitsLine(r.units)) + '</td>' +
          '<td class="num g-time" data-l="Droga">' + (r.skip ? '' : dur(r.time)) + '</td></tr>';
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
  function massDefaults() {
    const s = st();
    const first = E.UNITS.find(k => k !== 'settler' && k !== 'noble' && E.villagesOf(s, 'player').some(v => E.recruitInfo(s, v, k).code !== 'locked')) || E.UNITS[0];
    return { unit: first, count: '', max: false, off: {} };
  }
  /* ---------- budowa we wszystkich wioskach ---------- */
  function buildAllDefaults() { return { mode: 'tpl', tpl: 'eco', key: 'hq', level: 10, off: {} }; }
  function buildAllItems(g) { return g.mode === 'tpl' ? C.BUILD_TEMPLATES[g.tpl].items : [[g.key, Math.max(1, Math.min(C.MAX_LEVEL, Number(g.level) || 1))]]; }
  function buildAllModal() {
    const g = UI.buildall, tpl = g.mode === 'tpl';
    return '<h2>' + ico('hq') + 'Budowa we wszystkich wioskach</h2>' +
      '<p class="muted">Każda wioska kolejkuje tyle budów, ile zmieści się w kolejce i na ile ją stać – najpierw to, co jest najdalej od celu. Kliknij ponownie później, żeby dołożyć kolejne.</p>' +
      '<div class="seg"><button class="btn' + (tpl ? '' : ' ghost') + '" data-act="ba-mode" data-m="tpl">Szablon</button>' +
      '<button class="btn' + (tpl ? ' ghost' : '') + '" data-act="ba-mode" data-m="one">Jeden budynek</button></div>' +
      (tpl ? '<label class="field">Szablon <select data-batpl>' + Object.keys(C.BUILD_TEMPLATES).map(k => '<option value="' + k + '"' + (k === g.tpl ? ' selected' : '') + '>' +
          C.BUILD_TEMPLATES[k].label + '</option>').join('') + '</select></label><p class="muted seg-note">' + C.BUILD_TEMPLATES[g.tpl].desc + '</p>'
        : '<div class="gopts"><label class="field">Budynek <select data-bakey>' + E.BUILDINGS.map(k => '<option value="' + k + '"' + (k === g.key ? ' selected' : '') + '>' + C.BUILDINGS[k].name + '</option>').join('') + '</select></label>' +
          '<label class="field">Do poziomu <input type="number" inputmode="numeric" min="1" max="' + C.MAX_LEVEL + '" step="1" data-balevel value="' + esc(g.level) + '"></label></div>') +
      '<div id="baPlan"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="buildall-go" id="baGo">Kolejkuj</button></div>';
  }
  function updateBuildAllPlan() {
    const box = $('#baPlan');
    if (!box || !UI.modal || UI.modal.type !== 'buildall') return;
    const s = st(), g = UI.buildall, plan = E.planBuildAll(s, buildAllItems(g), s.now, g.off);
    const cost = { wood: 0, clay: 0, iron: 0 };
    plan.rows.forEach(r => r.items.forEach(it => E.RES.forEach(k => { cost[k] += it.cost[k]; })));
    box.innerHTML = '<div class="selbar"><button class="btn ghost" data-act="sel-all" data-w="b" data-on="1">Zaznacz wszystkie</button><button class="btn ghost" data-act="sel-all" data-w="b" data-on="0">Odznacz wszystkie</button></div>' +
      '<div class="tablewrap"><table class="units gather"><thead><tr><th></th><th>Wioska</th><th>Zakolejkuje</th></tr></thead><tbody>' +
      plan.rows.map(r => {
        const v = s.villages[r.villageId];
        return '<tr class="' + (r.skip && !r.off ? 'skipped' : '') + '"><td class="g-chk"><input type="checkbox" data-bsrc="' + v.id + '"' + (r.off ? '' : ' checked') + '></td>' +
          '<td class="g-name">' + esc(v.name) + '<small>' + xy(v.x, v.y) + '</small></td>' +
          '<td class="g-res">' + (r.items.length ? r.items.map(it => '<span class="uchip">' + ico(S.building[it.key]) + C.BUILDINGS[it.key].name + ' ' + it.level + '</span>').join(' ')
            : '<span class="muted">' + esc(r.skip) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="summary"><div><span>Budów</span><b>' + plan.total + '</b></div><div><span>Wiosek</span><b>' + plan.rows.filter(r => r.items.length).length + '</b></div>' +
      (plan.total ? '<div class="wide"><span>Koszt</span><b>' + E.RES.map(r => ico(r) + fmt(cost[r])).join(' ') + '</b></div>' : '') + '</div>';
    const btn = $('#baGo'); if (btn) { btn.disabled = !plan.total; btn.textContent = plan.total ? 'Kolejkuj (' + plan.total + ')' : 'Kolejkuj'; }
  }

  /* ---------- konwoje ---------- */
  function autoDefaults() {
    const s = st(), a = s.auto || {}, D = C.AUTO.defaults;
    const hubs = E.villagesOf(s, 'player').filter(v => (v.buildings.market || 0) > 0);
    return { on: a.on !== undefined ? a.on : true, hub: a.hub || (hubs[0] && hubs[0].id) || (cur() && cur().id),
      high: a.high || D.high, keep: a.keep !== undefined ? a.keep : D.keep, everyMin: a.everyMin || D.everyMin, coins: a.coins !== undefined ? a.coins : D.coins };
  }
  function autoModal() {
    const s = st(), g = UI.auto, a = s.auto;
    const own = E.villagesOf(s, 'player').sort((x, y) => x.name.localeCompare(y.name, 'pl'));
    const hub = s.villages[g.hub];
    const ago = a && a.last ? Math.round((s.now - a.last.t) / 60000) : null;
    return '<h2>' + ico('merchant') + 'Konwoje – nadwyżki do wioski centralnej</h2>' +
      '<p class="muted">Co jakiś czas wioski z prawie pełnym magazynem same wysyłają kupców z nadwyżką do wybranej wioski. Działa też podczas nieobecności (gra nadrabia czas), nie działa w pauzie.</p>' +
      '<label class="chk big-chk"><input type="checkbox" data-aon' + (g.on ? ' checked' : '') + '>Konwoje włączone</label>' +
      '<label class="field">Wioska centralna <select data-ahub>' + own.map(v => '<option value="' + v.id + '"' + (v.id === g.hub ? ' selected' : '') + '>' + esc(v.name) + ' ' + xy(v.x, v.y) +
        ((v.buildings.market || 0) > 0 ? '' : ' – bez Targowiska') + '</option>').join('') + '</select></label>' +
      '<div class="gopts"><label class="field">Wysyłaj, gdy magazyn ma ponad (%)<input type="number" inputmode="numeric" min="10" max="100" step="5" placeholder="80" data-ahigh value="' + nz(g.high) + '"></label>' +
      '<label class="field">Zostaw w wiosce (% magazynu)<input type="number" inputmode="numeric" min="0" max="90" step="5" placeholder="0" data-akeep value="' + nz(g.keep) + '"></label></div>' +
      '<label class="field">Sprawdzaj co <select data-aevery>' + C.AUTO.everyMin.map(m => '<option value="' + m + '"' + (m === Number(g.everyMin) ? ' selected' : '') + '>' + m + ' min</option>').join('') + '</select></label>' +
      '<label class="chk"><input type="checkbox" data-acoins' + (g.coins ? ' checked' : '') + '>Kupuj monety w wiosce centralnej (maks. limitu, najobfitszym surowcem)</label>' +
      (hub && !((hub.buildings.market || 0) > 0) && g.coins ? '<p class="why">Wioska centralna nie ma Targowiska – monet nie kupi. Wysyłające wioski też potrzebują Targowiska (kupcy).</p>' : '') +
      '<div class="summary"><div><span>Stan</span><b>' + (a && a.on ? 'włączone' : 'wyłączone') + '</b></div>' +
      (a && a.on && a.next ? '<div><span>Następny przegląd</span><b>' + clock(a.next) + '</b></div>' : '') +
      (ago !== null ? '<div class="wide"><span>Ostatnio (' + ago + ' min temu)</span><b>' + (a.last.sent ? a.last.sent + ' konwojów, ' + fmt(a.last.total) + ' surowców' : 'nic do wysłania') +
        (a.last.coins ? ', ' + a.last.coins + ' monet' : '') + '</b></div>' : '') + '</div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="auto-save">Zapisz</button></div>';
  }

  function massModal() {
    const g = UI.mass;
    return '<h2>' + ico('barracks') + 'Szkolenie we wszystkich wioskach</h2>' +
      '<p class="muted">Ta sama jednostka trafia do kolejki w każdej wiosce. Wioska, której nie stać na całą liczbę, szkoli tyle, ile może.</p>' +
      '<label class="field">Jednostka <select data-munit>' + E.UNITS.map(k => '<option value="' + k + '"' + (k === g.unit ? ' selected' : '') + '>' + C.UNITS[k].name + '</option>').join('') + '</select></label>' +
      '<div class="field">Liczba w każdej wiosce<div class="rrow">' +
        '<input type="number" inputmode="numeric" min="1" step="1" placeholder="0" data-mcount value="' + (g.max ? '' : esc(g.count)) + '"' + (g.max ? ' disabled' : '') + '>' +
        '<label class="chk"><input type="checkbox" data-mmax' + (g.max ? ' checked' : '') + '>Maksimum w każdej</label></div></div>' +
      '<div id="massPlan"></div>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn" data-act="mass-go" id="massGo">Szkol</button></div>';
  }
  function updateMassPlan() {
    const box = $('#massPlan');
    if (!box || !UI.modal || UI.modal.type !== 'mass') return;
    const s = st(), g = UI.mass, U = C.UNITS[g.unit];
    const plan = E.planRecruitAll(s, g.unit, { count: g.count, max: g.max, off: g.off }, s.now);
    const active = plan.rows.filter(r => r.n > 0);
    box.innerHTML = '<div class="selbar"><button class="btn ghost" data-act="sel-all" data-w="m" data-on="1">Zaznacz wszystkie</button><button class="btn ghost" data-act="sel-all" data-w="m" data-on="0">Odznacz wszystkie</button></div>' + '<div class="tablewrap"><table class="units gather"><thead><tr><th></th><th>Wioska</th><th>Zrekrutuje</th></tr></thead><tbody>' +
      plan.rows.map(r => {
        const v = s.villages[r.villageId];
        return '<tr class="' + (r.skip && !r.off ? 'skipped' : '') + '"><td class="g-chk"><input type="checkbox" data-msrc="' + v.id + '"' + (r.off ? '' : ' checked') + '></td>' +
          '<td class="g-name">' + esc(v.name) + '<small>' + xy(v.x, v.y) + '</small></td>' +
          '<td class="g-res">' + (r.n > 0 ? '<b>' + fmt(r.n) + '</b> × ' + U.name + (r.short ? ' <small class="muted">(tyle możesz)</small>' : '') : '<span class="muted">' + esc(r.skip) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="summary"><div><span>Razem jednostek</span><b>' + fmt(plan.total) + '</b></div><div><span>Wiosek</span><b>' + active.length + '</b></div>' +
      (plan.total ? '<div class="wide"><span>Koszt</span><b>' + E.RES.map(r => ico(r) + fmt(plan.cost[r])).join(' ') + '</b></div>' : '') + '</div>';
    const btn = $('#massGo'); if (btn) btn.disabled = !active.length;
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
    const mode = supMode();
    let html = '<h2>' + ico('spear') + 'Wojsko do ' + esc(target.name) + ' ' + xy(target.x, target.y) + '</h2>' +
      '<div class="seg" role="radiogroup" aria-label="Rodzaj wysyłki">' +
      '<button role="radio" aria-checked="' + (mode === 'stay') + '" class="' + (mode === 'stay' ? 'on' : '') + '" data-act="smode" data-m="stay">Przeniesienie na stałe</button>' +
      '<button role="radio" aria-checked="' + (mode === 'support') + '" class="' + (mode === 'support' ? 'on' : '') + '" data-act="smode" data-m="support">Wsparcie</button></div>' +
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
      const need = Math.ceil(total / E.merchantCap()), tt = E.merchantTime(from, target);
      const room = E.storageCap(target);
      box.innerHTML = '<div><span>Razem</span><b>' + fmt(total) + '</b></div><div><span>Potrzebni kupcy</span><b>' + need + ' / ' + E.merchantsFree(s, from) + '</b></div>' +
        '<div><span>Czas drogi</span><b>' + dur(tt) + '</b></div><div><span>Dostawa</span><b>' + clock(s.now + tt) + '</b></div>' +
        (need > E.merchantsFree(s, from) ? '<p class="why">Za mało wolnych kupców.</p>' : '') +
        (E.RES.some(k => target.res[k] + r[k] > room) ? '<p class="muted">Magazyn celu mieści ' + fmt(room) + ' – nadwyżka przepadnie.</p>' : '');
    } else if (m.type === 'exchange' && UI.form.tab === 'coin') {
      const n = Math.max(0, Math.floor(Number(UI.form.coins) || 0)), pay = UI.form.pay || 'clay', have = Math.floor(E.mintTokens(from, s.now));
      box.innerHTML = '<div><span>Koszt</span><b>' + fmt(n * C.TECH.coinPrice) + ' ' + C.RESOURCES[pay].name.toLowerCase() + '</b></div><div><span>W magazynie</span><b>' + fmt(from.res[pay]) + '</b></div>' +
        (n > have ? '<p class="why">Limit zakupu w tej wiosce: teraz maksymalnie ' + have + '.</p>' : '') +
        (n * C.TECH.coinPrice > Math.floor(from.res[pay]) ? '<p class="why">Za mało surowca.</p>' : '');
    } else if (m.type === 'exchange') {
      const amount = Math.max(0, Math.floor(Number(UI.form.amount) || 0)), got = E.exchangeGet(amount), room = E.storageCap(from) - Math.floor(from.res[UI.form.to]);
      box.innerHTML = '<div><span>Dostaniesz</span><b>' + fmt(got) + '</b></div><div><span>Miejsce w magazynie</span><b>' + fmt(Math.max(0, room)) + '</b></div>' +
        (got > room ? '<p class="why">Magazyn nie pomieści tyle – zmniejsz ilość.</p>' : '') +
        (amount > E.exchangeMax(from) ? '<p class="why">Jednorazowo maksymalnie ' + fmt(E.exchangeMax(from)) + '.</p>' : '') +
        (amount > Math.floor(from.res[UI.form.from]) ? '<p class="why">Za mało surowca.</p>' : '');
    } else if (m.type === 'support') {
      const target = s.villages[m.target], u = formUnits();
      if (!E.sumUnits(u)) { box.innerHTML = '<p class="muted">Wpisz liczbę jednostek albo kliknij liczbę dostępnych.</p>'; return; }
      const tt = E.travelTime(from, target, u), room = E.supportRoom(s, target), need = E.unitsPop(u);
      const over = E.UNITS.some(k => u[k] > from.units[k]);
      const stay = supMode() === 'stay';
      const combined = E.defenders(target);
      E.UNITS.forEach(k => { combined[k] += u[k]; });
      box.innerHTML = '<div><span>Czas marszu</span><b>' + dur(tt) + '</b></div><div><span>Przybycie</span><b>' + clock(s.now + tt) + '</b></div>' +
        (stay ? '<div><span>Miejsce na farmie celu</span><b>' + fmt(need) + ' / ' + fmt(Math.max(0, room)) + '</b></div>' : '<div><span>Obrona celu po przybyciu</span><b>' + fmt(E.defenseFrom(combined, target.buildings.wall, E.upgradesOf(s, target.owner))) + '</b></div>') +
        (stay && need > room ? '<p class="why">Za mało miejsca na farmie w ' + esc(target.name) + '. Rozbuduj tam Farmę albo wyślij mniej.</p>' : '') +
        (over ? '<p class="why">Wpisano więcej jednostek, niż jest w wiosce.</p>' : '');
    } else if (m.type === 'settle') {
      const u = E.emptyUnits(); u.settler = 1;
      const tt = E.travelTime(from, { x: m.x, y: m.y }, u);
      box.innerHTML = '<div><span>Czas marszu</span><b>' + dur(tt) + '</b></div><div><span>Nowa wioska</span><b>' + clock(s.now + tt) + '</b></div>';
    }
  }

  /* ---------- ranking ---------- */
  const RANK_TABS = [['kills', 'Pokonani'], ['buildings', 'Budynki'], ['villages', 'Wioski']];
  function rankingSection(s) {
    const sort = (UI.modal && UI.modal.sort) || 'kills';
    const rows = E.ranking(s, sort);
    const me = rows.find(r => r.id === 'player');
    const pts = n => fmt(Math.round(n));
    return '<section><h3>Ranking</h3>' +
      '<div class="seg seg3" role="tablist" aria-label="Kategoria rankingu">' + RANK_TABS.map(t =>
        '<button role="tab" aria-selected="' + (t[0] === sort) + '" class="' + (t[0] === sort ? 'on' : '') + '" data-act="rank-sort" data-s="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
      (me ? '<p class="muted seg-note">Twoje miejsce: <b>' + me.rank + '.</b> z ' + rows.length + '. „Pokonani” to punkty za zniszczone jednostki wroga (koszt jednostki / ' + C.SCORE.costDivisor +
        '), osobno w ataku i w obronie.</p>' : '') +
      '<div class="tablewrap"><table class="units rank"><thead><tr><th>#</th><th>Frakcja</th><th>Wioski</th><th>Budynki</th><th>Pokonani</th></tr></thead><tbody>' +
      rows.map(r => '<tr' + (r.id === 'player' ? ' class="me"' : '') + '><td>' + r.rank + '</td><td><span class="flag" style="--fc:' + r.color + '"></span>' + esc(r.name) +
        (r.ai ? ' <span class="muted">' + C.AI.personalities[r.personality].label + '</span>' : '') + (r.alive ? '' : ' <span class="muted">(pokonana)</span>') +
        '<br><small class="muted">atak ' + pts(r.killsAtt) + ' · obrona ' + pts(r.killsDef) + '</small></td>' +
        '<td class="num">' + r.villages + '</td><td class="num">' + fmt(r.buildings) + '</td><td class="num"><b>' + pts(r.kills) + '</b></td></tr>').join('') +
      '<tr><td></td><td><span class="flag" style="--fc:' + C.NEUTRAL.color + '"></span>Wolne osady</td><td class="num">' + E.villagesOf(s, null).length + '</td><td></td><td></td></tr>' +
      '</tbody></table></div></section>';
  }

  /* ---------- dyplomacja ---------- */
  const DIP = () => MP.Diplomacy;
  function diploOffers(s) { const d = s.diplo; return d ? d.offers.filter(o => o.expires > s.now && s.factions[o.from] && s.factions[o.from].alive).length : 0; }
  function diploModal() {
    const s = st(), D = DIP(), d = D.ensure(s), cfg = C.DIPLO, t = s.now;
    const v0 = cur();
    const factions = Object.values(s.factions).filter(f => f.ai && f.alive);
    const left = Math.max(0, Math.round(s.now));
    const offers = d.offers.filter(o => o.expires > t && s.factions[o.from] && s.factions[o.from].alive);
    const myPacts = D.pactsOf(s, 'player', t);
    let html = '<h2>' + ico('scroll') + 'Dyplomacja</h2>' +
      '<p class="muted">Pakt o nieagresji trwa ' + Math.round(cfg.pactMin / 60) + ' h: żadna ze stron nie może wtedy atakować drugiej. Masz ' + myPacts.length + ' z ' + cfg.playerMaxPacts + ' paktów. ' +
      'Wypowiedzenie chroni jeszcze ' + cfg.breakNoticeMin + ' min, a zrywający traci zaufanie wszystkich frakcji. Zwiad pozostaje dozwolony.</p>';
    if (offers.length) {
      html += '<section><h3>Oferty dla Ciebie</h3><ul class="dp-list">' + offers.map(o =>
        '<li class="dp-card"><div class="dp-top"><span>' + flag(s, o.from) + ' <small class="muted">' + (o.renew ? 'proponuje przedłużenie paktu' : 'proponuje pakt o nieagresji') + '</small></span>' +
        '<span class="muted">wygasa za <span class="timer" data-end="' + o.expires + '"></span></span></div>' +
        '<div class="actions left"><button class="btn" data-act="diplo-accept" data-id="' + o.id + '">Przyjmij</button>' +
        '<button class="btn ghost" data-act="diplo-decline" data-id="' + o.id + '">Odrzuć</button></div></li>').join('') + '</ul></section>';
    }
    html += '<section><h3>Frakcje</h3><ul class="dp-list">' + factions.map(f => {
      const att = Math.round(D.attitude(s, f.id, 'player'));
      const pact = D.pactBetween(s, 'player', f.id, t);
      const pend = offers.some(o => o.from === f.id);
      const a = D.assess(s, f.id, 'player', t);
      const others = D.pactsOf(s, f.id, t).map(p => D.partnerOf(p, f.id)).filter(x => x !== 'player');
      const leader = D.isLeader(s, f.id, t);
      let status, btns = '';
      if (pact) {
        status = pact.breakAt != null
          ? '<span class="dp-warn">Pakt wypowiedziany – chroni jeszcze <span class="timer" data-end="' + pact.breakAt + '"></span></span>'
          : '<span class="dp-ok">Pakt o nieagresji: jeszcze <span class="timer" data-end="' + pact.end + '"></span></span>';
        if (pact.breakAt == null) {
          const late = pact.end - t <= cfg.pactMin * 60000 / 2;
          btns += '<button class="btn"' + (late ? '' : ' disabled title="Przedłużenie w drugiej połowie paktu"') + ' data-act="diplo-propose" data-id="' + f.id + '">Przedłuż pakt</button>' +
            '<button class="btn danger" data-act="diplo-break" data-id="' + f.id + '">Wypowiedz pakt</button>';
        }
      } else {
        status = '<span class="muted">Brak paktu</span>';
        btns += '<button class="btn"' + (pend ? ' disabled title="Ta frakcja złożyła Ci już ofertę"' : '') + ' data-act="diplo-propose" data-id="' + f.id + '">Zaproponuj pakt</button>';
      }
      const hint = pact ? '' : pend ? 'Ta frakcja złożyła Ci ofertę.' : a.ok ? 'Skłonna do paktu.' : esc(a.reason) + (a.need ? ' (brakuje ok. ' + a.need + ' pkt nastawienia)' : '');
      const gv = v0 ? [3000, 6000, 12000].map(n => '<button class="btn ghost sm" data-act="diplo-gift" data-id="' + f.id + '" data-n="' + n + '" title="Dar z wioski ' + esc(v0.name) + '">' +
        fmt(n) + ' <small>+' + Math.min(cfg.giftMax, Math.floor(n / cfg.giftPerRes)) + '</small></button>').join('') : '';
      return '<li class="dp-card"><div class="dp-top"><span>' + flag(s, f.id) + ' <small class="muted">' + C.AI.personalities[f.personality].label + ', ' + E.villagesOf(s, f.id).length + ' wiosek</small>' +
        (leader ? ' <span class="dp-warn">lider</span>' : '') + '</span><span>' + D.attitudeLabel(att) + ' <small class="muted">' + (att > 0 ? '+' : '') + att + '</small></span></div>' +
        '<span class="dp-meter"><i style="left:' + ((att + 100) / 2) + '%"></i></span>' +
        '<div class="dp-line">' + status + (others.length ? '<small class="muted"> · w pakcie z: ' + others.map(o => esc(E.ownerName(s, o))).join(', ') + '</small>' : '') + '</div>' +
        (hint ? '<p class="muted dp-hint">' + hint + '</p>' : '') +
        '<div class="actions left">' + btns + '</div>' +
        (gv ? '<div class="dp-gift"><small class="muted">Dar z aktywnej wioski:</small> ' + gv + '</div>' : '') + '</li>';
    }).join('') + '</ul></section>' +
      '<p class="muted seg-note">Nastawienie rośnie, gdy nikogo nie atakujesz, i spada po atakach na daną frakcję (najmocniej po podboju). Frakcja z ' +
      Math.ceil(E.winVillages(s) * cfg.leaderShare) + ' wioskami jest „liderem”: nikt nie zawiera z nią paktu i wszyscy chętniej ją atakują.</p>' +
      '<div class="actions"><button class="btn" data-act="close">Wróć do gry</button></div>';
    return html;
  }

  // W trybie Wyścig: najsilniejsza frakcja AI i jej postęp do celu.
  function raceLeader(s) {
    if (!s.race) return '';
    const top = Object.values(s.factions).filter(f => f.ai && f.alive).map(f => ({ f, n: E.villagesOf(s, f.id).length })).sort((a, b) => b.n - a.n)[0];
    return top ? '<p class="muted seg-note">Wyścig: najdalej jest ' + flag(s, top.f.id) + ' (' + top.n + ' z ' + E.winVillages(s) + ').</p>' : '';
  }
  /* ---------- menu ---------- */
  function menuModal() {
    const s = st();
    const own = E.villagesOf(s, 'player').length;
    return '<h2>Menu</h2>' +
      '<section><h3>Cel gry</h3><p>Zdobądź ' + E.winVillages(s) + ' wiosek. Masz ' + own + '.</p>' +
      '<div class="goal"><i style="width:' + Math.min(100, own / E.winVillages(s) * 100) + '%"></i></div>' + raceLeader(s) + '</section>' +
      '<section><h3>Technologia</h3><p class="muted">Drzewko badań płatne monetami: ulepszenia wojska, magazyny, kurs wymiany.</p>' +
      '<div class="actions left"><button class="btn" data-act="tech-open">' + ico('scroll') + 'Otwórz Technologię</button></div></section>' +
      '<section><h3>Dyplomacja</h3><p class="muted">Pakty o nieagresji z frakcjami, dary i oferty. Pakt chroni obie strony przed atakiem.' +
        (diploOffers(s) ? ' <b>Masz ' + diploOffers(s) + ' ofert do rozpatrzenia.</b>' : '') + '</p>' +
      '<div class="actions left"><button class="btn" data-act="diplo-open">' + ico('scroll') + 'Otwórz Dyplomację</button></div></section>' +
      powerSection(s) +
      rankingSection(s) +
      '<section><h3>Tryb gry</h3>' + racePicker(s.race, 'set-race') + '<p class="muted seg-note">Zmiana działa od razu.</p></section>' +
      '<section><h3>Poziom trudności</h3>' + diffPicker(s.difficulty, 'set-diff') +
      '<p class="muted seg-note">' + E.diff(s).desc + ' Zmiana działa od razu.</p></section>' +
      '<section><h3>Zapis gry</h3><p class="muted">Gra zapisuje się sama. Czas płynie także przy zamkniętej grze – AI rozwija się wtedy dalej. ' +
      'Jeśli chcesz wrócić dokładnie do tego momentu (np. jutro albo na innym urządzeniu), wstrzymaj grę: czas stoi, dopóki jej nie wznowisz.</p>' +
      '<div class="actions left">' + (s.paused ? '<button class="btn" data-act="resume">Wznów grę</button>' : '<button class="btn" data-act="pause">Wstrzymaj grę</button>') +
      (s.paused ? '' : '<button class="btn" data-act="export-pause">Zapisz do pliku i wstrzymaj</button>') +
      '<button class="btn ghost" data-act="export">Pobierz kopię zapisu (JSON)</button>' +
      '<button class="btn ghost" data-act="import">Wczytaj zapis z pliku</button>' +
      '<input type="file" id="importFile" accept=".json,application/json" hidden></div></section>' +
      '<section><h3>Jak grać</h3><ul class="help">' +
      '<li>Surowce rosną same, także gdy gra jest zamknięta. Rozbudowuj Tartak, Cegielnię i Kopalnię.</li>' +
      '<li>Ratusz powiększa magazyn i pozwala budować wyżej. Farma daje miejsce na wojsko.</li>' +
      '<li>Toporniki i kawaleria atakują, pikinierzy bronią. Szybkość oddziału = najwolniejsza jednostka.</li>' +
      '<li>Wolną osadę przejmujesz, wygrywając bitwę. Wioskę frakcji – Dowódcą podboju (Koszary 5).</li>' +
      '<li>Zwiadowcy odkrywają siłę obrony celu. Targowisko pozwala przewozić surowce, a Osadnik zakłada wioski na pustych równinach.</li>' +
      '<li>Mur obronny zwiększa obronę wioski, a tarany go burzą. Wsparcie broni innej Twojej wioski i możesz je odwołać na ekranie Wojsko.</li>' +
      '<li>Technologia (Menu lub Przegląd): badania kupujesz monetami. Monety kupisz w Targowisku za nadmiar surowca.</li>' +
      '<li>Dyplomacja (Menu lub Przegląd): pakt o nieagresji chroni Cię przed frakcją na kilka godzin. Frakcje pamiętają ataki, dary poprawiają ich nastawienie.</li>' +
      '<li>Ekran Przegląd pokazuje wszystkie wioski naraz: surowce, kolejki, wojsko i nadciągające ataki.</li>' +
      '<li>Przez pierwsze ' + E.diff(s).graceMinutes + ' minut frakcje AI Cię nie atakują. ' + Math.round(E.diff(s).lootProtect * 100) + '% pojemności magazynu jest ukryte przed łupieżcami.</li></ul></section>' +
      '<section><h3>Nowa gra</h3><div class="actions left"><button class="btn danger" data-act="new-game">Zacznij od nowa</button></div></section>' +
      '<div class="actions"><button class="btn" data-act="close">Wróć do gry</button></div>';
  }

  // Moc konta gracza: punkty budynków + wojska oraz siła ataku i obrony całej armii.
  function powerSection(s) {
    const p = E.accountPower(s, 'player'), kl = E.killsOf(s, 'player');
    const row = (a, b) => '<tr><td>' + a + '</td><td class="num">' + b + '</td></tr>';
    return '<section><h3>Moc konta</h3><div class="tablewrap"><table class="units pw"><tbody>' +
      row('Wioski', p.villages) + row('Punkty budynków', fmt(p.buildings)) + row('Punkty wojska (' + fmt(p.units) + ' jedn.)', fmt(p.army)) +
      row('Siła ataku', fmt(p.attack)) + row('Siła obrony (bez muru)', fmt(p.defense)) +
      row('Pokonani wrogowie (' + fmt(kl.units) + ' jedn.)', fmt(Math.round(kl.total)) + ' <small class="muted">atak ' + fmt(Math.round(kl.att)) + ' · obrona ' + fmt(Math.round(kl.def)) + '</small>') +
      '<tr class="me"><td><b>Razem</b></td><td class="num"><b>' + fmt(p.total) + '</b></td></tr></tbody></table></div>' +
      '<p class="muted seg-note">Wojsko liczy się razem z oddziałami w marszu i na wsparciu. Punkty jednostki = koszt / ' + C.SCORE.costDivisor + '.</p></section>';
  }

  function diffPicker(current, act) {
    return '<div class="seg seg3" role="radiogroup" aria-label="Poziom trudności">' + Object.entries(C.DIFFICULTY).map(([k, d]) =>
      '<button role="radio" aria-checked="' + (k === current) + '" class="' + (k === current ? 'on' : '') + '" data-act="' + act + '" data-d="' + k + '">' + d.label + '</button>').join('') + '</div>';
  }
  const RACE_MODES = [[false, 'Spokojny', 'Tylko Ty możesz wygrać: zdobądź cel wiosek. AI nie ma celu zwycięstwa.'],
    [true, 'Wyścig', 'Frakcja AI, która pierwsza zdobędzie cel wiosek, wygrywa, a Ty przegrywasz. AI rozwija się szybciej (limit wiosek do celu) i dostajesz ostrzeżenie przy 80% celu.']];
  function racePicker(current, act) {
    return '<div class="seg" role="radiogroup" aria-label="Tryb gry">' + RACE_MODES.map(m =>
      '<button role="radio" aria-checked="' + (m[0] === !!current) + '" class="' + (m[0] === !!current ? 'on' : '') + '" data-act="' + act + '" data-r="' + (m[0] ? 1 : 0) + '">' + m[1] + '</button>').join('') + '</div>' +
      '<p class="muted seg-note">' + RACE_MODES.find(m => m[0] === !!current)[2] + '</p>';
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
      '<h3 class="pick-h">Tryb gry</h3>' + racePicker(UI.modal.race, 'pick-race') +
      '<p class="why">Obecna rozgrywka zostanie usunięta. Jeśli chcesz ją zachować, najpierw pobierz kopię zapisu.</p>' +
      '<div class="actions"><button class="btn ghost" data-act="close">Anuluj</button><button class="btn danger" data-act="new-game-now">Zacznij nową grę</button></div>';
  }

  function endModal() {
    const s = st(), win = s.ended.type === 'victory', by = s.ended.by;
    const title = win ? 'Zwycięstwo!' : by ? 'Przegrałeś wyścig' : 'Twoje plemię upadło';
    const text = win ? 'Zdobyłeś ' + E.winVillages(s) + ' wiosek i zdominowałeś mapę. Możesz grać dalej albo zacząć nową kampanię.'
      : by ? flag(s, by) + ' jako pierwsza zdobyła ' + E.winVillages(s) + ' wiosek. Możesz grać dalej albo zacząć nową kampanię.'
      : 'Straciłeś ostatnią wioskę. Spróbuj ponownie – tym razem z mocniejszą obroną.';
    return '<div class="endgame ' + (win ? 'win' : 'loss') + '">' + S.icon(win ? 'noble' : 'sword') +
      '<h2>' + title + '</h2><p>' + text + '</p>' +
      '<div class="actions">' + (win || by ? '<button class="btn ghost" data-act="close">Graj dalej</button>' : '') +
      '<button class="btn" data-act="new-game-now">Nowa gra</button></div></div>';
  }

  /* ---------- okna ---------- */
  function openModal(type, data) {
    UI.modal = Object.assign({ type }, data || {});
    renderModal();
  }
  function renderModal() {
    const box = $('#modal');
    if (!UI.modal) { box.hidden = true; box.innerHTML = ''; document.body.classList.remove('modal-open'); return; }
    let inner = '';
    const s = st();
    if (UI.modal.type === 'attack') inner = attackModal();
    else if (UI.modal.type === 'spy') inner = spyModal();
    else if (UI.modal.type === 'transport') inner = transportModal();
    else if (UI.modal.type === 'exchange') inner = exchangeModal();
    else if (UI.modal.type === 'support') inner = supportModal();
    else if (UI.modal.type === 'settle') inner = settleModal();
    else if (UI.modal.type === 'gather') inner = gatherModal();
    else if (UI.modal.type === 'troops') inner = troopsModal();
    else if (UI.modal.type === 'mass') inner = massModal();
    else if (UI.modal.type === 'buildall') inner = buildAllModal();
    else if (UI.modal.type === 'auto') inner = autoModal();
    else if (UI.modal.type === 'report') inner = reportModal(s.reports.find(r => r.id === UI.modal.id));
    else if (UI.modal.type === 'menu') inner = menuModal();
    else if (UI.modal.type === 'diplo') inner = diploModal();
    else if (UI.modal.type === 'newgame') inner = newGameModal();
    else if (UI.modal.type === 'end') inner = endModal();
    else if (UI.modal.type === 'confirm') inner = '<h2>' + UI.modal.title + '</h2><p>' + UI.modal.text + '</p><div class="actions">' +
      '<button class="btn ghost" data-act="close">Anuluj</button><button class="btn danger" data-act="' + UI.modal.ok + '">' + UI.modal.okLabel + '</button></div>';
    box.innerHTML = '<div class="dialog' + (UI.modal.type === 'report' ? ' chron' : UI.modal.type === 'attack' ? ' atk' : '') + '" role="dialog" aria-modal="true">' + inner + '</div>';
    box.hidden = false;
    document.body.classList.add('modal-open');
    fitModal();
    if (UI.modal.type === 'attack') updateAttackSummary();
    updateFormSummary();
    updateGatherPlan();
    updateTroopsPlan();
    updateMassPlan();
    updateBuildAllPlan();
    const first = box.querySelector('input:not([disabled]), button');
    if (first && !['attack', 'spy', 'transport', 'settle', 'support', 'gather', 'troops', 'mass'].includes(UI.modal.type)) first.focus({ preventScroll: true });
  }
  // Okno ma zawsze zajmować dokładnie to, co widać na ekranie. Gdy układ strony jest szerszy niż widoczny
  // obszar (przeglądarka w telefonie po powiększeniu / przy poziomym przepełnieniu strony), przypinamy je do visualViewport.
  function fitModal() {
    const box = $('#modal'); if (!box) return;
    const vv = window.visualViewport;
    const off = !box.hidden && vv && (Math.abs(vv.width - document.documentElement.clientWidth) > 1.5 || vv.scale > 1.02);
    if (off) {
      box.style.right = 'auto'; box.style.bottom = 'auto';
      box.style.left = vv.offsetLeft + 'px'; box.style.top = vv.offsetTop + 'px';
      box.style.width = vv.width + 'px'; box.style.height = vv.height + 'px';
    } else {
      box.style.left = box.style.top = box.style.right = box.style.bottom = box.style.width = box.style.height = '';
    }
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
    const sig = JSON.stringify([own.map(v => v.id + E.points(v)), pw.total, mv.map(m => m.id), Object.values(s.factions).map(f => E.villagesOf(s, f.id).length), Math.round(E.killsOf(s, 'player').total)]);
    if (UI.sigs.aside === sig) return;
    UI.sigs.aside = sig;
    let html = '<section class="panel"><h2>Imperium</h2><p>' + own.length + ' z ' + E.winVillages(s) + ' wiosek</p>' +
      '<div class="goal"><i style="width:' + Math.min(100, own.length / E.winVillages(s) * 100) + '%"></i></div>' +
      '<p class="tags"><span>Moc: ' + fmt(pw.total) + ' pkt</span><span>Atak ' + fmt(pw.attack) + '</span><span>Obrona ' + fmt(pw.defense) + '</span><span>Pokonani ' + fmt(Math.round(E.killsOf(s, 'player').total)) + '</span></p>' +
      '<ul class="vlist">' + own.map(v => '<li><button class="link" data-act="goto" data-id="' + v.id + '">' + esc(v.name) + '</button> <span class="muted">' + xy(v.x, v.y) + ', ' + E.points(v) + ' pkt</span></li>').join('') + '</ul></section>';
    html += '<section class="panel"><h2>Ruchy wojsk</h2>' + (mv.length ? '<ul class="mvlist compact">' + mv.slice(0, 8).map(m => movementItem(s, m)).join('') + '</ul>'
      : '<p class="muted">Brak ruchów wojsk.</p>') + '</section>';
    html += '<section class="panel"><h2>Frakcje</h2><ul class="vlist">' + Object.values(s.factions).map(f =>
      '<li><span class="flag" style="--fc:' + f.color + '"></span>' + esc(f.name) + ' <span class="muted">' + E.villagesOf(s, f.id).length + ' wiosek</span>' +
        (f.ai && f.upgrades && Object.keys(f.upgrades).length ? ' <span class="fx-up" title="Najwyższe ulepszenie jednostek frakcji (atak i obrona)">+' +
          Math.round(Math.max.apply(null, Object.values(f.upgrades)) * C.TECH.unitBonus * 100) + '%</span>' : '') + '</li>').join('') + '</ul></section>';
    el.innerHTML = html;
  }

  /* ---------- liczniki i paski postępu ---------- */
  // Postęp liczony z bieżącego zegara – pasek ma od razu właściwą szerokość i rośnie płynnie.
  function pct(a, b, now) {
    now = now == null ? MP.Game.clock() : now;
    const p = b > a ? Math.max(0, Math.min(1, (now - a) / (b - a))) : 1;
    return (p * 100).toFixed(2);
  }
  function updateBars() {
    const now = MP.Game.clock();
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
    const kept = focusDescriptor();
    renderHeader();
    renderNav();
    const pb = $('#pausebar'); if (pb) pb.hidden = !s.paused;
    document.querySelectorAll('.screen').forEach(el => { el.hidden = el.id !== 'screen-' + UI.screen; });
    if (UI.screen === 'village') renderVillage();
    else if (UI.screen === 'army') renderArmy();
    else if (UI.screen === 'reports') renderReports();
    else if (UI.screen === 'tech') renderTech();
    else if (UI.screen === 'overview' && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#screen-overview'))) renderOverview();
    else if (UI.screen === 'map') renderMap(false);
    renderQuick();
    restoreFocus(kept);
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
      case 'read-all': G.action(s => { s.reports.forEach(r => { r.read = true; }); }, { allowPaused: true }); break;
      case 'clear-reports':
        openModal('confirm', { title: 'Usunąć wszystkie raporty?', text: 'Tej operacji nie można cofnąć.', ok: 'clear-reports-ok', okLabel: 'Usuń raporty' });
        break;
      case 'clear-reports-ok': G.action(s => { s.reports = []; }, { allowPaused: true }); closeModal(); break;
      case 'report': {
        const id = b.dataset.id;
        G.action(s => { const r = s.reports.find(x => x.id === id); if (r) r.read = true; }, { allowPaused: true });
        openModal('report', { id });
        break;
      }
      case 'report-prev': stepReport(-1); break;
      case 'report-next': stepReport(1); break;
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
      case 'select-cur': { const v = cur(); if (v) { UI.sel = { x: v.x, y: v.y }; MP.Map.setSelected(UI.sel); MP.Map.centerOn(v.x, v.y); renderDetails(); } break; }
      case 'attack-open':
        UI.atk = {};
        if (b.dataset.mode) UI.atkMode = b.dataset.mode;
        openModal('attack', { target: b.dataset.id, from: UI.vid });
        break;
      case 'amode': UI.atkMode = b.dataset.m; renderModal(); break;
      // Raport grabieży: to samo wojsko jeszcze raz na tę samą osadę (z tej samej wioski, jeśli nadal jest Twoja).
      case 'raid-again': {
        const s = st(), r = s.reports.find(x => x.id === b.dataset.id);
        if (!r) break;
        UI.atk = {};
        E.UNITS.forEach(k => { if (r.attUnits[k]) UI.atk[k] = r.attUnits[k]; });
        UI.atkMode = 'raid';
        const from = r.from && s.villages[r.from] && s.villages[r.from].owner === 'player' ? r.from : UI.vid;
        openModal('attack', { target: r.to, from });
        break;
      }
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
        const r = G.action(s => E.sendAttack(s, m.from, m.target, attackUnits(), s.now, 'attack',
          { raid: UI.atkMode === 'raid' && s.villages[m.target] && s.villages[m.target].owner === null }));
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
      // Odsyła (hosted) albo odwołuje (abroad) wszystkie oddziały wsparcia danej wioski naraz.
      case 'withdraw-all': {
        const id = b.dataset.id, mode = b.dataset.mode;
        const r = G.action(s => {
          const pairs = mode === 'hosted'
            ? Object.keys(s.villages[id].support || {}).filter(o => s.villages[o]).map(o => [id, o])
            : Object.values(s.villages).filter(w => w.support && w.support[id]).map(w => [w.id, id]);
          let n = 0, last = 0;
          pairs.forEach(([h, o]) => { const x = E.withdrawSupport(s, h, o, s.now); if (x.ok) { n++; last = Math.max(last, x.movement.arrive); } });
          return { n, last };
        });
        if (r && r.ok === false) { /* gra wstrzymana – komunikat już pokazany */ }
        else if (r && r.n) toast('info', (mode === 'hosted' ? 'Odesłano wsparcie: ' : 'Odwołano wsparcie: ') + r.n + ' odd. Ostatni dotrze za ' + dur(r.last - st().now) + '.');
        else toast('bad', 'Brak wsparcia do ' + (mode === 'hosted' ? 'odesłania' : 'odwołania') + '.');
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
      case 'exchange-open': UI.form = {}; openModal('exchange', { from: UI.vid }); break;
      case 'ex-pick': {
        const w = b.dataset.w, k = b.dataset.k, other = w === 'from' ? 'to' : 'from';
        if (UI.form[other] === k) UI.form[other] = UI.form[w];
        UI.form[w] = k;
        renderModal();
        break;
      }
      case 'ex-max': {
        const v = st().villages[UI.modal.from];
        UI.form.amount = Math.min(Math.floor(v.res[UI.form.from]), E.exchangeMax(v));
        renderModal();
        break;
      }
      case 'ex-do': {
        const m = UI.modal, f = UI.form;
        const r = G.action(s => E.exchange(s, m.from, f.from, f.to, f.amount, s.now));
        if (r.ok) { toast('info', 'Wymieniono ' + fmt(r.spent) + ' na ' + fmt(r.got) + '.'); f.amount = ''; invalidate(); render(); renderModal(); }
        else toast('bad', r.reason);
        break;
      }
      case 'ex-tab': UI.form.tab = b.dataset.t; renderModal(); break;
      case 'coin-pick': UI.form.pay = b.dataset.k; renderModal(); break;
      case 'coin-max': {
        const s0 = st(), v = s0.villages[UI.modal.from];
        UI.form.coins = Math.max(0, Math.min(Math.floor(E.mintTokens(v, s0.now)), Math.floor(v.res[UI.form.pay] / C.TECH.coinPrice)));
        renderModal();
        break;
      }
      case 'coin-buy': {
        const m = UI.modal, f = UI.form;
        const r = G.action(s => E.buyCoins(s, m.from, f.pay, f.coins, s.now));
        if (r.ok) { toast('info', 'Kupiono ' + r.coins + ' monet (' + fmt(r.spent) + ' surowca).'); f.coins = ''; invalidate(); render(); renderModal(); }
        else toast('bad', r.reason);
        break;
      }
      case 'coins-open': {
        const v = cur();
        if (!v || !(v.buildings.market > 0)) { toast('bad', 'Zbuduj Targowisko w tej wiosce, aby kupować monety.'); break; }
        UI.form = { tab: 'coin' }; openModal('exchange', { from: v.id });
        break;
      }
      case 'diplo-open': if (UI.modal) closeModal(); openModal('diplo'); break;
      case 'diplo-propose': {
        const r = G.action(s => DIP().proposeFromPlayer(s, b.dataset.id, s.now));
        toast(r.ok ? 'good' : 'bad', r.ok ? (r.renewed ? 'Pakt przedłużony.' : 'Pakt zawarty.') : r.reason);
        renderModal();
        break;
      }
      case 'diplo-accept': case 'diplo-decline': {
        const acc = b.dataset.act === 'diplo-accept';
        const r = G.action(s => DIP().answerOffer(s, b.dataset.id, acc, s.now));
        toast(r.ok ? 'good' : 'bad', r.ok ? (acc ? (r.renewed ? 'Pakt przedłużony.' : 'Pakt zawarty.') : 'Oferta odrzucona.') : r.reason);
        renderModal();
        break;
      }
      case 'diplo-break': {
        UI.diploBreak = b.dataset.id;
        const name = esc(E.ownerName(st(), b.dataset.id));
        openModal('confirm', { title: 'Wypowiedzieć pakt z ' + name + '?', text: 'Pakt będzie chronił jeszcze ' + C.DIPLO.breakNoticeMin + ' min. Frakcja zapamięta zdradę, a inne chętniej odmówią Ci paktu.',
          ok: 'diplo-break-ok', okLabel: 'Wypowiedz pakt' });
        break;
      }
      case 'diplo-break-ok': {
        const id = UI.diploBreak; UI.diploBreak = null;
        const r = G.action(s => DIP().breakPact(s, 'player', id, s.now));
        openModal('diplo');
        toast(r.ok ? 'info' : 'bad', r.ok ? 'Pakt wypowiedziany.' : r.reason);
        break;
      }
      case 'diplo-gift': {
        const v = cur(), n = Number(b.dataset.n) || 0;
        if (!v) break;
        const r = G.action(s => {
          const vv = s.villages[v.id]; E.tickVillage(s, vv, s.now);
          const res = {}; E.RES.forEach(k => { res[k] = Math.min(Math.floor(n / E.RES.length), Math.floor(vv.res[k])); });
          return DIP().gift(s, v.id, b.dataset.id, res, s.now);
        });
        toast(r.ok ? 'good' : 'bad', r.ok ? 'Dar przyjęty: nastawienie +' + r.delta + '.' : r.reason);
        renderModal();
        break;
      }
      case 'tech-open': if (UI.modal) closeModal(); show('tech'); break;
      case 'tech-sel': UI.techSel = UI.techSel === b.dataset.id ? null : b.dataset.id; UI.sigs.tech = null; render(); break;
      case 'tech-buy': {
        UI.techSel = b.dataset.id;
        const r = G.action(s => E.researchTech(s, b.dataset.id, s.now));
        if (!r.ok) toast('bad', r.reason); else { invalidate(); render(); }
        break;
      }
      case 'qk-ex-mode': UI.quick.ex = b.dataset.m; render(); break;
      case 'qk-coin-mode': UI.quick.coin = b.dataset.m; render(); break;
      case 'qk-ex': {
        const v = cur(), f = b.dataset.f, t = b.dataset.t, mode = UI.quick.ex;
        if (!v) break;
        const r = G.action(s => {
          const vv = s.villages[v.id];
          E.tickVillage(s, vv, s.now);
          const q = E.exchangeQuick(vv, f, t, mode);
          return q.ok ? E.exchange(s, v.id, f, t, q.amount, s.now) : { ok: false, reason: 'Nie można wymienić tej ilości' };
        });
        if (r.ok) UI.quick.msg = { at: Date.now(), vid: v.id, text: 'Wymieniono ' + fmt(r.spent) + ' ' + RES_GEN[f] + ' na ' + fmt(r.got) + ' ' + RES_GEN[t] + '.' };
        else if (r.reason && !/wstrzymana/.test(r.reason)) UI.quick.msg = { at: Date.now(), vid: v.id, text: r.reason };
        render();
        break;
      }
      case 'qk-coin': {
        const v = cur(), res = b.dataset.r, mode = UI.quick.coin;
        if (!v) break;
        const r = G.action(s => {
          const vv = s.villages[v.id];
          E.tickVillage(s, vv, s.now);
          const q = E.coinQuick(vv, res, mode, s.now);
          return q.ok ? E.buyCoins(s, v.id, res, q.count, s.now) : { ok: false, reason: 'Limit zakupu lub zapas surowca jest za mały' };
        });
        if (r.ok) UI.quick.msg = { at: Date.now(), vid: v.id, text: 'Kupiono ' + r.coins + ' ' + plCoins(r.coins) + ' za ' + fmt(r.spent) + ' ' + RES_GEN[res] + '.' };
        else if (r.reason && !/wstrzymana/.test(r.reason)) UI.quick.msg = { at: Date.now(), vid: v.id, text: r.reason };
        render();
        break;
      }
      case 'qk-coin-all': {
        const r = G.action(s => E.buyCoinsAll(s, s.now));
        if (!/wstrzymana/.test(r.reason || '')) UI.quick.msg = { at: Date.now(), vid: '*', text: r.ok ? 'Kupiono ' + r.coins + ' ' + plCoins(r.coins) + ' w ' + r.villages + ' ' + plVillages(r.villages) + ' (' + fmt(r.spent) + ' surowców).' : r.reason };
        render();
        break;
      }
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
      case 'mass-open': UI.mass = massDefaults(); openModal('mass'); break;
      case 'mass-go': {
        const g = UI.mass;
        const r = G.action(s => E.recruitAll(s, E.planRecruitAll(s, g.unit, { count: g.count, max: g.max, off: g.off }, s.now), s.now));
        if (r.ok) {
          toast('info', 'Rekrutacja: ' + fmt(r.total) + ' × ' + C.UNITS[g.unit].name + ' w ' + r.done.length + ' wioskach');
          UI.mass = null; closeModal(); invalidate(); render();
        } else toast('bad', r.reason);
        break;
      }
      case 'troops-open': UI.troops = troopsDefaults(UI.vid || (cur() && cur().id)); openModal('troops'); break;
      case 'defense-open': UI.troops = defenseDefaults(UI.vid || (cur() && cur().id)); openModal('troops'); break;
      case 'tunits-def': {
        UI.troops.units = defenseUnits();
        document.querySelectorAll('[data-tunit]').forEach(i => { i.checked = !!UI.troops.units[i.dataset.tunit]; });
        updateTroopsPlan();
        break;
      }
      case 'buildall-open': UI.buildall = buildAllDefaults(); openModal('buildall'); break;
      case 'ba-mode': UI.buildall.mode = b.dataset.m; renderModal(); break;
      case 'buildall-go': {
        const g = UI.buildall;
        const r = G.action(s => E.buildAll(s, buildAllItems(g), s.now, g.off));
        if (r.ok) { toast('info', 'Zakolejkowano ' + r.queued + ' budów w ' + r.villages + ' wioskach.'); UI.buildall = null; closeModal(); invalidate(); render(); }
        else toast('bad', r.reason);
        break;
      }
      case 'auto-open': UI.auto = autoDefaults(); openModal('auto'); break;
      case 'auto-save': {
        const g = UI.auto;
        const r = G.action(s => E.setAuto(s, g, s.now));
        if (r.ok) { toast('info', g.on ? 'Konwoje włączone – pierwszy przegląd za chwilę.' : 'Konwoje wyłączone.'); UI.auto = null; closeModal(); invalidate(); render(); }
        else toast('bad', r.reason);
        break;
      }
      case 'tunits-all': {
        const on = b.dataset.on === '1';
        E.UNITS.forEach(k => { UI.troops.units[k] = on; });
        document.querySelectorAll('[data-tunit]').forEach(i => { i.checked = on; });
        updateTroopsPlan();
        break;
      }
      case 'sel-all': {
        const w = b.dataset.w, on = b.dataset.on === '1', O = w === 'g' ? UI.gather : w === 'm' ? UI.mass : w === 'b' ? UI.buildall : UI.troops;
        document.querySelectorAll('[data-' + w + 'src]').forEach(i => { if (on) delete O.off[i.dataset[w + 'src']]; else O.off[i.dataset[w + 'src']] = true; });
        (w === 'g' ? updateGatherPlan : w === 'm' ? updateMassPlan : w === 'b' ? updateBuildAllPlan : updateTroopsPlan)();
        break;
      }
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
        const r = G.action(s => act === 'send-support' ? E.sendSupport(s, m.from, m.target, formUnits(), s.now, supMode())
          : act === 'send-spy' ? E.sendSpy(s, m.from, m.target, UI.form.scout, s.now)
          : act === 'send-transport' ? E.sendTransport(s, m.from, m.target, formRes(), s.now)
          : E.sendSettler(s, m.from, m.x, m.y, s.now));
        if (r.ok) {
          toast('info', (act === 'send-support' ? (supMode() === 'stay' ? 'Wojsko wyruszyło' : 'Wsparcie wyruszyło') : act === 'send-spy' ? 'Zwiadowcy wyruszyli' : act === 'send-transport' ? 'Kupcy wyruszyli' : 'Osadnik wyruszył') +
            '. Na miejscu za ' + dur(r.movement.arrive - st().now) + '.');
          UI.form = {};
          closeModal(); invalidate(); render();
        } else toast('bad', r.reason);
        break;
      }
      case 'menu': openModal('menu'); break;
      case 'rank-sort': if (UI.modal) { UI.modal.sort = b.dataset.s; renderModal(); } break;
      case 'close': closeModal(); break;
      case 'export': {
        const d = new Date();
        download('mini-plemiona-zapis-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json', MP.DB.serialize(st()));
        toast('info', 'Pobrano kopię zapisu.');
        break;
      }
      case 'pause': if (MP.Game.pause()) toast('info', 'Gra wstrzymana – czas nie płynie.'); renderModal(); break;
      case 'resume': if (MP.Game.resume()) toast('info', 'Gra wznowiona.'); renderModal(); break;
      case 'export-pause': {
        MP.Game.pause();
        const d = new Date();
        download('mini-plemiona-zapis-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json', MP.DB.serialize(st()));
        toast('info', 'Gra wstrzymana, zapis pobrany. Po wczytaniu wznów grę przyciskiem u góry.');
        renderModal();
        break;
      }
      case 'import': $('#importFile').click(); break;
      case 'new-game': openModal('newgame', { diff: st().difficulty, world: st().world || C.DEFAULT_WORLD, race: !!st().race }); break;
      case 'pick-diff': UI.modal.diff = b.dataset.d; renderModal(); break;
      case 'pick-world': UI.modal.world = b.dataset.w; renderModal(); break;
      case 'pick-race': UI.modal.race = b.dataset.r === '1'; renderModal(); break;
      case 'set-race':
        G.action(s => { s.race = b.dataset.r === '1'; }, { allowPaused: true });
        toast('info', b.dataset.r === '1' ? 'Tryb Wyścig: AI też może wygrać.' : 'Tryb Spokojny: wygrać możesz tylko Ty.');
        renderModal();
        break;
      case 'set-diff':
        G.action(s => { s.difficulty = b.dataset.d; }, { allowPaused: true });
        toast('info', 'Poziom trudności: ' + C.DIFFICULTY[b.dataset.d].label + '.');
        renderModal();
        break;
      case 'new-game-now': {
        const d = UI.modal && UI.modal.diff, w = UI.modal && UI.modal.world, r = !!(UI.modal && UI.modal.race);
        closeModal();
        G.newGame(d, w, r);
        break;
      }
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.dataset.rin) UI.recruit[t.dataset.rin] = t.value;
    if (t.dataset.ain) { UI.atk[t.dataset.ain] = t.value; updateAttackSummary(); }
    if (t.dataset.fin) { UI.form[t.dataset.fin] = t.value; updateFormSummary(); }
    if (t.hasAttribute && t.hasAttribute('data-mcount')) { UI.mass.count = t.value; updateMassPlan(); }
    if (t.hasAttribute && t.hasAttribute('data-treserve')) { UI.troops.reserve = Math.max(0, Math.min(100, Number(t.value) || 0)); updateTroopsPlan(); }
    if (t.hasAttribute && t.hasAttribute('data-greserve')) { UI.gather.reserve = Math.max(0, Math.min(100, Number(t.value) || 0)); updateGatherPlan(); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'villageSelect') { UI.vid = t.value; UI.recruit = {}; invalidate(); render(); }
    else if (t.id === 'atkFrom') { UI.modal.from = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-from')) { UI.modal.from = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-munit')) { UI.mass.unit = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-batpl')) { UI.buildall.tpl = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-bakey')) { UI.buildall.key = t.value; updateBuildAllPlan(); }
    else if (t.hasAttribute && t.hasAttribute('data-balevel')) { UI.buildall.level = t.value; updateBuildAllPlan(); }
    else if (t.dataset && t.dataset.bsrc) { if (t.checked) delete UI.buildall.off[t.dataset.bsrc]; else UI.buildall.off[t.dataset.bsrc] = true; updateBuildAllPlan(); }
    else if (t.hasAttribute && t.hasAttribute('data-aon')) { UI.auto.on = t.checked; }
    else if (t.hasAttribute && t.hasAttribute('data-ahub')) { UI.auto.hub = t.value; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-ahigh')) { UI.auto.high = t.value; }
    else if (t.hasAttribute && t.hasAttribute('data-akeep')) { UI.auto.keep = t.value; }
    else if (t.hasAttribute && t.hasAttribute('data-aevery')) { UI.auto.everyMin = Number(t.value); }
    else if (t.hasAttribute && t.hasAttribute('data-acoins')) { UI.auto.coins = t.checked; renderModal(); }
    else if (t.hasAttribute && t.hasAttribute('data-mmax')) { UI.mass.max = t.checked; renderModal(); }
    else if (t.dataset && t.dataset.msrc) { if (t.checked) delete UI.mass.off[t.dataset.msrc]; else UI.mass.off[t.dataset.msrc] = true; updateMassPlan(); }
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
    if (!typing && UI.modal && UI.modal.type === 'report' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { stepReport(e.key === 'ArrowRight' ? 1 : -1); e.preventDefault(); return; }
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
    // przesunięcie palcem w oknie raportu: w lewo = starszy, w prawo = nowszy
    let tx = null, ty = null, tScroll = 0, tTable = false;
    const dlgOf = () => document.querySelector('#modal .dialog');
    $('#modal').addEventListener('touchstart', e => {
      tx = e.touches[0].clientX; ty = e.touches[0].clientY;
      const d = dlgOf(); tScroll = d ? d.scrollTop : 0;
      tTable = !!(e.target.closest && e.target.closest('.tablewrap'));
    }, { passive: true });
    $('#modal').addEventListener('touchcancel', () => { tx = null; }, { passive: true });
    $('#modal').addEventListener('touchend', e => {
      if (tx == null || !UI.modal || UI.modal.type !== 'report') { tx = null; return; }
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      const d = dlgOf(), scrolled = d && Math.abs(d.scrollTop - tScroll) > 4;
      tx = null;
      // zmiana raportu tylko przy wyraźnie poziomym geście; przewijanie w pionie nigdy jej nie wywołuje
      if (!scrolled && !tTable && Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2.5) stepReport(dx < 0 ? 1 : -1);
    }, { passive: true });
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
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitModal); window.visualViewport.addEventListener('scroll', fitModal); }
    window.addEventListener('resize', fitModal);
    // Klawiatura ekranowa (Android) zmienia tylko wysokość okna, i to w kilku krokach. Przebudowa całego UI przy każdym takim
    // zdarzeniu powodowała, że okno ataku „skakało” przy wpisywaniu liczby jednostek. Pełne odświeżenie robimy tylko przy zmianie
    // szerokości (obrót ekranu, próg układu mobilnego/komputerowego), a samo zdarzenie scalamy do jednej klatki.
    let lastW = window.innerWidth, rzFrame = 0;
    window.addEventListener('resize', () => {
      if (rzFrame) return;
      rzFrame = requestAnimationFrame(() => {
        rzFrame = 0;
        if (UI.screen === 'map') { MP.Map.clamp(); MP.Map.apply(); }
        const w = window.innerWidth;
        if (w === lastW) return;
        lastW = w;
        invalidate(); render();
      });
    });
  }

  MP.UI = { init, render, show, toast, drainNotices, invalidate, state: UI, closeModal };
})(typeof window !== 'undefined' ? window : globalThis);
