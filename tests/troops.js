/* Test zbierania i rozdzielania wojska: node tests/troops.js */
'use strict';
require('../config.js'); require('../engine.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

function addVillage(s, base, dx, name, units) {
  const id = 'vt' + name;
  const v = JSON.parse(JSON.stringify(base));
  Object.assign(v, { id, name, x: base.x + dx, y: base.y, owner: base.owner, lastTick: s.now, buildQueue: [], recruitQueue: [], support: {} });
  v.units = Object.assign(E.emptyUnits(), units); v.acc = undefined;
  s.villages[id] = v; return v;
}
const total = s => Object.values(s.villages).reduce((a, v) => a + E.sumUnits(v.units), 0) + s.movements.reduce((a, m) => a + E.sumUnits(m.units || {}), 0);

const s = E.newGame(0, 7, 'normal');
const t = E.villagesOf(s, 'player')[0];
t.units = E.emptyUnits();
t.buildings.farm = 10;
const a = addVillage(s, t, 1, 'A', { spear: 100, axe: 40, scout: 5 });
const b = addVillage(s, t, 2, 'B', { spear: 0 });
const c = addVillage(s, t, 3, 'C', { spear: 60, light: 10 });
const before = total(s);

// 1. zbieranie: domyślnie bez zwiadowców, pusta wioska pominięta, rezerwa
let p = E.planTroops(s, t.id, { mode: 'gather', reservePct: 0 }, s.now);
const rA = p.rows.find(r => r.villageId === a.id), rB = p.rows.find(r => r.villageId === b.id);
ok(rA.units.spear === 100 && rA.units.axe === 40 && rA.units.scout === 0, 'zbieranie: bez zwiadowców domyślnie');
ok(rB.skip === 'brak wojska', 'pusta wioska pominięta');
p = E.planTroops(s, t.id, { mode: 'gather', reservePct: 25, units: { spear: true } }, s.now);
ok(p.rows.find(r => r.villageId === a.id).units.spear === 75 && p.rows.find(r => r.villageId === a.id).units.axe === 0, 'rezerwa 25% i wybór jednostek');
ok(p.rows.find(r => r.villageId === a.id).time > 0, 'czas marszu policzony');

// 2. wysyłka jako wsparcie – jednostki nie giną
p = E.planTroops(s, t.id, { mode: 'gather', reservePct: 0 }, s.now);
const res = E.sendTroops(s, p, s.now);
ok(res.ok && res.sent.length === 2 && res.sent.every(m => m.type === 'support' && m.stay === false), 'wsparcie: po jednym oddziale na wioskę');
ok(total(s) === before && a.units.spear === 0, 'liczba jednostek zachowana, wioska źródłowa opróżniona');
ok(E.planTroops(s, t.id, { mode: 'gather', reservePct: 0 }, s.now).rows.every(r => r.skip), 'po wysyłce nic do ponownego wysłania');

// 3. limit farmy przy przeniesieniu na stałe
const s2 = E.newGame(0, 7, 'normal');
const t2 = E.villagesOf(s2, 'player')[0]; t2.units = E.emptyUnits(); t2.buildings.farm = 1;
const x = addVillage(s2, t2, 1, 'X', { spear: 5000 });
const room = E.supportRoom(s2, t2);
p = E.planTroops(s2, t2.id, { mode: 'gather', stay: true, reservePct: 0 }, s2.now);
ok(p.pop <= room && p.total > 0 && p.total < 5000, 'przeniesienie: przycięte do miejsca na farmie (' + p.total + ' z 5000)');
p = E.planTroops(s2, t2.id, { mode: 'gather', stay: false, reservePct: 0 }, s2.now);
ok(p.total === 5000, 'wsparcie: bez limitu farmy');
p = E.planTroops(s2, t2.id, { mode: 'gather', stay: true, capToRoom: false, reservePct: 0 }, s2.now);
const bad = E.sendTroops(s2, p, s2.now);
ok(!bad.ok, 'bez przycinania sendSupport odrzuca przepełnienie farmy');

// 4. rozdzielanie po równo
const s3 = E.newGame(0, 7, 'normal');
const src = E.villagesOf(s3, 'player')[0]; src.units = Object.assign(E.emptyUnits(), { spear: 100, axe: 31 }); src.buildings.farm = 10;
const d1 = addVillage(s3, src, 1, 'D1', {}), d2 = addVillage(s3, src, 2, 'D2', {}), d3 = addVillage(s3, src, 3, 'D3', {});
const t3 = total(s3);
p = E.planTroops(s3, src.id, { mode: 'spread', reservePct: 0 }, s3.now);
const sp = p.rows.map(r => r.units.spear), ax = p.rows.map(r => r.units.axe);
ok(sp.reduce((a, b) => a + b) === 100 && Math.max(...sp) - Math.min(...sp) <= 1, 'rozdzielanie pikinierów po równo (' + sp + ')');
ok(ax.reduce((a, b) => a + b) === 31 && Math.max(...ax) - Math.min(...ax) <= 1, 'rozdzielanie topornikiów po równo (' + ax + ')');
ok(p.rows[0].villageId === d1.id && p.rows[0].units.spear >= p.rows[2].units.spear, 'reszta trafia do najbliższych');
p = E.planTroops(s3, src.id, { mode: 'spread', reservePct: 0, off: { [d2.id]: true } }, s3.now);
ok(p.rows.find(r => r.villageId === d2.id).skip === 'pominięta' && p.rows.filter(r => !r.skip).length === 2, 'pominięta wioska nie dostaje wojska');
p = E.planTroops(s3, src.id, { mode: 'spread', reservePct: 50 }, s3.now);
ok(p.rows.reduce((a, r) => a + r.units.spear, 0) === 50, 'rozdzielanie z rezerwą 50%');
const r3 = E.sendTroops(s3, E.planTroops(s3, src.id, { mode: 'spread', reservePct: 0, stay: true }, s3.now), s3.now);
ok(r3.ok && r3.sent.length === 3 && src.units.spear === 0 && total(s3) === t3, 'rozdzielanie wysyła ze źródła, nic nie ginie');
E.advance(s3, s3.now + 3600 * 1000 * 10);
ok(d1.units.spear + d2.units.spear + d3.units.spear === 100, 'po dotarciu jednostki są w wioskach docelowych (przeniesienie na stałe)');

// 5. przypadki brzegowe
ok(E.planTroops(s3, src.id, { mode: 'gather', units: {} }, s3.now).rows.every(r => r.skip === 'wybierz jednostki'), 'brak wybranych jednostek');
const s4 = E.newGame(0, 7, 'normal');
ok(E.planTroops(s4, E.villagesOf(s4, 'player')[0].id, {}, s4.now).rows.length === 0, 'jedna wioska: pusty plan');

console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy wojska przeszły.');
process.exit(fails ? 1 : 0);
