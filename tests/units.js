/* Test balansu kosztów jednostek, Łucznika i odporności wczytywania zapisów: node tests/units.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, DB = MP.DB;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const total = c => c.wood + c.clay + c.iron;
const dominant = c => E.RES.reduce((a, r) => (c[r] > c[a] ? r : a), 'wood');

/* ---------- balans kosztów ---------- */
// Oryginalne sumy kosztów (przed rebalansem) – rebalans zmienia skład, a nie siłę na surowiec.
const ORIG_TOTAL = { spear: 96, axe: 113, scout: 101, light: 360, ram: 650, noble: 3100, settler: 2400 };
Object.keys(ORIG_TOTAL).forEach(k => {
  const t = total(C.UNITS[k].cost);
  ok(Math.abs(t - ORIG_TOTAL[k]) <= ORIG_TOTAL[k] * 0.05, k + ': suma kosztów ' + t + ' (było ' + ORIG_TOTAL[k] + ', ±5%)');
});
ok(!C.UNITS.slinger && !C.UNITS.shield && !C.UNITS.club && !C.UNITS.rider && !C.UNITS.woodram, 'Procarz i inne usunięte jednostki nie istnieją');

const dom = {};
E.UNITS.forEach(k => { dom[k] = dominant(C.UNITS[k].cost); });
ok(E.RES.every(r => E.UNITS.some(k => dom[k] === r)), 'są jednostki z przewagą drewna, gliny i żelaza: ' + JSON.stringify(dom));
ok(E.UNITS.every(k => C.UNITS[k].cost[dom[k]] >= total(C.UNITS[k].cost) * 0.38), 'każda jednostka ma wyraźnie dominujący surowiec (≥38% kosztu)');

// Typowe armie: żelazo ok. 1/4–1/3 kosztu, drewno i glina po ok. 1/3
function mix(counts) {
  const o = { wood: 0, clay: 0, iron: 0 };
  Object.keys(counts).forEach(k => E.RES.forEach(r => { o[r] += counts[k] * C.UNITS[k].cost[r]; }));
  return o;
}
const share = (o, r) => o[r] / total(o);
const armies = {
  'atak (topornicy, kawaleria, tarany)': { spear: 40, axe: 120, light: 20, ram: 6, scout: 3 },
  'obrona (piki i łucznicy)': { spear: 120, archer: 120, axe: 20, scout: 3 },
  'mieszana': { spear: 80, archer: 60, axe: 80, light: 10, ram: 4, scout: 3 }
};
Object.keys(armies).forEach(name => {
  const o = mix(armies[name]);
  const ir = share(o, 'iron');
  ok(ir >= 0.18 && ir <= 0.36, 'armia ' + name + ': żelazo ' + Math.round(ir * 100) + '% kosztu (cel 18–36%, oryginał ok. 38%)');
});
const m = mix(armies['mieszana']);
const sh = E.RES.map(r => share(m, r));
ok(Math.max.apply(null, sh) - Math.min.apply(null, sh) < 0.2, 'armia mieszana: drewno/glina/żelazo ' + sh.map(x => Math.round(x * 100) + '%').join('/') + ' – zbliżone udziały');

// Łucznik: najmniej żelaza, przewaga drewna, obrona jak Pikinier
const A = C.UNITS.archer, S = C.UNITS.spear;
ok(A.cost.iron <= S.cost.iron / 1.3 && dom.archer === 'wood', 'Łucznik: mniej żelaza niż Pikinier, przewaga drewna');
ok(A.def / total(A.cost) <= S.def / total(S.cost) + 0.001, 'obrona Łucznika nie jest tańsza na surowiec niż Pikiniera');

/* ---------- nowa gra i rekrutacja ---------- */
const s = E.newGame(0, 7, 'normal');
const v = E.villagesOf(s, 'player')[0];
ok(E.UNITS.every(k => k === 'spear' ? v.units[k] === 12 : v.units[k] === 0), 'nowa gra: 12 pikinierów, reszta 0');
v.buildings.barracks = 2; v.buildings.farm = 10; v.buildings.hq = 10;
v.res = { wood: 5000, clay: 5000, iron: 100 };
const r = E.queueRecruit(s, v, 'archer', 6, 0);
ok(r.ok && Math.round(v.res.iron) === 100 - 6 * A.cost.iron, 'rekrutacja 6 Łuczników kosztuje ' + 6 * A.cost.iron + ' żelaza');
v.buildings.barracks = 1;
ok(E.recruitInfo(s, v, 'archer').code === 'locked', 'Łucznik zablokowany do Koszar 2');
ok(E.ramCount({ ram: 8 }) === 8, 'ramCount liczy tarany');

