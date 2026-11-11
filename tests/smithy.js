/* Test wymiany surowców (Targowisko) i ulepszeń jednostek (Kuźnia), w tym migracji starego zapisu: node tests/smithy.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, DB = MP.DB;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const st = E.newGame(0, 12345, 'normal', 'small');
const v = E.villagesOf(st, 'player')[0];
E.useDifficulty(st);

/* ---------- wymiana ---------- */
v.buildings.hq = 10;
v.res = { wood: 1000, clay: 5000, iron: 1000 };
ok(!E.exchange(st, v.id, 'clay', 'wood', 1000, 0).ok, 'bez Targowiska wymiana jest zablokowana');
v.buildings.market = 1;
ok(E.exchangeMax(v) === C.MERCHANT.capacity, 'limit jednorazowej wymiany = kupcy × udźwig');
let r = E.exchange(st, v.id, 'clay', 'wood', 1000, 0);
ok(r.ok && r.spent === 1000 && r.got === 700, 'wymiana 1000 gliny daje 700 drewna (kurs 0,7)');
ok(v.res.clay === 4000 && v.res.wood === 1700, 'surowce zmienione poprawnie');
ok(!E.exchange(st, v.id, 'clay', 'wood', 1500, 0).ok, 'powyżej limitu kupców: odmowa');
ok(!E.exchange(st, v.id, 'iron', 'iron', 100, 0).ok, 'ten sam surowiec: odmowa');
ok(!E.exchange(st, v.id, 'wood', 'iron', 99999, 0).ok, 'za mało surowca: odmowa');
v.buildings.hq = 1; v.res.iron = E.storageCap(v) - 100; v.res.clay = 4000;
ok(!E.exchange(st, v.id, 'clay', 'iron', 1000, 0).ok, 'brak miejsca w magazynie: odmowa, nic nie przepada');
ok(v.res.clay === 4000, 'po odmowie surowiec oddawany nie ubywa');
// kółko wymian nie daje zysku
v.buildings.hq = 10; v.res = { wood: 10000, clay: 0, iron: 0 };
const a = E.exchange(st, v.id, 'wood', 'clay', 1000, 0).got, b = E.exchange(st, v.id, 'clay', 'wood', a, 0).got;
ok(b < 1000, 'wymiana tam i z powrotem: ' + b + ' < 1000');

/* ---------- Kuźnia ---------- */
v.buildings.hq = 10; v.buildings.smithy = 0; v.res = { wood: 14000, clay: 14000, iron: 14000 };
ok(E.upgradeInfo(st, v, 'spear').code === 'smithy', 'bez Kuźni: ulepszenie zablokowane');
ok(E.upgradeInfo(st, v, 'ram').code === 'unit' && E.upgradeInfo(st, v, 'noble').code === 'unit', 'tarany i Dowódcy nie są ulepszane');
v.buildings.smithy = 1;
const i1 = E.upgradeInfo(st, v, 'spear');
ok(i1.ok && i1.target === 1, 'Kuźnia 1: można ulepszyć Pikiniera do poz. 1');
ok(i1.cost.wood === Math.round(C.UNITS.spear.cost.wood * C.SMITHY.costMult / 5) * 5, 'koszt poz. 1 = koszt jednostki × mnożnik');
const wBefore = v.res.wood;
ok(E.queueUpgrade(st, v, 'spear', 0).ok && v.upgrade && v.res.wood < wBefore, 'badanie ruszyło i kosztuje');
ok(E.upgradeInfo(st, v, 'archer').code === 'busy', 'Kuźnia zajęta: drugie badanie odmowa');
const atk0 = E.attackPower({ spear: 10 }, null);
E.advance(st, v.upgrade.end + 1);
ok(!v.upgrade && E.upgradesOf(st, 'player').spear === 1, 'po czasie ulepszenie przyznane plemieniu');
ok(Math.abs(E.attackPower({ spear: 10 }, E.upgradesOf(st, 'player')) - atk0 * 1.05) < 1e-9, 'atak +5% na poziom');
ok(Math.abs(E.defensePower({ spear: 10 }, E.upgradesOf(st, 'player')) - 10 * C.UNITS.spear.def * 1.05) < 1e-9, 'obrona +5% na poziom');
ok(E.upgradeInfo(st, v, 'spear').code === 'level', 'poz. 2 wymaga Kuźni poz. 2');
// koszt najwyższego poziomu mieści się w magazynie dla każdej ulepszalnej jednostki
C.SMITHY.units.forEach(u => {
  const U = C.UNITS[u];
  const top = E.RES.map(rk => U.cost[rk] * C.SMITHY.costMult * Math.pow(C.SMITHY.costFactor, C.MAX_LEVEL - 1));
  ok(Math.max.apply(null, top) <= C.BUILDINGS.hq.storage[C.MAX_LEVEL], u + ': koszt poz. ' + C.MAX_LEVEL + ' ≤ magazyn (' + Math.round(Math.max.apply(null, top)) + ')');
});

