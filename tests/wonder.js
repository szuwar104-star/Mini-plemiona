/* Test Cudu świata: wymagania, koszty, kolejka, zwycięstwo, przejęcie przez wroga i budowa przez AI w trybie Wyścig: node tests/wonder.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js'); require('../pilot.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, W = C.WONDER, H = 3600000;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const fill = (st, v) => { const cap = E.storageCap(v); v.res = { wood: cap, clay: cap, iron: cap }; };

/* konfiguracja */
ok(W.maxLevel === 50 && W.cost.length === W.maxLevel + 1 && W.time.length === W.maxLevel + 1, 'tabele kosztu i czasu mają ' + W.maxLevel + ' poziomów');
ok(W.cost.slice(2).every((c, i) => c >= W.cost[i + 1]) && W.time.slice(2).every((c, i) => c >= W.time[i + 1]), 'koszt i czas rosną z poziomem');
const maxStore = C.BUILDINGS.hq.storage[C.MAX_LEVEL];
ok(W.cost[W.maxLevel] <= maxStore, 'koszt najwyższego poziomu (' + W.cost[W.maxLevel] + ') mieści się w magazynie Ratusza ' + C.MAX_LEVEL + ' (' + maxStore + ')');

/* gracz: wymagania */
const st = E.newGame(0, 4242, 'normal', 'small');
E.useDifficulty(st);
const mine = E.villagesOf(st, 'player');
const v = mine[0];
v.buildings.hq = 1; v.buildings.market = 0; fill(st, v);
let info = E.wonderInfo(st, v);
ok(!info.ok && info.code === 'hq', 'bez Ratusza ' + W.hq + ': Cud zablokowany (' + info.reason + ')');
v.buildings.hq = W.hq;
info = E.wonderInfo(st, v);
ok(!info.ok && info.code === 'market', 'bez Targowiska ' + W.market + ': Cud zablokowany');
v.buildings.market = W.market;
v.buildings.hq = C.MAX_LEVEL; fill(st, v);
info = E.wonderInfo(st, v);
ok(info.ok && info.target === 1, 'spełnione wymagania: można budować poziom 1');
ok(info.cost.wood === W.cost[1] && info.cost.clay === W.cost[1] && info.cost.iron === W.cost[1], 'koszt poziomu 1 = ' + W.cost[1] + ' każdego surowca');
ok(info.time > 0, 'czas budowy dodatni (' + Math.round(info.time / 1000) + ' s)');

/* kolejka i płatność */
const before = Object.assign({}, v.res);
let r = E.queueWonder(st, v, st.now);
ok(r.ok && v.buildQueue.length === 1 && v.buildQueue[0].building === 'wonder' && v.buildQueue[0].level === 1, 'poziom 1 trafia do kolejki budowy');
ok(Math.floor(v.res.wood) === Math.floor(before.wood) - W.cost[1], 'surowce zapłacone');
ok(E.wonderVillage(st, 'player') === v, 'wioska Cudu rozpoznana już z kolejki');
let w2 = mine.find(x => x !== v);
if (!w2) { w2 = Object.values(st.villages).find(x => x.owner === null); w2.owner = 'player'; }
{ w2.buildings.hq = C.MAX_LEVEL; w2.buildings.market = W.market; fill(st, w2); info = E.wonderInfo(st, w2);
  ok(!info.ok && info.code === 'one', 'drugi Cud w innej wiosce odrzucony (jeden na właściciela)'); }
r = E.queueWonder(st, v, st.now);
ok(r.ok && v.buildQueue[1].level === 2, 'drugi poziom można dołożyć do kolejki');
const poor = E.queueWonder(st, Object.assign(v, { res: { wood: 0, clay: 0, iron: 0 } }), st.now);
ok(!poor.ok && /Brak surowców|Kolejka/.test(poor.reason), 'bez surowców/kolejki: odmowa (' + poor.reason + ')');
fill(st, v);

/* ukończenie poziomu przez procesor zdarzeń */
v.buildQueue = []; v.buildings.wonder = 0;
r = E.queueWonder(st, v, st.now);
const end = v.buildQueue[0].end;
E.advance(st, end + 1);
ok(E.wonderLevel(v) === 1, 'po czasie Cud ma poziom 1');
ok(st.notices.some(n => /Cud świata/.test(n.text)), 'gracz dostaje powiadomienie o poziomie Cudu');
ok(!st.ended, 'poziom 1 nie kończy gry');

