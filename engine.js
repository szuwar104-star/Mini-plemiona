/* =========================================================================
   Mini Plemiona – SILNIK GRY
   Stan gry + jeden centralny procesor zdarzeń (advance).
   Cała logika opiera się na znacznikach czasu – nie na setInterval.
   Każde zdarzenie (koniec budowy, przybycie wojsk, tura AI) jest
   przetwarzane dokładnie raz, w kolejności chronologicznej.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP = root.MP || {};
  const C = MP.CONFIG;
  const RES = ['wood', 'clay', 'iron'];
  const UNITS = Object.keys(C.UNITS);
  const BUILDINGS = Object.keys(C.BUILDINGS);

  /* ---------- narzędzia ---------- */
  // Deterministyczny generator liczb losowych – jego stan jest częścią zapisu.
  function rand(state) {
    let t = state.rng = (state.rng + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function randInt(state, a, b) { return a + Math.floor(rand(state) * (b - a + 1)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function emptyUnits() { const u = {}; UNITS.forEach(k => { u[k] = 0; }); return u; }
  function cleanUnits(u) { const o = emptyUnits(); UNITS.forEach(k => { o[k] = Math.max(0, Math.floor(Number(u && u[k]) || 0)); }); return o; }
  function sumUnits(u) { return UNITS.reduce((s, k) => s + (u[k] || 0), 0); }
  function attackPower(u) { return UNITS.reduce((s, k) => s + (u[k] || 0) * C.UNITS[k].att, 0); }
  function defensePower(u) { return UNITS.reduce((s, k) => s + (u[k] || 0) * C.UNITS[k].def, 0); }
  // Wszystkie jednostki broniące wioski: własne + wsparcie z innych wiosek.
  function defenders(v) {
    const u = Object.assign(emptyUnits(), v.units);
    Object.values(v.support || {}).forEach(s => UNITS.forEach(k => { u[k] += s[k] || 0; }));
    return u;
  }
  // Siła obrony wioski z murem (poziom muru można podać, np. po uderzeniu taranów).
  function defenseFrom(units, wallLevel) {
    const W = C.BUILDINGS.wall, L = Math.max(0, Math.min(C.MAX_LEVEL, wallLevel || 0));
    return (defensePower(units) + C.COMBAT.baseDefense + W.flat[L]) * (1 + W.bonus[L]);
  }
  function villageDefense(v, wallLevel) { return defenseFrom(defenders(v), wallLevel == null ? v.buildings.wall : wallLevel); }
  function newId(state, prefix) { return prefix + (state.nextId++); }
  function tileAt(state, x, y) { return state.map.tiles[y * state.map.size + x]; }
  function villagesOf(state, owner) { return Object.values(state.villages).filter(v => v.owner === owner); }
  function points(v) { return BUILDINGS.reduce((s, k) => s + v.buildings[k], 0); }
  // Punkty jednostek = koszt / SCORE.costDivisor (liczone z konfiguracji, więc zmiana balansu sama je koryguje).
  function unitPoints(u) {
    return UNITS.reduce((s, k) => { const c = C.UNITS[k].cost; return s + (u[k] || 0) * (c.wood + c.clay + c.iron) / C.SCORE.costDivisor; }, 0);
  }
  // Całe wojsko właściciela: w wioskach, na wsparciu u siebie, w marszu (atak, powrót, wsparcie, osadnik).
  function armyOf(state, owner) {
    const u = emptyUnits();
    const add = x => { if (x) UNITS.forEach(k => { u[k] += x[k] || 0; }); };
    villagesOf(state, owner).forEach(v => { add(v.units); Object.values(v.support || {}).forEach(add); });
    state.movements.forEach(m => { if (m.owner === owner) add(m.units); });
    return u;
  }
  // Moc konta: punkty budynków + punkty wojska, a do tego siła ataku i obrony całej armii.
  function accountPower(state, owner) {
    const vs = villagesOf(state, owner), army = armyOf(state, owner);
    const buildings = vs.reduce((a, v) => a + points(v), 0);
    const armyPts = Math.round(unitPoints(army));
    return { villages: vs.length, buildings, army: armyPts, total: buildings + armyPts,
      units: sumUnits(army), attack: attackPower(army), defense: defensePower(army) };
  }
  function ownerName(state, owner) { return owner === null ? C.NEUTRAL.name : (state.factions[owner] ? state.factions[owner].name : '?'); }
  function ownerColor(state, owner) { return owner === null ? C.NEUTRAL.color : (state.factions[owner] ? state.factions[owner].color : '#888'); }

  function genName(state) {
    const N = C.NAMES;
    for (let i = 0; i < 60; i++) {
      const n = N.prefix[randInt(state, 0, N.prefix.length - 1)] + N.suffix[randInt(state, 0, N.suffix.length - 1)];
      if (!state.usedNames[n]) { state.usedNames[n] = 1; return n; }
    }
    return 'Osada ' + state.nextId;
  }

  function makeVillage(state, x, y, owner, buildings, units, res, now) {
    const b = {};
    BUILDINGS.forEach(k => { b[k] = (buildings && buildings[k] != null) ? buildings[k] : C.BUILDINGS[k].start; });
    const v = {
      id: newId(state, 'v'), name: genName(state), x, y, owner,
      buildings: b, units: Object.assign(emptyUnits(), units || {}),
      res: Object.assign({ wood: 0, clay: 0, iron: 0 }, res || {}),
      buildQueue: [], recruitQueue: [], loyalty: C.LOYALTY.max, lastTick: now, support: {}
    };
    state.villages[v.id] = v;
    const t = tileAt(state, x, y);
    t.terrain = 'plain';
    t.village = v.id;
    return v;
  }

  /* ---------- nowa gra i generowanie mapy ---------- */
  function diff(state) { return C.DIFFICULTY[state.difficulty] || C.DIFFICULTY[C.DEFAULT_DIFFICULTY]; }

  function worldOf(key) { return C.WORLDS[key] || C.WORLDS[C.DEFAULT_WORLD]; }
  function winVillages(state) { return (state && state.winVillages) || C.WIN_VILLAGES; }

  function newGame(now, seed, difficulty, world) {
    const W = worldOf(world), N = W.size, aiFactions = C.AI.factions.slice(0, W.ai);
    const state = {
      version: C.SAVE_VERSION, created: now, now: now,
      rng: (seed >>> 0) || 1, nextId: 1, usedNames: {},
      map: { size: N, tiles: [] }, villages: {}, factions: {},
      world: C.WORLDS[world] ? world : C.DEFAULT_WORLD, winVillages: W.win,
      movements: [], reports: [], notices: [], ended: null, intel: {}, lastHit: {},
      difficulty: C.DIFFICULTY[difficulty] ? difficulty : C.DEFAULT_DIFFICULTY,
      stats: { battles: 0, conquests: 0 }
    };
    state.factions.player = { id: 'player', name: C.PLAYER.name, color: C.PLAYER.color, ai: false, alive: true };
    aiFactions.forEach((f, i) => {
      state.factions[f.id] = {
        id: f.id, name: f.name, color: f.color, personality: f.personality, ai: true, alive: true,
        nextThink: now + Math.round(C.AI.thinkInterval * 1000 * (1 + i / aiFactions.length))
      };
    });

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const r = rand(state);
        const terrain = r < C.MAP.forest ? 'forest' : (r < C.MAP.forest + C.MAP.mountain ? 'mountain' : 'plain');
        state.map.tiles.push({ x, y, terrain, village: null });
      }
    }

    const placed = [];
    const inMap = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const isFree = (x, y, minD) => inMap(x, y) && !tileAt(state, x, y).village &&
      placed.every(p => dist(p, { x, y }) >= minD);
    function findSpot(test, tries) {
      for (let i = 0; i < tries; i++) {
        const x = randInt(state, 0, N - 1), y = randInt(state, 0, N - 1);
        if (test(x, y)) return { x, y };
      }
      return null;
    }

    // Wioska gracza – z dala od krawędzi
    const px = randInt(state, 3, N - 4), py = randInt(state, 3, N - 4);
    const player = makeVillage(state, px, py, 'player', C.START.buildings, C.START.units, C.START.resources, now);
    placed.push(player);

    // Stolice AI daleko od gracza i od siebie (z łagodzeniem warunków, gdy brak miejsca)
    const capitals = [];
    aiFactions.forEach(f => {
      let spot = null;
      for (let relax = 0; relax < 5 && !spot; relax++) {
        const dP = C.MAP.aiMinDistFromPlayer - relax * 0.5, dA = C.MAP.aiMinDistBetween - relax * 0.5;
        spot = findSpot((x, y) => isFree(x, y, 2) && dist(player, { x, y }) >= dP &&
          capitals.every(c => dist(c, { x, y }) >= dA), 500);
      }
      if (!spot) spot = findSpot((x, y) => isFree(x, y, 1), 2000);
      const res = { wood: 800, clay: 800, iron: 600 };
      const cap = makeVillage(state, spot.x, spot.y, f.id, C.AI.startBuildings, C.AI.startUnits, res, now);
      capitals.push(cap); placed.push(cap);
      const s2 = findSpot((x, y) => isFree(x, y, 1.4) && dist(cap, { x, y }) <= 3 && dist(player, { x, y }) >= 4, 800) ||
        findSpot((x, y) => isFree(x, y, 1.4), 2000);
      if (s2) placed.push(makeVillage(state, s2.x, s2.y, f.id, C.AI.secondBuildings, C.AI.secondUnits, { wood: 300, clay: 300, iron: 200 }, now));
    });

    // Neutralne osady – kilka słabych blisko gracza, reszta losowo
    function neutral(x, y) {
      const d = dist(player, { x, y });
      const NC = C.NEUTRAL;
      const units = emptyUnits();
      units.spear = Math.round(NC.spearBase + d * NC.spearPerDist * (0.8 + rand(state) * 0.4));
      units.axe = Math.round(d * NC.axePerDist * (0.6 + rand(state) * 0.8));
      units.light = d > NC.lightFromDist ? randInt(state, 0, Math.round(d - NC.lightFromDist) + 1) : 0;
      const lvl = d > 7 ? 2 : 1;
      const b = { hq: lvl, wood: randInt(state, 1, lvl + 1), clay: randInt(state, 1, lvl + 1), iron: randInt(state, 1, lvl), farm: lvl, barracks: 0, wall: d > 6 ? 1 : 0 };
      const r = NC.startRes;
      const v = makeVillage(state, x, y, null, b, units, { wood: r, clay: r, iron: Math.round(r * 0.7) }, now);
      placed.push(v);
    }
    let made = 0;
    for (let i = 0; i < C.MAP.neutralNearPlayer; i++) {
      const s = findSpot((x, y) => isFree(x, y, 1.4) && dist(player, { x, y }) >= 2 && dist(player, { x, y }) <= 4, 800);
      if (s) { neutral(s.x, s.y); made++; }
    }
    for (let guard = 0; made < W.neutral && guard < W.neutral * 3; guard++) {
      const s = findSpot((x, y) => isFree(x, y, 2), 300) || findSpot((x, y) => isFree(x, y, 1.4), 600);
      if (!s) break;
      neutral(s.x, s.y); made++;
    }
    return state;
  }

  /* ---------- ekonomia ---------- */
  // Mnożniki trudności ustawia advance()/newGame – produkcja nie potrzebuje wtedy dostępu do stanu.
  let D = C.DIFFICULTY[C.DEFAULT_DIFFICULTY];
  function useDifficulty(state) { D = diff(state); }
  function prodFactor(v) {
    if (v.owner === null) return C.NEUTRAL.prodFactor;
    return v.owner === 'player' ? D.playerProd : D.aiProd;
  }
  function productionPerMin(v) {
    const f = prodFactor(v);
    return {
      wood: C.BUILDINGS.wood.prod[v.buildings.wood] * f,
      clay: C.BUILDINGS.clay.prod[v.buildings.clay] * f,
      iron: C.BUILDINGS.iron.prod[v.buildings.iron] * f
    };
  }
  function storageCap(v) { return C.BUILDINGS.hq.storage[v.buildings.hq]; }
  function popCap(v) { return C.BUILDINGS.farm.pop[v.buildings.farm]; }
  function popUsed(state, v) {
    let p = 0;
    const add = u => { UNITS.forEach(k => { p += (u[k] || 0) * C.UNITS[k].pop; }); };
    add(v.units);
    v.recruitQueue.forEach(e => { p += (e.count - e.done) * C.UNITS[e.unit].pop; });
    state.movements.forEach(m => { if (m.from === v.id && m.owner === v.owner) add(m.units); });
    for (const id in state.villages) {
      const w = state.villages[id];
      if (w.support && w.support[v.id]) add(w.support[v.id]);
    }
    return p;
  }

  // Nalicza produkcję, poparcie i ukończoną rekrutację do chwili t.
  // Rekrutacja nie wpływa na produkcję, więc może być liczona "leniwie".
  function tickVillage(state, v, t) {
    if (t <= v.lastTick) return;
    useDifficulty(state);
    // Arytmetyka całkowita: przyrost = tempo × czas, reszta (ułamek jednostki) czeka w v.acc.
    // Dzięki temu wynik jest identyczny bez względu na to, w ilu krokach liczono czas.
    const dt = Math.round(t - v.lastTick);
    const p = productionPerMin(v), cap = storageCap(v);
    if (!v.acc) v.acc = { wood: 0, clay: 0, iron: 0, loyalty: 0 };
    RES.forEach(r => {
      if (v.res[r] >= cap) { v.acc[r] = 0; return; }
      const rate = Math.round(p[r] * 10);                // jednostek na 600 000 ms
      const total = v.acc[r] + rate * dt;
      const whole = Math.floor(total / 600000);
      v.acc[r] = total - whole * 600000;
      v.res[r] += whole;
      if (v.res[r] >= cap) { v.res[r] = cap; v.acc[r] = 0; }
    });
    if (v.owner !== null && v.loyalty < C.LOYALTY.max) {
      const total = v.acc.loyalty + Math.round(C.LOYALTY.regenPerMin * 10) * dt;
      const whole = Math.floor(total / 600000);
      v.acc.loyalty = total - whole * 600000;
      v.loyalty = Math.min(C.LOYALTY.max, v.loyalty + whole);
      if (v.loyalty >= C.LOYALTY.max) v.acc.loyalty = 0;
    }
    const q = v.recruitQueue;
    while (q.length) {
      const e = q[0];
      const fin = Math.min(e.count, Math.max(0, Math.floor((t - e.start) / e.per)));
      if (fin > e.done) { v.units[e.unit] += fin - e.done; e.done = fin; }
      if (e.done >= e.count) q.shift(); else break;
    }
    v.lastTick = t;
  }

  function canAfford(v, cost) { return RES.every(r => Math.floor(v.res[r]) >= cost[r]); }
  function pay(v, cost) { RES.forEach(r => { v.res[r] -= cost[r]; }); }

  /* ---------- budowa ---------- */
  function buildTime(v, key, level) {
    return Math.round(C.BUILDINGS[key].time[level] * C.BUILDINGS.hq.buildSpeed[v.buildings.hq] * 1000);
  }
  function buildInfo(state, v, key) {
    const B = C.BUILDINGS[key];
    const queued = v.buildQueue.filter(e => e.building === key).length;
    const target = v.buildings[key] + queued + 1;
    const info = { key, target, cost: null, time: 0, ok: false, code: '', reason: '' };
    if (target > C.MAX_LEVEL) { info.code = 'max'; info.reason = 'Maksymalny poziom'; return info; }
    info.cost = { wood: B.cost.wood[target], clay: B.cost.clay[target], iron: B.cost.iron[target] };
    info.time = buildTime(v, key, target);
    if (key !== 'hq' && v.buildings.hq < target - C.HQ_LEVEL_GAP) {
      info.code = 'hq'; info.reason = 'Wymaga Ratusza poz. ' + (target - C.HQ_LEVEL_GAP); return info;
    }
    if (v.buildQueue.length >= C.BUILD_QUEUE_MAX) { info.code = 'queue'; info.reason = 'Kolejka jest pełna'; return info; }
    if (RES.some(r => info.cost[r] > storageCap(v))) { info.code = 'storage'; info.reason = 'Za mały magazyn – rozbuduj Ratusz'; return info; }
    if (!canAfford(v, info.cost)) { info.code = 'resources'; info.reason = 'Brak surowców'; return info; }
    info.ok = true;
    return info;
  }
  function queueBuild(state, v, key, t) {
    tickVillage(state, v, t);
    const info = buildInfo(state, v, key);
    if (!info.ok) return info;
    pay(v, info.cost);
    const last = v.buildQueue[v.buildQueue.length - 1];
    const start = last ? Math.max(t, last.end) : t;
    v.buildQueue.push({ id: newId(state, 'b'), building: key, level: info.target, start, end: start + info.time });
    return info;
  }

  /* ---------- rekrutacja ---------- */
  function recruitPer(v, unit) {
    return Math.round(C.UNITS[unit].time * C.BUILDINGS.barracks.recruitSpeed[v.buildings.barracks] * 1000);
  }
  function recruitInfo(state, v, unit) {
    const U = C.UNITS[unit];
    const info = { unit, ok: false, max: 0, per: 0, code: '', reason: '' };
    if (v.buildings.barracks < U.barracks) { info.code = 'locked'; info.reason = 'Wymaga Koszar poz. ' + U.barracks; return info; }
    if (U.hq && v.buildings.hq < U.hq) { info.code = 'locked'; info.reason = 'Wymaga Ratusza poz. ' + U.hq; return info; }
    info.per = recruitPer(v, unit);
    const byRes = Math.min.apply(null, RES.map(r => U.cost[r] > 0 ? Math.floor(v.res[r] / U.cost[r]) : Infinity));
    const byPop = Math.floor((popCap(v) - popUsed(state, v)) / U.pop);
    info.max = Math.max(0, Math.min(byRes, byPop));
    if (v.recruitQueue.length >= C.RECRUIT_QUEUE_MAX) { info.code = 'queue'; info.reason = 'Kolejka jest pełna'; info.max = 0; return info; }
    if (byPop < 1) { info.code = 'pop'; info.reason = 'Brak miejsca na farmie'; return info; }
    if (byRes < 1) { info.code = 'resources'; info.reason = 'Brak surowców'; return info; }
    info.ok = true;
    return info;
  }
  function queueRecruit(state, v, unit, count, t) {
    tickVillage(state, v, t);
    count = Math.floor(Number(count) || 0);
    const info = recruitInfo(state, v, unit);
    if (!info.ok) return info;
    if (count < 1) { info.ok = false; info.reason = 'Podaj liczbę jednostek'; return info; }
    if (count > info.max) { info.ok = false; info.reason = 'Możesz zrekrutować maksymalnie ' + info.max; return info; }
    const U = C.UNITS[unit];
    pay(v, { wood: U.cost.wood * count, clay: U.cost.clay * count, iron: U.cost.iron * count });
    const last = v.recruitQueue[v.recruitQueue.length - 1];
    const start = last ? Math.max(t, last.start + last.count * last.per) : t;
    v.recruitQueue.push({ id: newId(state, 'q'), unit, count, done: 0, per: info.per, start });
    return info;
  }

  /* ---------- ruchy wojsk ---------- */
  function slowest(units) {
    let s = 0;
    UNITS.forEach(k => { if (units[k] > 0) s = Math.max(s, C.UNITS[k].speed); });
    return s;
  }
  function travelTime(a, b, units) { return Math.round(dist(a, b) * slowest(units) * 1000); }

  function sendAttack(state, fromId, toId, units, t, type) {
    type = type || 'attack';
    const from = state.villages[fromId], to = state.villages[toId];
    if (!from || !to) return { ok: false, reason: 'Nieznana wioska' };
    if (from.id === to.id) return { ok: false, reason: 'Nie można zaatakować tej samej wioski' };
    if (to.owner === from.owner) return { ok: false, reason: 'To Twoja wioska' };
    tickVillage(state, from, t);
    const u = cleanUnits(units);
    if (u.settler > 0) return { ok: false, reason: 'Osadnika wysyłasz przyciskiem „Załóż osadę” na pustym polu' };
    if (type === 'spy') {
      if (u.scout < 1) return { ok: false, reason: 'Wybierz zwiadowców' };
      if (sumUnits(u) !== u.scout) return { ok: false, reason: 'Na zwiad wysyłasz tylko zwiadowców' };
    }
    if (sumUnits(u) < 1) return { ok: false, reason: 'Wybierz jednostki do ataku' };
    for (const k of UNITS) {
      if (u[k] > from.units[k]) return { ok: false, reason: 'Za mało jednostek: ' + C.UNITS[k].name };
    }
    UNITS.forEach(k => { from.units[k] -= u[k]; });
    const m = {
      id: newId(state, 'm'), type, owner: from.owner, from: from.id, to: to.id,
      units: u, loot: null, start: t, arrive: t + travelTime(from, to, u)
    };
    state.movements.push(m);
    if (type === 'attack' && to.owner === 'player' && from.owner !== 'player') {
      state.lastHit = state.lastHit || {};
      state.lastHit[to.id] = t;
      notice(state, t, 'danger', 'Nadciąga atak na ' + to.name + ' (' + to.x + ':' + to.y + ')!');
    }
    return { ok: true, movement: m };
  }
  function sendSpy(state, fromId, toId, scouts, t) {
    const u = emptyUnits(); u.scout = Math.floor(Number(scouts) || 0);
    return sendAttack(state, fromId, toId, u, t, 'spy');
  }

  /* ---------- przemieszczanie wojska między własnymi wioskami ---------- */
  function unitsPop(u) { return UNITS.reduce((s, k) => s + (u[k] || 0) * C.UNITS[k].pop, 0); }
  function incomingSupportPop(state, v) {
    return state.movements.reduce((s, m) => s + (m.type === 'support' && m.stay !== false && m.to === v.id && m.owner === v.owner ? unitsPop(m.units) : 0), 0);
  }
  function supportRoom(state, v) { return popCap(v) - popUsed(state, v) - incomingSupportPop(state, v); }
  function sendSupport(state, fromId, toId, units, t, mode) {
    const stay = mode === 'stay';
    const from = state.villages[fromId], to = state.villages[toId];
    if (!from || !to || from.id === to.id) return { ok: false, reason: 'Wybierz dwie różne wioski' };
    if (to.owner !== from.owner) return { ok: false, reason: 'Wojsko możesz przenieść tylko do własnej wioski' };
    tickVillage(state, from, t);
    tickVillage(state, to, t);
    const u = cleanUnits(units);
    if (sumUnits(u) < 1) return { ok: false, reason: 'Wybierz jednostki do przeniesienia' };
    for (const k of UNITS) {
      if (u[k] > from.units[k]) return { ok: false, reason: 'Za mało jednostek: ' + C.UNITS[k].name };
    }
    if (stay) {
      const room = supportRoom(state, to);
      if (unitsPop(u) > room) return { ok: false, reason: 'Za mało miejsca na farmie w ' + to.name + ' (wolne: ' + Math.max(0, room) + ')' };
    }
    UNITS.forEach(k => { from.units[k] -= u[k]; });
    const m = { id: newId(state, 'm'), type: 'support', stay, owner: from.owner, from: from.id, to: to.id,
      units: u, loot: null, start: t, arrive: t + travelTime(from, to, u) };
    state.movements.push(m);
    return { ok: true, movement: m };
  }
  function resolveSupport(state, m, t) {
    const to = state.villages[m.to], from = state.villages[m.from];
    if (to.owner === m.owner) {
      tickVillage(state, to, t);
      if (m.stay !== false || !from || from.owner !== m.owner) {
        UNITS.forEach(k => { to.units[k] += m.units[k]; });
        if (m.owner === 'player') notice(state, t, 'good', 'Wojsko dotarło do ' + to.name + '.');
      } else {
        to.support = to.support || {};
        const cur = to.support[m.from] || emptyUnits();
        UNITS.forEach(k => { cur[k] = (cur[k] || 0) + m.units[k]; });
        to.support[m.from] = cur;
        if (m.owner === 'player') notice(state, t, 'good', 'Wsparcie z ' + from.name + ' broni teraz ' + to.name + '.');
      }
    } else {
      state.movements.push({ id: newId(state, 'm'), type: 'return', owner: m.owner, from: m.from, to: m.to,
        units: m.units, loot: null, start: t, arrive: t + travelTime(to, from, m.units) });
      if (m.owner === 'player') notice(state, t, 'bad', 'Wioska ' + to.name + ' nie jest już Twoja – wojsko zawraca.');
    }
  }

  // Odwołanie wsparcia: oddział z originId stacjonujący w hostId wraca do domu.
  function withdrawSupport(state, hostId, originId, t) {
    const host = state.villages[hostId], origin = state.villages[originId];
    const u = host && host.support && host.support[originId];
    if (!u || !origin) return { ok: false, reason: 'Brak takiego wsparcia' };
    delete host.support[originId];
    const m = { id: newId(state, 'm'), type: 'return', owner: origin.owner, from: originId, to: hostId,
      units: Object.assign(emptyUnits(), u), loot: null, start: t, arrive: t + travelTime(host, origin, u) };
    state.movements.push(m);
    return { ok: true, movement: m };
  }

  /* ---------- kupcy ---------- */
  function merchantsTotal(v) { return C.BUILDINGS.market.merchants[v.buildings.market || 0]; }
  function merchantsBusy(state, v) {
    return state.movements.reduce((s, m) => s + ((m.type === 'transport' || m.type === 'trade-return') && m.from === v.id ? m.merchants : 0), 0);
  }
  function merchantsFree(state, v) { return Math.max(0, merchantsTotal(v) - merchantsBusy(state, v)); }
  function merchantTime(a, b) { return Math.round(dist(a, b) * C.MERCHANT.speed * 1000); }
  function sendTransport(state, fromId, toId, res, t) {
    const from = state.villages[fromId], to = state.villages[toId];
    if (!from || !to || from.id === to.id) return { ok: false, reason: 'Wybierz dwie różne wioski' };
    if (to.owner !== from.owner) return { ok: false, reason: 'Surowce można wysłać tylko do własnej wioski' };
    tickVillage(state, from, t);
    const r = {};
    RES.forEach(k => { r[k] = Math.max(0, Math.floor(Number(res && res[k]) || 0)); });
    const total = r.wood + r.clay + r.iron;
    if (total < 1) return { ok: false, reason: 'Wpisz ilość surowców' };
    for (const k of RES) if (r[k] > Math.floor(from.res[k])) return { ok: false, reason: 'Za mało surowca: ' + C.RESOURCES[k].name.toLowerCase() };
    const need = Math.ceil(total / C.MERCHANT.capacity);
    const free = merchantsFree(state, from);
    if (merchantsTotal(from) < 1) return { ok: false, reason: 'Zbuduj Targowisko w wiosce ' + from.name };
    if (need > free) return { ok: false, reason: 'Potrzeba ' + need + ' kupców, wolnych: ' + free };
    RES.forEach(k => { from.res[k] -= r[k]; });
    const m = { id: newId(state, 'm'), type: 'transport', owner: from.owner, from: from.id, to: to.id,
      units: emptyUnits(), res: r, merchants: need, start: t, arrive: t + merchantTime(from, to) };
    state.movements.push(m);
    return { ok: true, movement: m };
  }
  /* ---------- zbieranie i rozdzielanie surowców (wiele wiosek naraz) ---------- */
  // Surowce już jadące do wioski (transporty w drodze) – liczą się do zajętego miejsca w magazynie.
  function incomingRes(state, villageId) {
    const r = { wood: 0, clay: 0, iron: 0 };
    state.movements.forEach(m => {
      if (m.type === 'transport' && m.to === villageId) RES.forEach(k => { r[k] += m.res[k] || 0; });
    });
    return r;
  }
  function gatherReserve(v, pct) { return Math.ceil(storageCap(v) * Math.max(0, Math.min(100, Number(pct) || 0)) / 100); }

  // Plan bez skutków ubocznych (poza naliczeniem produkcji do chwili t).
  // opts: mode 'gather' (wszystko do celu) | 'spread' (z celu do reszty), res {wood,clay,iron: bool},
  //       reservePct (zostaje w wiosce wysyłającej), capToRoom (nie wysyłaj ponad wolne miejsce celu),
  //       off {id: true} – wioski pominięte przez gracza.
  function planGather(state, targetId, opts, t) {
    opts = opts || {};
    const mode = opts.mode === 'spread' ? 'spread' : 'gather';
    const target = state.villages[targetId];
    const plan = { mode, targetId, rows: [], total: 0, merchants: 0, lost: false };
    if (!target) return plan;
    const want = RES.filter(k => !opts.res || opts.res[k]);
    const capToRoom = opts.capToRoom !== false;
    const others = villagesOf(state, target.owner).filter(v => v.id !== target.id)
      .sort((a, b) => dist(a, target) - dist(b, target) || a.name.localeCompare(b.name, 'pl'));
    others.forEach(v => tickVillage(state, v, t));
    tickVillage(state, target, t);
    const mk = v => ({ villageId: v.id, off: !!(opts.off && opts.off[v.id]), skip: '', res: { wood: 0, clay: 0, iron: 0 },
      total: 0, merchants: 0, time: merchantTime(v, target) });
    const cap = C.MERCHANT.capacity;
    // Ile mieści się w magazynie wioski (z uwzględnieniem transportów w drodze).
    const roomOf = v => { const inc = incomingRes(state, v.id), c = storageCap(v), r = {};
      RES.forEach(k => { r[k] = Math.max(0, c - Math.floor(v.res[k]) - inc[k]); }); return r; };

    if (mode === 'gather') {
      const room = roomOf(target);
      others.forEach(v => {
        const row = mk(v); plan.rows.push(row);
        if (row.off) { row.skip = 'pominięta'; return; }
        if (merchantsTotal(v) < 1) { row.skip = 'brak Targowiska'; return; }
        const free = merchantsFree(state, v);
        if (free < 1) { row.skip = 'brak wolnych kupców'; return; }
        const avail = {}; let sum = 0;
        want.forEach(k => { avail[k] = Math.max(0, Math.floor(v.res[k]) - gatherReserve(v, opts.reservePct)); sum += avail[k]; });
        if (sum < 1) { row.skip = 'nic ponad rezerwę'; return; }
        const f = Math.min(1, free * cap / sum);                 // limit udźwigu kupców
        want.forEach(k => {
          let take = Math.floor(avail[k] * f);
          if (capToRoom) { take = Math.min(take, room[k]); room[k] -= take; } else room[k] -= take;
          row.res[k] = take;
        });
        row.total = row.res.wood + row.res.clay + row.res.iron;
        if (row.total < 1) { row.skip = 'magazyn celu pełny'; return; }
        row.merchants = Math.ceil(row.total / cap);
      });
      // Nadwyżka ponad magazyn celu (tylko gdy gracz wyłączył przycinanie).
      const cap0 = storageCap(target), inc0 = incomingRes(state, target.id);
      plan.lost = RES.some(k => Math.floor(target.res[k]) + inc0[k] + plan.rows.reduce((a, r) => a + r.res[k], 0) > cap0);
    } else {
      // Rozdzielanie: z celu (tu: wioska wysyłająca) po równo do pozostałych.
      const dests = others.map(v => { const row = mk(v); plan.rows.push(row);
        if (row.off) row.skip = 'pominięta'; return { v, row, room: roomOf(v) }; });
      const live = dests.filter(d => !d.row.skip);
      let left = merchantsFree(state, target);
      if (merchantsTotal(target) < 1) { live.forEach(d => { d.row.skip = 'brak Targowiska w wiosce źródłowej'; }); }
      else if (left < 1) { live.forEach(d => { d.row.skip = 'brak wolnych kupców'; }); }
      else {
        const share = {};
        want.forEach(k => {
          let A = Math.max(0, Math.floor(target.res[k]) - gatherReserve(target, opts.reservePct));
          let pool = live.slice();
          share[k] = new Map();
          while (A >= 1 && pool.length) {                         // wyrównywanie: pełne magazyny odpadają, reszta dzieli po równo
            const each = Math.floor(A / pool.length);
            if (each < 1) break;
            const full = capToRoom ? pool.filter(d => d.room[k] - (share[k].get(d) || 0) <= each) : [];
            if (!full.length) { pool.forEach(d => share[k].set(d, (share[k].get(d) || 0) + each)); A -= each * pool.length; break; }
            full.forEach(d => { const g = d.room[k] - (share[k].get(d) || 0); share[k].set(d, (share[k].get(d) || 0) + g); A -= g; });
            pool = pool.filter(d => !full.includes(d));
          }
        });
        live.forEach(d => {                                       // od najbliższej: kupcy rozdzielani po kolei
          want.forEach(k => { d.row.res[k] = Math.max(0, share[k].get(d) || 0); });
          let tot = d.row.res.wood + d.row.res.clay + d.row.res.iron;
          if (tot < 1) { d.row.skip = 'magazyn pełny'; return; }
          if (left < 1) { d.row.res = { wood: 0, clay: 0, iron: 0 }; d.row.skip = 'zabrakło kupców'; return; }
          const f = Math.min(1, left * cap / tot);
          if (f < 1) want.forEach(k => { d.row.res[k] = Math.floor(d.row.res[k] * f); });
          d.row.total = d.row.res.wood + d.row.res.clay + d.row.res.iron;
          if (d.row.total < 1) { d.row.skip = 'zabrakło kupców'; return; }
          d.row.merchants = Math.ceil(d.row.total / cap); left -= d.row.merchants;
        });
      }
      plan.lost = false;
    }
    plan.rows.forEach(r => { plan.total += r.total; plan.merchants += r.merchants; });
    return plan;
  }

  // Wysyła cały plan; każdy transport przechodzi zwykłą walidację sendTransport.
  function sendGather(state, plan, t) {
    const sent = [], failed = [];
    plan.rows.forEach(r => {
      if (r.skip || r.total < 1) return;
      const from = plan.mode === 'gather' ? r.villageId : plan.targetId;
      const to = plan.mode === 'gather' ? plan.targetId : r.villageId;
      const res = sendTransport(state, from, to, r.res, t);
      if (res.ok) sent.push(res.movement); else failed.push(res.reason);
    });
    if (!sent.length) return { ok: false, reason: failed[0] || 'Nic do wysłania', sent, failed };
    return { ok: true, sent, failed, total: sent.reduce((a, m) => a + m.res.wood + m.res.clay + m.res.iron, 0),
      first: Math.min.apply(null, sent.map(m => m.arrive)) };
  }

  /* ---------- zbieranie i rozdzielanie wojska (wiele wiosek naraz) ---------- */
  // Jednostki wybierane domyślnie: cała armia poza Osadnikiem i Zwiadowcami.
  function troopKinds(opts) {
    return UNITS.filter(k => opts && opts.units ? !!opts.units[k] : (k !== 'settler' && k !== 'scout'));
  }
  // Plan bez skutków ubocznych. opts: mode 'gather' (wszyscy do celu) | 'spread' (z celu po równo do reszty),
  //   units {k: bool}, reservePct (% wojska zostaje w wiosce wysyłającej), stay (przeniesienie na stałe zamiast wsparcia),
  //   capToRoom (przy stay: nie wysyłaj ponad wolne miejsce na farmie celu), off {id: true} – pominięte wioski.
  function planTroops(state, targetId, opts, t) {
    opts = opts || {};
    const mode = opts.mode === 'spread' ? 'spread' : 'gather';
    const stay = !!opts.stay, capToRoom = opts.capToRoom !== false;
    const target = state.villages[targetId];
    const plan = { mode, targetId, stay, rows: [], total: 0, pop: 0, lost: false };
    if (!target) return plan;
    const kinds = troopKinds(opts);
    const pct = Math.max(0, Math.min(100, Number(opts.reservePct) || 0));
    const others = villagesOf(state, target.owner).filter(v => v.id !== target.id)
      .sort((a, b) => dist(a, target) - dist(b, target) || a.name.localeCompare(b.name, 'pl'));
    others.forEach(v => tickVillage(state, v, t));
    tickVillage(state, target, t);
    const mk = v => ({ villageId: v.id, off: !!(opts.off && opts.off[v.id]), skip: '', units: emptyUnits(), total: 0, pop: 0, time: 0 });
    // Przycina oddział do wolnego miejsca na farmie (po równo ze wszystkich typów), zwraca zużyte miejsce.
    const fit = (u, room) => {
      const pop = unitsPop(u);
      if (pop <= room) return pop;
      const f = Math.max(0, room) / pop;
      kinds.forEach(k => { u[k] = Math.floor(u[k] * f); });
      return unitsPop(u);
    };
    if (!kinds.length) { others.forEach(v => { const r = mk(v); r.skip = 'wybierz jednostki'; plan.rows.push(r); }); return plan; }

    if (mode === 'gather') {
      let room = stay && capToRoom ? supportRoom(state, target) : Infinity;
      others.forEach(v => {
        const row = mk(v); plan.rows.push(row);
        if (row.off) { row.skip = 'pominięta'; return; }
        kinds.forEach(k => { row.units[k] = Math.max(0, v.units[k] - Math.ceil(v.units[k] * pct / 100)); });
        if (sumUnits(row.units) < 1) { row.skip = 'brak wojska'; return; }
        if (room <= 0) { row.units = emptyUnits(); row.skip = 'brak miejsca na farmie celu'; return; }
        room -= fit(row.units, room);
        row.total = sumUnits(row.units);
        if (row.total < 1) { row.skip = 'brak miejsca na farmie celu'; return; }
        row.pop = unitsPop(row.units); row.time = travelTime(v, target, row.units);
      });
    } else {
      // Rozdzielanie: z celu (tu: wioska wysyłająca) po równo do pozostałych; reszta z dzielenia trafia do najbliższych.
      const live = others.map(v => { const row = mk(v); plan.rows.push(row); if (row.off) row.skip = 'pominięta'; return { v, row }; })
        .filter(d => !d.row.skip);
      kinds.forEach(k => {
        const avail = Math.max(0, target.units[k] - Math.ceil(target.units[k] * pct / 100));
        if (!live.length) return;
        const each = Math.floor(avail / live.length);
        let rest = avail - each * live.length;
        live.forEach(d => { d.row.units[k] = each + (rest-- > 0 ? 1 : 0); });
      });
      live.forEach(d => {
        if (sumUnits(d.row.units) < 1) { d.row.skip = 'za mało wojska do podziału'; return; }
        if (stay && capToRoom) {
          if (supportRoom(state, d.v) <= 0) { d.row.units = emptyUnits(); d.row.skip = 'brak miejsca na farmie'; return; }
          fit(d.row.units, supportRoom(state, d.v));
        }
        d.row.total = sumUnits(d.row.units);
        if (d.row.total < 1) { d.row.skip = 'brak miejsca na farmie'; return; }
        d.row.pop = unitsPop(d.row.units); d.row.time = travelTime(target, d.v, d.row.units);
      });
    }
    plan.rows.forEach(r => { plan.total += r.total; plan.pop += r.pop; });
    return plan;
  }

  // Wysyła cały plan; każdy oddział przechodzi zwykłą walidację sendSupport.
  function sendTroops(state, plan, t) {
    const sent = [], failed = [];
    plan.rows.forEach(r => {
      if (r.skip || r.total < 1) return;
      const from = plan.mode === 'gather' ? r.villageId : plan.targetId;
      const to = plan.mode === 'gather' ? plan.targetId : r.villageId;
      const res = sendSupport(state, from, to, r.units, t, plan.stay ? 'stay' : 'support');
      if (res.ok) sent.push(res.movement); else failed.push(res.reason);
    });
    if (!sent.length) return { ok: false, reason: failed[0] || 'Nic do wysłania', sent, failed };
    return { ok: true, sent, failed, total: sent.reduce((a, m) => a + sumUnits(m.units), 0),
      first: Math.min.apply(null, sent.map(m => m.arrive)) };
  }

  function resolveTransport(state, m, t) {
    const to = state.villages[m.to], from = state.villages[m.from];
    let back = { wood: 0, clay: 0, iron: 0 };
    if (to.owner === m.owner) {
      tickVillage(state, to, t);
      const cap = storageCap(to);
      let lost = 0;
      RES.forEach(k => {
        const room = Math.max(0, cap - to.res[k]);
        const put = Math.min(room, m.res[k]);
        to.res[k] += put; lost += m.res[k] - put;
      });
      if (m.owner === 'player') notice(state, t, 'good', 'Kupcy dostarczyli surowce do ' + to.name + (lost > 0 ? ' (' + lost + ' nie zmieściło się w magazynie)' : '.'));
    } else {
      back = m.res;
      if (m.owner === 'player') notice(state, t, 'bad', 'Wioska ' + to.name + ' nie jest już Twoja – kupcy wracają z towarem.');
    }
    state.movements.push({ id: newId(state, 'm'), type: 'trade-return', owner: m.owner, from: m.from, to: m.to,
      units: emptyUnits(), res: back, merchants: m.merchants, start: t, arrive: t + merchantTime(to, from) });
  }

  /* ---------- zakładanie osad ---------- */
  function settleCheck(state, x, y) {
    const N = state.map.size;
    if (x < 0 || y < 0 || x >= N || y >= N) return 'Poza mapą';
    const tile = tileAt(state, x, y);
    if (tile.village) return 'Pole jest zajęte';
    if (tile.terrain !== 'plain') return 'Las i góry nie nadają się do zasiedlenia';
    if (Object.values(state.villages).some(v => dist(v, { x, y }) < C.SETTLE.minDistance)) return 'Za blisko innej wioski';
    return '';
  }
  function sendSettler(state, fromId, x, y, t) {
    const from = state.villages[fromId];
    if (!from) return { ok: false, reason: 'Nieznana wioska' };
    tickVillage(state, from, t);
    if (from.units.settler < 1) return { ok: false, reason: 'Brak Osadnika w wiosce ' + from.name };
    const why = settleCheck(state, x, y);
    if (why) return { ok: false, reason: why };
    if (state.movements.some(m => m.type === 'settle' && m.x === x && m.y === y && m.owner === from.owner)) return { ok: false, reason: 'Osadnicy już tam zmierzają' };
    from.units.settler -= 1;
    const u = emptyUnits(); u.settler = 1;
    const m = { id: newId(state, 'm'), type: 'settle', owner: from.owner, from: from.id, to: null, x, y,
      units: u, start: t, arrive: t + travelTime(from, { x, y }, u) };
    state.movements.push(m);
    return { ok: true, movement: m };
  }
  function resolveSettle(state, m, t) {
    const why = settleCheck(state, m.x, m.y);
    if (why) {
      const origin = state.villages[m.from];
      state.movements.push({ id: newId(state, 'm'), type: 'return', owner: m.owner, from: m.from, to: null, x: m.x, y: m.y,
        units: m.units, loot: null, start: t, arrive: t + travelTime({ x: m.x, y: m.y }, origin, m.units) });
      if (m.owner === 'player') notice(state, t, 'bad', 'Nie udało się założyć osady (' + m.x + ':' + m.y + '): ' + why.toLowerCase() + '. Osadnik wraca.');
      return;
    }
    const v = makeVillage(state, m.x, m.y, m.owner, C.SETTLE.buildings, emptyUnits(), C.SETTLE.resources, t);
    addReport(state, { id: newId(state, 'r'), time: t, kind: 'news', read: m.owner !== 'player', settled: true,
      attacker: m.owner, defender: null, toName: v.name, toX: v.x, toY: v.y, to: v.id });
    if (m.owner === 'player') {
      notice(state, t, 'good', 'Założono nową osadę: ' + v.name + ' (' + v.x + ':' + v.y + ')!');
      if (!state.ended && villagesOf(state, 'player').length >= winVillages(state)) state.ended = { type: 'victory', time: t, seen: false };
    }
  }

  /* ---------- zwiad ---------- */
  function snapshot(target, t) {
    return { time: t, units: defenders(target), res: { wood: Math.floor(target.res.wood), clay: Math.floor(target.res.clay), iron: Math.floor(target.res.iron) },
      buildings: Object.assign({}, target.buildings), loyalty: Math.floor(target.loyalty), owner: target.owner };
  }
  function resolveSpy(state, m, t) {
    const target = state.villages[m.to], origin = state.villages[m.from];
    tickVillage(state, target, t);
    if (target.owner === m.owner) { target.units.scout += m.units.scout; return; }
    const att = m.units.scout, def = target.units.scout;
    const success = att > def;
    const lost = success ? Math.min(att, Math.round(att * Math.pow(def / att, C.SPY.lossExponent))) : att;
    const survivors = emptyUnits(); survivors.scout = att - lost;
    const intel = success ? snapshot(target, t) : null;
    if (survivors.scout > 0) {
      state.movements.push({ id: newId(state, 'm'), type: 'return', owner: m.owner, from: m.from, to: m.to,
        units: survivors, loot: null, start: t, arrive: t + travelTime(target, origin, survivors) });
    }
    if (m.owner === 'player') {
      if (intel) state.intel[target.id] = intel;
      addReport(state, { id: newId(state, 'r'), time: t, kind: 'spy', read: false, attacker: m.owner, defender: target.owner,
        fromName: origin.name, fromX: origin.x, fromY: origin.y, from: origin.id, toName: target.name, toX: target.x, toY: target.y, to: target.id,
        sent: att, lost, success, intel });
      notice(state, t, success ? 'good' : 'bad', success ? 'Zwiad w ' + target.name + ' udany.' : 'Zwiadowcy zginęli w ' + target.name + '.');
    }
    if (target.owner === 'player' && def > 0) {
      addReport(state, { id: newId(state, 'r'), time: t, kind: 'spydef', read: false, attacker: m.owner, defender: 'player',
        fromName: origin.name, fromX: origin.x, fromY: origin.y, from: origin.id, toName: target.name, toX: target.x, toY: target.y, to: target.id,
        sent: att, lost, success });
      notice(state, t, success ? 'bad' : 'good', success ? 'Wrogi zwiad przejrzał ' + target.name + '.' : 'Twoi zwiadowcy zatrzymali wrogi zwiad w ' + target.name + '.');
    }
  }

  /* ---------- walka i podbój ---------- */
  function resolveAttack(state, m, t) {
    const target = state.villages[m.to];
    const origin = state.villages[m.from];
    tickVillage(state, target, t);

    // Cel w międzyczasie przeszedł na własność atakującego – wojsko wzmacnia wioskę.
    if (target.owner === m.owner) {
      UNITS.forEach(k => { target.units[k] += m.units[k]; });
      if (m.owner === 'player') notice(state, t, 'info', 'Wojsko dotarło do Twojej wioski ' + target.name + ' i ją wzmocniło.');
      return;
    }

    const defOwner = target.owner;
    const attUnits = Object.assign(emptyUnits(), m.units);
    const defUnits = defenders(target);
    const hadSupport = Object.keys(target.support || {}).length > 0;
    const wallBefore = target.buildings.wall || 0;
    const wallFight = Math.max(0, wallBefore - Math.floor(attUnits.ram / C.RAM.fightPerLevel));
    const luck = 1 + (rand(state) * 2 - 1) * C.COMBAT.luck;
    const A = attackPower(attUnits) * luck;
    const D = defenseFrom(defUnits, wallFight);
    const attLoss = emptyUnits(), defLoss = emptyUnits();
    const attackerWon = A > D;
    // obrońcy: własne wojsko i każdy oddział wsparcia tracą tę samą część
    const groups = [target.units].concat(Object.values(target.support || {}));
    if (attackerWon) {
      const ratio = Math.pow(D / A, C.COMBAT.lossExponent);
      UNITS.forEach(k => {
        attLoss[k] = Math.min(attUnits[k], Math.round(attUnits[k] * ratio));
        defLoss[k] = defUnits[k];
      });
      groups.forEach(g => UNITS.forEach(k => { g[k] = 0; }));
      target.support = {};
    } else {
      const ratio = Math.pow(A / D, C.COMBAT.lossExponent);
      UNITS.forEach(k => { attLoss[k] = attUnits[k]; });
      groups.forEach(g => UNITS.forEach(k => {
        const l = Math.min(g[k] || 0, Math.round((g[k] || 0) * ratio));
        g[k] -= l; defLoss[k] += l;
      }));
      for (const key in target.support) if (sumUnits(target.support[key]) === 0) delete target.support[key];
    }
    const survivors = emptyUnits();
    UNITS.forEach(k => { survivors[k] = attUnits[k] - attLoss[k]; });
    // tarany burzą mur na stałe
    let wallAfter = wallBefore;
    if (attackerWon && survivors.ram > 0 && wallBefore > 0) {
      wallAfter = Math.max(0, wallBefore - Math.floor(survivors.ram / C.RAM.destroyPerLevel));
      target.buildings.wall = wallAfter;
      target.buildQueue = target.buildQueue.filter(e => e.building !== 'wall');
    }
    const anyAlive = sumUnits(survivors) > 0;

    // Łupy
    const loot = { wood: 0, clay: 0, iron: 0 };
    let lootCapacity = 0, lootHidden = 0;
    if (attackerWon && anyAlive) {
      const capacity = UNITS.reduce((s, k) => s + survivors[k] * C.UNITS[k].carry, 0);
      lootCapacity = capacity;
      const avail = {}; let total = 0;
      const hidden = defOwner === 'player' ? Math.floor(storageCap(target) * diff(state).lootProtect) : 0;
      lootHidden = hidden;
      RES.forEach(r => { avail[r] = Math.max(0, Math.floor(target.res[r]) - hidden); total += avail[r]; });
      if (total > 0 && capacity > 0) {
        const take = Math.min(capacity, total);
        RES.forEach(r => { loot[r] = Math.floor(avail[r] * take / total); target.res[r] -= loot[r]; });
      }
    }

    // Podbój
    let conquered = false;
    const loyaltyBefore = Math.floor(target.loyalty);
    let loyaltyAfter = null;
    if (attackerWon && anyAlive) {
      if (defOwner === null) {
        conquered = true;
      } else if (survivors.noble > 0) {
        target.loyalty -= randInt(state, C.LOYALTY.dropMin, C.LOYALTY.dropMax);
        loyaltyAfter = Math.max(0, Math.floor(target.loyalty));
        if (target.loyalty <= 0) { conquered = true; survivors.noble -= 1; }
      }
    }
    if (conquered) changeOwner(state, target, m.owner, defOwner, t);

    // Powrót ocalałych
    if (sumUnits(survivors) > 0) {
      const back = { id: newId(state, 'm'), type: 'return', owner: m.owner, from: m.from, to: m.to,
        units: survivors, loot, start: t, arrive: t + travelTime(target, origin, survivors) };
      state.movements.push(back);
    }

    state.stats.battles++;
    let intel = null;
    if (m.owner === 'player' && attackerWon && anyAlive) {
      intel = snapshot(target, t);
      if (!(survivors.scout > 0)) { intel.res = null; intel.buildings = null; }
      state.intel[target.id] = intel;
    }
    const rep = {
      id: newId(state, 'r'), time: t, kind: m.owner === 'player' ? 'attack' : 'defense', read: false,
      attacker: m.owner, defender: defOwner,
      fromName: origin.name, fromX: origin.x, fromY: origin.y, from: origin.id,
      toName: target.name, toX: target.x, toY: target.y, to: target.id,
      attUnits, attLoss, defUnits, defLoss, attackerWon, loot, luck: Math.round((luck - 1) * 100),
      loyaltyBefore: defOwner !== null && attUnits.noble > 0 ? loyaltyBefore : null, loyaltyAfter, conquered,
      wallBefore, wallFight, wallAfter, hadSupport, lootCapacity, lootHidden,
      intel: intel && intel.buildings ? intel : null
    };
    if (m.owner === 'player' || defOwner === 'player') {
      addReport(state, rep);
      if (m.owner === 'player') {
        notice(state, t, attackerWon ? 'good' : 'bad', (attackerWon ? 'Zwycięstwo: ' : 'Porażka: ') + target.name +
          (conquered ? ' – wioska przejęta!' : ''));
      } else {
        notice(state, t, attackerWon ? 'bad' : 'good', (attackerWon ? 'Wioska ' + target.name + ' przegrała obronę' : 'Odparto atak na ' + target.name) +
          (conquered ? ' i została utracona!' : '.'));
      }
    } else if (conquered) {
      addReport(state, { id: newId(state, 'r'), time: t, kind: 'news', read: false, attacker: m.owner, defender: defOwner,
        toName: target.name, toX: target.x, toY: target.y, to: target.id, conquered: true });
    }
  }

  function changeOwner(state, v, newOwner, prevOwner, t) {
    v.owner = newOwner;
    v.loyalty = C.LOYALTY.afterConquest;
    v.buildQueue = [];
    v.recruitQueue = [];
    v.lastTick = t;
    v.support = {};
    // wojska tej wioski stacjonujące gdzie indziej tracą dom i rozchodzą się
    for (const id in state.villages) {
      const w = state.villages[id];
      if (w.support && w.support[v.id]) {
        if (w.owner === 'player') notice(state, t, 'bad', 'Wsparcie z utraconej wioski ' + v.name + ' opuściło ' + w.name + '.');
        delete w.support[v.id];
      }
    }
    if (newOwner === 'player' && state.intel) delete state.intel[v.id];
    state.stats.conquests++;
    if (prevOwner !== null && villagesOf(state, prevOwner).length === 0) {
      state.factions[prevOwner].alive = false;
      if (prevOwner === 'player') {
        if (!state.ended) state.ended = { type: 'defeat', time: t, seen: false };
      } else {
        addReport(state, { id: newId(state, 'r'), time: t, kind: 'news', read: false, eliminated: prevOwner,
          attacker: newOwner, defender: prevOwner, toName: v.name, toX: v.x, toY: v.y, to: v.id });
      }
    }
    if (newOwner === 'player' && !state.ended && villagesOf(state, 'player').length >= winVillages(state)) {
      state.ended = { type: 'victory', time: t, seen: false };
    }
  }

  function resolveReturn(state, m, t) {
    const v = state.villages[m.from];
    if (v.owner !== m.owner) {
      if (m.owner === 'player') notice(state, t, 'bad', (m.type === 'trade-return' ? 'Kupcy wrócili' : 'Wojsko wróciło') + ' do utraconej wioski ' + v.name + ' i rozproszyło się.');
      return;
    }
    tickVillage(state, v, t);
    UNITS.forEach(k => { v.units[k] += m.units[k]; });
    const cap = storageCap(v);
    const goods = m.loot || (m.type === 'trade-return' ? m.res : null);
    if (goods) RES.forEach(r => { v.res[r] = Math.max(v.res[r], Math.min(cap, v.res[r] + goods[r])); });
  }

  /* ---------- raporty i powiadomienia ---------- */
  function addReport(state, rep) {
    state.reports.unshift(rep);
    if (state.reports.length > 200) state.reports.length = 200;
  }
  function notice(state, t, kind, text) {
    state.notices.push({ t, kind, text });
    if (state.notices.length > 40) state.notices.splice(0, state.notices.length - 40);
  }

  /* ---------- CENTRALNY PROCESOR ZDARZEŃ ---------- */
  function nextEvent(state) {
    let best = null;
    const consider = (time, kind, ref) => { if (best === null || time < best.time) best = { time, kind, ref }; };
    for (const id in state.villages) {
      const v = state.villages[id];
      if (v.buildQueue.length) consider(v.buildQueue[0].end, 'build', id);
    }
    for (const m of state.movements) consider(m.arrive, 'move', m.id);
    for (const fid in state.factions) {
      const f = state.factions[fid];
      if (f.ai && f.alive) consider(f.nextThink, 'ai', fid);
    }
    return best;
  }

  function processEvent(state, ev) {
    const t = ev.time;
    if (ev.kind === 'build') {
      const v = state.villages[ev.ref];
      tickVillage(state, v, t);   // produkcja do chwili zmiany poziomu liczona po starej stawce
      const e = v.buildQueue.shift();
      v.buildings[e.building] = e.level;
      if (v.owner === 'player') notice(state, t, 'info', C.BUILDINGS[e.building].name + ' w ' + v.name + ' – poziom ' + e.level);
    } else if (ev.kind === 'move') {
      const i = state.movements.findIndex(m => m.id === ev.ref);
      const m = state.movements.splice(i, 1)[0];
      if (m.type === 'attack') resolveAttack(state, m, t);
      else if (m.type === 'spy') resolveSpy(state, m, t);
      else if (m.type === 'transport') resolveTransport(state, m, t);
      else if (m.type === 'support') resolveSupport(state, m, t);
      else if (m.type === 'settle') resolveSettle(state, m, t);
      else resolveReturn(state, m, t);
    } else if (ev.kind === 'ai') {
      const f = state.factions[ev.ref];
      f.nextThink = t + C.AI.thinkInterval * 1000;
      if (villagesOf(state, f.id).length === 0) { f.alive = false; return; }
      if (MP.AI) MP.AI.think(state, f.id, t);
    }
  }

  // Przesuwa świat gry do chwili `target`. Zwraca liczbę przetworzonych zdarzeń.
  function advance(state, target) {
    useDifficulty(state);
    if (!(target > state.now)) return 0;
    let count = 0;
    for (;;) {
      const ev = nextEvent(state);
      if (!ev || ev.time > target) break;
      if (ev.time < state.now) ev.time = state.now; // ochrona przed cofnięciem czasu
      processEvent(state, ev);
      state.now = Math.max(state.now, ev.time);
      if (++count > 20000000) break; // bezpiecznik na wypadek uszkodzonego zapisu
    }
    for (const id in state.villages) tickVillage(state, state.villages[id], target);
    state.now = target;
    return count;
  }

  function hiddenRes(state, v) { return v.owner === 'player' ? Math.floor(storageCap(v) * diff(state).lootProtect) : 0; }

  MP.Engine = {
    RES, UNITS, BUILDINGS, diff, useDifficulty, hiddenRes,
    rand, randInt, dist, emptyUnits, cleanUnits, sumUnits, attackPower, defensePower,
    tileAt, villagesOf, points, unitPoints, armyOf, accountPower, ownerName, ownerColor,
    newGame, worldOf, winVillages, productionPerMin, storageCap, popCap, popUsed, tickVillage,
    buildInfo, queueBuild, recruitInfo, queueRecruit, recruitPer,
    travelTime, slowest, sendAttack, sendSpy, advance, nextEvent,
    unitsPop, supportRoom, sendSupport, withdrawSupport, defenders, defenseFrom, villageDefense,
    merchantsTotal, merchantsBusy, merchantsFree, merchantTime, sendTransport, planGather, sendGather, planTroops, sendTroops, incomingRes, settleCheck, sendSettler
  };
})(typeof window !== 'undefined' ? window : globalThis);
