/* =========================================================================
   Mini Plemiona – DYPLOMACJA
   Nastawienie frakcji (-100 … +100, osobno w każdą stronę), pakty o
   nieagresji, dary, zdrada i „lider”. Obowiązuje gracza i frakcje AI tak
   samo. Deterministyczne (E.rand), liczone w centralnym procesorze zdarzeń
   (tick wywoływany z AI.think), więc działa także wstecznie.
   Sojusze (alliances): bloki 2–4 frakcji AI, w których nikt nikogo nie atakuje. Wojny AI z AI (wars) toczą się
   tylko po wypowiedzeniu (albo przeciw „liderowi”), trwają ograniczony czas i liczbę bitew, po czym następuje
   rozejm (peace) – dzięki temu frakcje nie wykrwawiają się w ciągłych potyczkach.
   Stan: state.diplo = { rel, hostile, rep, pacts, offers, cool, gifts, last, seq, alliances, wars, peace }.
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
    if (!state.diplo) state.diplo = { rel: {}, hostile: {}, rep: {}, pacts: [], offers: [], cool: {}, gifts: {}, last: 0, seq: 0, alliances: [], wars: [], peace: {} };
    const d = state.diplo;
    ['rel', 'hostile', 'rep', 'cool', 'gifts', 'peace'].forEach(k => { if (!d[k]) d[k] = {}; });
    if (!d.pacts) d.pacts = [];
    if (!d.offers) d.offers = [];
    if (!d.alliances) d.alliances = []; // starsze zapisy nie miały sojuszy ani wojen
    if (!d.wars) d.wars = [];
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
  /* ---------- sojusze ---------- */
  const allianceOf = (state, id) => (id === null || id === 'player' ? null : ensure(state).alliances.find(al => al.members.indexOf(id) >= 0) || null);
  const allied = (state, a, b) => { if (a === null || b === null || a === b) return false; const al = allianceOf(state, a); return !!al && al.members.indexOf(b) >= 0; };
  // Blok frakcji: ona sama i jej sojusznicy (żywi).
  const blocOf = (state, id) => { const al = allianceOf(state, id); return al ? al.members.filter(x => alive(state, x)) : [id]; };
  const blocPower = (state, id) => blocOf(state, id).reduce((n, x) => n + E.accountPower(state, x).total, 0);
  const maxMembers = state => {
    const n = Object.keys(state.factions).filter(id => isAI(state, id) && alive(state, id)).length;
    return Math.max(2, Math.min(DC().alliance.maxMembers, Math.ceil(n / 3)));
  };

  /* ---------- wojny AI z AI ---------- */
  const warBetween = (state, a, b, t) => {
    if (a === null || b === null || a === b) return null;
    const k = pair(a, b);
    return ensure(state).wars.find(w => w.end > t && pair(w.a, w.b) === k) || null;
  };
  const warsOf = (state, id, t) => ensure(state).wars.filter(w => (w.a === id || w.b === id) && w.end > t);

  // Pakt albo sojusz: żadna ze stron nie może atakować drugiej.
  const blocked = (state, a, b, t) => !!pactBetween(state, a, b, t) || allied(state, a, b);
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
    // frakcja AI bywa liderem tylko w trybie Wyścig (poza nim AI nie może wygrać, więc nie ma czego hamować);
    // inaczej każda AI dobijająca do limitu wiosek stawałaby się celem wszystkich i frakcje wyniszczałyby się nawzajem
    const set = new Set(Object.keys(n).filter(o => n[o] >= need && alive(state, o) && (state.race || !isAI(state, o))));
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
  // Wpis w Kronice świata (zapisany jako przeczytany, bez plakietki i wyskakujących okienek).
  function chronicle(state, t, diplo, a, b, members) {
    E.addReport(state, { id: E.newId(state, 'r'), time: t, kind: 'news', read: true, diplo, attacker: a, defender: b || null,
      members: members || null, toName: '', toX: 0, toY: 0, to: null });
  }
  function notifyPlayer(state, t, kind, text, ids) {
    if (ids.indexOf('player') >= 0) E.notice(state, t, kind, text);
  }

  // Czy `me` (AI) zgodziłby się na pakt z `them`? Czysta ocena, bez skutków ubocznych.
  function assess(state, me, them, t) {
    const d = ensure(state), cfg = DC(), D = params(state, me);
    if (!D || !alive(state, me) || !alive(state, them)) return { ok: false, code: 'dead', reason: 'Ta frakcja nie istnieje.' };
    const existing = pactBetween(state, me, them, t);
    if (warBetween(state, me, them, t)) return { ok: false, code: 'war', reason: 'Toczy z Tobą wojnę.' };
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
    // sojusznicy ofiary mają za złe każdy atak (nie tylko podbój)
    blocOf(state, def).forEach(friend => { if (friend !== def && friend !== att) adjust(state, friend, att, -cfg.allyOutrage); });
    // zmęczenie wojną: po maxBattles bitwach między stronami wojna kończy się rozejmem
    const w = isAI(state, att) ? warBetween(state, att, def, t) : null;
    if (w && ++w.battles >= cfg.war.maxBattles) endWar(state, w, t, 'weary');
  }

  // Mnożnik atrakcyjności celu dla AI: 0 = pakt (nie atakuje), >1 = zemsta albo lider, <1 = sympatia.
  function targetWeight(state, me, owner, t) {
    if (owner === null || me === owner) return 1;
    if (blocked(state, me, owner, t)) return 0;
    const D = params(state, me);
    if (!D) return 1;
    // AI atakuje inną frakcję AI tylko w czasie wojny (albo gdy to „lider”, albo sama jest liderem); poza wojną panuje pokój
    if (isAI(state, owner) && !warBetween(state, me, owner, t) && !isLeader(state, owner, t) && !isLeader(state, me, t)) return 0;
    const att = attitude(state, me, owner);
    let w = att < 0 ? 1 + (-att) / D.revenge : 1 - Math.min(0.5, att / 150);
    if (isLeader(state, owner, t)) w *= 1 + D.leaderBias;
    return w;
  }

  /* ---------- sojusze: tworzenie, wyjście ---------- */
  function formAlliance(state, a, b, t) {
    const d = ensure(state);
    let al = allianceOf(state, a) || allianceOf(state, b);
    if (!al) { al = { id: 'al' + (++d.seq), members: [a, b], formed: t }; d.alliances.push(al); chronicle(state, t, 'alliance', a, b, al.members.slice()); }
    else {
      const newcomer = al.members.indexOf(a) >= 0 ? b : a;
      al.members.push(newcomer);
      chronicle(state, t, 'join', newcomer, al.members[0], al.members.slice());
    }
    // pakty między członkami są zbędne – zwalniają limit paktów
    d.pacts = d.pacts.filter(p => !(al.members.indexOf(p.a) >= 0 && al.members.indexOf(p.b) >= 0));
    al.members.forEach(x => al.members.forEach(y => { if (x !== y) adjust(state, x, y, DC().alliance.joinBonus); }));
    return al;
  }
  function leaveAlliance(state, id, t, why) {
    const d = ensure(state), cfg = DC().alliance, al = allianceOf(state, id);
    if (!al) return;
    const rest = al.members.filter(x => x !== id);
    al.members = rest;
    if (rest.length < 2) d.alliances = d.alliances.filter(x => x !== al);
    rest.forEach(x => {
      d.peace[pair(id, x)] = t + cfg.leaveGraceMin * MIN;
      if (why === 'betray') adjust(state, x, id, -cfg.leavePenalty);
    });
    if (why === 'betray') d.rep[id] = (d.rep[id] || 0) + DC().repPerBreak;
    chronicle(state, t, why === 'betray' ? 'betray' : 'leave', id, rest[0] || null, rest.length >= 2 ? rest.slice() : null);
  }

  /* ---------- wojny: wypowiedzenie i rozejm ---------- */
  function openWar(state, x, y, t, end, joined) {
    const d = ensure(state);
    if (x === y || allied(state, x, y) || warBetween(state, x, y, t)) return null;
    const w = { id: 'w' + (++d.seq), a: x, b: y, start: t, end, battles: 0, joined: !!joined };
    d.wars.push(w);
    adjust(state, x, y, -10); adjust(state, y, x, -10);
    return w;
  }
  function declareWar(state, a, b, t) {
    const wc = DC().war, end = t + wc.durationMin * MIN;
    const w = openWar(state, a, b, t, end, false);
    if (!w) return null;
    const mine = blocOf(state, a).filter(x => x !== a), theirs = blocOf(state, b).filter(x => x !== b);
    theirs.forEach(m => openWar(state, a, m, t, end, true)); // sojusznicy obrońcy stają po jego stronie
    mine.forEach(m => { // sojusznicy agresora dołączają z pewną szansą (tylko jeśli cel jest w zasięgu)
      if (E.rand(state) < wc.joinChance && minDistance(state, m, b) <= wc.range) openWar(state, m, b, t, end, true);
    });
    chronicle(state, t, 'war', a, b, null);
    return w;
  }
  function endWar(state, w, t, why) {
    const d = ensure(state), wc = DC().war;
    d.wars = d.wars.filter(x => x !== w);
    d.peace[pair(w.a, w.b)] = t + wc.peaceMin * MIN;
    [[w.a, w.b], [w.b, w.a]].forEach(xy => {
      if (!alive(state, xy[0]) || !alive(state, xy[1])) return;
      if (attitude(state, xy[0], xy[1]) < wc.truceAttitude) adjust(state, xy[0], xy[1], wc.truceAttitude - attitude(state, xy[0], xy[1]));
    });
    if (!w.joined && alive(state, w.a) && alive(state, w.b)) chronicle(state, t, 'peace', w.a, w.b, null);
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
    d.wars.slice().forEach(w => { if (w.end <= t || !alive(state, w.a) || !alive(state, w.b)) endWar(state, w, t, 'time'); });
    Object.keys(d.peace).forEach(k => { if (d.peace[k] <= t) delete d.peace[k]; });
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

    // 3b. sojusze: wymarłe i niepełne się rozwiązują, lider odpada, agresywny członek może zdradzić słabszych
    d.alliances = d.alliances.filter(al => { al.members = al.members.filter(x => alive(state, x)); return al.members.length >= 2; });
    d.alliances.slice().forEach(al => al.members.slice().forEach(x => {
      if (al.members.indexOf(x) < 0) return;
      if (isLeader(state, x, t) && al.members.length >= 2) { leaveAlliance(state, x, t, 'leader'); return; }
      const D = params(state, x);
      if (D && D.betray && E.rand(state) < D.betray * cfg.alliance.betrayMult * (dt / MIN)) {
        const others = al.members.filter(y => y !== x);
        const avg = others.reduce((n, y) => n + E.accountPower(state, y).total, 0) / others.length;
        if (avg < E.accountPower(state, x).total * 0.6) leaveAlliance(state, x, t, 'betray');
      }
    }));

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
      const cands = ids.filter(b => b !== a && !pactBetween(state, a, b, t) && !allied(state, a, b) && !warBetween(state, a, b, t) && !isLeader(state, b, t) && !((d.cool[pair(a, b)] || 0) > t) &&
        !d.offers.some(o => o.from === a) && attitude(state, a, b) >= D.minAttitude + (b === 'player' ? 5 : 0))
        .map(b => ({ b, d: minDistance(state, a, b) })).filter(c => c.d <= 10).sort((x, y) => x.d - y.d);
      if (!cands.length) return;
      const b = cands[0].b;
      if (b === 'player') offerToPlayer(state, a, t, false);
      else if (assess(state, b, a, t).ok) signPact(state, a, b, t);
      else d.cool[pair(a, b)] = t + cfg.rejectCoolMin * MIN;
    });

    // 5. sojusze: przychylne sobie frakcje łączą się w bloki (albo dołączają do istniejącego, jeśli wszyscy członkowie się zgadzają)
    const AL = cfg.alliance;
    ais.forEach(a => {
      const D = params(state, a);
      if (!D.allyChance || isLeader(state, a, t) || E.rand(state) >= D.allyChance * (dt / MIN)) return;
      const myAl = allianceOf(state, a);
      if (myAl && myAl.members.length >= maxMembers(state)) return;
      const cands = ais.filter(b => b !== a && !allied(state, a, b) && !isLeader(state, b, t) && !((d.peace[pair(a, b)] || 0) > t) &&
        attitude(state, a, b) >= AL.minAttitude && attitude(state, b, a) >= AL.minAttitude)
        .filter(b => {
          const bAl = allianceOf(state, b);
          if (myAl && bAl) return false;                                    // dwa istniejące sojusze się nie łączą
          const al = myAl || bAl, newcomer = myAl ? b : a;
          if (al && al.members.length >= maxMembers(state)) return false;
          const group = al ? al.members : [b];
          return group.every(m => !warBetween(state, newcomer, m, t) && (m === b || m === a || attitude(state, m, newcomer) >= AL.minAttitude - 5) &&
            (d.rep[newcomer] || 0) < params(state, m).repLimit);
        })
        .map(b => ({ b, d: minDistance(state, a, b) })).filter(c => c.d <= AL.range).sort((x, y) => x.d - y.d);
      if (cands.length) formAlliance(state, a, cands[0].b, t);
    });

    // 6. wojny: agresywne frakcje czasem wypowiadają wojnę sąsiadowi, ale nie blokowi silniejszemu od własnego
    const WC = cfg.war;
    ais.forEach(a => {
      const D = params(state, a);
      if (!D.warChance || warsOf(state, a, t).length >= WC.maxWars || E.rand(state) >= D.warChance * (dt / MIN)) return;
      const mine = blocPower(state, a);
      const cands = ais.filter(b => b !== a && !allied(state, a, b) && !pactBetween(state, a, b, t) && !warBetween(state, a, b, t) &&
        !isLeader(state, b, t) && !((d.peace[pair(a, b)] || 0) > t))
        .map(b => ({ b, d: minDistance(state, a, b) })).filter(c => c.d <= WC.range)
        .filter(c => blocPower(state, c.b) <= mine * WC.strengthRatio).sort((x, y) => x.d - y.d);
      if (cands.length) declareWar(state, a, cands[0].b, t);
    });
  }

  MP.Diplomacy = { ensure, attitude, adjust, attitudeLabel, pactBetween, pactsOf, partnerOf, blocked, isLeader, assess,
    signPact, breakPact, proposeFromPlayer, answerOffer, gift, onBattle, targetWeight, tick,
    allianceOf, allied, blocOf, maxMembers, warBetween, warsOf, formAlliance, leaveAlliance, declareWar, endWar };
})(typeof window !== 'undefined' ? window : globalThis);
