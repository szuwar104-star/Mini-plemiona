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
  s.race = true; // frakcja AI bywa liderem tylko w trybie Wyścig
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

/* ---------- sojusze AI ---------- */
const aiIds = s => Object.keys(s.factions).filter(id => s.factions[id].ai);
const minDist = (s, a, b) => { let m = Infinity; E.villagesOf(s, a).forEach(x => E.villagesOf(s, b).forEach(y => { m = Math.min(m, E.dist(x, y)); })); return m; };
{
  const s = E.newGame(0, 7, 'normal', 'medium');
  const [a, b, c] = aiIds(s);
  const al = D.formAlliance(s, a, b, 0);
  ok(al.members.length === 2 && D.allied(s, a, b) && D.allied(s, b, a), 'sojusz łączy dwie frakcje w obie strony');
  ok(D.blocked(s, a, b, 0) && !D.blocked(s, a, c, 0), 'sojusznicy nie mogą się atakować, reszta bez zmian');
  ok(D.targetWeight(s, a, b, 0) === 0, 'AI nie wybiera sojusznika na cel');
  const va = E.villagesOf(s, a)[0], vb = E.villagesOf(s, b)[0];
  va.units = Object.assign(E.emptyUnits(), { axe: 50 });
  const r = E.sendAttack(s, va.id, vb.id, { axe: 50 }, 0);
  ok(!r.ok, 'silnik blokuje atak na sojusznika: ' + r.reason);
  D.formAlliance(s, c, a, 1);
  ok(D.allianceOf(s, c) === D.allianceOf(s, a) && D.blocOf(s, a).length === 3, 'trzecia frakcja dołącza do istniejącego sojuszu');
  ok(D.maxMembers(s) === 3, 'limit członków na świecie Średnim (8 frakcji AI) to 3');
  ok(!D.allied(s, a, 'player') && !D.allianceOf(s, 'player'), 'gracz nie należy do sojuszy AI');
}
{
  // pakt między przyszłymi sojusznikami znika (zwalnia limit paktów)
  const s = E.newGame(0, 8, 'normal', 'medium');
  const [a, b] = aiIds(s);
  D.signPact(s, a, b, 0);
  ok(D.pactsOf(s, a, 0).length === 1, 'pakt AI–AI podpisany');
  D.formAlliance(s, a, b, 1);
  ok(D.pactsOf(s, a, 1).length === 0, 'sojusz zastępuje pakt między członkami');
}
{
  // tick sam zawiera sojusz między przychylnymi sobie sąsiadami
  const s = E.newGame(0, 9, 'normal', 'medium');
  const a = aiIds(s).find(id => C.AI.personalities[s.factions[id].personality].diplo.allyChance >= 0.008);
  const b = aiIds(s).filter(id => id !== a).sort((x, y) => minDist(s, a, x) - minDist(s, a, y))[0];
  ok(minDist(s, a, b) <= C.DIPLO.alliance.range, 'najbliższy sąsiad leży w zasięgu sojuszu (' + minDist(s, a, b).toFixed(1) + ')');
  D.adjust(s, a, b, 80); D.adjust(s, b, a, 80);
  const d = D.ensure(s); d.last = 1;
  for (let m = 2; m < 3000 && !D.allianceOf(s, a); m++) D.tick(s, m * MIN);
  ok(!!D.allianceOf(s, a), 'przychylne frakcje same zawierają sojusz');
  ok(s.reports.some(r => r.diplo === 'alliance' || r.diplo === 'join'), 'Kronika zapisuje powstanie sojuszu');
  ok(s.reports.filter(r => r.diplo).every(r => r.read === true), 'wpisy dyplomatyczne w Kronice są przeczytane (bez plakietki)');
  ok(D.ensure(s).alliances.every(al => al.members.length <= D.maxMembers(s)), 'sojusze nie przekraczają limitu członków');
}
{
  // frakcja, która była w wojnie z członkiem, nie wstąpi do jego sojuszu; wrogie nastawienie też blokuje
  const s = E.newGame(0, 10, 'normal', 'medium');
  const [a, b, c] = aiIds(s);
  D.formAlliance(s, a, b, 0);
  D.declareWar(s, c, a, 1);
  ok(!!D.warBetween(s, c, a, 2) && !!D.warBetween(s, c, b, 2), 'wojna z członkiem sojuszu obejmuje też jego sojusznika (obrona wspólna)');
}
{
  // lider odpada z sojuszu (tryb Wyścig); zdrada psuje reputację i nastawienie
  const s = E.newGame(0, 11, 'normal', 'medium');
  s.race = true;
  const [a, b] = aiIds(s);
  D.formAlliance(s, a, b, 0);
  const need = Math.ceil(E.winVillages(s) * C.DIPLO.leaderShare);
  const free = Object.values(s.villages).filter(v => v.owner === null);
  for (let i = E.villagesOf(s, a).length; i < need; i++) free.pop().owner = a;
  const d = D.ensure(s); d.last = 1;
  D.tick(s, 2 * MIN);
  ok(!D.allied(s, a, b) && D.ensure(s).alliances.length === 0, 'lider odchodzi z sojuszu, a sojusz z jednego członka się rozwiązuje');
  ok(!(d.rep[a] > 0), 'odejście lidera nie psuje reputacji');
  const s2 = E.newGame(0, 11, 'normal', 'medium');
  const [x, y] = aiIds(s2);
  D.formAlliance(s2, x, y, 0);
  const before = D.attitude(s2, y, x);
  D.leaveAlliance(s2, x, 10 * MIN, 'betray');
  ok(D.attitude(s2, y, x) < before && D.ensure(s2).rep[x] >= 1, 'zdrada sojuszu obniża nastawienie i daje punkt nieufności');
  ok((D.ensure(s2).peace[x < y ? x + '|' + y : y + '|' + x] || 0) > 10 * MIN, 'po zdradzie jest okres karencji bez wojny');
}
{
  // poza trybem Wyścig AI nie jest liderem (gracz nadal bywa)
  const s = E.newGame(0, 12, 'normal', 'medium');
  const need = Math.ceil(E.winVillages(s) * C.DIPLO.leaderShare);
  const [a] = aiIds(s);
  const free = Object.values(s.villages).filter(v => v.owner === null);
  for (let i = E.villagesOf(s, a).length; i < need; i++) free.pop().owner = a;
  ok(!D.isLeader(s, a, 0), 'poza Wyścigiem AI z dużą liczbą wiosek nie jest liderem');
  s.race = true;
  D.ensure(s).last = 1;
  ok(D.isLeader(s, a, 61 * MIN), 'w trybie Wyścig ta sama frakcja jest liderem');
  s.race = false;
  for (let i = E.villagesOf(s, 'player').length; i < need; i++) free.pop().owner = 'player';
  ok(D.isLeader(s, 'player', 130 * MIN), 'gracz może być liderem w każdym trybie');
}

