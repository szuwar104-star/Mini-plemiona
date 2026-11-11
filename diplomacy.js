/* =========================================================================
   Mini Plemiona – DYPLOMACJA
   Nastawienie frakcji (-100 … +100, osobno w każdą stronę), pakty o
   nieagresji, dary, zdrada i „lider”. Obowiązuje gracza i frakcje AI tak
   samo. Deterministyczne (E.rand), liczone w centralnym procesorze zdarzeń
   (tick wywoływany z AI.think), więc działa także wstecznie.
   Stan: state.diplo = { rel, hostile, rep, pacts, offers, cool, gifts, last, seq }.
   Wszystkie liczby: C.DIPLO i C.AI.personalities[*].diplo w config.js.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const E = MP.Engine;
  const MIN = 60000;
  const DC = () => C.DIPLO;

  function ensure(state) {
    if (!state.diplo) state.diplo = { rel: {}, hostile: {}, rep: {}, pacts: [], offers: [], cool: {}, gifts: {}, last: 0, seq: 0 };
    const d = state.diplo;
    ['rel', 'hostile', 'rep', 'cool', 'gifts'].forEach(k => { if (!d[k]) d[k] = {}; });
    if (!d.pacts) d.pacts = [];
    if (!d.offers) d.offers = [];
    return d;
  }
  const pair = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const dir = (a, b) => a + '>' + b;
  const isAI = (state, id) => !!(state.factions[id] && state.factions[id].ai);
  const alive = (state, id) => !!(state.factions[id] && state.factions[id].alive);
  const nameOf = (state, id) => E.ownerName(state, id);
  // Parametry dyplomatyczne frakcji AI (null dla gracza).
  const params = (state, id) => (isAI(state, id) ? C.AI.personalities[state.factions[id].personality].diplo : null);

  /* ---------- nastawienie ---------- */
  function attitude(state, a, b) {
    const D = params(state, a);
    if (!D) return 0;
    const v = ensure(state).rel[dir(a, b)];
    return v == null ? D.baseline : v;
  }
  function adjust(state, a, b, delta) {
    if (!params(state, a) || a === b) return;
    ensure(state).rel[dir(a, b)] = Math.max(-100, Math.min(100, attitude(state, a, b) + delta));
  }
  function attitudeLabel(v) {
    return v <= -40 ? 'Wrogie' : v <= -10 ? 'Nieufne' : v < 15 ? 'Obojętne' : v < 40 ? 'Przychylne' : 'Przyjazne';
  }

  /* ---------- pakty ---------- */
  const active = (p, t) => t < p.end && !(p.breakAt != null && t >= p.breakAt);
  function pactBetween(state, a, b, t) {
    if (a === null || b === null || a === b) return null;
    const k = pair(a, b);
    return ensure(state).pacts.find(p => pair(p.a, p.b) === k && active(p, t)) || null;
  }
  const blocked = (state, a, b, t) => !!pactBetween(state, a, b, t);
  const pactsOf = (state, id, t) => ensure(state).pacts.filter(p => (p.a === id || p.b === id) && active(p, t));
  const partnerOf = (p, id) => (p.a === id ? p.b : p.a);
  // „Lider” = frakcja z co najmniej leaderShare celu zwycięstwa. Zbiór liczony jednym przejściem po wioskach
  // i odświeżany co minutę czasu gry (tick) – bez tego ocena celu w AI byłaby kwadratowa względem liczby wiosek.
  const leaderCache = new WeakMap();
  function leaderSet(state, t, force) {
    const c = leaderCache.get(state);
    if (c && !force && t !== undefined && t >= c.t && t - c.t < MIN) return c.set;
    const need = Math.ceil(E.winVillages(state) * DC().leaderShare), n = {};
    for (const id in state.villages) { const o = state.villages[id].owner; if (o !== null) n[o] = (n[o] || 0) + 1; }
    const set = new Set(Object.keys(n).filter(o => n[o] >= need && alive(state, o)));
    leaderCache.set(state, { t: t === undefined ? -Infinity : t, set });
    return set;
  }
  const isLeader = (state, id, t) => id !== null && leaderSet(state, t).has(id);
  function minDistance(state, a, b) {
    const va = E.villagesOf(state, a), vb = E.villagesOf(state, b);
    let best = Infinity;
    va.forEach(x => vb.forEach(y => { const d = E.dist(x, y); if (d < best) best = d; }));
    return best;
  }
  function notifyPlayer(state, t, kind, text, ids) {
    if (ids.indexOf('player') >= 0) E.notice(state, t, kind, text);
  }

  // Czy `me` (AI) zgodziłby się na pakt z `them`? Czysta ocena, bez skutków ubocznych.
  function assess(state, me, them, t) {
    const d = ensure(state), cfg = DC(), D = params(state, me);
    if (!D || !alive(state, me) || !alive(state, them)) return { ok: false, code: 'dead', reason: 'Ta frakcja nie istnieje.' };
    const existing = pactBetween(state, me, them, t);
    if (isLeader(state, them, t)) return { ok: false, code: 'leader', reason: 'Jesteś zbyt blisko zwycięstwa – nikt nie chce z Tobą paktu.' };
    if ((d.rep[them] || 0) >= D.repLimit) return { ok: false, code: 'distrust', reason: 'Nie ufa komuś, kto zrywa pakty.' };
    if ((d.cool[pair(me, them)] || 0) > t) return { ok: false, code: 'cooldown', reason: 'Niedawno odrzuciła propozycję – spróbuj później.' };
    if (!existing && pactsOf(state, me, t).length >= cfg.maxPacts) return { ok: false, code: 'full', reason: 'Ma już komplet paktów.' };
    const att = attitude(state, me, them);
    if (att < D.minAttitude) {
      return { ok: false, code: att < -20 ? 'hostile' : 'cold', need: Math.ceil(D.minAttitude - att),
        reason: att < -20 ? 'Jest do Ciebie wrogo nastawiona.' : 'Jeszcze Ci nie ufa. Poprawi to czas bez ataków albo dar.' };
    }
    return { ok: true };
  }

  function signPact(state, a, b, t) {
    const d = ensure(state), cfg = DC();
    const ex = pactBetween(state, a, b, t);
    if (ex) { ex.end = t + cfg.pactMin * MIN; ex.warned = false; ex.renewTried = false; }
    else d.pacts.push({ id: 'p' + (++d.seq), a, b, start: t, end: t + cfg.pactMin * MIN, breakAt: null, breakBy: null, warned: false, renewTried: false });
    adjust(state, a, b, cfg.signBonus); adjust(state, b, a, cfg.signBonus);
    return !!ex;
  }

  // Wypowiedzenie: pakt chroni jeszcze breakNoticeMin minut. Zrywający traci zaufanie (chyba że „uzasadnione”).
  function breakPact(state, by, other, t, justified) {
    const d = ensure(state), cfg = DC();
    const p = pactBetween(state, by, other, t);
    if (!p || p.breakAt != null) return { ok: false, reason: 'Brak aktywnego paktu.' };
    p.breakAt = Math.min(p.end, t + cfg.breakNoticeMin * MIN); p.breakBy = by;
    if (!justified) {
      adjust(state, other, by, -cfg.breakPenalty);
      d.rep[by] = (d.rep[by] || 0) + cfg.repPerBreak;
    }
    if (by === 'player') notifyPlayer(state, t, 'info', 'Wypowiedziano pakt z ' + nameOf(state, other) + '. Chroni jeszcze ' + cfg.breakNoticeMin + ' min.', [by]);
    else notifyPlayer(state, t, 'danger', nameOf(state, by) + ' wypowiada pakt o nieagresji! Za ' + cfg.breakNoticeMin + ' min może zaatakować.', [other]);
    return { ok: true };
  }

  /* ---------- akcje gracza ---------- */
  function proposeFromPlayer(state, fid, t) {
    const d = ensure(state), cfg = DC();
    if (!isAI(state, fid) || !alive(state, fid)) return { ok: false, reason: 'Ta frakcja nie istnieje.' };
    const pending = d.offers.find(o => o.from === fid);
    if (pending) { const r = answerOffer(state, pending.id, true, t); return r.ok ? { ok: true, renewed: !!pending.renew } : r; } // własna oferta AI = zgoda
    const ex = pactBetween(state, 'player', fid, t);
    if (ex && ex.breakAt != null) return { ok: false, reason: 'Pakt jest wypowiedziany.' };
    if (!ex && pactsOf(state, 'player', t).length >= cfg.playerMaxPacts) return { ok: false, reason: 'Masz już maksymalną liczbę paktów (' + cfg.playerMaxPacts + ').' };
    if (ex && ex.end - t > cfg.pactMin * MIN / 2) return { ok: false, reason: 'Pakt można przedłużyć w drugiej połowie jego trwania.' };
    const a = assess(state, fid, 'player', t);
    if (!a.ok) {
      if (a.code === 'cold' || a.code === 'hostile' || a.code === 'distrust') d.cool[pair(fid, 'player')] = t + cfg.rejectCoolMin * MIN;
      return { ok: false, reason: a.reason, code: a.code };
    }
    const renewed = signPact(state, 'player', fid, t);
    E.notice(state, t, 'good', nameOf(state, fid) + (renewed ? ' przedłuża' : ' zawiera') + ' pakt o nieagresji.');
    return { ok: true, renewed };
  }

  function answerOffer(state, offerId, accept, t) {
    const d = ensure(state), cfg = DC();
    const i = d.offers.findIndex(o => o.id === offerId);
    if (i < 0) return { ok: false, reason: 'Oferta wygasła.' };
    const o = d.offers[i];
    if (accept) {
      const ex = pactBetween(state, 'player', o.from, t);
      if (!ex && pactsOf(state, 'player', t).length >= cfg.playerMaxPacts) return { ok: false, reason: 'Masz już maksymalną liczbę paktów (' + cfg.playerMaxPacts + ').' };
      if (!alive(state, o.from)) { d.offers.splice(i, 1); return { ok: false, reason: 'Ta frakcja już nie istnieje.' }; }
      d.offers.splice(i, 1);
      const renewed = signPact(state, 'player', o.from, t);
      return { ok: true, renewed };
    }
    d.offers.splice(i, 1);
    d.cool[pair(o.from, 'player')] = t + cfg.rejectCoolMin * MIN;
    return { ok: true, declined: true };
  }

  // Dar surowców dla frakcji AI (znika z wioski) podnosi jej nastawienie.
  function gift(state, villageId, fid, res, t) {
    const d = ensure(state), cfg = DC();
    const v = state.villages[villageId];
    if (!v || v.owner !== 'player') return { ok: false, reason: 'Wybierz swoją wioskę.' };
    if (!isAI(state, fid) || !alive(state, fid)) return { ok: false, reason: 'Ta frakcja nie istnieje.' };
    if ((d.gifts[fid] || 0) > t) return { ok: false, reason: 'Poprzedni dar jeszcze nie został doceniony – poczekaj chwilę.' };
    E.tickVillage(state, v, t);
    let total = 0;
    const give = {};
    for (const r of E.RES) {
      give[r] = Math.max(0, Math.floor(Number(res && res[r]) || 0));
      if (give[r] > v.res[r]) return { ok: false, reason: 'Za mało surowców w ' + v.name + '.' };
      total += give[r];
    }
    if (total < cfg.giftPerRes) return { ok: false, reason: 'Dar musi mieć co najmniej ' + cfg.giftPerRes + ' surowców.' };
    E.RES.forEach(r => { v.res[r] -= give[r]; });
    const delta = Math.min(cfg.giftMax, Math.floor(total / cfg.giftPerRes));
    adjust(state, fid, 'player', delta);
    d.gifts[fid] = t + cfg.giftCoolMin * MIN;
    return { ok: true, delta, total };
  }

  /* ---------- skutki walk ---------- */
  function onBattle(state, att, def, won, conquered, t) {
    if (def === null || !isAI(state, def) || att === def) return;
    const d = ensure(state), cfg = DC();
    adjust(state, def, att, -(conquered ? cfg.hitConquer : won ? cfg.hitWin : cfg.hitLoss));
    d.hostile[dir(def, att)] = t;
    if (conquered) pactsOf(state, def, t).forEach(p => { const friend = partnerOf(p, def); if (friend !== att) adjust(state, friend, att, -cfg.allyOutrage); });
  }

  // Mnożnik atrakcyjności celu dla AI: 0 = pakt (nie atakuje), >1 = zemsta albo lider, <1 = sympatia.
  function targetWeight(state, me, owner, t) {
    if (owner === null || me === owner) return 1;
    if (pactBetween(state, me, owner, t)) return 0;
    const D = params(state, me);
    if (!D) return 1;
    const att = attitude(state, me, owner);
    let w = att < 0 ? 1 + (-att) / D.revenge : 1 - Math.min(0.5, att / 150);
    if (isLeader(state, owner, t)) w *= 1 + D.leaderBias;
    return w;
  }

  /* ---------- tick co minutę czasu gry ---------- */
  function offerToPlayer(state, fid, t, renew) {
    const d = ensure(state), cfg = DC();
    if (d.offers.some(o => o.from === fid)) return;
    d.offers.push({ id: 'o' + (++d.seq), from: fid, renew: !!renew, time: t, expires: t + cfg.offerTtlMin * MIN });
    E.notice(state, t, 'info', nameOf(state, fid) + (renew ? ' proponuje przedłużenie paktu.' : ' proponuje pakt o nieagresji.') + ' Zobacz: Menu → Dyplomacja.');
  }

  function tick(state, t) {
    const d = ensure(state), cfg = DC();
    if (!d.last) { d.last = t; return; }
    const dt = t - d.last;
    if (dt < MIN) return;
    d.last = t;
    const hours = dt / 3600000;
    const ids = Object.keys(state.factions).filter(id => alive(state, id));
    const ais = ids.filter(id => isAI(state, id));
    const anyLeader = leaderSet(state, t, true).size > 0;

    // 1. wygasanie paktów i ofert, ostrzeżenia, zanik nieufności
    d.pacts = d.pacts.filter(p => {
      if (!alive(state, p.a) || !alive(state, p.b)) return false;
      if (!active(p, t)) {
        const other = p.a === 'player' ? p.b : p.a;
        notifyPlayer(state, t, 'info', p.breakAt != null && p.breakAt <= p.end
          ? 'Pakt z ' + nameOf(state, other) + ' przestał obowiązywać.' : 'Pakt z ' + nameOf(state, other) + ' wygasł.', [p.a, p.b]);
        return false;
      }
      if (!p.warned && p.breakAt == null && p.end - t < cfg.warnMin * MIN) {
        p.warned = true;
        notifyPlayer(state, t, 'info', 'Pakt z ' + nameOf(state, p.a === 'player' ? p.b : p.a) + ' wygasa za mniej niż ' + cfg.warnMin + ' min.', [p.a, p.b]);
      }
      return true;
    });
    d.offers = d.offers.filter(o => o.expires > t && alive(state, o.from));
    Object.keys(d.rep).forEach(id => { d.rep[id] = Math.max(0, d.rep[id] - hours / cfg.repDecayHours); if (d.rep[id] < 0.001) delete d.rep[id]; });

    // 2. nastawienie wraca do bazowego, a przy braku wrogich czynów rośnie (szybciej w pakcie)
    ais.forEach(a => {
      const D = params(state, a);
      ids.forEach(b => {
        if (a === b) return;
        const k = dir(a, b), old = attitude(state, a, b);
        let v = old;
        if (v < D.baseline) v = Math.min(D.baseline, v + D.heal * hours);
        else if (v > D.cap) v = Math.max(D.cap, v - D.heal * hours);
        else if (v < D.cap && t - (d.hostile[k] || 0) > 60 * MIN) v = Math.min(D.cap, v + D.warm * hours * (pactBetween(state, a, b, t) ? 2 : 1));
        if (v !== old) d.rel[k] = v;
      });
    });

    // 3. AI zrywa pakty z liderem, a agresywne – także ze słabszym partnerem (zdrada)
    d.pacts.slice().forEach(p => {
      [[p.a, p.b], [p.b, p.a]].forEach(xy => {
        const x = xy[0], y = xy[1];
        if (p.breakAt != null || !isAI(state, x)) return;
        if (isLeader(state, y, t) && !isLeader(state, x, t)) { breakPact(state, x, y, t, true); return; }
        const D = params(state, x);
        if (D.betray && t - p.start > 60 * MIN && E.rand(state) < D.betray * (dt / MIN)) {
          if (E.accountPower(state, y).total < E.accountPower(state, x).total * 0.6) breakPact(state, x, y, t, false);
        }
      });
    });

    // 4. przedłużenia i własne propozycje AI
    ais.forEach(a => {
      const D = params(state, a);
      pactsOf(state, a, t).forEach(p => {
        if (p.breakAt != null || p.renewTried || p.end - t > cfg.renewWindowMin * MIN) return;
        p.renewTried = true;
        const o = partnerOf(p, a);
        if (o === 'player') { if (assess(state, a, o, t).ok) offerToPlayer(state, a, t, true); }
        else if (assess(state, a, o, t).ok && assess(state, o, a, t).ok) signPact(state, a, o, t);
      });
      if (pactsOf(state, a, t).length >= cfg.maxPacts) return;
      const chance = D.offerChance * (dt / MIN) * (anyLeader && !isLeader(state, a, t) ? 1.5 : 1);
      if (E.rand(state) >= chance) return;
      const cands = ids.filter(b => b !== a && !pactBetween(state, a, b, t) && !isLeader(state, b, t) && !((d.cool[pair(a, b)] || 0) > t) &&
        !d.offers.some(o => o.from === a) && attitude(state, a, b) >= D.minAttitude + (b === 'player' ? 5 : 0))
        .map(b => ({ b, d: minDistance(state, a, b) })).filter(c => c.d <= 10).sort((x, y) => x.d - y.d);
      if (!cands.length) return;
      const b = cands[0].b;
      if (b === 'player') offerToPlayer(state, a, t, false);
      else if (assess(state, b, a, t).ok) signPact(state, a, b, t);
      else d.cool[pair(a, b)] = t + cfg.rejectCoolMin * MIN;
    });
  }

  MP.Diplomacy = { ensure, attitude, adjust, attitudeLabel, pactBetween, pactsOf, partnerOf, blocked, isLeader, assess,
    signPact, breakPact, proposeFromPlayer, answerOffer, gift, onBattle, targetWeight, tick };
})(typeof window !== 'undefined' ? window : globalThis);
