/* Test poziomów budynków 1–20: tablice, monotoniczność, koszt vs magazyn, budowa ponad poziom 10: node tests/levels.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, B = C.BUILDINGS;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

ok(C.MAX_LEVEL === 20, 'maksymalny poziom to 20');
const tables = [['hq.storage', B.hq.storage], ['hq.buildSpeed', B.hq.buildSpeed], ['wood.prod', B.wood.prod], ['clay.prod', B.clay.prod], ['iron.prod', B.iron.prod],
  ['farm.pop', B.farm.pop], ['barracks.recruitSpeed', B.barracks.recruitSpeed], ['market.merchants', B.market.merchants], ['wall.flat', B.wall.flat], ['wall.bonus', B.wall.bonus]];
Object.keys(B).forEach(k => { tables.push([k + '.time', B[k].time]); ['wood', 'clay', 'iron'].forEach(r => tables.push([k + '.cost.' + r, B[k].cost[r]])); });
tables.forEach(([n, a]) => ok(a.length === C.MAX_LEVEL + 1 && a.every(Number.isFinite), n + ': wartości dla poziomów 0–20'));

const inc = (a, strict) => a.every((x, i) => i === 0 || (strict ? x > a[i - 1] : x >= a[i - 1]));
ok(inc(B.hq.storage, true) && inc(B.wood.prod.slice(1), true) && inc(B.farm.pop.slice(1), true) && inc(B.market.merchants, true) && inc(B.wall.flat, true) && inc(B.wall.bonus, true), 'magazyn, produkcja, farma, kupcy i mur rosną z poziomem');
ok(B.hq.buildSpeed.every((x, i) => i < 2 || x <= B.hq.buildSpeed[i - 1]) && B.barracks.recruitSpeed.every((x, i) => i < 2 || x <= B.barracks.recruitSpeed[i - 1]), 'czasy budowy i szkolenia nie rosną z poziomem');
Object.keys(B).forEach(k => ok(inc(B[k].time.slice(1), true) && ['wood', 'clay', 'iron'].every(r => inc(B[k].cost[r].slice(1), true)), k + ': koszt i czas rosną z poziomem'));

// Poziomy 1–10 bez zmian względem poprzedniej wersji gry (stare zapisy i balans).
ok(B.wood.cost.wood[10] === 425 && B.hq.time[10] === 258, 'poziomy 1–10 mają dotychczasowe koszty i czasy');

// Magazyn Ratusza poz. 18 (wymagany do poz. 20 innych budynków) pomieści koszt każdego budynku na poz. 20.
let maxCost = 0; Object.keys(B).forEach(k => ['wood', 'clay', 'iron'].forEach(r => { maxCost = Math.max(maxCost, B[k].cost[r][20]); }));
ok(B.hq.storage[18] >= maxCost, 'magazyn Ratusza 18 (' + B.hq.storage[18] + ') ≥ najdroższy budynek poz. 20 (' + maxCost + ')');
ok(B.hq.storage[20] >= B.hq.cost.wood[20], 'magazyn Ratusza 20 pomieści koszt Ratusza 20');

// Budowa ponad poziom 10 w silniku.
const st = E.newGame(0, 777, 'normal', 'small'); E.useDifficulty(st);
const v = E.villagesOf(st, 'player')[0];
Object.keys(B).forEach(k => { v.buildings[k] = 10; });
v.res = { wood: 1e5, clay: 1e5, iron: 1e5 };
let info = E.buildInfo(st, v, 'wood');
ok(info.ok && info.target === 11, 'poz. 10 → 11 jest dozwolone przy Ratuszu 10');
v.buildings.hq = 9; info = E.buildInfo(st, v, 'wood');
ok(info.ok, 'przy Ratuszu 9 poz. 11 jest dozwolone (Ratusz + 2)');
v.buildings.hq = 8; v.buildings.wood = 10; info = E.buildInfo(st, v, 'wood');
ok(info.code === 'hq' && /9/.test(info.reason), 'przy Ratuszu 8 poz. 11 jest zablokowane komunikatem o Ratuszu 9');
Object.keys(B).forEach(k => { v.buildings[k] = 20; });
ok(E.buildInfo(st, v, 'hq').code === 'max', 'poziom 20 to maksimum');
ok(E.storageCap(v) >= B.hq.storage[20], 'pojemność magazynu przy Ratuszu 20');
ok(E.points(v) === 8 * 20, 'punkty wioski z budynkami na 20: 160');

// Szablony rozwoju zawsze celują w maksymalny poziom.
ok(Object.keys(C.BUILD_TEMPLATES).every(id => C.BUILD_TEMPLATES[id].items.every(([k, L]) => B[k] && L === C.MAX_LEVEL)), 'każdy szablon ulepsza budynki do maksymalnego poziomu');

// Zapis z budynkami na poz. 20 przechodzi walidację i migrację bez zmian.
const clone = JSON.parse(JSON.stringify(st));
const m = MP.DB.migrate(clone);
ok(m.version === C.SAVE_VERSION && E.villagesOf(m, 'player')[0].buildings.hq === 20, 'zapis z poziomami 20 wczytuje się poprawnie');

if (fails) { console.error('\n' + fails + ' błędów'); process.exit(1); }
console.log('\nWszystkie testy poziomów budynków przeszły.');
