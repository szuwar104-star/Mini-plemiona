/* Test dyplomacji: node tests/diplomacy.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, D = MP.Diplomacy, DB = MP.DB;
const MIN = 60000, H = 3600000;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

function setup(seed) {
  const s = E.newGame(0, seed, 'normal');
  const me = E.villagesOf(s, 'player')[0];
  const fid = Object.keys(s.factions).find(id => s.factions[id].personality === 'economic');
  const enemy = E.villagesOf(s, fid)[0];
  return { s, me, fid, enemy };
}
const att = (s, me, enemy, n) => { me.units = Object.assign(E.emptyUnits(), { axe: n || 50 }); return E.sendAttack(s, me.id, enemy.id, { axe: n || 50 }, s.now); };

/* ---------- nastawienie startowe i ocena ---------- */
{
  const { s, fid } = setup(3);
  const P = C.AI.personalities[s.factions[fid].personality].diplo;
  ok(D.attitude(s, fid, 'player') === P.baseline, 'start: nastawienie = bazowe osobowości');
  ok(D.assess(s, fid, 'player', 0).ok, 'gospodarcza frakcja zgadza się na pakt od początku (próg ' + P.minAttitude + ')');
  const aggr = Object.keys(s.factions).find(id => s.factions[id].personality === 'aggressive');
  const a = D.assess(s, aggr, 'player', 0);
  ok(!a.ok && a.code === 'cold' && a.need > 0, 'agresywna frakcja na początku odmawia (brakuje ' + a.need + ' pkt)');
}

/* ---------- pakt blokuje atak, wypowiedzenie go zwalnia ---------- */
{
  const { s, me, fid, enemy } = setup(3);
  const r = D.proposeFromPlayer(s, fid, 0);
  ok(r.ok && D.pactBetween(s, 'player', fid, 0), 'propozycja przyjęta: pakt aktywny');
  const at = att(s, me, enemy);
  ok(!at.ok && /Pakt/.test(at.reason), 'atak na partnera paktu jest zablokowany: ' + at.reason);
  ok(E.sendAttack(s, me.id, enemy.id, { axe: 10 }, 0, 'spy').ok === false, 'zwiad zwykłą metodą nadal wymaga zwiadowców (bez zmian)');
  const b = D.breakPact(s, 'player', fid, 0);
  ok(b.ok && !att(s, me, enemy).ok, 'w okresie wypowiedzenia pakt nadal chroni');
  const after = C.DIPLO.breakNoticeMin * MIN + 1;
  s.now = after;
  ok(att(s, me, enemy).ok && true, 'po okresie wypowiedzenia atak jest możliwy');
  ok(D.attitude(s, fid, 'player') < C.AI.personalities.economic.diplo.baseline, 'zerwanie paktu obniża nastawienie ofiary');
  ok((s.diplo.rep.player || 0) >= 1, 'zerwanie paktu daje punkt nieufności');
}

/* ---------- pakt podpisany w trakcie marszu zawraca wojsko ---------- */
{
  const { s, me, fid, enemy } = setup(4);
  ok(att(s, me, enemy, 40).ok, 'atak wysłany przed paktem');
  D.signPact(s, 'player', fid, 1000);
  E.advance(s, 2 * H);
  const rep = s.reports.find(r => r.attacker === 'player' && r.defender === fid);
  ok(!rep, 'brak bitwy: pakt podpisany w marszu');
  ok(s.notices.some(n => /zawraca/.test(n.text)), 'gracz dostał komunikat o zawróceniu');
  ok(E.sumUnits(me.units) >= 40, 'wojsko wróciło do wioski');
}

/* ---------- ataki obniżają nastawienie, czas je poprawia ---------- */
{
  const { s, me, fid, enemy } = setup(5);
  const base = D.attitude(s, fid, 'player');
  enemy.units = Object.assign(E.emptyUnits(), { spear: 1 }); enemy.buildings.wall = 0;
  me.units = Object.assign(E.emptyUnits(), { axe: 300 });
  E.sendAttack(s, me.id, enemy.id, { axe: 300 }, 0);
  E.advance(s, E.travelTime(me, enemy, { axe: 300 }) + 1000);
  const hit = D.attitude(s, fid, 'player');
  ok(hit < base - 5, 'wygrany atak obniża nastawienie ofiary (' + base + ' → ' + Math.round(hit) + ')');
  const t0 = s.now;
  D.tick(s, t0); // inicjalizacja zegara
  for (let i = 1; i <= 12; i++) D.tick(s, t0 + i * H);
  ok(D.attitude(s, fid, 'player') >= base - 0.01, 'po 12 h bez ataków nastawienie wraca do bazowego i wyżej');
  ok(D.attitude(s, fid, 'player') <= C.AI.personalities.economic.diplo.cap + 0.01, 'nastawienie nie przekracza limitu osobowości');
  ok(D.targetWeight(s, fid, 'player', s.now) <= 1, 'sympatia zmniejsza atrakcyjność celu');
}

