/* =========================================================================
   Mini Plemiona – PRZECIWNICY AI
   Lokalny skrypt decyzyjny (bez zewnętrznych API). Wywoływany przez
   centralny procesor zdarzeń co C.AI.thinkInterval sekund czasu gry –
   także wstecznie, gdy gra była zamknięta.
   Każda frakcja: rozbudowuje, rekrutuje, atakuje i zdobywa wioski.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const E = MP.Engine;

  function pickWeighted(state, pairs) {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = E.rand(state) * total;
    for (const p of pairs) { r -= p[1]; if (r <= 0) return p[0]; }
    return pairs[pairs.length - 1][0];
  }

  function noblesOf(state, v) {
    let n = v.units.noble;
    v.recruitQueue.forEach(e => { if (e.unit === 'noble') n += e.count - e.done; });
    state.movements.forEach(m => { if (m.from === v.id && m.owner === v.owner) n += m.units.noble; });
    return n;
  }

  function settlersOf(state, v) {
    let n = v.units.settler;
    v.recruitQueue.forEach(e => { if (e.unit === 'settler') n += e.count - e.done; });
    state.movements.forEach(m => { if (m.from === v.id && m.owner === v.owner) n += m.units.settler || 0; });
    return n;
  }

  function trySettle(state, v, t) {
    if (v.units.settler < 1) return;
    const N = state.map.size;
    const zone = E.diff(state).playerZone, players = E.villagesOf(state, 'player');
    let best = null;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = E.dist(v, { x, y });
        if (d < 1.5 || d > 4.5) continue;
        if (E.settleCheck(state, x, y)) continue;
        if (zone && players.some(pv => E.dist(pv, { x, y }) <= zone)) continue;
        if (state.movements.some(m => m.type === 'settle' && m.x === x && m.y === y)) continue;
        const crowd = Object.values(state.villages).filter(o => E.dist(o, { x, y }) < 2.5).length;
        const score = d + crowd * 1.5 + E.rand(state);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    if (best) E.sendSettler(state, v.id, best.x, best.y, t);
  }

  function trySpy(state, v, P, t) {
    if (!P.spyChance || v.units.scout < 2 || E.rand(state) >= P.spyChance) return;
    if ((t - state.created) / 60000 < E.diff(state).graceMinutes) return;
    const targets = E.villagesOf(state, 'player').filter(p => E.dist(v, p) <= P.range);
    if (!targets.length) return;
    const target = targets[Math.floor(E.rand(state) * targets.length)];
    E.sendSpy(state, v.id, target.id, Math.min(v.units.scout, 3), t);
  }

  // Buduje to, czego ma najmniej względem wag osobowości.
  function manageBuild(state, v, P, t) {
    if (v.buildQueue.length >= 2) return;
    const order = Object.keys(P.buildWeights).map(k => {
      const queued = v.buildQueue.filter(e => e.building === k).length;
      return { k, score: (v.buildings[k] + queued) / P.buildWeights[k] };
    }).sort((a, b) => a.score - b.score);
    for (const o of order) {
      const info = E.buildInfo(state, v, o.k);
      if (info.ok) { E.queueBuild(state, v, o.k, t); return; }
      if (info.code === 'resources') return; // oszczędza na najważniejszy budynek
    }
  }

  function manageRecruit(state, v, P, t) {
    if (v.recruitQueue.length >= 2) return;
    const owned = E.villagesOf(state, v.owner).length;
    const X = E.diff(state).aiExpand;
    if (P.nobles && v.buildings.barracks >= C.UNITS.noble.barracks && noblesOf(state, v) === 0 && owned < Math.ceil(P.maxVillages * X)) {
      const ri = E.recruitInfo(state, v, 'noble');
      if (ri.ok && ri.max >= 1) { E.queueRecruit(state, v, 'noble', 1, t); return; }
      if (E.rand(state) < 0.6) return; // odkłada surowce na dowódcę
    }
    // osadnik: rozrost na wolne ziemie
    if (P.settle && v.buildings.hq >= C.UNITS.settler.hq && owned < Math.ceil((P.settleMax || P.maxVillages) * X) && settlersOf(state, v) === 0 &&
        state.movements.filter(m => m.type === 'settle' && m.owner === v.owner).length === 0 && E.rand(state) < 0.5) {
      const si = E.recruitInfo(state, v, 'settler');
      if (si.ok && si.max >= 1) { E.queueRecruit(state, v, 'settler', 1, t); return; }
      if (si.code === 'resources') return; // odkłada surowce na osadnika
    }
    // zwiadowców wystarczy kilku
    const scoutCap = 6;
    const siegeCap = 20;
    const unlocked = Object.keys(C.UNITS).filter(u => !C.UNITS[u].conquer && !C.UNITS[u].settler &&
      v.buildings.barracks >= C.UNITS[u].barracks && (P.unitWeights[u] || 0) > 0 &&
      !(u === 'scout' && v.units.scout >= scoutCap) && !(C.UNITS[u].wallPower && E.ramCount(v.units) >= siegeCap));
    if (!unlocked.length) return;
    const unit = pickWeighted(state, unlocked.map(k => [k, P.unitWeights[k]]));
    const U = C.UNITS[unit];
    const ri = E.recruitInfo(state, v, unit);
    if (!ri.ok) return;
    const byBudget = Math.min.apply(null, E.RES.map(r => Math.floor(v.res[r] * P.recruitShare / U.cost[r])));
    const n = Math.min(ri.max, byBudget, unit === 'scout' ? 3 : U.wallPower ? 5 : C.AI.maxOrder);
    if (n >= 1) E.queueRecruit(state, v, unit, n, t);
  }

  function tryAttack(state, v, P, t) {
    if (state.movements.some(m => m.from === v.id && m.type === 'attack')) return; // jedna wyprawa naraz
    const send = E.emptyUnits();
    Object.keys(C.UNITS).forEach(k => {
      const U = C.UNITS[k];
      if (U.conquer || U.settler || U.scout) return;
      send[k] = U.role === 'def' ? Math.floor(v.units[k] * (1 - P.keepHome)) : v.units[k];
    });
    const A = E.attackPower(send);
    if (A < P.minPower) return;

    const D = E.diff(state);
    const minutes = (t - state.created) / 60000;
    const grace = minutes < D.graceMinutes;
    const cooldown = D.hitCooldownMin * 60000;
    const owned = E.villagesOf(state, v.owner).length;
    const canTakeAny = P.targets === 'any' || minutes >= P.anyAfterMin;
    const playerAll = E.villagesOf(state, 'player');
    const playerVs = grace ? playerAll : [];
    let best = null;
    for (const id in state.villages) {
      const target = state.villages[id];
      if (target.owner === v.owner) continue;
      if (target.owner !== null && !canTakeAny) continue;
      if (target.owner === null && owned >= Math.ceil(P.maxVillages * D.aiExpand)) continue;
      if (target.owner === null && D.playerZone && playerAll.some(pv => E.dist(pv, target) <= D.playerZone)) continue;
      if (target.owner === 'player' && (grace || (state.lastHit && t - (state.lastHit[target.id] || -1e15) < cooldown))) continue;
      const d = E.dist(v, target);
      if (d > P.range) continue;
      // okres ochronny: osady bliższe graczowi zostają dla niego
      if (grace && target.owner === null && playerVs.some(pv => E.dist(pv, target) < d)) continue;
      E.tickVillage(state, target, t);
      const wall = Math.max(0, target.buildings.wall - Math.floor(E.ramCount(send) / C.RAM.fightPerLevel));
      const Dv = E.villageDefense(target, wall, E.upgradesOf(state, target.owner));
      if (A < Dv * P.attackRatio * (target.owner === 'player' ? D.aiCaution : 1)) continue;
      let w = 1 / (1 + d);
      if (target.owner === null) w *= P.neutralBias;
      else if (target.owner === 'player') w *= P.playerBias * D.playerBias;
      if (!best || w > best.w) best = { target, w };
    }
    if (!best) return;
    if (best.target.owner !== null && P.nobles && v.units.noble > 0) send.noble = 1;
    E.sendAttack(state, v.id, best.target.id, send, t);
  }

  function think(state, fid, t) {
    const f = state.factions[fid];
    const P = C.AI.personalities[f.personality];
    const vs = E.villagesOf(state, fid);
    for (const v of vs) {
      E.tickVillage(state, v, t);
      manageBuild(state, v, P, t);
      manageRecruit(state, v, P, t);
    }
    for (const v of vs) {
      if (P.settle) trySettle(state, v, t);
      trySpy(state, v, P, t);
      if (E.rand(state) < P.attackChance * E.diff(state).aiAggro) tryAttack(state, v, P, t);
    }
  }

  MP.AI = { think };
})(typeof window !== 'undefined' ? window : globalThis);
