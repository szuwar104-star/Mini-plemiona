/* Test zbierania i rozdzielania surowców: node tests/gather.js */
'use strict';
require('../config.js'); require('../engine.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

// Pomocnik: dopisuje wioski przez ręczną kopię (makeVillage nie jest eksportowany)
function addVillage(s, base, dx, name, market, res) {
  const id = 'vt' + name;
  const v = JSON.parse(JSON.stringify(base));
  Object.assign(v, { id, name, x: base.x + dx, y: base.y, owner: base.owner, lastTick: s.now, buildQueue: [], recruitQueue: [], support: {} });
  v.buildings.market = market; v.res = Object.assign({ wood: 0, clay: 0, iron: 0 }, res); v.acc = undefined;
  s.villages[id] = v; return v;
}

const s = E.newGame(0, 7, 'normal');
const t = E.villagesOf(s, 'player')[0];
t.buildings.hq = 3; t.buildings.market = 3;             // magazyn 1600, 2 kupców... 
t.res = { wood: 100, clay: 100, iron: 100 };
const a = addVillage(s, t, 1, 'A', 2, { wood: 700, clay: 500, iron: 300 });
const b = addVillage(s, t, 2, 'B', 0, { wood: 900, clay: 900, iron: 900 });   // bez Targowiska
const c = addVillage(s, t, 3, 'C', 5, { wood: 800, clay: 800, iron: 800 });
const cap = E.storageCap(t);

// 1. rezerwa i pominięcia
let p = E.planGather(s, t.id, { mode: 'gather', reservePct: 20 }, s.now);
const rowB = p.rows.find(r => r.villageId === b.id);
ok(rowB.skip === 'brak Targowiska', 'wioska bez Targowiska jest pomijana');
const rowA = p.rows.find(r => r.villageId === a.id);
ok(rowA.res.wood === 700 - Math.ceil(E.storageCap(a) * 0.2), 'rezerwa 20% zostaje w wiosce źródłowej');

// 2. limit kupców
const merchA = E.merchantsFree(s, a);
ok(rowA.merchants <= merchA && rowA.total <= merchA * C.MERCHANT.capacity, 'plan nie przekracza udźwigu wolnych kupców');

// 3. przycięcie do magazynu celu
ok(p.rows.reduce((x, r) => x + r.res.wood, 0) + 100 <= cap, 'dostawa mieści się w magazynie celu');
t.res = { wood: cap - 50, clay: 0, iron: 0 };
p = E.planGather(s, t.id, { mode: 'gather', reservePct: 0, res: { wood: true } }, s.now);
ok(p.rows.reduce((x, r) => x + r.res.wood, 0) === 50, 'cel prawie pełny: wysyłane tylko tyle, ile się mieści');
ok(p.rows.find(r => r.villageId === c.id).skip !== '' || p.rows.find(r => r.villageId === a.id).total === 50, 'najbliższa wioska wypełnia cel, dalsze są przycięte');

// 4. wyłączone wioski i wyłączone surowce
t.res = { wood: 0, clay: 0, iron: 0 };
p = E.planGather(s, t.id, { mode: 'gather', reservePct: 0, res: { clay: true }, off: { [a.id]: true } }, s.now);
ok(p.rows.find(r => r.villageId === a.id).skip === 'pominięta', 'wioska wyłączona przez gracza jest pominięta');
ok(p.rows.every(r => r.res.wood === 0 && r.res.iron === 0), 'wysyłane są tylko wybrane surowce');

// 5. wysyłka: stan i ruchy
const before = c.res.clay;
const moves = s.movements.length;
p = E.planGather(s, t.id, { mode: 'gather', reservePct: 0 }, s.now);
const res = E.sendGather(s, p, s.now);
ok(res.ok && s.movements.length === moves + res.sent.length, 'sendGather tworzy po jednym transporcie na wioskę');
ok(c.res.clay < before, 'surowce zeszły z wioski źródłowej');
ok(E.planGather(s, t.id, { mode: 'gather', reservePct: 0 }, s.now).rows.every(r => r.skip || r.total === 0), 'po wysyłce kupcy zajęci → brak podwójnej wysyłki');

// 6. surowce w drodze liczą się do zajętego miejsca
ok(E.incomingRes(s, t.id).clay > 0, 'transporty w drodze są wliczane do miejsca w magazynie celu');

// 7. rozdzielanie
const s2 = E.newGame(0, 9, 'normal');
const src = E.villagesOf(s2, 'player')[0];
src.buildings.market = 5; src.buildings.hq = 3; src.res = { wood: 1000, clay: 0, iron: 0 };
const d1 = addVillage(s2, src, 1, 'D1', 1, {}), d2 = addVillage(s2, src, 2, 'D2', 1, {});
let q = E.planGather(s2, src.id, { mode: 'spread', reservePct: 0, res: { wood: true } }, s2.now);
ok(q.rows.length === 2 && Math.abs(q.rows[0].res.wood - q.rows[1].res.wood) <= 1 && q.total <= 1000, 'rozdzielanie dzieli po równo');
d1.res.wood = E.storageCap(d1) - 100;
q = E.planGather(s2, src.id, { mode: 'spread', reservePct: 0, res: { wood: true } }, s2.now);
ok(q.rows.find(r => r.villageId === d1.id).res.wood === 100 && q.rows.find(r => r.villageId === d2.id).res.wood === 900, 'pełniejszy magazyn dostaje mniej, reszta idzie do pozostałych');
const r2 = E.sendGather(s2, q, s2.now);
ok(r2.ok && src.res.wood === 0, 'rozdzielanie wysyła z wioski źródłowej');

// 8. jedna wioska – brak wierszy
const s3 = E.newGame(0, 3, 'normal');
ok(E.planGather(s3, E.villagesOf(s3, 'player')[0].id, {}, s3.now).rows.length === 0, 'jedna wioska: pusty plan');

console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy zbierania przeszły.');
process.exit(fails ? 1 : 0);