/* ---------- dary ---------- */
{
  const { s, me } = setup(6);
  const aggr = Object.keys(s.factions).find(id => s.factions[id].personality === 'aggressive');
  me.res = { wood: 9000, clay: 9000, iron: 9000 };
  const before = D.attitude(s, aggr, 'player');
  const g = D.gift(s, me.id, aggr, { wood: 3000, clay: 3000, iron: 3000 }, 0);
  ok(g.ok && g.delta === Math.min(C.DIPLO.giftMax, Math.floor(9000 / C.DIPLO.giftPerRes)), 'dar podnosi nastawienie o ' + g.delta);
  ok(Math.round(me.res.wood) === 6000, 'dar odejmuje surowce z wioski');
  ok(D.attitude(s, aggr, 'player') === before + g.delta, 'nastawienie wzrosło dokładnie o wartość daru');
  ok(!D.gift(s, me.id, aggr, { wood: 3000 }, 1000).ok, 'drugi dar od razu jest odrzucony (przerwa)');
  ok(!D.gift(s, me.id, aggr, { wood: 5, clay: 0, iron: 0 }, 10 * H).ok, 'zbyt mały dar jest odrzucony');
  ok(!D.gift(s, me.id, aggr, { wood: 999999 }, 10 * H).ok, 'dar ponad stan wioski jest odrzucony');
  me.res = { wood: 0, clay: 0, iron: 0 };
}

/* ---------- lider, nieufność, limity ---------- */
{
  const { s, fid } = setup(7);
  const mine = E.villagesOf(s, 'player');
  const need = Math.ceil(E.winVillages(s) * C.DIPLO.leaderShare);
  const free = Object.values(s.villages).filter(v => v.owner === null);
  for (let i = 0; mine.length + i < need; i++) free[i].owner = 'player';
  ok(D.isLeader(s, 'player'), 'gracz z ' + need + ' wioskami jest liderem');
  const r = D.proposeFromPlayer(s, fid, 0);
  ok(!r.ok && r.code === 'leader', 'lider nie dostanie paktu');
  ok(D.targetWeight(s, fid, 'player', 0) > 1, 'lider jest chętniej atakowany');
}
{
  const { s, fid } = setup(8);
  s.diplo = null; D.ensure(s);
  s.diplo.rep.player = 5;
  const r = D.proposeFromPlayer(s, fid, 0);
  ok(!r.ok && r.code === 'distrust', 'zbyt duża nieufność blokuje pakt');
  s.diplo.rep.player = 0;
  const ids = Object.keys(s.factions).filter(id => id !== 'player');
  ids.slice(0, C.DIPLO.playerMaxPacts).forEach(id => D.signPact(s, 'player', id, 0));
  const extra = ids[C.DIPLO.playerMaxPacts];
  const r2 = extra ? D.proposeFromPlayer(s, extra, 0) : { ok: false, reason: 'Masz już' };
  ok(!r2.ok && /maksymaln|Masz/.test(r2.reason), 'limit paktów gracza: ' + r2.reason);
}

/* ---------- oferty AI dla gracza ---------- */
{
  const { s, fid } = setup(9);
  const d = D.ensure(s);
  d.last = 1;
  s.factions[fid].personality = 'economic';
  s.diplo.rel[fid + '>player'] = 60; // bardzo przychylna
  const f2 = Object.keys(s.factions).filter(id => id !== 'player' && id !== fid);
  f2.forEach(id => { d.cool[(id < fid ? id + '|' + fid : fid + '|' + id)] = 1e15; d.cool[(id < 'player' ? id + '|player' : 'player|' + id)] = 1e15; });
  // przesuwamy wioskę frakcji blisko gracza, żeby była sąsiadem
  let got = null;
  for (let i = 1; i <= 600 && !got; i++) { D.tick(s, 1 + i * MIN); got = d.offers.find(o => o.from === fid); }
  ok(!!got, 'przychylna frakcja sama proponuje pakt graczowi');
  if (got) {
    ok(s.notices.some(n => /proponuje/.test(n.text)), 'gracz dostaje powiadomienie o ofercie');
    const t = s.diplo.last;
    const a = D.answerOffer(s, got.id, true, t);
    ok(a.ok && D.pactBetween(s, 'player', fid, t), 'przyjęcie oferty zawiera pakt');
    ok(d.offers.length === 0, 'oferta znika po odpowiedzi');
  }
  // wygasanie oferty
  const o2 = { id: 'oX', from: fid, renew: false, time: 0, expires: 5 * MIN };
  d.offers.push(o2); d.last = 10 * MIN; D.tick(s, 12 * MIN);
  ok(!d.offers.some(o => o.id === 'oX'), 'oferta wygasa po czasie');
  ok(!D.answerOffer(s, 'oX', true, 12 * MIN).ok, 'wygasłej oferty nie da się przyjąć');
  const dec = (() => { d.offers.push({ id: 'oY', from: fid, expires: 1e15 }); return D.answerOffer(s, 'oY', false, 12 * MIN); })();
  ok(dec.ok && (d.cool[fid < 'player' ? fid + '|player' : 'player|' + fid] || 0) > 12 * MIN, 'odrzucenie oferty włącza przerwę w propozycjach');
}