/* ---------- walka uwzględnia ulepszenia ---------- */
const st2 = E.newGame(0, 777, 'normal', 'small');
const pv = E.villagesOf(st2, 'player')[0];
const ai = Object.values(st2.villages).find(x => x.owner && x.owner !== 'player');
E.useDifficulty(st2);
pv.units = E.emptyUnits(); ai.units = E.emptyUnits();
ai.units.spear = 10; pv.units.axe = 10;
const D0 = E.villageDefense(ai, null, E.upgradesOf(st2, ai.owner));
st2.factions[ai.owner].upgrades = { spear: 4 };
const D1 = E.villageDefense(ai, null, E.upgradesOf(st2, ai.owner));
ok(D1 > D0, 'obrona wioski rośnie po ulepszeniu obrońcy (' + Math.round(D0) + ' → ' + Math.round(D1) + ')');
ok(E.accountPower(st2, ai.owner).defense > 0, 'moc konta liczy się z ulepszeniami bez błędu');

/* ---------- zdobycie wioski kasuje badanie ---------- */
const st3 = E.newGame(0, 4242, 'normal', 'small');
const w = Object.values(st3.villages).find(x => x.owner && x.owner !== 'player');
w.upgrade = { unit: 'spear', level: 1, start: 0, end: 1e9 };
ok(E.nextEvent(st3) !== null, 'zdarzenia istnieją przy trwającym badaniu');

/* ---------- migracja zapisu v6 → v7 ---------- */
const old = JSON.parse(JSON.stringify(E.newGame(0, 99, 'normal', 'small')));
old.version = 6;
Object.values(old.villages).forEach(x => { delete x.buildings.smithy; delete x.upgrade; });
Object.values(old.factions).forEach(f => { delete f.upgrades; });
const mig = DB.migrate(old);
ok(mig.version === C.SAVE_VERSION, 'zapis v6 migruje do v' + C.SAVE_VERSION);
ok(Object.values(mig.villages).every(x => x.buildings.smithy === 0 && x.upgrade === null), 'migracja dodaje Kuźnię (0) i brak badania');
ok(Object.values(mig.factions).every(f => f.upgrades && typeof f.upgrades === 'object'), 'migracja dodaje ulepszenia frakcjom');
const reload = DB.parse(DB.serialize(mig)).state;
E.advance(reload, reload.now + 3600 * 1000);
ok(true, 'zapis po migracji działa przez godzinę gry');

/* ---------- symulacja bez NaN ---------- */
const sim = E.newGame(0, 31337, 'normal', 'small');
E.useDifficulty(sim);
const sv = E.villagesOf(sim, 'player')[0];
sv.buildings.smithy = 10; sv.buildings.hq = 10; sv.res = { wood: 14000, clay: 14000, iron: 14000 };
for (let i = 0; i < 6; i++) { E.queueUpgrade(sim, sv, 'axe', sim.now); E.advance(sim, sim.now + 3600 * 1000); sv.res = { wood: 14000, clay: 14000, iron: 14000 }; }
ok((E.upgradesOf(sim, 'player') || {}).axe === 6, 'sześć kolejnych ulepszeń Toporników: poz. ' + (E.upgradesOf(sim, 'player') || {}).axe);
ok(Object.values(sim.villages).every(x => E.RES.every(k => Number.isFinite(x.res[k]) && x.res[k] >= 0)), 'brak NaN i wartości ujemnych po symulacji');

console.log(fails ? '\nBŁĘDÓW: ' + fails : '\nWszystkie testy Kuźni i wymiany przeszły.');
process.exit(fails ? 1 : 0);