/* ---------- wojny AI z AI: wypowiedzenie, zmęczenie, rozejm ---------- */
{
  const s = E.newGame(0, 13, 'normal', 'medium');
  const [a, b] = aiIds(s);
  ok(D.targetWeight(s, a, b, 0) === 0, 'bez wojny AI nie atakuje innej AI (pokój)');
  const w = D.declareWar(s, a, b, 0);
  ok(!!w && D.targetWeight(s, a, b, MIN) > 0 && D.targetWeight(s, b, a, MIN) > 0, 'po wypowiedzeniu obie strony mogą się atakować');
  ok(!D.assess(s, b, a, MIN).ok && D.assess(s, b, a, MIN).code === 'war', 'w czasie wojny pakt jest niemożliwy');
  for (let i = 0; i < C.DIPLO.war.maxBattles; i++) D.onBattle(s, a, b, true, false, (i + 1) * MIN);
  ok(!D.warBetween(s, a, b, 10 * MIN), 'po ' + C.DIPLO.war.maxBattles + ' bitwach wojna kończy się rozejmem');
  ok(D.targetWeight(s, a, b, 10 * MIN) === 0, 'po rozejmie znów panuje pokój');
  ok(D.attitude(s, a, b) >= C.DIPLO.war.truceAttitude, 'rozejm podnosi nastawienie do progu');
  ok(s.reports.some(r => r.diplo === 'peace') && s.reports.some(r => r.diplo === 'war'), 'Kronika zapisuje wojnę i rozejm');
  const d = D.ensure(s);
  const k = a < b ? a + '|' + b : b + '|' + a;
  ok(d.peace[k] > 10 * MIN, 'po wojnie jest okres bez kolejnej wojny tej pary');
  // wojna wygasa też z czasem
  const w2 = D.declareWar(s, b, a, 20 * MIN);
  d.last = 21 * MIN; d.peace = {};
  D.tick(s, 21 * MIN + C.DIPLO.war.durationMin * MIN + 2 * MIN);
  ok(!D.warBetween(s, b, a, 21 * MIN + C.DIPLO.war.durationMin * MIN + 2 * MIN) && !d.wars.includes(w2), 'wojna wygasa po czasie');
}
{
  // lider w trybie Wyścig jest celem bez wypowiedzenia wojny; gracz jako cel nie zależy od wojen
  const s = E.newGame(0, 14, 'normal', 'medium');
  s.race = true;
  const [a, b] = aiIds(s);
  const need = Math.ceil(E.winVillages(s) * C.DIPLO.leaderShare);
  const free = Object.values(s.villages).filter(v => v.owner === null);
  for (let i = E.villagesOf(s, b).length; i < need; i++) free.pop().owner = b;
  s.diplo = null; D.ensure(s).last = 1;
  D.tick(s, 2 * MIN);
  ok(D.targetWeight(s, a, b, 2 * MIN) > 0, 'lider (Wyścig) jest celem bez wojny');
  ok(D.targetWeight(s, a, 'player', 2 * MIN) > 0, 'gracz pozostaje celem niezależnie od wojen AI');
}

