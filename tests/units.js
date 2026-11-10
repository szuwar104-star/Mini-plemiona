/* Test Łucznika (jednostka bez żelaza) i migracji zapisu: node tests/units.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, DB = MP.DB;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const total = c => c.wood + c.clay + c.iron;

/* ---------- balans kosztów ---------- */
const A = C.UNITS.archer, S = C.UNITS.spear;
ok(A, 'Łucznik istnieje w config.js');
ok(!C.UNITS.shield && !C.UNITS.club && !C.UNITS.rider && !C.UNITS.woodram, 'pozostałe nowe jednostki usunięte');
ok(A.cost.iron <= S.cost.iron / 3, 'Łucznik: żelazo ' + A.cost.iron + ' ≤ 1/3 żelaza Pikiniera (' + S.cost.iron + ')');
ok(A.cost.wood + A.cost.clay > S.cost.wood + S.cost.clay, 'Łucznik: więcej drewna i gliny niż Pikinier');
ok(A.def / total(A.cost) <= S.def / total(S.cost) + 0.001, 'obrona Łucznika nie jest tańsza na surowiec niż Pikiniera');

const res = { wood: 20000, clay: 20000, iron: 1500 };
const fit = k => Math.min(...E.RES.map(r => Math.floor(res[r] / C.UNITS[k].cost[r])));
ok(fit('archer') > fit('spear') * 2.5, 'przy 1500 żelaza: Łuczników ' + fit('archer') + ' vs Pikinierów ' + fit('spear'));

const L = C.UNITS.slinger, X = C.UNITS.axe;
ok(L && L.cost.iron <= X.cost.iron / 3, 'Procarz: żelazo ' + (L && L.cost.iron) + ' ≤ 1/3 żelaza Topornika (' + X.cost.iron + ')');
ok(L.cost.clay > L.cost.wood * 2 && L.cost.clay > X.cost.clay * 3, 'Procarz kosztuje głównie glinę (' + L.cost.clay + ')');
ok(L.att / total(L.cost) <= X.att / total(X.cost), 'atak Procarza nie jest tańszy na surowiec niż Topornika');
ok(fit('slinger') > fit('axe') * 3, 'przy 1500 żelaza: Procarzy ' + fit('slinger') + ' vs Toporników ' + fit('axe'));

/* ---------- nowa gra i rekrutacja ---------- */
const s = E.newGame(0, 7, 'normal');
const v = E.villagesOf(s, 'player')[0];
ok(v.units.archer === 0 && v.units.slinger === 0, 'nowa gra: Łuczników i Procarzy 0');
v.buildings.barracks = 2; v.buildings.farm = 10; v.buildings.hq = 10;
v.res = { wood: 5000, clay: 5000, iron: 100 };
const r = E.queueRecruit(s, v, 'archer', 10, 0);
ok(r.ok && Math.round(v.res.iron) === 0, 'rekrutacja 10 Łuczników kosztuje 100 żelaza (zostało ' + Math.round(v.res.iron) + ')');
v.buildings.barracks = 1;
ok(E.recruitInfo(s, v, 'archer').code === 'locked', 'Łucznik zablokowany do Koszar 2');

/* ---------- taran: ogólne liczenie muru nadal działa ---------- */
ok(E.ramCount({ ram: 8 }) === 8, 'ramCount liczy tarany');

/* ---------- migracja starego zapisu v4 ---------- */
const old = JSON.parse(JSON.stringify(E.newGame(0, 5, 'normal')));
const cheap = ['archer', 'slinger'];
const oldKeys = ['spear', 'axe', 'scout', 'light', 'ram', 'noble', 'settler'];
const strip = u => { if (u) Object.keys(u).forEach(k => { if (!oldKeys.includes(k)) delete u[k]; }); };
Object.values(old.villages).forEach(x => { strip(x.units); x.support = { zz: (() => { const u = { spear: 2 }; return u; })() }; });
const ids = Object.keys(old.villages);
old.movements.push({ id: 'm', type: 'attack', owner: 'player', from: ids[0], to: ids[ids.length - 1], units: { spear: 1 }, start: 0, arrive: 1 });
old.version = 4;
const migrated = DB.migrate(old);
ok(migrated.version === C.SAVE_VERSION && C.SAVE_VERSION === 5, 'migracja v4 → v5');
const allZero = u => cheap.every(k => u[k] === 0);
ok(Object.values(migrated.villages).every(x => allZero(x.units) && Object.values(x.support).every(allZero)), 'migracja: wioski i wsparcie mają nowe jednostki = 0');
ok(allZero(migrated.movements[migrated.movements.length - 1].units), 'migracja: oddziały w marszu mają nowe jednostki = 0');
E.advance(migrated, 2 * 3600 * 1000);
const nanFree = Object.values(migrated.villages).every(x => E.UNITS.every(k => Number.isFinite(x.units[k])) && E.RES.every(k => Number.isFinite(x.res[k])));
ok(nanFree, 'po migracji gra liczy się bez NaN');

/* ---------- symulacja: AI korzysta z nowych jednostek ---------- */
const sim = E.newGame(0, 99, 'hard', 'small');
E.advance(sim, 12 * 3600 * 1000);
const seen = {};
Object.values(sim.villages).forEach(x => { if (x.owner && x.owner !== 'player') cheap.forEach(k => { seen[k] = (seen[k] || 0) + x.units[k]; }); });
const used = cheap.filter(k => seen[k] > 0);
ok(used.length >= 1, 'po 12 h AI ma w armiach nowe jednostki (' + JSON.stringify(seen) + ')');
const finite = Object.values(sim.villages).every(x => E.UNITS.every(k => Number.isFinite(x.units[k]) && x.units[k] >= 0) && E.RES.every(k => Number.isFinite(x.res[k])));
ok(finite, 'symulacja 12 h: brak NaN i ujemnych wartości');

console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy jednostek przeszły.');
process.exit(fails ? 1 : 0);
