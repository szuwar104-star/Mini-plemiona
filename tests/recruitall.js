/* Test rekrutacji zbiorczej: node tests/recruitall.js */
'use strict';
require('../config.js'); require('../engine.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

function addVillage(s, base, dx, name, res) {
  const id = 'vr' + name;
  const v = JSON.parse(JSON.stringify(base));
  Object.assign(v, { id, name, x: base.x + dx, y: base.y, lastTick: s.now, buildQueue: [], recruitQueue: [], support: {} });
  v.units = E.emptyUnits(); v.acc = undefined; v.res = Object.assign({}, res);
  s.villages[id] = v; return v;
}
const s = E.newGame(0, 7, 'normal');
const base = E.villagesOf(s, 'player')[0];
base.buildings.barracks = 5; base.buildings.farm = 10; base.buildings.storage = 10;
const rich = { wood: 20000, clay: 20000, iron: 20000 };
const a = addVillage(s, base, 1, 'A', rich);
const b = addVillage(s, base, 2, 'B', { wood: 100, clay: 100, iron: 100 });
const c = addVillage(s, base, 3, 'C', rich);
c.recruitQueue = Array.from({ length: 20 }, (_, i) => ({ id: 'x' + i, unit: 'spear', count: 1, done: 0, per: 1000, start: s.now }));
base.res = Object.assign({}, rich);

let p = E.planRecruitAll(s, 'spear', { count: 10 }, s.now);
const rowOf = id => p.rows.find(r => r.villageId === id);
ok(rowOf(a.id).n === 10, 'bogata wioska: pełna liczba');
ok(rowOf(b.id).n > 0 && rowOf(b.id).n < 10 && rowOf(b.id).short, 'uboga wioska: tyle, ile może');
ok(rowOf(c.id).n === 0 && /Kolejka/.test(rowOf(c.id).skip), 'pełna kolejka pominięta');
p = E.planRecruitAll(s, 'spear', { count: 10, off: { [a.id]: true } }, s.now);
ok(rowOf(a.id).n === 0 && rowOf(a.id).skip === 'Pominięta', 'wyłączona wioska pominięta');
p = E.planRecruitAll(s, 'spear', { count: 0 }, s.now);
ok(p.total === 0, 'zero bez liczby');
p = E.planRecruitAll(s, 'spear', { max: true }, s.now);
ok(rowOf(a.id).n === E.recruitInfo(s, a, 'spear').max && rowOf(a.id).n > 10, 'maksimum = limit wioski');

p = E.planRecruitAll(s, 'spear', { count: 10 }, s.now);
const resA = a.res.wood;
const r = E.recruitAll(s, p, s.now);
ok(r.ok && r.total === p.total, 'rekrutacja wykonana, suma zgodna z planem');
ok(a.recruitQueue.length === 1 && a.recruitQueue[0].count === 10, 'kolejka w wiosce A');
ok(a.res.wood === resA - 10 * MP.CONFIG.UNITS.spear.cost.wood, 'surowce pobrane');
ok(c.recruitQueue.length === 20, 'pełna kolejka nietknięta');
b.buildings.barracks = 1; a.buildings.barracks = 1; c.buildings.barracks = 1; base.buildings.barracks = 1;
ok(!E.recruitAll(s, E.planRecruitAll(s, 'ram', { count: 1 }, s.now), s.now).ok, 'zablokowana jednostka: brak rekrutacji');
if (fails) { console.error(fails + ' błędów'); process.exit(1); }
console.log('Wszystko OK');