/* ---------- odporność wczytywania zapisów ---------- */
const finiteState = st => Object.values(st.villages).every(x => E.UNITS.every(k => Number.isFinite(x.units[k]) && x.units[k] >= 0) &&
  Object.values(x.support).every(u => E.UNITS.every(k => Number.isFinite(u[k]))) &&
  E.RES.every(k => Number.isFinite(x.res[k]))) &&
  st.movements.every(mv => E.UNITS.every(k => Number.isFinite(mv.units[k])));

// (a) stary zapis v4 bez Łucznika
const oldKeys = ['spear', 'axe', 'scout', 'light', 'ram', 'noble', 'settler'];
const strip = u => { if (u) Object.keys(u).forEach(k => { if (!oldKeys.includes(k)) delete u[k]; }); };
const old = JSON.parse(JSON.stringify(E.newGame(0, 5, 'normal')));
Object.values(old.villages).forEach(x => { strip(x.units); x.support = { zz: { spear: 2 } }; });
const ids = Object.keys(old.villages);
old.movements.push({ id: 'm', type: 'attack', owner: 'player', from: ids[0], to: ids[ids.length - 1], units: { spear: 1 }, start: 0, arrive: 1 });
old.version = 4;
const m4 = DB.migrate(old);
ok(m4.version === C.SAVE_VERSION && finiteState(m4), 'zapis v4: migracja do v' + C.SAVE_VERSION + ', wszystkie liczniki skończone');
E.advance(m4, 2 * 3600 * 1000);
ok(finiteState(m4), 'po migracji v4 gra liczy się bez NaN');

// (b) zapis w AKTUALNEJ wersji, ale bez jednostki dodanej później (przypadek, który dawał NaN)
const cur = JSON.parse(JSON.stringify(E.newGame(0, 6, 'normal')));
const cids = Object.keys(cur.villages);
Object.values(cur.villages).forEach(x => { delete x.units.archer; });
cur.movements.push({ id: 'm2', type: 'attack', owner: 'player', from: cids[0], to: cids[1], units: { spear: 1 }, start: 0, arrive: 1 });
const m5 = DB.migrate(cur);
ok(finiteState(m5), 'zapis v' + C.SAVE_VERSION + ' bez Łucznika: brak NaN (liczniki uzupełnione zerami)');

// (c) zapis z usuniętą jednostką (Procarz) w wojsku, kolejce i raporcie
const rem = JSON.parse(JSON.stringify(E.newGame(0, 8, 'normal')));
const pv = Object.values(rem.villages).find(x => x.owner === 'player');
pv.units.slinger = 25;
pv.recruitQueue.push({ id: 'q1', unit: 'slinger', count: 10, done: 0, per: 1000, start: 0 }, { id: 'q2', unit: 'archer', count: 2, done: 0, per: 1000, start: 0 });
rem.reports.push({ id: 'r1', attUnits: { slinger: 3, spear: 1 }, attLoss: {}, defUnits: {}, defLoss: {} });
const mr = DB.migrate(rem);
const pv2 = Object.values(mr.villages).find(x => x.owner === 'player');
ok(!('slinger' in pv2.units) && pv2.recruitQueue.length === 1 && pv2.recruitQueue[0].unit === 'archer', 'usunięta jednostka znika z wojska i kolejki, reszta kolejki zostaje');
ok(!('slinger' in mr.reports[mr.reports.length - 1].attUnits) && finiteState(mr), 'usunięta jednostka znika z raportów, brak NaN');
E.advance(mr, 10 * 60 * 1000);                  // krócej niż ochrona przed AI – wioska nie zmienia właściciela
ok(finiteState(mr) && pv2.units.archer >= 2, 'gra po wczytaniu liczy się poprawnie (Łucznicy z kolejki są gotowi)');

/* ---------- symulacja: AI korzysta z Łucznika ---------- */
const sim = E.newGame(0, 99, 'hard', 'small');
E.advance(sim, 12 * 3600 * 1000);
let archers = 0;
Object.values(sim.villages).forEach(x => { if (x.owner && x.owner !== 'player') archers += x.units.archer; });
ok(archers > 0, 'po 12 h AI ma w armiach ' + archers + ' Łuczników');
ok(finiteState(sim), 'symulacja 12 h: brak NaN i ujemnych wartości');

console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy jednostek przeszły.');
process.exit(fails ? 1 : 0);
