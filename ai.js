/* =========================================================================
   Mini Plemiona – PRZECIWNICY AI
   Lokalny skrypt decyzyjny (bez zewnętrznych API). Wywoływany przez
   centralny procesor zdarzeń co C.AI.thinkInterval sekund czasu gry –
   także wstecznie, gdy gra była zamknięta. Deterministyczny (E.rand).

   Każda tura frakcji:
   1. Gospodarka – kolejka budowy nigdy nie stoi: pilne potrzeby (farma,
      magazyn) mają pierwszeństwo, na następny budynek odkładana jest rezerwa.
   2. Wojsko – rekrutacja z nadwyżki ponad rezerwę; najpierw obrona domu do
      progu zależnego od osobowości i wielkości wioski, potem armia.
      Pełny magazyn = wydawanie wszystkiego, żeby nic się nie marnowało.
   3. Obrona – wioska z nadciągającym atakiem dostaje posiłki z sąsiednich.
   4. Rozrost – osadnicy, dowódcy podboju, dobijanie wiosek z obniżonym
      poparciem.
   5. Ataki – jedna lub dwie wyprawy naraz (osobowość), cele wybierane
      według siły obrony, odległości, łupu i poparcia oraz dyplomacji
      (pakt = brak ataku, zemsta za ataki, polowanie na lidera; diplomacy.js).
   Wszystkie liczby: C.AI w config.js.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const E = MP.Engine;
  const T = () => C.AI.tactics;

  function pickWeighted(state, pairs) {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = E.rand(state) * total;
    for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }

  function inProgress(state, v, unit) {
    let n = v.units[unit] || 0;
    v.recruitQueue.forEach(e => { if (e.unit === unit) n += e.count - e.done; });
    state.movements.forEach(m => { if (m.from === v.id && m.owner === v.owner) n += m.units[unit] || 0; });
    return n;
  }
  const noblesOf = (state, v) => inProgress(state, v, 'noble');
  const settlersOf = (state, v) => inProgress(state, v, 'settler');

  const storeRatio = v => { const cap = E.storageCap(v); return Math.max.apply(null, E.RES.map(r => v.res[r] / cap)); };
  const popRatio = (state, v) => E.popUsed(state, v) / Math.max(1, E.popCap(v));
  // Docelowa obrona domu: rośnie z rozbudową wioski (punkty) i zależy od osobowości.
  const homeDefTarget = (v, P) => E.points(v) * P.homeDef;
  const incomingOn = (state, v) => state.movements.filter(m => m.type === 'attack' && m.to === v.id && m.owner !== v.owner);

  // Największa liczba wiosek w rękach jednej frakcji (z graczem) – liczona raz na moment, nie dla każdej wioski.
  const leaderCache = new WeakMap();
  function leaderVillages(state, t) {
    const c = leaderCache.get(state);
    if (c && c.t === t) return c.n;
    const cnt = {};
    let n = 0;
    for (const id in state.villages) { const o = state.villages[id].owner; if (o) { cnt[o] = (cnt[o] || 0) + 1; if (cnt[o] > n) n = cnt[o]; } }
    leaderCache.set(state, { t, n });
    return n;
  }

  // Limit wiosek frakcji: bazowy (osobowość × poziom trudności) rośnie z czasem gry o C.AI.growth.perStep co everyHours,
  // ale nie ponad ceilingShare celu zwycięstwa świata (nigdy poniżej bazowego). Dzięki temu AI nie zatrzymuje się na ok. 9 wioskach.
  // Doganianie: gdy lider (zwykle gracz) ma dużo więcej wiosek, limit podnosi się do aiCatchUp × wioski lidera (też pod sufitem).
  function villageCap(state, P, t, settle) {
    const D = E.diff(state), X = D.aiExpand, G = C.AI.growth;
    const base = Math.ceil((settle ? (P.settleMax || P.maxVillages) : P.maxVillages) * X);
    const hours = Math.max(0, (t - state.created) / 3600000);
    const bonus = Math.round(Math.floor(hours / G.everyHours) * G.perStep * X);
    const ceiling = Math.ceil(E.winVillages(state) * (state.race ? G.ceilingShareRace : G.ceilingShare));
    const timed = Math.max(base, Math.min(base + bonus, ceiling));
    const catchUp = Math.min(ceiling, Math.ceil(leaderVillages(state, t) * (D.aiCatchUp || 0)));
    return Math.max(timed, catchUp);
  }

  // Strefa ochronna wokół wiosek gracza jest tylko na początek gry: z czasem słabnie do zera,
  // żeby rozrośnięty gracz nie odcinał AI od wolnej ziemi.
  function playerZoneNow(state, t) {
    const z = E.diff(state).playerZone || 0;
    const fade = C.AI.growth.zoneFadeHours;
    if (!z || !fade) return z;
    const hours = Math.max(0, (t - state.created) / 3600000);
    return Math.floor(z * Math.max(0, 1 - hours / fade));
  }

  // Presja na gracza (poziom Trudny): im dłużej dana frakcja nie uderzyła w żadną wioskę gracza, tym śmielej do tego dąży – niższe wymagane
  // przewagi i próg siły wyprawy, częstsze próby i większa waga gracza jako celu. Po udanym uderzeniu presja spada do zera.
  // Zwraca 0..1 (pomnożone przez DIFFICULTY.aiPressure; 0 = wyłączona na Łatwym i Normalnym).
  function pressureOf(state, t, fid) {
    const D = E.diff(state), k = D.aiPressure || 0, cfg = C.AI.pressure;
    if (!k || !cfg) return 0;
    let last = state.created + D.graceMinutes * 60000;
    const mine = state.lastHitBy && state.lastHitBy[fid];
    if (mine > last) last = mine; // presja liczona osobno dla każdej frakcji: cudze ataki jej nie zerują
    return Math.max(0, Math.min(1, ((t - last) / 60000 - cfg.startMin) / cfg.rampMin)) * k;
  }

  /* ---------- 1. gospodarka ---------- */
  // Zwraca koszt budynku, na który wioska oszczędza (albo null, gdy coś zakolejkowała / nie ma czego budować).
  function manageBuild(state, v, P, t) {
    if (v.buildQueue.length >= T().buildQueue) return null;
    const urgent = [];
    if (popRatio(state, v) > T().farmUrgent) urgent.push('farm');
    if (storeRatio(v) > T().storeUrgent) urgent.push('hq');
    const weighted = Object.keys(P.buildWeights).map(k => {
      const queued = v.buildQueue.filter(e => e.building === k).length;
      return { k, score: (v.buildings[k] + queued) / P.buildWeights[k] + E.rand(state) * 0.15 };
    }).sort((a, b) => a.score - b.score).map(o => o.k);
    const order = urgent.concat(weighted.filter(k => urgent.indexOf(k) < 0));
    for (let i = 0; i < order.length; i++) {
      const k = order[i];
      const info = E.buildInfo(state, v, k);
      if (info.ok) { E.queueBuild(state, v, k, t); return null; }
      // Blokuje Ratusz (limit poziomu albo za mały magazyn) – Ratusz wskakuje na następną pozycję.
      if ((info.code === 'hq' || info.code === 'storage') && order.indexOf('hq', i + 1) !== i + 1) order.splice(i + 1, 0, 'hq');
      if (info.code === 'resources') return info.cost;
    }
    return null;
  }

  /* ---------- 2. wojsko ---------- */
  function manageRecruit(state, v, P, t, reserve, owned) {
    if (v.recruitQueue.length >= T().recruitQueue) return false;
    const full = storeRatio(v) > T().storeSpend;

    // dowódca podboju
    if (P.nobles && v.buildings.barracks >= C.UNITS.noble.barracks && noblesOf(state, v) === 0 && owned < villageCap(state, P, t) &&
        E.villageDefense(v, null, E.upgradesOf(state, v.owner)) >= homeDefTarget(v, P) * 0.6) {
      const ri = E.recruitInfo(state, v, 'noble');
      if (ri.ok && ri.max >= 1) { E.queueRecruit(state, v, 'noble', 1, t); return true; }
      if (ri.code === 'resources' && !full && E.rand(state) < 0.5) return false; // odkłada surowce na dowódcę
    }
    // osadnik: rozrost na wolne ziemie
    if (P.settle && v.buildings.hq >= C.UNITS.settler.hq && owned < villageCap(state, P, t, true) && settlersOf(state, v) === 0 &&
        !state.movements.some(m => m.type === 'settle' && m.owner === v.owner) && E.rand(state) < T().settleChance) {
      const si = E.recruitInfo(state, v, 'settler');
      if (si.ok && si.max >= 1) { E.queueRecruit(state, v, 'settler', 1, t); return true; }
      if (si.code === 'resources' && !full) return false; // odkłada surowce na osadnika
    }

    const def = E.villageDefense(v, null, E.upgradesOf(state, v.owner));
    const threatened = incomingOn(state, v).length > 0;
    const needDef = def < homeDefTarget(v, P) * (threatened ? 1.5 : 1);
    const pool = Object.keys(C.UNITS).filter(u => {
      const U = C.UNITS[u];
      if (U.conquer || U.settler || v.buildings.barracks < U.barracks) return false;
      if (u === 'scout' && inProgress(state, v, 'scout') >= T().scoutCap) return false;
      if (U.wallPower && E.ramCount(v.units) >= T().siegeCap) return false;
      return needDef ? U.role === 'def' : (P.unitWeights[u] || 0) > 0;
    });
    if (!pool.length) return false;
    const unit = pickWeighted(state, pool.map(k => [k, needDef ? (P.unitWeights[k] || 0) + 1 : P.unitWeights[k]]));
    const U = C.UNITS[unit];
    const ri = E.recruitInfo(state, v, unit);
    if (!ri.ok) return false;
    // budżet: nadwyżka ponad rezerwę na budynek; przy pełnym magazynie albo zagrożeniu – wszystko
    const share = full || threatened ? 1 : P.recruitShare;
    const byBudget = Math.min.apply(null, E.RES.map(r => Math.floor(Math.max(0, v.res[r] - (reserve && !full && !threatened ? reserve[r] : 0)) * share / Math.max(1, U.cost[r]))));
    const n = Math.min(ri.max, byBudget, unit === 'scout' ? 3 : U.wallPower ? 5 : C.AI.maxOrder);
    if (n < 1) return false;
    return E.queueRecruit(state, v, unit, n, t).ok !== false;
  }

  /* ---------- 3. obrona: posiłki dla zagrożonej wioski ---------- */
  function sendReinforcements(state, fid, vs, P, t) {
    if (vs.length < 2) return;
    for (const v of vs) {
      const inc = incomingOn(state, v);
      if (!inc.length) continue;
      if (state.movements.some(m => m.type === 'support' && m.owner === fid && m.to === v.id)) continue; // już ktoś idzie
      const first = Math.min.apply(null, inc.map(m => m.arrive));
      const helpers = vs.filter(o => o.id !== v.id && E.dist(o, v) <= T().supportRange && !incomingOn(state, o).length)
        .sort((a, b) => E.dist(a, v) - E.dist(b, v));
      for (const h of helpers) {
        const spare = E.emptyUnits();
        let any = 0;
        // oddaje część obrońców ponad własne minimum
        const keep = homeDefTarget(h, P) * 0.7, hdef = E.villageDefense(h, null, E.upgradesOf(state, h.owner));
        if (hdef <= keep) continue;
        const frac = Math.min(T().supportShare, (hdef - keep) / hdef);
        Object.keys(C.UNITS).forEach(k => { if (C.UNITS[k].role === 'def') { spare[k] = Math.floor(h.units[k] * frac); any += spare[k]; } });
        if (any < 5) continue;
        if (t + E.travelTime(h, v, spare) > first) continue; // nie zdąży
        const room = E.supportRoom(state, v);
        if (E.unitsPop(spare) > room) {
          const scale = room / Math.max(1, E.unitsPop(spare));
          Object.keys(spare).forEach(k => { spare[k] = Math.floor(spare[k] * scale); });
          if (E.sumUnits(spare) < 5) continue;
        }
        if (E.sendSupport(state, h.id, v.id, spare, t, 'stay').ok) break;
      }
    }
  }

  /* ---------- 3b. zbiórka: jednostki ataku z zaplecza ściągane do wioski frontowej ---------- */
  // Rozproszona armia nie zdobędzie silnie bronionej wioski – frakcja co jakiś czas skupia ją w jednym miejscu.
  function gatherArmy(state, fid, vs, P, t) {
    if (!P.gatherChance || vs.length < 3 || E.rand(state) >= P.gatherChance) return;
    const front = vs.slice().sort((a, b) => E.attackPower(b.units) - E.attackPower(a.units))[0];
    if (incomingOn(state, front).length) return;
    let room = E.supportRoom(state, front);
    for (const o of vs) {
      if (o.id === front.id || room < 20 || E.dist(o, front) > T().gatherRange || incomingOn(state, o).length) continue;
      if (state.movements.some(m => m.from === o.id && m.owner === fid && m.type === 'attack')) continue;
      const u = E.emptyUnits();
      Object.keys(C.UNITS).forEach(k => { const U = C.UNITS[k]; if (U.role !== 'def' && !U.conquer && !U.settler && !U.scout) u[k] = o.units[k]; });
      if (E.attackPower(u) < P.minPower) continue;
      const pop = E.unitsPop(u);
      if (pop > room) { const sc = room / pop; Object.keys(u).forEach(k => { u[k] = Math.floor(u[k] * sc); }); }
      if (E.sumUnits(u) < 10) continue;
      if (E.sendSupport(state, o.id, front.id, u, t, 'stay').ok) room -= E.unitsPop(u);
    }
  }

  /* ---------- 4. rozrost ---------- */
  function trySettle(state, v, t) {
    if (v.units.settler < 1) return;
    const N = state.map.size;
    const zone = playerZoneNow(state, t), players = E.villagesOf(state, 'player');
    const R = Math.ceil(T().settleRange); // tylko okno wokół wioski – nie cała mapa (wydajność na dużych światach)
    // wioski w pobliżu liczone raz, zamiast przeglądać wszystkie dla każdego pola
    const near = Object.values(state.villages).filter(o => Math.abs(o.x - v.x) <= R + 3 && Math.abs(o.y - v.y) <= R + 3);
    let best = null;
    for (let y = Math.max(0, v.y - R); y <= Math.min(N - 1, v.y + R); y++) {
      for (let x = Math.max(0, v.x - R); x <= Math.min(N - 1, v.x + R); x++) {
        const p = { x, y }, d = E.dist(v, p);
        if (d < 1.5 || d > T().settleRange) continue;
        const tile = E.tileAt(state, x, y);
        if (tile.village || tile.terrain !== 'plain') continue;
        if (near.some(o => E.dist(o, p) < C.SETTLE.minDistance)) continue;
        if (zone && players.some(pv => E.dist(pv, p) <= zone)) continue;
        if (state.movements.some(m => m.type === 'settle' && m.x === x && m.y === y)) continue;
        const crowd = near.filter(o => E.dist(o, p) < 2.5).length;
        const score = d + crowd * 1.5 + E.rand(state);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    if (best && !E.settleCheck(state, best.x, best.y)) E.sendSettler(state, v.id, best.x, best.y, t);
  }

  function trySpy(state, v, P, t) {
    if (!P.spyChance || v.units.scout < 2 || E.rand(state) >= P.spyChance) return;
    if ((t - state.created) / 60000 < E.diff(state).graceMinutes) return;
    const targets = E.villagesOf(state, 'player').filter(p => E.dist(v, p) <= P.range && !(MP.Diplomacy && MP.Diplomacy.blocked(state, v.owner, 'player', t)));
    if (!targets.length) return;
    const target = targets[Math.floor(E.rand(state) * targets.length)];
    E.sendSpy(state, v.id, target.id, Math.min(v.units.scout, 3), t);
  }

  /* ---------- 5. ataki ---------- */
  function tryAttack(state, v, P, t, owned, playerAll, press) {
    const out = state.movements.filter(m => m.from === v.id && m.type === 'attack' && m.owner === v.owner).length;
    if (out >= (P.waves || 1) + (press >= 0.5 ? 1 : 0)) return; // pod presją jedna wyprawa więcej
    if (incomingOn(state, v).length) return; // nie wysyła wojska, gdy samo jest atakowane
    // obrońców zostawia tyle, żeby dom nie został pusty
    const send = E.emptyUnits();
    const target0 = homeDefTarget(v, P);
    Object.keys(C.UNITS).forEach(k => {
      const U = C.UNITS[k];
      if (U.conquer || U.settler || U.scout) return;
      send[k] = U.role === 'def' ? Math.floor(v.units[k] * (1 - P.keepHome)) : v.units[k];
    });
    const left = E.emptyUnits();
    Object.keys(C.UNITS).forEach(k => { left[k] = v.units[k] - send[k]; });
    if (E.defenseFrom(left, v.buildings.wall, E.upgradesOf(state, v.owner)) < target0 * 0.5) {
      Object.keys(C.UNITS).forEach(k => { if (C.UNITS[k].role === 'def') send[k] = 0; }); // tylko jednostki ataku
    }
    const A = E.attackPower(send, E.upgradesOf(state, v.owner));
    // armia zbiera się do sensownej wielkości (rośnie z rozbudową wioski) – zamiast wysyłać garstki co turę
    // Próg rośnie z czasem gry, więc wyprawy są coraz większe (a nie stałe garstki, które co chwilę giną lub wykrwawiają wroga).
    const hoursPlayed = Math.max(0, (t - state.created) / 3600000);
    const growth = Math.min(T().waveGrowthMax, 1 + hoursPlayed * T().waveGrowthPerHour);
    if (A < (P.minPower + E.points(v) * T().powerPerPoint) * growth * (1 - press * C.AI.pressure.powerCut)) return;

    const D = E.diff(state);
    const minutes = (t - state.created) / 60000;
    const grace = minutes < D.graceMinutes;
    const cooldown = D.hitCooldownMin * 60000;
    const cap = villageCap(state, P, t);
    const zone = playerZoneNow(state, t);
    const canTakeAny = P.targets === 'any' || minutes >= P.anyAfterMin;
    const busy = new Set(state.movements.filter(m => m.type === 'attack' && m.owner === v.owner).map(m => m.to));
    let best = null;
    for (const id in state.villages) {
      const target = state.villages[id];
      if (target.owner === v.owner || busy.has(id)) continue;
      if (target.owner !== null && !canTakeAny) continue;
      // dyplomacja: pakt = brak ataku; zemsta, lider i sympatia zmieniają atrakcyjność celu
      const dw = target.owner !== null && MP.Diplomacy ? MP.Diplomacy.targetWeight(state, v.owner, target.owner, t) : 1;
      if (dw <= 0) continue;
      // limit wiosek osiągnięty: wolne osady już tylko grabi (łup bez przejęcia)
      const raid = target.owner === null && owned >= cap;
      if (raid && !P.raids) continue;
      if (target.owner === null && zone && playerAll.some(pv => E.dist(pv, target) <= zone)) continue;
      if (target.owner === 'player' && (grace || (state.lastHit && t - (state.lastHit[target.id] || -1e15) < cooldown))) continue;
      const d = E.dist(v, target);
      // pod presją sięga dalej po gracza: do x(1+rangeBoost) zasięgu, a na dużych mapach co najmniej rangeMapShare boku mapy
      const reach = target.owner === 'player' ? P.range + press * Math.max(P.range * C.AI.pressure.rangeBoost, state.map.size * C.AI.pressure.rangeMapShare - P.range) : P.range;
      if (d > reach) continue;
      // okres ochronny: osady bliższe graczowi zostają dla niego
      if (grace && target.owner === null && playerAll.some(pv => E.dist(pv, target) < d)) continue;
      E.tickVillage(state, target, t);
      const wall = Math.max(0, target.buildings.wall - Math.floor(E.ramCount(send) / C.RAM.fightPerLevel));
      const Dv = E.villageDefense(target, wall, E.upgradesOf(state, target.owner));
      if (A < Dv * P.attackRatio * (target.owner === 'player' ? D.aiCaution * (1 - press * (1 - C.AI.pressure.ratioFloor)) : 1)) continue;
      let w = dw / (1 + d);
      w *= 1 + Math.min(2, (target.res.wood + target.res.clay + target.res.iron) / T().lootScale); // łup
      w *= 1 + Math.min(1, A / Math.max(1, Dv) / 6);                                              // łatwy cel
      if (raid) w *= P.raids;
      else if (target.owner === null) w *= P.neutralBias * (1 + (100 - target.loyalty) / 25); // dobija rozpoczęty podbój
      else {
        if (target.owner === 'player') w *= P.playerBias * D.playerBias * (1 + press * C.AI.pressure.biasBoost);
        if (P.nobles && target.loyalty != null && target.loyalty < 100) w *= 1 + (100 - target.loyalty) / 25; // dobijanie podboju
        if (P.nobles && v.units.noble > 0 && owned < cap) w *= 1.5;
      }
      if (!best || w > best.w) best = { target, w, raid };
    }
    if (!best) return;
    if (best.target.owner !== null && P.nobles && v.units.noble > 0 && owned < cap) send.noble = 1;
    E.sendAttack(state, v.id, best.target.id, send, t, 'attack', { raid: best.raid });
  }

  /* ---------- 0. ulepszenia jednostek (odpowiednik Technologii gracza) ---------- */
  // Poziom rośnie sam z czasem gry: po C.AI.tech.startAfterMin minutach co minutesPerLevel / DIFFICULTY.aiTech.
  // Ulubione jednostki frakcji (waga ≥ 1) dostają pełny poziom, pozostałe o 2 niższy. Nigdy nie maleje.
  const TECH_UNITS = () => C.TECH.nodes.filter(n => n.effect.type === 'unit').map(n => n.effect.unit);
  function aiTech(state, f, P, t) {
    const cfg = C.AI.tech, mult = E.diff(state).aiTech || 0;
    const minutes = (t - state.created) / 60000 - cfg.startAfterMin;
    if (minutes <= 0 || !mult) return;
    const L = Math.min(cfg.max, Math.floor(minutes * mult / cfg.minutesPerLevel));
    if (L < 1) return;
    f.upgrades = f.upgrades || {};
    TECH_UNITS().forEach(u => {
      const lvl = Math.max(0, (P.unitWeights[u] || 0) >= 1 ? L : L - 2);
      if (lvl > (f.upgrades[u] || 0)) f.upgrades[u] = lvl;
    });
  }

  function think(state, fid, t) {
    const f = state.factions[fid];
    const P = C.AI.personalities[f.personality];
    aiTech(state, f, P, t);
    if (MP.Diplomacy) MP.Diplomacy.tick(state, t);
    const vs = E.villagesOf(state, fid);
    for (const v of vs) {
      E.tickVillage(state, v, t);
      const reserve = manageBuild(state, v, P, t);
      for (let i = 0; i < 3; i++) if (!manageRecruit(state, v, P, t, reserve, vs.length)) break;
    }
    sendReinforcements(state, fid, vs, P, t);
    gatherArmy(state, fid, vs, P, t);
    const playerAll = E.villagesOf(state, 'player');
    const press = pressureOf(state, t, fid);
    for (const v of vs) {
      if (P.settle) trySettle(state, v, t);
      trySpy(state, v, P, t);
      if (E.rand(state) < P.attackChance * E.diff(state).aiAggro * (1 + press * C.AI.pressure.chanceBoost)) tryAttack(state, v, P, t, vs.length, playerAll, press);
    }
  }

  MP.AI = { think, villageCap, playerZoneNow, pressureOf };
})(typeof window !== 'undefined' ? window : globalThis);