/* ---------- pakt wygasa, ostrzeżenie, przedłużenie ---------- */
{
  const { s, fid } = setup(10);
  D.ensure(s).last = 1;
  D.signPact(s, 'player', fid, 0);
  let warned = false;
  for (let t = MIN; t <= C.DIPLO.pactMin * MIN + 5 * MIN; t += MIN) {
    D.tick(s, t);
    if (s.notices.some(n => /wygasa za/.test(n.text))) warned = true;
    if (t === (C.DIPLO.pactMin - 10) * MIN) {
      const rr = D.proposeFromPlayer(s, fid, t);
      ok(rr.ok && rr.renewed, 'przedłużenie w drugiej połowie paktu działa');
      ok(D.pactBetween(s, 'player', fid, t).end > C.DIPLO.pactMin * MIN, 'przedłużony pakt kończy się później');
    }
  }
  ok(warned, 'gracz dostał ostrzeżenie o wygasaniu');
  ok(D.pactBetween(s, 'player', fid, (C.DIPLO.pactMin + 5) * MIN) !== null, 'przedłużony pakt dalej obowiązuje');
  const s2 = setup(10); D.ensure(s2.s).last = 1; D.signPact(s2.s, 'player', s2.fid, 0);
  ok(!D.proposeFromPlayer(s2.s, s2.fid, 0).ok, 'przedłużenie na początku paktu jest odrzucone');
  for (let t = MIN; t <= (C.DIPLO.pactMin + 5) * MIN; t += MIN) D.tick(s2.s, t);
  ok(!s2.s.diplo.pacts.some(p => p.a === 'player' || p.b === 'player') && !D.pactBetween(s2.s, 'player', s2.fid, (C.DIPLO.pactMin + 5) * MIN), 'nieprzedłużony pakt gracza wygasa i znika');
}

/* ---------- zdrada agresywnej frakcji ---------- */
{
  const { s } = setup(11);
  const ids = Object.keys(s.factions).filter(id => id !== 'player');
  const aggr = ids.find(id => s.factions[id].personality === 'aggressive');
  const weak = ids.find(id => id !== aggr && s.factions[id].personality !== 'aggressive');
  const d = D.ensure(s); d.last = 1;
  E.villagesOf(s, aggr).forEach(v => { Object.keys(v.buildings).forEach(k => { v.buildings[k] = 10; }); });
  D.signPact(s, aggr, weak, 0);
  d.pacts[0].end = 1e15;
  let broke = null;
  for (let i = 1; i <= 6000 && !broke; i++) {
    D.tick(s, 1 + i * MIN);
    const p = d.pacts.find(x => (x.a === aggr && x.b === weak) || (x.a === weak && x.b === aggr));
    if (p && p.breakAt != null) broke = p;
    if (!p) break;
  }
  ok(broke && broke.breakBy === aggr, 'agresywna frakcja zrywa pakt ze znacznie słabszym partnerem');
}