/* ---------- sojusz gracza z AI ---------- */
{
  const s = E.newGame(0, 16, 'normal', 'medium');
  const fid = aiIds(s).find(id => s.factions[id].personality === 'economic') || aiIds(s)[0];
  const MINS = C.DIPLO.alliance.pactFirstMin;
  D.adjust(s, fid, 'player', 60);
  let a = D.assessAlliance(s, fid, 0);
  ok(!a.ok && a.code === 'pact', 'sojusz wymaga wcześniejszego paktu: ' + a.reason);
  D.signPact(s, 'player', fid, 0);
  a = D.assessAlliance(s, fid, (MINS - 1) * MIN);
  ok(!a.ok && a.code === 'pact', 'pakt musi trwać co najmniej ' + MINS + ' min');
  a = D.assessAlliance(s, fid, (MINS + 1) * MIN);
  ok(a.ok, 'po ' + MINS + ' min paktu i przy wysokim nastawieniu frakcja się zgadza');
  const r = D.proposeAllianceFromPlayer(s, fid, (MINS + 1) * MIN);
  ok(r.ok && D.allied(s, 'player', fid) && D.allianceOf(s, 'player').members.length === 2, 'propozycja gracza zawiera sojusz');
  ok(D.pactsOf(s, 'player', (MINS + 2) * MIN).length === 0, 'sojusz zastępuje pakt (zwalnia miejsce na pakt)');
  ok(D.targetWeight(s, fid, 'player', (MINS + 2) * MIN) === 0, 'sojusznik AI nie wybiera gracza na cel');
  const me = E.villagesOf(s, 'player')[0], his = E.villagesOf(s, fid)[0];
  me.units = Object.assign(E.emptyUnits(), { axe: 50 });
  const at = E.sendAttack(s, me.id, his.id, { axe: 50 }, (MINS + 2) * MIN);
  ok(!at.ok && /Sojusz/.test(at.reason), 'silnik blokuje atak gracza na sojusznika: ' + at.reason);
  ok(!D.proposeFromPlayer(s, fid, (MINS + 3) * MIN).ok, 'pakt z sojusznikiem nie jest potrzebny');
  ok(s.notices.some(n => /Sojusz:/.test(n.text)), 'gracz dostaje komunikat o sojuszu');
}
{
  // za niskie nastawienie: odmowa i karencja; wysokie nastawienie bloku jest wymagane
  const s = E.newGame(0, 17, 'normal', 'medium');
  const [fid, other] = aiIds(s);
  D.signPact(s, 'player', fid, 0);
  D.adjust(s, fid, 'player', -200);
  const t = 90 * MIN;
  const a = D.assessAlliance(s, fid, t);
  ok(!a.ok && a.code === 'cold' && a.need > 0, 'zbyt niskie nastawienie blokuje sojusz (brakuje ' + a.need + ')');
  const r = D.proposeAllianceFromPlayer(s, fid, t);
  ok(!r.ok && D.assessAlliance(s, fid, t + MIN).code === 'cooldown', 'odmowa daje karencję na ponowną propozycję');
  // blok AI, w którym członek nie ufa graczowi, nie przyjmie go
  const s2 = E.newGame(0, 17, 'normal', 'medium');
  const [x, y] = aiIds(s2);
  D.formAlliance(s2, x, y, 0);
  D.signPact(s2, 'player', x, 0); D.adjust(s2, x, 'player', 80);
  D.adjust(s2, y, 'player', -200);
  const a2 = D.assessAlliance(s2, x, 90 * MIN);
  ok(!a2.ok && a2.code === 'ally', 'członek bloku bez zaufania do gracza blokuje wstąpienie: ' + a2.reason);
  D.adjust(s2, y, 'player', 300);
  ok(D.assessAlliance(s2, x, 90 * MIN).ok, 'gdy cały blok ufa graczowi, może wstąpić');
  ok(D.proposeAllianceFromPlayer(s2, x, 90 * MIN).ok && D.allianceOf(s2, 'player').members.length === 3, 'gracz dołącza do istniejącego sojuszu AI');
  ok(D.blocOf(s2, 'player').length === 3 && D.allied(s2, 'player', y), 'wszyscy członkowie bloku są sojusznikami gracza');
}
{
  // AI sama proponuje sojusz graczowi
  const s = E.newGame(0, 18, 'normal', 'medium');
  const fid = aiIds(s).find(id => C.AI.personalities[s.factions[id].personality].diplo.allyChance >= 0.008);
  D.signPact(s, 'player', fid, 0); D.ensure(s).pacts[0].end = 1e15;
  D.adjust(s, fid, 'player', 90);
  const d = D.ensure(s); d.last = 1;
  let offer = null;
  for (let m = 2; m < 6000 && !offer; m++) { D.tick(s, m * MIN); offer = d.offers.find(o => o.from === fid && o.alliance); }
  ok(!!offer, 'przychylna frakcja po paktach sama proponuje sojusz');
  const r = D.answerOffer(s, offer.id, true, s.now || 7000 * MIN);
  ok(r.ok && r.alliance && D.allied(s, 'player', fid), 'przyjęcie oferty zawiera sojusz');
  ok(!D.ensure(s).alliances.some(al => al.members.indexOf('player') >= 0 && al.members.some(m => m !== 'player' && !s.factions[m])), 'sojusz gracza zawiera tylko istniejące frakcje');
}
{
  // sojusznik broni gracza; wojny nie obejmują gracza
  const s = E.newGame(0, 19, 'normal', 'medium');
  const ids = aiIds(s);
  const ally = ids[0];
  const foe = ids.filter(id => id !== ally).sort((x, y) => minDist(s, ally, x) - minDist(s, ally, y))[0];
  D.formAlliance(s, 'player', ally, 0);
  const before = D.attitude(s, ally, foe);
  D.onBattle(s, foe, 'player', true, false, MIN);
  ok(D.attitude(s, ally, foe) < before, 'atak na gracza obniża nastawienie jego sojusznika do napastnika');
  ok(!!D.warBetween(s, ally, foe, 2 * MIN), 'sojusznik wypowiada wojnę napastnikowi gracza (jest w zasięgu)');
  ok(s.notices.some(n => /w obronie sojuszu/.test(n.text)), 'gracz dostaje komunikat o obronie');
  ok(D.ensure(s).wars.every(w => w.a !== 'player' && w.b !== 'player'), 'wojny AI nigdy nie dotyczą gracza');
  const s2 = E.newGame(0, 19, 'normal', 'medium');
  const [x, y, z] = aiIds(s2);
  D.formAlliance(s2, x, y, 0); D.formAlliance(s2, 'player', x, 1);
  D.declareWar(s2, z, x, 2 * MIN);
  ok(D.ensure(s2).wars.every(w => w.a !== 'player' && w.b !== 'player') && !!D.warBetween(s2, z, y, 3 * MIN), 'wojna z członkiem sojuszu z graczem obejmuje sojuszników AI, ale nie gracza');
}
{
  // wyjście gracza z sojuszu i lider
  const s = E.newGame(0, 20, 'normal', 'medium');
  const [x, y] = aiIds(s);
  D.formAlliance(s, x, y, 0); D.formAlliance(s, 'player', x, 1);
  const before = D.attitude(s, x, 'player');
  const r = D.leavePlayerAlliance(s, 10 * MIN);
  ok(r.ok && !D.allied(s, 'player', x) && D.allied(s, x, y), 'gracz opuszcza sojusz, reszta zostaje w sojuszu');
  ok(D.attitude(s, x, 'player') < before && D.ensure(s).rep.player >= 1, 'opuszczenie sojuszu obniża zaufanie (jak zerwanie paktu)');
  ok(!D.leavePlayerAlliance(s, 11 * MIN).ok, 'bez sojuszu nie ma czego opuszczać');
  const s2 = E.newGame(0, 20, 'normal', 'medium');
  const [p, q] = aiIds(s2);
  D.formAlliance(s2, 'player', p, 0);
  const need = Math.ceil(E.winVillages(s2) * C.DIPLO.leaderShare);
  const free = Object.values(s2.villages).filter(v => v.owner === null);
  for (let i = E.villagesOf(s2, 'player').length; i < need; i++) free.pop().owner = 'player';
  const d = D.ensure(s2); d.last = 1;
  D.tick(s2, 2 * MIN);
  ok(!D.allied(s2, 'player', p) && s2.notices.some(n => /zbyt blisko zwycięstwa/.test(n.text)), 'gdy gracz zbliża się do zwycięstwa, sojusznicy odchodzą (z komunikatem)');
}