/* badania skracają czas i koszt */
const f = st.factions.player;
const t0 = E.wonderInfo(st, v);
f.tech = { w_time: 5, w_cost: 5 }; E.useDifficulty(st); fill(st, v);
const t1 = E.wonderInfo(st, v);
ok(t1.time < t0.time && t1.cost.wood < t0.cost.wood, 'Cechy budowniczych i Kamieniołomy obniżają czas i koszt');
f.tech = {}; E.useDifficulty(st);

/* zwycięstwo gracza */

const sA = E.newGame(0, 11, 'normal', 'small', false);
const pv = E.villagesOf(sA, 'player')[0];
pv.buildings.wonder = W.maxLevel - 1; pv.buildQueue = [{ id: 'b1', building: 'wonder', level: W.maxLevel, start: sA.now, end: sA.now + 10 }];
E.advance(sA, sA.now + 11);
ok(sA.ended && sA.ended.type === 'victory' && sA.ended.wonder === true, 'maksymalny poziom Cudu = zwycięstwo gracza');
const sB = E.newGame(0, 12, 'normal', 'small', true);
const pv2 = E.villagesOf(sB, 'player')[0];
pv2.buildings.wonder = W.maxLevel; E.checkWonder(sB, pv2, 5);
ok(sB.ended && sB.ended.type === 'victory', 'zwycięstwo gracza także w trybie Wyścig');

/* AI: Spokojny – nie wygrywa, Wyścig – wygrywa i jest ostrzeżenie */
const aiOf = s => Object.keys(s.factions).find(i => i !== 'player');
{
  const s = E.newGame(0, 21, 'normal', 'small', false);
  const ai = aiOf(s), av = E.villagesOf(s, ai)[0];
  av.buildings.wonder = W.maxLevel; E.checkWonder(s, av, 1);
  ok(!s.ended, 'tryb Spokojny: Cud AI na maksimum nie kończy gry');
}
{
  const s = E.newGame(0, 22, 'normal', 'small', true);
  const ai = aiOf(s), av = E.villagesOf(s, ai)[0];
  av.buildings.wonder = Math.ceil(W.maxLevel * W.warnShare); E.checkWonder(s, av, 1);
  ok(!s.ended && s.notices.some(n => /Cud świata na poziomie/.test(n.text)), 'przy ' + W.warnShare * 100 + '% Cudu AI gracz dostaje ostrzeżenie z koordynatami');
  const n0 = s.notices.length; E.checkWonder(s, av, 2);
  ok(s.notices.length === n0, 'ostrzeżenie tylko raz');
  av.buildings.wonder = W.maxLevel; E.checkWonder(s, av, 3);
  ok(s.ended && s.ended.type === 'defeat' && s.ended.by === ai && s.ended.wonder === true, 'Cud AI na maksimum = porażka gracza w trybie Wyścig');
}

/* przejęcie wioski z Cudem: poziomy zostają, kolejka znika */
{
  const s = E.newGame(0, 31, 'normal', 'small', true);
  const ai = aiOf(s), av = E.villagesOf(s, ai)[0];
  av.buildings.wonder = 30; av.buildQueue = [{ id: 'bx', building: 'wonder', level: 31, start: 0, end: 99 }];
  E.changeOwner(s, av, 'player', ai, 5);
  ok(av.owner === 'player' && E.wonderLevel(av) === 30, 'po zdobyciu wioski Cud zostaje na poziomie 30');
  ok(av.buildQueue.length === 0, 'wpisy kolejki Cudu znikają po zdobyciu');
}

