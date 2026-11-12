/* =========================================================================
   Mini Plemiona – AUTOPILOT (bot rozwijający Twoje wioski)
   Działa w centralnym procesorze zdarzeń (zdarzenie 'pilot'), więc – tak jak AI –
   nadrabia czas także wstecznie, gdy gra była zamknięta lub uśpiona.
   Co robi w każdej turze (C.PILOT.tickSec sekund czasu gry):
   1. Obrona – nowy atak na Twoją wioskę = natychmiastowa tura: posiłki z innych wiosek
      (tylko jednostki obronne, tylko takie, które zdążą przed atakiem); po ataku wracają.
      Wioski przygraniczne (wróg w zasięgu ataku) dostają stały garnizon: wyższy cel szkolenia obrony
      i dosyłanie nadwyżek obrony z zaplecza (przeniesienie na stałe) – bo na ostrzeżenie często brakuje czasu.
   2. Budowa – kolejka każdej wioski stale zapełniona (pilne: Farma, Ratusz/magazyn).
   3. Wojsko – jednostki obronne do celu zależnego od rozbudowy wioski, kilku zwiadowców,
      opcjonalnie armia ataku; przy zagrożeniu wszystkie surowce idą na obronę.
   4. Technologia – nadwyżki surowców -> monety (Targowisko) -> badania wg priorytetów.
   5. Podbój (opcja „attack”) – Dowódcy, Tarany i armia ataku; zwiad celu, zbiórka armii w najsilniejszej wiosce,
      fale z Dowódcą na wioski innych frakcji (bez paktu), aż poparcie spadnie do 0.
   Bot nie podgląda sił wroga bez zwiadu (tak jak Ty: „siła nieznana”). Wszystkie liczby: C.PILOT.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const E = MP.Engine;
  const P = () => C.PILOT;

  const own = state => E.villagesOf(state, 'player');
  const storeRatio = v => { const cap = E.storageCap(v); return Math.max.apply(null, E.RES.map(r => v.res[r] / cap)); };
  const popRatio = (state, v) => E.popUsed(state, v) / Math.max(1, E.popCap(v));
  const incomingOn = (state, v) => state.movements.filter(m => m.type === 'attack' && m.owner !== 'player' && m.to === v.id);
  const isDef = k => C.UNITS[k].role === 'def';
  // Wioska przygraniczna: w zasięgu ataku leży wioska innej frakcji (z paktem o nieagresji nie liczy się).
  function exposed(state, v, t) {
    return Object.values(state.villages).some(o => o.owner && o.owner !== 'player' && E.dist(o, v) <= P().garrisonRange &&
      !(MP.Diplomacy && MP.Diplomacy.blocked(state, o.owner, 'player', t)));
  }

  function note(state, p, t, text) {
    p.log.push({ t, text });
    if (p.log.length > P().logMax) p.log.splice(0, p.log.length - P().logMax);
  }

  /* ---------- 1. obrona ---------- */
  function defend(state, p, vs, t, acts, threatened) {
    const ups = E.upgradesOf(state, 'player');
    const attacks = state.movements.filter(m => m.type === 'attack' && m.owner !== 'player' && state.villages[m.to] && state.villages[m.to].owner === 'player');
    const live = {};
    attacks.forEach(m => { live[m.id] = 1; });
    Object.keys(p.seen).forEach(id => { if (!live[id]) delete p.seen[id]; });

    const byTarget = {};
    attacks.forEach(m => { (byTarget[m.to] = byTarget[m.to] || []).push(m); });
    Object.keys(byTarget).forEach(tid => {
      const v = state.villages[tid], list = byTarget[tid];
      threatened[tid] = true;
      p.threat[tid] = t;
      if (!list.some(m => !p.seen[m.id])) return;          // wszystkie ataki na tę wioskę już obsłużone
      list.forEach(m => { p.seen[m.id] = t; });
      if (!p.defend) return;
      const first = Math.min.apply(null, list.map(m => m.arrive));
      const goal = E.points(v) * p.defLevel * P().supportGoal;
      let have = E.villageDefense(v, null, ups);
      state.movements.forEach(m => { if (m.type === 'support' && m.owner === 'player' && m.to === v.id) have += E.defensePower(m.units, ups); });
      const helpers = vs.filter(h => h.id !== v.id && !incomingOn(state, h).length).sort((a, b) => E.dist(a, v) - E.dist(b, v));
      let sentFrom = 0, sentUnits = 0;
      for (const h of helpers) {
        if (have >= goal) break;
        const spare = E.emptyUnits();
        let n = 0;
        Object.keys(C.UNITS).forEach(k => { if (isDef(k)) { spare[k] = Math.floor(h.units[k] * P().supportShare); n += spare[k]; } });
        if (n < P().supportMin) continue;
        if (t + E.travelTime(h, v, spare, 'player') >= first) continue;   // nie zdąży
        const r = E.sendSupport(state, h.id, v.id, spare, t, 'support');
        if (!r.ok) continue;
        have += E.defensePower(spare, ups);
        p.deployed[v.id + '|' + h.id] = t;
        sentFrom++; sentUnits += n;
      }
      if (sentFrom) {
        acts.support += sentFrom;
        const txt = 'Obrona dla ' + v.name + ': ' + sentUnits + ' jednostek z ' + sentFrom + ' wiosek';
        E.notice(state, t, 'info', 'Autopilot – ' + txt + '.');
        note(state, p, t, txt);
      } else {
        note(state, p, t, 'Atak na ' + v.name + ': brak posiłków, które zdążą');
      }
    });
  }

  /* ---------- 1b. garnizony na froncie ---------- */
  // Wioski z zaplecza (bez wrogów w zasięgu) przenoszą na stałe nadwyżkę obrony do wiosek przygranicznych.
  function garrison(state, p, vs, t, acts, threatened) {
    if (p.garrison === false || vs.length < 2) return;
    if (p.garrisonAt && t < p.garrisonAt) return;
    p.garrisonAt = t + P().garrisonEveryMin * 60000;
    const ups = E.upgradesOf(state, 'player');
    const front = [], rear = [];
    vs.forEach(v => { (exposed(state, v, t) ? front : rear).push(v); });
    if (!front.length || !rear.length) return;
    const need = v => E.points(v) * p.defLevel * P().garrisonGoal;
    front.sort((a, b) => (E.villageDefense(a, null, ups) / Math.max(1, need(a))) - (E.villageDefense(b, null, ups) / Math.max(1, need(b))));
    for (const f of front) {
      let have = E.villageDefense(f, null, ups);
      state.movements.forEach(m => { if (m.type === 'support' && m.owner === 'player' && m.to === f.id) have += E.defensePower(m.units, ups); });
      const goal = need(f);
      if (have >= goal) continue;
      const helpers = rear.filter(h => !threatened[h.id] && !incomingOn(state, h).length).sort((a, b) => E.dist(a, f) - E.dist(b, f));
      let sentUnits = 0, sentFrom = 0;
      for (const h of helpers) {
        if (have >= goal) break;
        const hdef = E.villageDefense(h, null, ups), keep = E.points(h) * p.defLevel * P().garrisonKeep;
        if (hdef <= keep) continue;
        const frac = Math.min(P().garrisonShare, (hdef - keep) / hdef);
        const spare = E.emptyUnits();
        let n = 0;
        Object.keys(C.UNITS).forEach(k => { if (isDef(k)) { spare[k] = Math.floor(h.units[k] * frac); n += spare[k]; } });
        const room = E.supportRoom(state, f);
        if (E.unitsPop(spare) > room) {
          const sc = Math.max(0, room) / Math.max(1, E.unitsPop(spare));
          n = 0; Object.keys(spare).forEach(k => { spare[k] = Math.floor(spare[k] * sc); n += spare[k]; });
        }
        if (n < P().supportMin) continue;
        if (!E.sendSupport(state, h.id, f.id, spare, t, 'stay').ok) continue;
        have += E.defensePower(spare, ups);
        sentUnits += n; sentFrom++;
      }
      if (sentFrom) {
        acts.garrisoned += sentUnits;
        note(state, p, t, 'Garnizon dla ' + f.name + ': ' + sentUnits + ' jednostek z ' + sentFrom + ' wiosek zaplecza');
      }
    }
  }

  // Po zakończeniu zagrożenia wsparcie wysłane przez bota wraca do domu.
  function recall(state, p, t, acts) {
    Object.keys(p.deployed).forEach(key => {
      const parts = key.split('|'), host = state.villages[parts[0]], origin = state.villages[parts[1]];
      if (!host || !origin || host.owner !== 'player' || origin.owner !== 'player') { delete p.deployed[key]; return; }
      if (!host.support || !host.support[origin.id]) {
        // wsparcie jeszcze w drodze albo już odwołane – po godzinie przestajemy śledzić
        if (t - p.deployed[key] > 3600000) delete p.deployed[key];
        return;
      }
      if (incomingOn(state, host).length) return;
      if (t - (p.threat[host.id] || 0) < P().recallMin * 60000) return;
      if (E.withdrawSupport(state, host.id, origin.id, t).ok) { delete p.deployed[key]; acts.recalled++; }
    });
  }

  /* ---------- 2. budowa ---------- */
  function buildVillage(state, v, p, t, acts) {
    const depth = Math.min(P().buildDepth, E.queueMax(v, 'build'));
    const W = P().buildWeights;
    let saving = null;
    for (let guard = 0; guard < 12 && v.buildQueue.length < depth; guard++) {
      const urgent = [];
      if (popRatio(state, v) > P().farmUrgent) urgent.push('farm');
      if (storeRatio(v) > P().storeUrgent) urgent.push('hq');
      const order = urgent.concat(Object.keys(W).map(k => {
        const queued = v.buildQueue.filter(e => e.building === k).length;
        return { k, score: (v.buildings[k] + queued) / W[k] };
      }).sort((a, b) => a.score - b.score).map(o => o.k).filter(k => urgent.indexOf(k) < 0));
      let queuedOne = false;
      for (let i = 0; i < order.length; i++) {
        const k = order[i], info = E.buildInfo(state, v, k);
        if (info.ok) { E.queueBuild(state, v, k, t); acts.built++; queuedOne = true; break; }
        // blokuje Ratusz albo za mały magazyn – Ratusz wskakuje na następną pozycję
        if ((info.code === 'hq' || info.code === 'storage') && order.indexOf('hq', i + 1) !== i + 1 && k !== 'hq') order.splice(i + 1, 0, 'hq');
        if (info.code === 'resources') { saving = info.cost; break; }      // oszczędza na ten budynek
        if (info.code === 'queue') break;
      }
      if (!queuedOne) break;
    }
    return saving;
  }

  /* ---------- 2b. zasilanie wiosek z brakiem surowców na budowę ---------- */
  // Wioska, która czeka na surowce na następny budynek (kolejka pusta albo niepełna), dostaje surowce
  // od wiosek, które mają je ponad własną rezerwę – nie tylko brakujące na budynek, ale tyle, by magazyn wioski miał
  // PILOT.supplyFill (80%) pojemności każdego surowca. Najbliższe wioski oddają pierwsze; liczą się surowce już jadące.
  function supply(state, p, vs, t, reserves, threatened, acts) {
    if (p.supply === false || vs.length < 2) return;
    const needy = vs.filter(v => !threatened[v.id] && reserves[v.id] && !incomingOn(state, v).length);   // reserves[id] ustawione = wioska czeka na surowce na następny budynek
    if (!needy.length) return;
    const needyIds = {};
    needy.forEach(v => { needyIds[v.id] = true; });
    // ile surowca wioska-dawca może oddać: ponad własną rezerwę na budynek i ponad część magazynu
    const spareOf = v => {
      const keep = E.storageCap(v) * P().supplyKeep, own = reserves[v.id] || { wood: 0, clay: 0, iron: 0 }, out = {};
      E.RES.forEach(r => { out[r] = Math.max(0, Math.floor(v.res[r] - Math.max(keep, own[r] || 0))); });
      return out;
    };
    const donors = vs.filter(v => !needyIds[v.id] && !threatened[v.id] && !incomingOn(state, v).length && E.merchantsTotal(v) > 0);
    // najbardziej potrzebujące (najmniejsza dostępność) pierwsze
    needy.sort((a, b) => Math.min.apply(null, E.RES.map(r => a.res[r] / Math.max(1, reserves[a.id][r] || 1))) -
      Math.min.apply(null, E.RES.map(r => b.res[r] / Math.max(1, reserves[b.id][r] || 1))));
    needy.forEach(v => {
      const cost = reserves[v.id], inc = E.incomingRes(state, v.id), lack = {};
      const fill = E.storageCap(v) * P().supplyFill;         // cel: co najmniej 80% magazynu, a gdy budynek kosztuje więcej – jego koszt
      let any = false;
      E.RES.forEach(r => { lack[r] = Math.max(0, Math.ceil(Math.max(cost[r] || 0, fill) - v.res[r] - inc[r])); if (lack[r] > 0) any = true; });
      if (!any) return;                                     // surowce już są albo jadą
      const sorted = donors.slice().sort((a, b) => E.dist(a, v) - E.dist(b, v));
      let sentFrom = 0, sentTotal = 0;
      for (const d of sorted) {
        if (!E.RES.some(r => lack[r] > 0)) break;
        E.tickVillage(state, d, t);
        const sp = spareOf(d), send = {};
        let total = 0;
        E.RES.forEach(r => { send[r] = Math.min(lack[r], sp[r]); total += send[r]; });
        if (total < 1) continue;
        const cap = E.merchantCap(), free = E.merchantsFree(state, d);
        if (free < 1) continue;
        if (Math.ceil(total / cap) > free) {                // za mało kupców: wysyła tyle, ile uniesie
          let left = free * cap;
          E.RES.forEach(r => { send[r] = Math.min(send[r], left); left -= send[r]; });
          total = send.wood + send.clay + send.iron;
          if (total < 1) continue;
        }
        if (!E.sendTransport(state, d.id, v.id, send, t).ok) continue;
        E.RES.forEach(r => { lack[r] -= send[r]; });
        sentFrom++; sentTotal += total;
      }
      if (sentFrom) {
        acts.supplied += sentTotal;
        note(state, p, t, 'Zasilanie ' + v.name + ': ' + sentTotal + ' surowców z ' + sentFrom + ' wiosek');
      }
    });
  }

  /* ---------- 3. wojsko ---------- */
  function recruitVillage(state, v, p, t, reserve, threatened, acts) {
    if (v.recruitQueue.length >= Math.min(P().recruitDepth, E.queueMax(v, 'recruit'))) return;
    const ups = E.upgradesOf(state, 'player');
    const full = storeRatio(v) > P().storeSpend;
    const free = threatened || full;          // bez rezerwy na budynek
    const share = free ? 1 : P().recruitShare;
    const spend = {};
    E.RES.forEach(r => { spend[r] = Math.max(0, v.res[r] - (reserve && !free ? reserve[r] : 0)) * share; });
    const afford = (U, cap) => Math.min.apply(null, E.RES.map(r => U.cost[r] > 0 ? Math.floor(spend[r] / U.cost[r]) : Infinity).concat([cap]));

    // kilku zwiadowców chroni przed wrogim zwiadem
    if (P().scouts > 0 && !threatened) {
      let have = v.units.scout || 0;
      v.recruitQueue.forEach(e => { if (e.unit === 'scout') have += e.count - e.done; });
      const ri = E.recruitInfo(state, v, 'scout');
      if (have < P().scouts && ri.ok) {
        const n = Math.min(P().scouts - have, afford(C.UNITS.scout, ri.max));
        if (n >= 1 && E.queueRecruit(state, v, 'scout', n, t).ok !== false) { acts.recruited += n; return; }
      }
    }

    const border = p.garrison !== false && exposed(state, v, t);
    const target = E.points(v) * p.defLevel * (threatened ? 1.5 : 1) * (border ? P().garrisonGoal : 1);
    const needDef = E.villageDefense(v, null, ups) < target;
    let role;
    if (needDef) role = 'def';
    else if (p.recruit === 'balanced' || p.attack) role = 'att';
    else if (full) role = 'def';            // pełny magazyn: nadwyżka idzie na dodatkową obronę, nic się nie marnuje
    else return;

    // podbój: kilka Taranów w każdej wiosce, żeby mur nie zatrzymał fali
    if (role === 'att' && p.attack && !threatened) {
      let rams = 0;
      v.recruitQueue.forEach(e => { if (C.UNITS[e.unit].wallPower) rams += e.count - e.done; });
      const ramKey = Object.keys(C.UNITS).find(k => C.UNITS[k].wallPower);
      if (ramKey) {
        rams += v.units[ramKey] || 0;
        const ri = E.recruitInfo(state, v, ramKey);
        if (rams < P().war.rams && ri.ok) {
          const n = afford(C.UNITS[ramKey], Math.min(ri.max, P().war.rams - rams));
          if (n >= 1 && E.queueRecruit(state, v, ramKey, n, t).ok !== false) { acts.recruited += n; return; }
        }
      }
    }

    let best = null;
    Object.keys(C.UNITS).forEach(k => {
      const U = C.UNITS[k];
      if (U.conquer || U.settler || U.scout || U.wallPower) return;
      if ((role === 'def') !== isDef(k)) return;
      const ri = E.recruitInfo(state, v, k);
      if (!ri.ok) return;
      const batch = Math.max(1, Math.floor(P().batchMin * 60000 / Math.max(1, ri.per)));
      const n = afford(U, Math.min(ri.max, batch));
      if (n < 1) return;
      const value = n * (role === 'def' ? U.def : U.att) * E.upgradeMult(ups, k);
      if (!best || value > best.value) best = { k, n, value };
    });
    if (best && E.queueRecruit(state, v, best.k, best.n, t).ok !== false) acts.recruited += best.n;
  }

  /* ---------- 3b. atakowane wioski: wydać albo wywieźć surowce ---------- */
  // Wioska, na którą idzie atak, najpierw szkoli obrońców (recruitVillage), potem resztę surowców przeznacza na budowę
  // (koszt zablokowany w kolejce – nie do zrabowania), a to, co zostało, wywozi kupcami do najbliższej bezpiecznej wioski.
  function shield(state, p, vs, t, threatened, acts) {
    p.shieldAt = p.shieldAt || {};
    const safe = vs.filter(v => !threatened[v.id] && !incomingOn(state, v).length);
    vs.forEach(v => {
      if (!threatened[v.id] || (p.shieldAt[v.id] && t < p.shieldAt[v.id])) return;
      p.shieldAt[v.id] = t + 60000;
      E.tickVillage(state, v, t);
      if (p.build) buildVillage(state, v, p, t, acts);
      if (E.merchantsTotal(v) < 1) return;
      const dest = safe.slice().sort((a, b) => E.dist(a, v) - E.dist(b, v));
      let sent = 0, to = null;
      for (const d of dest) {
        const free = E.merchantsFree(state, v);
        if (free < 1) break;
        const inc = E.incomingRes(state, d.id), send = {};
        let total = 0;
        E.RES.forEach(r => { send[r] = Math.max(0, Math.min(Math.floor(v.res[r]), Math.floor(E.storageCap(d) - d.res[r] - inc[r]))); total += send[r]; });
        if (total < 1) continue;
        const cap = E.merchantCap();
        if (Math.ceil(total / cap) > free) {
          let left = free * cap;
          E.RES.forEach(r => { send[r] = Math.min(send[r], left); left -= send[r]; });
          total = send.wood + send.clay + send.iron;
          if (total < 1) continue;
        }
        if (E.sendTransport(state, v.id, d.id, send, t).ok) { sent += total; to = to || d; }
      }
      if (sent) { acts.supplied += sent; note(state, p, t, 'Atak na ' + v.name + ': wywieziono ' + sent + ' surowców do ' + to.name); }
    });
  }

  /* ---------- 4. technologia ---------- */
  function techAllowed(node, p) {
    if (node.branch !== 'war') return true;
    return node.id === 'drill' || p.recruit === 'balanced' || !!p.attack;
  }
  function techOrder(p) {
    const out = P().techPriority.slice();
    C.TECH.nodes.slice().sort((a, b) => a.base - b.base).forEach(n => { out.push([n.id, n.max]); });
    return out.filter(([id]) => { const n = E.techNode(id); return n && techAllowed(n, p); });
  }
  // Zwraca id następnego badania do kupienia (albo { wait: true }, gdy trzeba zbierać monety).
  function nextTech(state, p) {
    const f = state.factions.player;
    for (const [id, lvl] of techOrder(p)) {
      const node = E.techNode(id);
      if (E.techLevel(f, node) >= Math.min(lvl, node.max)) continue;
      const info = E.techInfo(state, id);
      if (info.ok) return { id };
      if (info.code === 'coins') return { wait: true, cost: info.cost };
    }
    return null;
  }
  function manageTech(state, p, vs, t, acts) {
    const f = state.factions.player;
    // badania, na które starcza monet
    for (let guard = 0; guard < 50; guard++) {
      const nt = nextTech(state, p);
      if (!nt || nt.wait) break;
      if (E.researchTech(state, nt.id, t).ok) { acts.research++; note(state, p, t, 'Badanie: ' + E.techNode(nt.id).name); } else break;
    }
    // nadwyżki surowców -> monety (tylko, gdy jest jeszcze co badać)
    const want = nextTech(state, p);
    if (!want) return;
    let need = want.wait ? want.cost - (f.coins || 0) : Infinity;
    for (const v of vs) {
      if (need <= 0) break;
      if (!((v.buildings.market || 0) > 0)) continue;
      const cap = E.storageCap(v);
      for (const res of E.RES.slice().sort((a, b) => v.res[b] - v.res[a])) {      // najobfitszy surowiec pierwszy
        if (need <= 0) break;
        if (v.res[res] / cap < P().coinFrom) break;
        const room = Math.floor((v.res[res] - cap * P().coinTo) / C.TECH.coinPrice);
        const n = Math.min(Math.floor(E.mintTokens(v, t)), room, need === Infinity ? room : need);
        if (n >= 1) { const r = E.buyCoins(state, v.id, res, n, t); if (r.ok) { acts.coins += r.coins; need -= r.coins; } }
      }
    }
    if (acts.coins) {
      for (let guard = 0; guard < 50; guard++) {
        const nt = nextTech(state, p);
        if (!nt || nt.wait) break;
        if (E.researchTech(state, nt.id, t).ok) { acts.research++; note(state, p, t, 'Badanie: ' + E.techNode(nt.id).name); } else break;
      }
    }
  }

  /* ---------- 5. osadnicy: nowe wioski w pobliżu własnego terytorium ---------- */
  function settlersTotal(state, vs) {
    let n = 0;
    vs.forEach(v => {
      n += v.units.settler || 0;
      v.recruitQueue.forEach(e => { if (e.unit === 'settler') n += e.count - e.done; });
    });
    state.movements.forEach(m => { if (m.owner === 'player' && (m.type === 'settle' || (m.type === 'return' && m.units.settler > 0))) n += m.units.settler || 1; });
    return n;
  }
  // Najlepsze wolne pole: blisko wioski macierzystej, z dala od cudzych wiosek. Zwraca { x, y } albo null.
  function findSpot(state, v) {
    const N = state.map.size, foe = P().settleFoeDist;
    for (const R of P().settleRanges) {
      const near = Object.values(state.villages).filter(o => Math.abs(o.x - v.x) <= R + 4 && Math.abs(o.y - v.y) <= R + 4);
      let best = null;
      for (let y = Math.max(0, v.y - R); y <= Math.min(N - 1, v.y + R); y++) {
        for (let x = Math.max(0, v.x - R); x <= Math.min(N - 1, v.x + R); x++) {
          const d = E.dist(v, { x, y });
          if (d < 1.5 || d > R) continue;
          const tile = E.tileAt(state, x, y);
          if (tile.village || tile.terrain !== 'plain') continue;                       // to samo, co E.settleCheck, ale tanio
          if (near.some(o => E.dist(o, { x, y }) < C.SETTLE.minDistance)) continue;
          if (state.movements.some(m => m.type === 'settle' && m.x === x && m.y === y)) continue;
          if (near.some(o => o.owner && o.owner !== 'player' && E.dist(o, { x, y }) < foe)) continue;   // wolne osady (bez właściciela) nie przeszkadzają
          const crowd = near.filter(o => o.owner && o.owner !== 'player' && E.dist(o, { x, y }) < 4).length;
          const score = d + crowd * 1.5;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (best) return best;
    }
    return null;
  }
  // Miejsce dla osadnika z wioski v: wolne pole w jej zasięgu, a gdy tam nic nie zostało (wioska w środku terytorium) –
  // najbliższe wolne pole przy innej własnej wiosce (osadnik idzie dalej, ale nie dalej niż settleFarMax pól).
  function findSpotFor(state, v, vs, spotOf) {
    const own = spotOf(v);
    if (own) return own;
    let best = null;
    vs.forEach(o => {
      if (o.id === v.id) return;
      const sp = spotOf(o);
      if (!sp) return;
      const d = E.dist(v, sp);
      if (d <= P().settleFarMax && (!best || d < best.d)) best = { x: sp.x, y: sp.y, d };
    });
    return best;
  }
  function settleWhy(state, p, t, text) {
    if (p.settleInfo === text) return;
    p.settleInfo = text;
    note(state, p, t, 'Osadnicy: ' + text);
  }
  // Wysyła gotowych osadników, a gdy żadnego nie ma w grze – zleca kolejnego. Zwraca { id, cost }: wioska, która odkłada surowce na osadnika.
  function settleStep(state, p, vs, t, threatened, acts) {
    const cap = p.settleMax > 0 ? p.settleMax : Infinity;      // puste = bez limitu (gra toczy się dalej także po osiągnięciu celu)
    if (p.settleRetry && t < p.settleRetry) return null;       // niedawno nie było wolnych pól – nie skanuj mapy co minutę
    let memo = {};
    const spotOf = v => (v.id in memo ? memo[v.id] : (memo[v.id] = findSpot(state, v)));
    for (const v of vs) {
      while (v.units.settler >= 1) {
        const spot = findSpotFor(state, v, vs, spotOf);
        if (!spot || !E.sendSettler(state, v.id, spot.x, spot.y, t).ok) {
          settleWhy(state, p, t, 'osadnik w ' + v.name + ' czeka – brak wolnego pola do zasiedlenia');
          p.settleRetry = t + P().settleRetryMin * 60000;
          break;
        }
        memo = {};                                   // zajęte pole zmienia obraz wolnych miejsc
        acts.settled++;
        note(state, p, t, 'Osadnik z ' + v.name + ' wyrusza na ' + spot.x + ':' + spot.y);
      }
    }
    if (vs.length + settlersTotal(state, vs) >= cap) { settleWhy(state, p, t, 'osiągnięty limit wiosek (' + cap + ')'); return null; }
    if (settlersTotal(state, vs) > 0) return null;
    const U = C.UNITS.settler, ups = E.upgradesOf(state, 'player');
    const why = {};                                           // powód odrzucenia -> liczba wiosek (do statusu w oknie Autopilota)
    const no = (k) => { why[k] = (why[k] || 0) + 1; };
    const cands = [];
    vs.forEach(v => {
      if (threatened[v.id]) return no('atakowane');
      if (v.buildings.hq < U.hq) return no('Ratusz poniżej ' + U.hq);
      if (v.buildings.barracks < U.barracks) return no('brak Koszar');
      if (E.villageDefense(v, null, ups) < E.points(v) * p.defLevel * P().settleDefMin) return no('za słaba obrona');
      if (v.recruitQueue.length >= E.queueMax(v, 'recruit')) return no('pełna kolejka wojska');
      if (E.RES.some(r => U.cost[r] > E.storageCap(v))) return no('za mały magazyn');
      cands.push({ v, ready: Math.min.apply(null, E.RES.map(r => v.res[r] / U.cost[r])) });
    });
    // najbardziej „gotowa” wioska, z której osiągalne jest wolne pole (nie tylko najbogatsza)
    cands.sort((x, y) => y.ready - x.ready);
    let best = null;
    for (const c of cands) { if (findSpotFor(state, c.v, vs, spotOf)) { best = c; break; } }
    if (!best) {
      if (cands.length) p.settleRetry = t + P().settleRetryMin * 60000;
      settleWhy(state, p, t, cands.length ? 'brak wolnego pola na równinie w zasięgu wiosek (poza polami zbyt blisko cudzych wiosek); ponowne szukanie za ' + P().settleRetryMin + ' min'
        : 'żadna wioska nie spełnia warunków: ' + Object.keys(why).map(k => k + ' ×' + why[k]).join(', '));
      return null;
    }
    const ri = E.recruitInfo(state, best.v, 'settler');
    if (ri.ok && ri.max >= 1 && E.queueRecruit(state, best.v, 'settler', 1, t).ok !== false) {
      p.settleInfo = 'szkolenie osadnika';
      note(state, p, t, 'Szkolenie osadnika w ' + best.v.name);
      return null;
    }
    settleWhy(state, p, t, 'odkłada surowce na osadnika w ' + best.v.name + (ri.code === 'pop' ? ' (brak miejsca na farmie)' : ''));
    return { id: best.v.id, cost: U.cost };       // jeszcze nie stać – ta wioska odkłada surowce
  }

  /* ---------- 6. podbój: zwiad, zbiórka armii, fale z Dowódcą ---------- */
  const isAtt = k => { const U = C.UNITS[k]; return !U.role && !U.conquer && !U.settler && !U.scout; };
  const attUnits = v => { const u = E.emptyUnits(); Object.keys(C.UNITS).forEach(k => { if (isAtt(k)) u[k] = v.units[k] || 0; }); return u; };
  const attPower = (state, v) => E.attackPower(attUnits(v), E.upgradesOf(state, 'player'));
  const foeBlocked = (state, o, t) => !!(MP.Diplomacy && MP.Diplomacy.blocked(state, 'player', o.owner, t));

  function noblesTotal(state, vs) {
    let n = 0;
    vs.forEach(v => {
      n += v.units.noble || 0;
      v.recruitQueue.forEach(e => { if (e.unit === 'noble') n += e.count - e.done; });
    });
    state.movements.forEach(m => { if (m.owner === 'player' && m.units && m.units.noble > 0 && (m.type === 'attack' || m.type === 'return' || m.type === 'support')) n += m.units.noble; });
    return n;
  }

  // Szkoli Dowódców do limitu P().war.nobles – dopiero gdy armia ma sensowną siłę. Zwraca { id, cost }, gdy wioska odkłada surowce.
  function nobleStep(state, p, vs, t, threatened, acts) {
    const W = P().war;
    if (noblesTotal(state, vs) >= W.nobles) return null;
    if (vs.reduce((s2, v) => s2 + attPower(state, v), 0) < W.minPower) return null;
    const U = C.UNITS.noble, ups = E.upgradesOf(state, 'player');
    const cands = vs.filter(v => !threatened[v.id] && v.buildings.barracks >= U.barracks && v.recruitQueue.length < E.queueMax(v, 'recruit') &&
      E.villageDefense(v, null, ups) >= E.points(v) * p.defLevel * P().settleDefMin && !E.RES.some(r => U.cost[r] > E.storageCap(v)))
      .map(v => ({ v, ready: Math.min.apply(null, E.RES.map(r => v.res[r] / U.cost[r])) })).sort((a, b) => b.ready - a.ready);
    if (!cands.length) return null;
    const best = cands[0].v, ri = E.recruitInfo(state, best, 'noble');
    if (ri.ok && ri.max >= 1 && E.queueRecruit(state, best, 'noble', 1, t).ok !== false) {
      acts.recruited++;
      note(state, p, t, 'Szkolenie Dowódcy podboju w ' + best.name);
      return null;
    }
    return ri.code === 'resources' ? { id: best.id, cost: U.cost } : null;
  }

  // Wyniki fal bota: przejęcie wioski albo przegrana (podnosi wymagany zapas siły dla tego celu).
  function warReports(state, p, t, acts) {
    const seen = p.repT || 0;
    if (state.reports.length) p.repT = Math.max(seen, state.reports[0].time);
    for (const r of state.reports) {
      if (r.time <= seen) break;
      if (r.kind !== 'attack' || r.attacker !== 'player' || !p.ops[r.to] || r.time < p.ops[r.to].t) continue;
      if (r.conquered) {
        acts.conquered++;
        note(state, p, t, 'Przejęto wioskę ' + r.toName + ' (' + r.toX + ':' + r.toY + ')');
        delete p.ops[r.to]; delete p.fail[r.to]; delete p.spied[r.to];
      } else if (!r.attackerWon) {
        const f = p.fail[r.to] || { n: 0 };
        p.fail[r.to] = { n: f.n + 1, t };
        note(state, p, t, 'Fala na ' + r.toName + ' przegrała – wymagana większa przewaga');
      }
    }
    Object.keys(p.fail).forEach(id => { if (t - p.fail[id].t > P().war.retryMin * 60000) delete p.fail[id]; });
    Object.keys(p.ops).forEach(id => { if (t - p.ops[id].t > 3 * 3600000) delete p.ops[id]; });
  }

  // Wioska może być bazą armii ataku, gdy ma własną obronę (cel jak dla wioski przygranicznej) i pełne poparcie.
  function canHost(state, p, v) {
    return v.loyalty >= C.LOYALTY.max &&
      E.villageDefense(v, null, E.upgradesOf(state, 'player')) >= E.points(v) * p.defLevel * P().garrisonGoal * 0.8;
  }

  // Armia ataku (i Dowódcy) z zaplecza wędruje na stałe do najsilniejszej wioski – rozproszona nie zdobędzie obsadzonej wioski.
  function gather(state, p, vs, t, threatened) {
    const W = P().war;
    if (p.gatherAt && t < p.gatherAt) return;
    p.gatherAt = t + W.gatherEveryMin * 60000;
    const free = vs.filter(v => !threatened[v.id] && !incomingOn(state, v).length);
    if (free.length < 2) return;
    // baza armii: tylko wioska z własną obroną i pełnym poparciem – inaczej zostałaby bez obrońców
    const hosts = free.filter(v => canHost(state, p, v));
    if (!hosts.length) return;
    const front = hosts.slice().sort((a, b) => attPower(state, b) - attPower(state, a))[0];
    let room = E.supportRoom(state, front) - Math.ceil(E.popCap(front) * W.farmReserve);
    free.forEach(v => {
      if (v.id === front.id || room < 20 || E.dist(v, front) > W.gatherRange) return;
      const u = attUnits(v); u.noble = v.units.noble || 0;
      const pop = E.unitsPop(u);
      if (pop > room) { const sc = room / pop; Object.keys(u).forEach(k => { u[k] = Math.floor(u[k] * sc); }); }
      if (E.sumUnits(u) < W.gatherMin && !u.noble) return;
      if (E.sendSupport(state, v.id, front.id, u, t, 'stay').ok) room -= E.unitsPop(u);
    });
  }

  // Powód, dla którego bot w tej turze nie wysłał fali (widać go w oknie Autopilota); do dziennika trafia tylko zmiana powodu.
  function warWhy(state, p, t, key, text) {
    const prev = p.warWhy;
    p.warWhy = { t, key, text };
    if (!prev || prev.key !== key) note(state, p, t, 'Brak ataku: ' + text);
  }

  function warStep(state, p, vs, t, threatened, acts) {
    const W = P().war, ups = E.upgradesOf(state, 'player');
    p.ops = p.ops || {}; p.fail = p.fail || {}; p.spied = p.spied || {};
    warReports(state, p, t, acts);
    gather(state, p, vs, t, threatened);

    const foesAll = Object.values(state.villages).filter(o => o.owner && o.owner !== 'player');
    const foes = foesAll.filter(o => !foeBlocked(state, o, t));
    if (!foes.length) return warWhy(state, p, t, 'foes', foesAll.length ? 'wszystkie frakcje (' + foesAll.length + ' wiosek) objęte paktem o nieagresji – wypowiedz pakt w Dyplomacji' : 'brak wrogich wiosek na mapie');
    const out = state.movements.filter(m => m.type === 'attack' && m.owner === 'player');
    const busy = new Set(out.map(m => m.to));
    const free = vs.filter(v => !threatened[v.id] && !incomingOn(state, v).length && canHost(state, p, v));
    const sources = free.map(v => ({ v, A: attPower(state, v) })).filter(s2 => s2.A >= W.minPower).sort((a, b) => b.A - a.A);
    if (!sources.length) {
      const top = free.reduce((m, v) => Math.max(m, attPower(state, v)), 0);
      return warWhy(state, p, t, 'power', 'żadna wioska nie ma w domu armii ataku od ' + W.minPower + ' siły (najsilniejsza: ' + Math.round(top) + '); część wojska jest w marszu albo to jednostki obronne');
    }
    const nobles = noblesTotal(state, vs);
    const dg = { inRange: 0, noIntel: 0, noble: 0, weak: 0, ratio: 0, A: 0, need: 0 };
    let best = null, spies = 0;
    for (const src of sources) {
      const v = src.v;
      foes.forEach(o => {
        const d = E.dist(v, o);
        if (d > W.range || busy.has(o.id)) return;
        dg.inRange++;
        const intel = state.intel[o.id];
        if (!intel || intel.owner !== o.owner || t - intel.time > W.intelMaxMin * 60000) {
          dg.noIntel++;
          // brak świeżego zwiadu – zwiadowcy z najbliższej wioski (tylko gdy jest czym zdobywać)
          if (!nobles || spies >= W.spyPerTurn || (p.spied[o.id] && t - p.spied[o.id] < W.spyEveryMin * 60000)) return;
          const sc = vs.filter(h => (h.units.scout || 0) >= W.spyScouts && !incomingOn(state, h).length).sort((a, b) => E.dist(a, o) - E.dist(b, o))[0];
          if (!sc || E.dist(sc, o) > W.range + 4) return;
          if (E.sendSpy(state, sc.id, o.id, W.spyScouts, t).ok) { p.spied[o.id] = t; acts.spied++; spies++; }
          return;
        }
        if (!v.units.noble) { dg.noble++; return; }
        const send = attUnits(v);
        const loy = Math.min(C.LOYALTY.max, intel.loyalty + (t - intel.time) / 60000 * C.LOYALTY.regenPerMin);
        if (loy <= 0) return;
        const wall = intel.buildings ? intel.buildings.wall : W.wallGuess;
        const wallEff = Math.max(0, wall - Math.floor(E.ramCount(send) / C.RAM.fightPerLevel));
        const need = E.defenseFrom(intel.units, wallEff, null) * W.ratio * (1 + W.failPenalty * ((p.fail[o.id] || { n: 0 }).n));
        if (src.A < need) { dg.weak++; if (src.A / need > dg.ratio) { dg.ratio = src.A / need; dg.A = src.A; dg.need = need; } return; }
        // dobijanie rozpoczętego podboju najpierw, potem blisko i z dużą przewagą
        const w = (1 + (C.LOYALTY.max - loy) / 25) / (1 + d) * (1 + Math.min(1, src.A / need / 4));
        if (!best || w > best.w) best = { v, o, w, send };
      });
    }
    if (!best) {
      let key, msg;
      if (!dg.inRange) { key = 'range'; msg = 'w zasięgu ' + W.range + ' pól od wiosek z armią (' + sources.length + ') nie ma wrogiej wioski bez paktu (wrogich wiosek: ' + foes.length + ')'; }
      else if (dg.noIntel && dg.noIntel >= dg.inRange) {
        key = 'intel';
        msg = 'brak świeżego zwiadu celów w zasięgu (' + dg.noIntel + ') – ' + (nobles ? 'zwiad w toku albo brak wioski z ' + W.spyScouts + '+ zwiadowcami w pobliżu celu' : 'zwiad rusza dopiero, gdy bot ma Dowódcę podboju (teraz 0)');
      } else if (dg.noble && !dg.weak) { key = 'noble'; msg = 'Dowódca podboju nie stoi w żadnej wiosce z armią (Dowódców razem: ' + nobles + ') – są w drodze albo w innych wioskach'; }
      else if (dg.weak) { key = 'weak'; msg = 'za słaba fala: najłatwiejszy cel wymaga siły ' + Math.round(dg.need) + ' (obrona × ' + W.ratio + '), a najlepsza wioska z Dowódcą wyśle ' + Math.round(dg.A) + ' – fala rusza z jednej wioski (limit: farma)'; }
      else { key = 'other'; msg = 'brak odpowiedniego celu'; }
      return warWhy(state, p, t, key, msg);
    }
    if (out.length >= W.maxWaves) return warWhy(state, p, t, 'waves', 'już ' + out.length + ' fale w drodze (limit ' + W.maxWaves + ')');
    const send = best.send;
    send.noble = 1;
    send.scout = Math.max(0, Math.min(W.waveScouts, (best.v.units.scout || 0) - 1));
    const r = E.sendAttack(state, best.v.id, best.o.id, send, t, 'attack');
    if (r.ok) {
      p.ops[best.o.id] = { t, from: best.v.id };
      p.warWhy = { t, key: 'sent', text: 'fala wysłana na ' + best.o.name };
      acts.attacked++;
      note(state, p, t, 'Atak na ' + best.o.name + ' (' + best.o.x + ':' + best.o.y + ') z ' + best.v.name + ' z Dowódcą podboju');
    }
  }

  /* ---------- tura bota ---------- */
  function run(state, t) {
    const p = state.pilot;
    if (!p || !p.on) return;
    p.next = t + P().tickSec * 1000;
    const vs = own(state);
    if (!vs.length) return;
    vs.forEach(v => E.tickVillage(state, v, t));
    const acts = { built: 0, recruited: 0, support: 0, research: 0, coins: 0, recalled: 0, settled: 0, garrisoned: 0, supplied: 0, attacked: 0, spied: 0, conquered: 0 };
    const threatened = {};

    defend(state, p, vs, t, acts, threatened);
    garrison(state, p, vs, t, acts, threatened);
    const reserves = {};
    vs.forEach(v => {
      if (p.build && !threatened[v.id]) reserves[v.id] = buildVillage(state, v, p, t, acts);
    });
    if (p.build) supply(state, p, vs, t, reserves, threatened, acts);
    if (p.settle) {
      const sv = settleStep(state, p, vs, t, threatened, acts);
      if (sv) {
        const cur = reserves[sv.id] || { wood: 0, clay: 0, iron: 0 };
        reserves[sv.id] = { wood: Math.max(cur.wood, sv.cost.wood), clay: Math.max(cur.clay, sv.cost.clay), iron: Math.max(cur.iron, sv.cost.iron) };
      }
    }
    if (p.attack) {
      const nv = nobleStep(state, p, vs, t, threatened, acts);
      if (nv) {
        const cur = reserves[nv.id] || { wood: 0, clay: 0, iron: 0 };
        reserves[nv.id] = { wood: Math.max(cur.wood, nv.cost.wood), clay: Math.max(cur.clay, nv.cost.clay), iron: Math.max(cur.iron, nv.cost.iron) };
      }
    }
    if (p.recruit !== 'off') vs.forEach(v => recruitVillage(state, v, p, t, reserves[v.id], !!threatened[v.id], acts));
    shield(state, p, vs, t, threatened, acts);
    if (p.tech) manageTech(state, p, vs, t, acts);
    if (p.attack) warStep(state, p, vs, t, threatened, acts);
    recall(state, p, t, acts);

    ['built', 'recruited', 'support', 'research', 'coins', 'recalled', 'settled', 'garrisoned', 'supplied', 'attacked', 'spied', 'conquered'].forEach(k => { p.stats[k] = (p.stats[k] || 0) + acts[k]; });
    p.last = { t, built: acts.built, recruited: acts.recruited, support: acts.support, research: acts.research, settled: acts.settled, supplied: acts.supplied, attacked: acts.attacked, conquered: acts.conquered };
  }

  /* ---------- konfiguracja ---------- */
  function normalize(cfg, base) {
    const D = P().defaults, o = Object.assign({}, D, base || {});
    if (cfg.on !== undefined) o.on = !!cfg.on;
    if (cfg.build !== undefined) o.build = !!cfg.build;
    if (cfg.tech !== undefined) o.tech = !!cfg.tech;
    if (cfg.defend !== undefined) o.defend = !!cfg.defend;
    if (cfg.garrison !== undefined) o.garrison = !!cfg.garrison;
    if (cfg.recruit !== undefined && ['defense', 'balanced', 'off'].indexOf(cfg.recruit) >= 0) o.recruit = cfg.recruit;
    if (cfg.supply !== undefined) o.supply = !!cfg.supply;
    if (cfg.convoy !== undefined) o.convoy = !!cfg.convoy;
    if (cfg.settle !== undefined) o.settle = !!cfg.settle;
    if (cfg.attack !== undefined) o.attack = !!cfg.attack;
    if (cfg.settleMax !== undefined) { const n = Math.floor(Number(cfg.settleMax)); o.settleMax = n >= 1 && n <= 200 ? n : 0; }
    if (cfg.hub !== undefined) o.hub = cfg.hub || null;
    if (cfg.defLevel !== undefined) { const n = Number(cfg.defLevel); if (n >= 5 && n <= 400) o.defLevel = Math.round(n); }
    return o;
  }
  function configure(state, cfg, t) {
    const old = state.pilot || {};
    const p = normalize(cfg || {}, old);
    p.log = old.log || []; p.stats = old.stats || {}; p.seen = old.seen || {}; p.threat = old.threat || {};
    p.deployed = old.deployed || {}; p.last = old.last || null; p.garrisonAt = old.garrisonAt || 0;
    p.next = p.on ? t + 1000 : null;
    p.settleRetry = 0;                       // zmiana ustawień = szukaj wolnych pól od razu
    // Konwoje do stolicy: bot włącza wbudowane Konwoje (nadwyżki z wiosek > 80% magazynu wracają do wioski centralnej).
    const a = state.auto || {};
    if (p.on && p.convoy) {
      const r = E.setAuto(state, { on: true, hub: p.hub, high: a.high, keep: a.keep, everyMin: a.everyMin, coins: a.coins !== undefined ? a.coins : true }, t);
      if (!r.ok) return r;
    } else if (old.convoy && a.on) {
      E.setAuto(state, Object.assign({}, a, { on: false }), t);
    }
    state.pilot = p;
    return { ok: true };
  }

  MP.Pilot = { run, configure, nextTech, findSpot };
})(typeof window !== 'undefined' ? window : globalThis);
