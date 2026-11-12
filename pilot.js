/* =========================================================================
   Mini Plemiona – AUTOPILOT (bot rozwijający Twoje wioski)
   Działa w centralnym procesorze zdarzeń (zdarzenie 'pilot'), więc – tak jak AI –
   nadrabia czas także wstecznie, gdy gra była zamknięta lub uśpiona.
   Co robi w każdej turze (C.PILOT.tickSec sekund czasu gry):
   1. Obrona – nowy atak na Twoją wioskę = natychmiastowa tura: posiłki z innych wiosek
      (tylko jednostki obronne, tylko takie, które zdążą przed atakiem); po ataku wracają.
   2. Budowa – kolejka każdej wioski stale zapełniona (pilne: Farma, Ratusz/magazyn).
   3. Wojsko – jednostki obronne do celu zależnego od rozbudowy wioski, kilku zwiadowców,
      opcjonalnie armia ataku; przy zagrożeniu wszystkie surowce idą na obronę.
   4. Technologia – nadwyżki surowców -> monety (Targowisko) -> badania wg priorytetów.
   Bot nie podgląda sił wroga (tak jak Ty: „siła nieznana”). Wszystkie liczby: C.PILOT.
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

    const target = E.points(v) * p.defLevel * (threatened ? 1.5 : 1);
    const needDef = E.villageDefense(v, null, ups) < target;
    let role;
    if (needDef) role = 'def';
    else if (p.recruit === 'balanced') role = 'att';
    else if (full) role = 'def';            // pełny magazyn: nadwyżka idzie na dodatkową obronę, nic się nie marnuje
    else return;

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

  /* ---------- 4. technologia ---------- */
  function techAllowed(node, p) {
    if (node.branch !== 'war') return true;
    return node.id === 'drill' || p.recruit === 'balanced';
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
          if (d < 1.5 || d > R || E.settleCheck(state, x, y)) continue;
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
    let memo = {};
    const spotOf = v => (v.id in memo ? memo[v.id] : (memo[v.id] = findSpot(state, v)));
    for (const v of vs) {
      while (v.units.settler >= 1) {
        const spot = findSpotFor(state, v, vs, spotOf);
        if (!spot || !E.sendSettler(state, v.id, spot.x, spot.y, t).ok) { settleWhy(state, p, t, 'osadnik w ' + v.name + ' czeka – brak wolnego pola do zasiedlenia'); break; }
        memo = {};                                   // zajęte pole zmienia obraz wolnych miejsc
        acts.settled++;
        note(state, p, t, 'Osadnik z ' + v.name + ' wyrusza na ' + spot.x + ':' + spot.y);
      }
    }
    if (vs.length + settlersTotal(state, vs) >= cap) { settleWhy(state, p, t, 'osiągnięty limit wiosek (' + cap + ')'); return null; }
    if (settlersTotal(state, vs) > 0) return null;
    const U = C.UNITS.settler, ups = E.upgradesOf(state, 'player');
    let best = null, eligible = 0;
    const why = {};                                           // powód odrzucenia -> liczba wiosek (do statusu w oknie Autopilota)
    const no = (k) => { why[k] = (why[k] || 0) + 1; };
    vs.forEach(v => {
      if (threatened[v.id]) return no('atakowane');
      if (v.buildings.hq < U.hq) return no('Ratusz poniżej ' + U.hq);
      if (v.buildings.barracks < U.barracks) return no('brak Koszar');
      if (E.villageDefense(v, null, ups) < E.points(v) * p.defLevel * P().settleDefMin) return no('za słaba obrona');
      if (v.recruitQueue.length >= E.queueMax(v, 'recruit')) return no('pełna kolejka wojska');
      if (E.RES.some(r => U.cost[r] > E.storageCap(v))) return no('za mały magazyn');
      eligible++;
      if (!findSpotFor(state, v, vs, spotOf)) return;      // wolne pole musi być osiągalne z TEJ wioski (a nie tylko z najbogatszej)
      const ready = Math.min.apply(null, E.RES.map(r => v.res[r] / U.cost[r]));
      if (!best || ready > best.ready) best = { v, ready };
    });
    if (!best) {
      settleWhy(state, p, t, eligible ? 'brak wolnego pola na równinie w zasięgu wiosek (poza polami zbyt blisko cudzych wiosek)'
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

  /* ---------- tura bota ---------- */
  function run(state, t) {
    const p = state.pilot;
    if (!p || !p.on) return;
    p.next = t + P().tickSec * 1000;
    const vs = own(state);
    if (!vs.length) return;
    vs.forEach(v => E.tickVillage(state, v, t));
    const acts = { built: 0, recruited: 0, support: 0, research: 0, coins: 0, recalled: 0, settled: 0 };
    const threatened = {};

    defend(state, p, vs, t, acts, threatened);
    const reserves = {};
    vs.forEach(v => {
      if (p.build && !threatened[v.id]) reserves[v.id] = buildVillage(state, v, p, t, acts);
    });
    if (p.settle) {
      const sv = settleStep(state, p, vs, t, threatened, acts);
      if (sv) {
        const cur = reserves[sv.id] || { wood: 0, clay: 0, iron: 0 };
        reserves[sv.id] = { wood: Math.max(cur.wood, sv.cost.wood), clay: Math.max(cur.clay, sv.cost.clay), iron: Math.max(cur.iron, sv.cost.iron) };
      }
    }
    if (p.recruit !== 'off') vs.forEach(v => recruitVillage(state, v, p, t, reserves[v.id], !!threatened[v.id], acts));
    if (p.tech) manageTech(state, p, vs, t, acts);
    recall(state, p, t, acts);

    ['built', 'recruited', 'support', 'research', 'coins', 'recalled', 'settled'].forEach(k => { p.stats[k] = (p.stats[k] || 0) + acts[k]; });
    p.last = { t, built: acts.built, recruited: acts.recruited, support: acts.support, research: acts.research, settled: acts.settled };
  }

  /* ---------- konfiguracja ---------- */
  function normalize(cfg, base) {
    const D = P().defaults, o = Object.assign({}, D, base || {});
    if (cfg.on !== undefined) o.on = !!cfg.on;
    if (cfg.build !== undefined) o.build = !!cfg.build;
    if (cfg.tech !== undefined) o.tech = !!cfg.tech;
    if (cfg.defend !== undefined) o.defend = !!cfg.defend;
    if (cfg.recruit !== undefined && ['defense', 'balanced', 'off'].indexOf(cfg.recruit) >= 0) o.recruit = cfg.recruit;
    if (cfg.convoy !== undefined) o.convoy = !!cfg.convoy;
    if (cfg.settle !== undefined) o.settle = !!cfg.settle;
    if (cfg.settleMax !== undefined) { const n = Math.floor(Number(cfg.settleMax)); o.settleMax = n >= 1 && n <= 200 ? n : 0; }
    if (cfg.hub !== undefined) o.hub = cfg.hub || null;
    if (cfg.defLevel !== undefined) { const n = Number(cfg.defLevel); if (n >= 5 && n <= 400) o.defLevel = Math.round(n); }
    return o;
  }
  function configure(state, cfg, t) {
    const old = state.pilot || {};
    const p = normalize(cfg || {}, old);
    p.log = old.log || []; p.stats = old.stats || {}; p.seen = old.seen || {}; p.threat = old.threat || {};
    p.deployed = old.deployed || {}; p.last = old.last || null;
    p.next = p.on ? t + 1000 : null;
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