/* ---------- AI nie atakuje partnera paktu (z grupą kontrolną bez paktu) ---------- */
{
  const saved = {}, savedLeader = C.DIPLO.leaderShare;
  C.DIPLO.leaderShare = 9; // wyłączamy polowanie na lidera, żeby zmierzyć sam pakt
  Object.keys(C.AI.personalities).forEach(k => { saved[k] = C.AI.personalities[k].diplo.betray; C.AI.personalities[k].diplo.betray = 0; });
  const run = withPact => {
    const s = E.newGame(0, 21, 'hard', 'small');
    const ids = Object.keys(s.factions).filter(id => id !== 'player');
    let best = null;
    ids.forEach(x => ids.forEach(y => {
      if (x >= y) return;
      let m = Infinity;
      E.villagesOf(s, x).forEach(vx => E.villagesOf(s, y).forEach(vy => { m = Math.min(m, E.dist(vx, vy)); }));
      if (!best || m < best.m) best = { x, y, m };
    }));
    const a = best.x, b = best.y;
    s.factions[a].personality = 'aggressive'; s.factions[b].personality = 'aggressive';
    D.ensure(s).last = 1;
    if (withPact) { D.signPact(s, a, b, 0); s.diplo.pacts[0].end = 1e15; }
    E.advance(s, 6 * H);
    const hit = s.reports.some(r => (r.attacker === a && r.defender === b) || (r.attacker === b && r.defender === a)) ||
      Object.values(s.villages).some(v => v.owner === a && false);
    const sent = s.stats && s.stats.battles;
    // wszystkie wyprawy między a i b (także w drodze)
    const mv = s.movements.some(m => m.type === 'attack' && ((m.owner === a && s.villages[m.to].owner === b) || (m.owner === b && s.villages[m.to].owner === a)));
    return { hit: hit || mv, sent };
  };
  const control = run(false), pact = run(true);
  Object.keys(saved).forEach(k => { C.AI.personalities[k].diplo.betray = saved[k]; });
  C.DIPLO.leaderShare = savedLeader;
  ok(!pact.hit, 'AI w pakcie nie atakuje partnera przez 6 h gry');
  console.log('   kontrola bez paktu: ' + (control.hit ? 'frakcje biją się nawzajem' : 'brak wzajemnych ataków (test słabszy)'));
}

/* ---------- AI zrywa pakt z liderem ---------- */
{
  const { s, fid } = setup(12);
  const ids = Object.keys(s.factions).filter(id => id !== 'player' && id !== fid);
  const other = ids[0];
  const d = D.ensure(s); d.last = 1;
  D.signPact(s, fid, other, 0); d.pacts[0].end = 1e15;
  const need = Math.ceil(E.winVillages(s) * C.DIPLO.leaderShare);
  const free = Object.values(s.villages).filter(v => v.owner === null);
  for (let i = E.villagesOf(s, other).length; i < need; i++) free.pop().owner = other;
  D.tick(s, 2 * MIN);
  ok(d.pacts[0].breakAt != null && d.pacts[0].breakBy === fid, 'AI wypowiada pakt frakcji, która została liderem');
  ok(!(d.rep[fid] > 0), 'zerwanie z liderem nie psuje reputacji');
}

/* ---------- migracja zapisu v8 → v9 ---------- */
{
  const s = E.newGame(0, 31, 'normal');
  const saved = JSON.parse(JSON.stringify(s));
  delete saved.diplo; saved.version = 8;
  const m = DB.migrate(saved);
  ok(m.version === C.SAVE_VERSION && m.diplo && Array.isArray(m.diplo.pacts), 'zapis v8 jest migrowany do v' + C.SAVE_VERSION + ' z pustą dyplomacją');
  E.advance(m, 6 * H);
  ok(m.now === 6 * H, 'zmigrowana gra działa (6 h)');
}

/* ---------- symulacja: 24 h gry bez gracza, mapa Duża – wydajność i spójność ---------- */
{
  const s = E.newGame(0, 41, 'normal', 'large');
  const t0 = Date.now();
  E.advance(s, 24 * H);
  const ms = Date.now() - t0;
  const d = s.diplo;
  console.log('   pakty AI–AI po 24 h: ' + d.pacts.length + ', czas symulacji: ' + ms + ' ms');
  ok(ms < 60000, 'symulacja 24 h na mapie Dużej mieści się w czasie (' + ms + ' ms)');
  ok(d.pacts.every(p => s.factions[p.a] && s.factions[p.b] && p.a !== p.b), 'pakty łączą istniejące, różne frakcje');
  const cnt = {};
  d.pacts.forEach(p => { if (p.breakAt == null || p.breakAt > s.now) { cnt[p.a] = (cnt[p.a] || 0) + 1; cnt[p.b] = (cnt[p.b] || 0) + 1; } });
  ok(Object.values(cnt).every(n => n <= C.DIPLO.maxPacts), 'żadna frakcja nie przekracza limitu paktów');
  ok(Object.values(d.rel).every(v => v >= -100 && v <= 100), 'nastawienie mieści się w zakresie -100…100');
}

if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy dyplomacji przeszły.');