/* AI buduje Cud w trybie Wyścig (po czasie startu, tylko przy aiTech > 0) */
{
  const s = E.newGame(0, 41, 'hard', 'small', true);
  const ai = aiOf(s), vs = E.villagesOf(s, ai), av = vs[0];
  E.useDifficulty(s);
  av.buildings.hq = C.MAX_LEVEL; av.buildings.market = W.market;
  const run = t => { E.tickVillage(s, av, t); fill(s, av); MP.AI.think(s, ai, t); };
  av.res = { wood: 0, clay: 0, iron: 0 };
  s.now = s.created + 10 * 60000;
  fill(s, av); MP.AI.think(s, ai, s.now);
  ok(E.wonderLevel(av) + E.wonderQueued(av) === 0 || av.buildQueue.every(e => e.building !== 'wonder'), 'AI nie buduje Cudu przed czasem startu');
  s.now = s.created + (W.ai.startAfterMin + 5) * 60000;
  let built = 0;
  for (let i = 0; i < 40 && !built; i++) { av.buildQueue = []; fill(s, av); av.lastTick = s.now; MP.AI.think(s, ai, s.now); built = E.villagesOf(s, ai).reduce((a, h) => a + h.buildQueue.filter(e => e.building === 'wonder').length, 0); s.now += 60000; }
  ok(built >= 1, 'AI w trybie Wyścig po czasie startu kolejkuje Cud świata');
  ok(s.notices.some(n => /zaczęła budować Cud świata/.test(n.text)), 'gracz jest powiadamiany o pierwszej budowie Cudu AI z koordynatami');
  const wv = E.wonderVillage(s, ai);
  ok(wv && wv.buildQueue.some(e => e.building === 'wonder'), 'wioska Cudu AI rozpoznana');
  const slow = E.wonderInfo(s, wv).time;
  const mineT = Math.round(W.time[1] * C.BUILDINGS.hq.buildSpeed[wv.buildings.hq] * 1000);
  ok(slow >= mineT, 'AI buduje Cud nie szybciej niż bazowo (' + slow + ' ≥ ' + mineT + ')');
}
{
  const s = E.newGame(0, 42, 'normal', 'small', false);
  const ai = aiOf(s), av = E.villagesOf(s, ai)[0];
  E.useDifficulty(s);
  av.buildings.hq = C.MAX_LEVEL; av.buildings.market = W.market; fill(s, av);
  s.now = s.created + (W.ai.startAfterMin + 5) * 60000;
  MP.AI.think(s, ai, s.now);
  ok(E.villagesOf(s, ai).every(h => !h.buildQueue.some(e => e.building === 'wonder')), 'tryb Spokojny: AI nie buduje Cudu');
}

/* Autopilot: opcja „Cud świata” – domyślnie wyłączona, po włączeniu dokłada poziomy i zwozi surowce */
{
  const T0 = 1700000000000, MIN = 60000;
  const mk = on => {
    const s = E.newGame(T0, 4243, 'normal', 'small');
    E.useDifficulty(s);
    const own = E.villagesOf(s, 'player');
    const extra = Object.values(s.villages).filter(x => x.owner === null).slice(0, 2);
    extra.forEach(x => { x.owner = 'player'; });
    const vs = E.villagesOf(s, 'player');
    vs.forEach((h, i) => { h.buildings.hq = C.MAX_LEVEL; h.buildings.market = C.MAX_LEVEL; h.buildings.farm = C.MAX_LEVEL; fill(s, h); h.lastTick = T0; });
    MP.Pilot.configure(s, { on: true, wonder: on, recruit: 'off', tech: false }, T0);
    return s;
  };
  ok(C.PILOT.defaults.wonder === false, 'Cud w Autopilocie jest domyślnie wyłączony');
  const off = mk(false); E.advance(off, T0 + 20 * MIN);
  ok(E.villagesOf(off, 'player').every(h => E.wonderLevel(h) + E.wonderQueued(h) === 0), 'bez opcji Autopilot nie rusza Cudu');
  const on = mk(true); E.advance(on, T0 + 20 * MIN);
  const wv = E.wonderVillage(on, 'player');
  ok(!!wv && E.wonderLevel(wv) + E.wonderQueued(wv) >= 1, 'z opcją Autopilot zaczyna budować Cud świata');
  E.advance(on, T0 + 6 * 3600000);
  const wv2 = E.wonderVillage(on, 'player');
  ok(E.wonderLevel(wv2) >= 3, 'po kilku godzinach Cud ma już poziomy (' + E.wonderLevel(wv2) + ')');
  ok(E.villagesOf(on, 'player').filter(h => E.wonderLevel(h) + E.wonderQueued(h) > 0).length === 1, 'Cud rośnie tylko w jednej wiosce');
  ok(on.pilot.stats.built > 0, 'Autopilot liczy budowę Cudu w statystykach');
}

/* zapis/odczyt */
const back = MP.DB.parse(MP.DB.serialize(st)).state;
ok(E.wonderLevel(back.villages[v.id]) === E.wonderLevel(v), 'poziom Cudu przeżywa zapis i odczyt');

if (fails) { console.error(fails + ' błędów'); process.exit(1); } else console.log('Cud świata: OK');
