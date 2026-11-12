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
   6. Zmasowane uderzenia – wojsko ze wszystkich wiosek w zasięgu celu idzie jedną falą (5–10+ tys. żołnierzy), dochodzi jednocześnie (massStrike).
   Wojny AI z AI są rzadkie i duże (C.AI.versus): osobny próg siły, większa wymagana
   przewaga, przerwa między atakami tej samej pary frakcji i limit równoczesnych
   wypraw – dzięki temu armie rosną, zamiast wykrwawiać się w ciągłych potyczkach.
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

  /* ---------- siła fal: skład armii i posiłki gracza ---------- */
  const isOffUnit = k => { const U = C.UNITS[k]; return U.role !== 'def' && !U.conquer && !U.settler && !U.scout; };
  // Udział jednostek ofensywnych (wg populacji) w armii wioski, razem z tym, co czeka w kolejce rekrutacji.
  function offShareOf(v) {
    let off = 0, all = 0;
    const add = (k, n) => { const U = C.UNITS[k]; if (!n || U.conquer || U.settler || U.scout) return; all += n * U.pop; if (isOffUnit(k)) off += n * U.pop; };
    Object.keys(C.UNITS).forEach(k => add(k, v.units[k]));
    (v.recruitQueue || []).forEach(q => add(q.unit, Math.max(0, q.count - (q.done || 0))));
    return all > 0 ? off / all : 0;
  }
  // Docelowy udział ofensywy rośnie z czasem gry (do pełnej wartości po rampHours), żeby świeża gra nie zaczynała się od wojny totalnej.
  const offTarget = (state, t, P, press) => {
    const ramp = Math.min(1, Math.max(0, (t - state.created) / 3600000) / C.AI.war.rampHours);
    return Math.min(C.AI.war.offMax, ((P.offShare || 0) + press * C.AI.war.offPressure) * ramp);
  };

  // Obrona celu gracza z dodatkiem na posiłki: obrońcy z sąsiednich wiosek (Autopilot wysyła pomoc) liczą się częściowo,
  // inaczej AI szturmuje wioskę, która po drodze dostaje wsparcie, i fala ginie. Wynik zapamiętany na kilka minut gry.
  const reinfCache = new WeakMap();
  function playerDefenseWithHelp(state, target, Dv, t) {
    const R = C.AI.war.reinforce;
    if (!R || target.owner !== 'player') return Dv;
    let c = reinfCache.get(state);
    const bucket = Math.floor(t / 180000);
    if (!c || c.bucket !== bucket) { c = { bucket, map: {} }; reinfCache.set(state, c); }
    let extra = c.map[target.id];
    if (extra === undefined) {
      const ups = E.upgradesOf(state, 'player'), own = E.emptyUnits();
      extra = 0;
      for (const o of E.villagesOf(state, 'player')) {
        if (o.id === target.id || E.dist(o, target) > R.range) continue;
        Object.keys(C.UNITS).forEach(k => { own[k] = C.UNITS[k].role === 'def' ? (o.units[k] || 0) : 0; });
        extra += E.defensePower(own, ups);
      }
      c.map[target.id] = extra;
    }
    return Dv + Math.min(extra * R.share, Dv * R.capMult);
  }

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

  // Wojny AI z AI (C.AI.versus): ile wypraw frakcja ma teraz w drodze na inne frakcje AI i kiedy ostatnio uderzyła w daną.
  const isAIOwner = (state, o) => o !== null && o !== 'player' && !!(state.factions[o] && state.factions[o].ai);
  function aiWarsOut(state, fid) {
    return state.movements.filter(m => m.type === 'attack' && m.owner === fid && isAIOwner(state, state.villages[m.to] && state.villages[m.to].owner)).length;
  }
  function aiWarReady(state, fid, target, t, dw) {
    const V = C.AI.versus;
    if (aiWarsOut(state, fid) >= V.maxConcurrent) return false;
    const last = state.aiWar && state.aiWar[fid + '>' + target];
    return !(last && t - last < V.cooldownMin * 60000 * (dw > 1.2 ? V.revengeCooldown : 1)); // zemsta/lider: krótsza przerwa
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

  /* ---------- Cud świata (tylko tryb Wyścig) ---------- */
  // Po czasie startAfterMin AI wybiera swoją najlepszą wioskę (najwyższy Ratusz, potem największy magazyn) i dokłada poziomy Cudu,
  // gdy ta wioska ma zapas surowców (reserve × koszt). Pierwsza budowa jest ogłaszana graczowi z koordynatami, żeby mógł ją zdobyć.
  function manageWonder(state, fid, vs, t) {
    const W = C.WONDER, diff = E.diff(state);
    if (!state.race || !(diff.aiTech > 0) || !vs.length) return;
    if ((t - (state.created || 0)) / 60000 < W.ai.startAfterMin) return;
    let v = E.wonderVillage(state, fid);
    if (!v) {
      const ok = vs.filter(h => h.buildings.hq >= W.hq && (h.buildings.market || 0) >= W.market);
      if (!ok.length) return;
      v = ok.sort((a, b) => b.buildings.hq - a.buildings.hq || E.storageCap(b) - E.storageCap(a))[0];
    }
    E.tickVillage(state, v, t);
    const info = E.wonderInfo(state, v);
    if (!info.cost) return;
    if (!info.ok || E.RES.some(r => Math.floor(v.res[r]) < info.cost[r] * W.ai.reserve)) return;
    const first = E.wonderLevel(v) + E.wonderQueued(v) === 0;
    if (E.queueWonder(state, v, t).ok && first) {
      E.notice(state, t, 'danger', state.factions[fid].name + ' zaczęła budować Cud świata w wiosce ' + v.name + ' (' + v.x + '|' + v.y + '). Możesz ją zdobyć, zanim skończy.');
    }
  }

  /* ---------- 1b. handel: wymiana nadwyżek na brakujący surowiec (opcja gry state.aiTrade) ---------- */
  // Wymienia tylko wtedy, gdy nadwyżki całkowicie pokrywają niedobór (czyli wymiana faktycznie odblokowuje budowę albo partię wojska).
  // Celem jest koszt budynku, na który wioska oszczędza (reserve), a gdy go nie ma – partia ulubionej jednostki frakcji.
  // Zwraca true, gdy wymiana się odbyła.
  function manageTrade(state, v, P, t, reserve) {
    const cfg = C.AI.trade;
    if (!state.aiTrade || !cfg || !(E.merchantsTotal(v) > 0)) return false;
    if (v.aiTradeAt != null && t - v.aiTradeAt < cfg.cooldownMin * 60000) return false;
    let want = reserve;
    if (!want) {
      if (v.recruitQueue.length >= T().recruitQueue) return false;
      let best = null;
      Object.keys(C.UNITS).forEach(u => {
        const U = C.UNITS[u], w = P.unitWeights[u] || 0;
        if (U.conquer || U.settler || U.scout || v.buildings.barracks < U.barracks || w <= 0) return;
        if (!best || w > best.w) best = { u, w };
      });
      if (!best) return false;
      want = {};
      E.RES.forEach(r => { want[r] = C.UNITS[best.u].cost[r] * cfg.batch; });
    }
    const cap = E.storageCap(v), rate = E.aiExchangeRate();
    const deficit = {}, surplus = {};
    let need = 0;
    for (const r of E.RES) {
      if (want[r] > cap) return false; // nie zmieści się w magazynie – to problem Ratusza, nie handlu
      const have = Math.floor(v.res[r]);
      deficit[r] = Math.max(0, want[r] - have);
      surplus[r] = Math.max(0, have - Math.max(want[r], cap * cfg.keepShare));
      need += deficit[r];
    }
    if (need < 1) return false;
    let left = E.aiExchangeMax(v);
    const plan = [];
    const short = E.RES.filter(r => deficit[r] > 0).sort((a, b) => deficit[b] - deficit[a]);
    for (const d of short) {
      let gap = deficit[d];
      const donors = E.RES.filter(r => deficit[r] === 0 && surplus[r] > 0).sort((a, b) => surplus[b] - surplus[a]);
      for (const s of donors) {
        if (gap <= 0) break;
        let give = Math.ceil(gap / rate);
        while (Math.floor(give * rate + 1e-9) < gap) give++;
        give = Math.min(give, Math.floor(surplus[s]), left);
        if (give < 1) continue;
        plan.push([s, d, give]);
        surplus[s] -= give; left -= give;
        gap -= Math.floor(give * rate + 1e-9);
      }
      if (gap > 0) return false; // nadwyżek nie starcza na pokrycie niedoboru – nie wymienia nic
    }
    let done = false;
    plan.forEach(p => { if (E.aiExchange(state, v, p[0], p[1], p[2]).ok) done = true; });
    if (done) v.aiTradeAt = t;
    return done;
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
    const canBuild = u => {
      const U = C.UNITS[u];
      if (U.conquer || U.settler || v.buildings.barracks < U.barracks) return false;
      if (u === 'scout' && inProgress(state, v, 'scout') >= T().scoutCap) return false;
      if (U.wallPower && E.ramCount(v.units) >= T().siegeCap) return false;
      return true;
    };
    let pool = Object.keys(C.UNITS).filter(u => canBuild(u) && (needDef ? C.UNITS[u].role === 'def' : (P.unitWeights[u] || 0) > 0));
    // za mało ofensywy w wiosce: rekrutuje wyłącznie jednostki ataku (inaczej armie AI to prawie same piki i łucznicy)
    if (!needDef && offShareOf(v) < offTarget(state, t, P, pressureOf(state, t, v.owner))) {
      const offPool = pool.filter(u => isOffUnit(u) && u !== 'scout');
      if (offPool.length) pool = offPool;
    }
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
      if (state.aiPending && state.aiPending.some(x => x.from === o.id)) continue;   // oddział czeka na zmasowane uderzenie
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
    if (state.aiPending && state.aiPending.some(x => x.from === v.id)) return; // jego oddział czeka na zmasowane uderzenie
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
    // Wariant na gracza/frakcję: tylko część obrońców (dają mało ataku, a osłabiają dom). Na wolne osady idzie pełny skład jak dawniej.
    const sendH = Object.assign({}, send);
    Object.keys(C.UNITS).forEach(k => { if (C.UNITS[k].role === 'def') sendH[k] = Math.floor(send[k] * C.AI.war.waveDefShare); });
    const AH = E.attackPower(sendH, E.upgradesOf(state, v.owner));
    // armia zbiera się do sensownej wielkości (rośnie z rozbudową wioski) – zamiast wysyłać garstki co turę
    // Próg rośnie z czasem gry, więc wyprawy są coraz większe (a nie stałe garstki, które co chwilę giną lub wykrwawiają wroga).
    const hoursPlayed = Math.max(0, (t - state.created) / 3600000);
    const growth = Math.min(T().waveGrowthMax, 1 + hoursPlayed * T().waveGrowthPerHour);
    // Duży próg dotyczy wypraw na graczy i frakcje. Wolne osady mają słabą obronę (rośnie wolno), więc przy ich zajmowaniu
    // liczy się obrona celu (A ≥ Dv × attackRatio niżej) i tylko niewielki próg minimalny – inaczej im dłuższa gra,
    // tym bardziej rośnie wymagana armia i AI przestaje zajmować puste wioski.
    const fullNeed = (P.minPower + E.points(v) * T().powerPerPoint) * growth * (1 - press * C.AI.pressure.powerCut);
    const freeNeed = P.minPower * (T().freeMinShare || 0.5);
    if (A < freeNeed) return;

    const D = E.diff(state);
    const minutes = (t - state.created) / 60000;
    const grace = minutes < D.graceMinutes;
    const cooldown = D.hitCooldownMin * 60000;
    const cap = villageCap(state, P, t);
    // wyprawy już w drodze po nowe wioski (dowódcy, zajęcie wolnych osad) liczą się do limitu – inaczej kilka wiosek naraz przekracza sufit przy większych armiach
    const noblesAway = state.movements.filter(m => m.type === 'attack' && m.owner === v.owner && (m.units.noble > 0 ||
      (!m.raid && state.villages[m.to] && state.villages[m.to].owner === null))).length; // także wyprawy po wolne osady (zajęcie)
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
      const vs = isAIOwner(state, target.owner); // cel to inna frakcja AI
      if (vs && !aiWarReady(state, v.owner, target.owner, t, dw)) continue;
      // większe armie nie mogą zamienić się w ciągły szturm na gracza: odstęp między wyprawami jednej frakcji na gracza
      if (target.owner === 'player') { const lp = state.aiWar && state.aiWar[v.owner + '>player']; if (lp && t - lp < C.AI.versus.playerSpacingMin * 60000) continue; }
      // limit wiosek osiągnięty: wolne osady już tylko grabi (łup bez przejęcia)
      const raid = target.owner === null && owned + noblesAway >= cap;
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
      const Dv0 = E.villageDefense(target, wall, E.upgradesOf(state, target.owner));
      const Dv = playerDefenseWithHelp(state, target, Dv0, t);
      const heavy = target.owner !== null && !raid;   // gracz i frakcje: wyprawa bez większości obrońców
      const Ae = heavy ? AH : A;
      if (!(target.owner === null && !raid) && Ae < fullNeed * (vs ? C.AI.versus.powerMult : 1)) continue; // pełny próg: gracz, frakcje i grabież
      if (Ae < Dv * P.attackRatio * (target.owner === 'player' ? D.aiCaution * (1 - press * (1 - C.AI.pressure.ratioFloor)) : vs ? C.AI.versus.ratioMult : 1)) continue;
      let w = dw / (1 + d) * (vs ? C.AI.versus.weightMult : 1);
      w *= 1 + Math.min(2, (target.res.wood + target.res.clay + target.res.iron) / T().lootScale); // łup
      w *= 1 + Math.min(1, Ae / Math.max(1, Dv) / 6);                                             // łatwy cel
      if (raid) w *= P.raids;
      else if (target.owner === null) w *= P.neutralBias * (1 + (100 - target.loyalty) / 25); // dobija rozpoczęty podbój
      else {
        if (target.owner === 'player') w *= P.playerBias * D.playerBias * (1 + press * C.AI.pressure.biasBoost);
        if (P.nobles && target.loyalty != null && target.loyalty < 100) w *= 1 + (100 - target.loyalty) / 25; // dobijanie podboju
        if (P.nobles && v.units.noble > 0 && owned + noblesAway < cap) w *= 1.5;
      }
      if (!best || w > best.w) best = { target, w, raid };
    }
    if (!best) return;
    const wave = best.target.owner !== null && !best.raid ? sendH : send;
    if (best.target.owner !== null && P.nobles && v.units.noble > 0 && owned + noblesAway < cap) wave.noble = 1;
    const sent = E.sendAttack(state, v.id, best.target.id, wave, t, 'attack', { raid: best.raid });
    if ((best.target.owner === 'player' || isAIOwner(state, best.target.owner)) && !(sent && sent.ok === false)) {
      state.aiWar = state.aiWar || {};
      state.aiWar[v.owner + '>' + best.target.owner] = t;
    }
  }

  /* ---------- 5b. zmasowane uderzenia: wojsko ze wszystkich wiosek w jednej fali ---------- */
  // Pojedyncza wioska wysyła tylko to, co ma w domu, więc wyprawy były garstkami (setki–kilka tysięcy) i nie ruszały dobrze bronionych wiosek.
  // Tu frakcja liczy siłę wszystkich wiosek w zasięgu celu i posyła je naraz: najdalsze wychodzą od razu, bliższe z opóźnieniem (state.aiPending),
  // tak by całe uderzenie dotarło jednocześnie.
  const massCfg = () => C.AI.mass;

  // Co dana wioska może dołożyć do uderzenia: cały atak, a z jednostek obronnych defShare (ale nigdy tyle, by dom został bez obrony).
  function massContribution(state, v, P, ups) {
    if (incomingOn(state, v).length) return null;
    const M = massCfg(), send = E.emptyUnits(), left = E.emptyUnits();
    Object.keys(C.UNITS).forEach(k => {
      const U = C.UNITS[k];
      if (U.conquer || U.settler || U.scout) return;
      send[k] = U.role === 'def' ? Math.floor(v.units[k] * Math.min(M.defShare, 1 - P.keepHome)) : v.units[k];
    });
    Object.keys(C.UNITS).forEach(k => { left[k] = v.units[k] - send[k]; });
    if (E.defenseFrom(left, v.buildings.wall, ups) < homeDefTarget(v, P) * 0.4) Object.keys(C.UNITS).forEach(k => { if (C.UNITS[k].role === 'def') send[k] = 0; });
    const n = E.sumUnits(send);
    return n < 1 ? null : { v, send, n, A: E.attackPower(send, ups) };
  }

  function massStrike(state, fid, vs, P, t, press, playerAll) {
    const M = massCfg();
    if (!M || vs.length < 2) return;
    state.aiMass = state.aiMass || {};
    const last = state.aiMass[fid];
    if (last && t - last < M.everyMin * 60000) return;
    if (E.rand(state) >= M.chance) return;
    const D = E.diff(state);
    const grace = (t - state.created) / 60000 < D.graceMinutes;
    const pend = new Set((state.aiPending || []).map(x => x.from));
    const ups = E.upgradesOf(state, fid);
    const mine = [];
    for (const v of vs) {
      if (pend.has(v.id) || state.movements.some(m => m.type === 'attack' && m.from === v.id && m.owner === fid)) continue;
      const c = massContribution(state, v, P, ups);
      if (c) mine.push(c);
    }
    if (mine.length < 2) return;
    const busy = new Set(state.movements.filter(m => m.type === 'attack' && m.owner === fid).map(m => m.to));
    (state.aiPending || []).forEach(x => { if (x.fid === fid) busy.add(x.to); });
    const allowVs = E.rand(state) < M.versusShare;
    const cap = villageCap(state, P, t);
    let best = null;
    for (const id in state.villages) {
      const target = state.villages[id];
      if (target.owner === fid || target.owner === null || busy.has(id)) continue;
      const toPlayer = target.owner === 'player';
      if (toPlayer ? grace : !allowVs) continue;
      if (toPlayer && state.lastHit && t - (state.lastHit[id] || -1e15) < D.hitCooldownMin * 60000) continue;
      const dw = MP.Diplomacy ? MP.Diplomacy.targetWeight(state, fid, target.owner, t) : 1;
      if (dw <= 0) continue;
      if (!toPlayer && !aiWarReady(state, fid, target.owner, t, dw)) continue;
      const pool = mine.filter(c => E.dist(c.v, target) <= M.range).sort((a, b) => E.dist(a.v, target) - E.dist(b.v, target));
      if (pool.length < 2) continue;
      E.tickVillage(state, target, t);
      const rams = pool.reduce((n, c) => n + E.ramCount(c.send), 0);
      const Dv0 = E.villageDefense(target, Math.max(0, target.buildings.wall - Math.floor(rams / C.RAM.fightPerLevel)), E.upgradesOf(state, target.owner));
      const Dv = playerDefenseWithHelp(state, target, Dv0, t);
      const need = Dv * M.ratio * (toPlayer ? D.aiCaution * (1 - press * (1 - C.AI.pressure.ratioFloor)) : C.AI.versus.ratioMult);
      // dokłada wioski od najbliższej, aż siła i liczebność wystarczą (z zapasem overkill), maks. maxVillages
      const use = []; let A = 0, n = 0;
      for (const c of pool) {
        if (use.length >= M.maxVillages) break;
        use.push(c); A += c.A; n += c.n;
        if (A >= need * M.overkill && n >= M.minUnits) break;
      }
      if (A < need || n < M.minUnits) continue;
      let w = dw / (1 + E.dist(use[0].v, target));
      w *= 1 + Math.min(2, (target.res.wood + target.res.clay + target.res.iron) / T().lootScale);
      w *= 1 + Math.min(1, A / Math.max(1, Dv) / 6);
      if (toPlayer) w *= P.playerBias * D.playerBias * (1 + press * C.AI.pressure.biasBoost);
      else w *= C.AI.versus.weightMult;
      if (!best || w > best.w) best = { target, use, w, toPlayer };
    }
    if (!best) return;
    const target = best.target;
    // Dowódca podboju idzie z ostatnią falą (po wybiciu obrony), o ile frakcja może jeszcze mieć wioski
    const noblers = P.nobles && vs.length < cap ? best.use.filter(c => c.v.units.noble > 0) : [];
    const noble = noblers.length ? noblers[noblers.length - 1] : null;
    if (noble) noble.send.noble = 1;
    const times = best.use.map(c => E.travelTime(c.v, target, c.send));
    const slow = Math.max.apply(null, times);
    state.aiPending = state.aiPending || [];
    let sent = 0;
    best.use.forEach((c, i) => {
      const delay = slow - times[i] + (c === noble ? M.spreadSec * 1000 : 0);
      if (delay < C.AI.thinkInterval * 1000 / 2) { if (E.sendAttack(state, c.v.id, target.id, c.send, t, 'attack').ok) sent++; }
      else { state.aiPending.push({ fid, from: c.v.id, to: target.id, units: c.send, at: t + delay }); sent++; }
    });
    if (!sent) return;
    state.aiMass[fid] = t;
    state.aiWar = state.aiWar || {};
    state.aiWar[fid + '>' + target.owner] = t;
  }

  // Opóźnione oddziały zmasowanych uderzeń: wysyłane, gdy nadejdzie ich czas, tak by dotarły razem z resztą.
  function massPending(state, fid, t) {
    const list = state.aiPending;
    if (!list || !list.length) return;
    state.aiPending = list.filter(x => {
      if (x.fid !== fid) return true;
      if (t < x.at) return true;
      const v = state.villages[x.from], o = state.villages[x.to];
      if (!v || !o || v.owner !== fid || o.owner === fid || t > x.at + 5 * 60000) return false;
      const u = E.emptyUnits();
      Object.keys(x.units).forEach(k => { u[k] = Math.min(x.units[k], v.units[k] || 0); });
      if (E.sumUnits(u) >= 1) E.sendAttack(state, v.id, o.id, u, t, 'attack');
      return false;
    });
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
    massPending(state, fid, t);
    if (MP.Diplomacy) MP.Diplomacy.tick(state, t);
    const vs = E.villagesOf(state, fid);
    for (const v of vs) {
      E.tickVillage(state, v, t);
      let reserve = manageBuild(state, v, P, t);
      if (manageTrade(state, v, P, t, reserve) && reserve) reserve = manageBuild(state, v, P, t); // po wymianie budowa może już ruszyć
      for (let i = 0; i < 3; i++) if (!manageRecruit(state, v, P, t, reserve, vs.length)) break;
    }
    manageWonder(state, fid, vs, t);
    sendReinforcements(state, fid, vs, P, t);
    gatherArmy(state, fid, vs, P, t);
    const playerAll = E.villagesOf(state, 'player');
    const press = pressureOf(state, t, fid);
    massStrike(state, fid, vs, P, t, press, playerAll);
    for (const v of vs) {
      if (P.settle) trySettle(state, v, t);
      trySpy(state, v, P, t);
      if (E.rand(state) < P.attackChance * E.diff(state).aiAggro * (1 + press * C.AI.pressure.chanceBoost)) tryAttack(state, v, P, t, vs.length, playerAll, press);
    }
  }

  MP.AI = { think, villageCap, playerZoneNow, pressureOf, manageTrade };
})(typeof window !== 'undefined' ? window : globalThis);