/* ---------- stary zapis bez sojuszy i wojen ---------- */
{
  const s = E.newGame(0, 15, 'normal');
  const d = D.ensure(s);
  delete d.alliances; delete d.wars; delete d.peace;
  const d2 = D.ensure(s);
  ok(Array.isArray(d2.alliances) && Array.isArray(d2.wars) && d2.peace && typeof d2.peace === 'object', 'ensure uzupełnia sojusze, wojny i pokój w starym zapisie');
  E.advance(s, 3 * H);
  ok(true, 'stary zapis działa dalej (3 h)');
}

/* ---------- symulacja: AI z AI nie wyniszczają się (Średnia, 48 h) ---------- */
{
  const s = E.newGame(0, 21, 'hard', 'medium');
  let battles = 0;
  const orig = D.onBattle;
  D.onBattle = function (st, att, def) { if (att !== 'player' && def !== null && def !== 'player') battles++; return orig.apply(this, arguments); };
  E.advance(s, 48 * H);
  D.onBattle = orig;
  const d = s.diplo;
  console.log('   bitwy AI–AI w 48 h: ' + battles + ', sojusze: ' + d.alliances.map(a => a.members.length).join('+') + ', aktywne wojny: ' + d.wars.length);
  ok(battles < 400, 'frakcje AI toczą ze sobą mało bitew (' + battles + ' < 400; bez sojuszy i wojen było ich ponad 1000)');
  ok(d.alliances.length >= 1, 'po 48 h istnieje przynajmniej jeden sojusz AI');
  ok(d.alliances.every(al => al.members.length >= 2 && al.members.length <= D.maxMembers(s) && al.members.every(m => s.factions[m].alive)), 'sojusze są spójne (2…limit członków, żywi członkowie)');
  const seen = {};
  ok(d.alliances.every(al => al.members.every(m => !seen[m] && (seen[m] = 1))), 'frakcja należy najwyżej do jednego sojuszu');
  ok(d.wars.every(w => w.a !== w.b && !D.allied(s, w.a, w.b)), 'sojusznicy nigdy nie są ze sobą w stanie wojny');
}

if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy dyplomacji przeszły.');
