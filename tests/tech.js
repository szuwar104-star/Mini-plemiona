/* Test Technologii: monety (limit zakupu), drzewko badań, efekty, wymiana surowców i migracja zapisu v7 → v8: node tests/tech.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, DB = MP.DB, T = C.TECH;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const st = E.newGame(0, 12345, 'normal', 'small');
const f = st.factions.player;
const v = E.villagesOf(st, 'player')[0];
E.useDifficulty(st);

/* ---------- struktura drzewka ---------- */
const ids = T.nodes.map(n => n.id);
ok(new Set(ids).size === ids.length, 'identyfikatory węzłów są unikalne');
ok(T.nodes.every(n => !n.req || ids.indexOf(n.req.id) >= 0 && ids.indexOf(n.req.id) < ids.indexOf(n.id)), 'każdy węzeł ma rodzica wcześniej w liście (drzewko bez cykli)');
ok(T.nodes.every(n => n.effect.type !== 'unit' || C.UNITS[n.effect.unit]), 'węzły jednostek wskazują istniejące jednostki');
ok(!C.BUILDINGS.smithy, 'budynek Kuźni usunięty');

/* ---------- wymiana surowców ---------- */
v.buildings.hq = 10;
v.res = { wood: 1000, clay: 5000, iron: 1000 };
ok(!E.exchange(st, v.id, 'clay', 'wood', 1000, 0).ok, 'bez Targowiska wymiana jest zablokowana');
v.buildings.market = 1;
let r = E.exchange(st, v.id, 'clay', 'wood', 1000, 0);
ok(r.ok && r.got === 700, 'wymiana 1000 gliny daje 700 drewna (kurs ' + E.exchangeRate() + ')');
ok(!E.exchange(st, v.id, 'clay', 'wood', 1500, 0).ok, 'powyżej limitu kupców: odmowa');
ok(!E.exchange(st, v.id, 'iron', 'iron', 100, 0).ok, 'ten sam surowiec: odmowa');
v.res.wood = 10000; v.res.clay = 0;
const a = E.exchange(st, v.id, 'wood', 'clay', 1000, 0).got, b = E.exchange(st, v.id, 'clay', 'wood', a, 0).got;
ok(b < 1000, 'wymiana tam i z powrotem nie daje zysku (' + b + ' < 1000)');

/* ---------- monety ---------- */
v.buildings.market = 0; v.res = { wood: 14000, clay: 14000, iron: 14000 };
ok(!E.buyCoins(st, v.id, 'clay', 1, 0).ok, 'bez Targowiska: brak zakupu monet');
v.buildings.market = 2;
ok(E.mintLimit(v) === 2 * T.mint.perLevelPerHour, 'limit zakupu = poziom Targowiska × ' + T.mint.perLevelPerHour + ' monet/h');
const lim = E.mintLimit(v);
ok(!E.buyCoins(st, v.id, 'clay', lim + 1, 0).ok, 'zakup ponad limit: odmowa');
r = E.buyCoins(st, v.id, 'clay', lim, 0);
ok(r.ok && f.coins === lim && v.res.clay === 14000 - lim * T.coinPrice, 'zakup ' + lim + ' monet kosztuje ' + lim * T.coinPrice + ' gliny');
ok(!E.buyCoins(st, v.id, 'clay', 1, 0).ok, 'po wyczerpaniu limitu: odmowa');
ok(E.buyCoins(st, v.id, 'iron', 1, 3600 * 1000).ok, 'po godzinie limit się odnawia');
v.mint = { tokens: 0, at: 0 };
ok(Math.floor(E.mintTokens(v, 100 * 3600 * 1000)) === lim * T.mint.bucketHours, 'zapas limitu ma sufit ' + T.mint.bucketHours + ' h');
ok(E.buyCoins(st, v.id, 'wood', 1, 7200 * 1000).ok, 'zakup monet za inny surowiec działa');

/* ---------- badania ---------- */
f.coins = 0;
ok(E.techInfo(st, 'u_spear').code === 'req', 'Pikinier wymaga Pospolitego ruszenia');
ok(E.techInfo(st, 'drill').code === 'coins', 'bez monet: badanie zablokowane');
f.coins = 1000;
const c1 = E.techInfo(st, 'drill').cost;
r = E.researchTech(st, 'drill', 0);
ok(r.ok && f.tech.drill === 1 && f.coins === 1000 - c1, 'Musztra poz. 1 kupiona za ' + c1 + ' monet');
const recBefore = E.recruitPer(v, 'spear');
E.researchTech(st, 'drill', 0); E.researchTech(st, 'drill', 0);
ok(E.recruitPer(v, 'spear') < recBefore, 'Musztra skraca szkolenie');
E.researchTech(st, 'militia', 0);
ok(E.techInfo(st, 'u_spear').ok, 'po Pospolitym ruszeniu 1 można badać Pikiniera');
const atk0 = E.attackPower({ spear: 10 }, null);
E.researchTech(st, 'u_spear', 0);
ok(f.upgrades.spear === 1, 'badanie Pikiniera zapisuje poziom w ulepszeniach plemienia');
ok(Math.abs(E.attackPower({ spear: 10 }, E.upgradesOf(st, 'player')) - atk0 * 1.05) < 1e-9, 'atak +5% na poziom');
ok(E.techInfo(st, 'u_guard').code === 'req', 'Tarczownik wymaga Pospolitego ruszenia poz. 2 (nie Pikiniera)');
f.coins = 100000;
for (let i = 0; i < 12; i++) E.researchTech(st, 'u_spear', 0);
ok(f.upgrades.spear === 10 && E.techInfo(st, 'u_spear').code === 'max', 'poziom maksymalny 10 i dalej zablokowany');
// gospodarka
ok(E.techInfo(st, 'store').code === 'req', 'Magazyny wymagają Kupiectwa');
E.researchTech(st, 'trade', 0);
const cap0 = E.storageCap(v);
for (let i = 0; i < 3; i++) E.researchTech(st, 'store', 0);
ok(E.storageCap(v) === Math.floor(cap0 * 1.3), 'Magazyny +30%: ' + cap0 + ' → ' + E.storageCap(v));
const ai = Object.values(st.villages).find(x => x.owner && x.owner !== 'player');
ok(E.storageCap(ai) === C.BUILDINGS.hq.storage[ai.buildings.hq], 'AI nie dostaje bonusu do magazynu');
E.researchTech(st, 'trade', 0);
ok(Math.abs(E.exchangeRate() - 0.74) < 1e-9, 'Kupiectwo poz. 2: kurs ' + E.exchangeRate());
const lim0 = E.mintLimit(v);
E.researchTech(st, 'trade', 0); E.researchTech(st, 'mint', 0);
ok(E.mintLimit(v) === lim0 + 2, 'Mennica poz. 1: limit +2 monety/h');
const bt0 = E.buildInfo(st, v, 'farm').time;
E.researchTech(st, 'build', 0);   // wymaga Magazynów 3 (są)
ok(E.buildInfo(st, v, 'farm').time < bt0, 'Budownictwo skraca czas budowy (' + bt0 + ' → ' + E.buildInfo(st, v, 'farm').time + ' ms)');
// koszt najwyższego poziomu jest rozsądny
ok(T.nodes.every(n => E.techCost(n, n.max) > 0 && Number.isFinite(E.techCost(n, n.max))), 'koszty wszystkich poziomów są skończone');
const total = T.nodes.reduce((s, n) => { for (let l = 1; l <= n.max; l++) s += E.techCost(n, l); return s; }, 0);
console.log('   (całe drzewko: ' + total + ' monet = ' + (total * T.coinPrice / 1e6).toFixed(1) + ' mln surowców)');

/* ---------- walka uwzględnia badania ---------- */
const st2 = E.newGame(0, 777, 'normal', 'small');
E.useDifficulty(st2);
const pv = E.villagesOf(st2, 'player')[0];
pv.units = E.emptyUnits(); pv.units.spear = 10;
const D0 = E.villageDefense(pv, null, E.upgradesOf(st2, 'player'));
st2.factions.player.upgrades.spear = 4;
ok(E.villageDefense(pv, null, E.upgradesOf(st2, 'player')) > D0, 'obrona rośnie po badaniu jednostki');
ok(E.accountPower(st2, 'player').defense > 0, 'moc konta liczy się z badaniami');

/* ---------- migracja v7 → v8 ---------- */
const old = JSON.parse(JSON.stringify(E.newGame(0, 99, 'normal', 'small')));
old.version = 7;
Object.values(old.villages).forEach(x => { x.buildings.smithy = 2; x.upgrade = null; });
old.factions.player.upgrades = { axe: 3 }; delete old.factions.player.coins; delete old.factions.player.tech;
const mig = DB.migrate(old);
ok(mig.version === C.SAVE_VERSION, 'zapis v7 migruje do v' + C.SAVE_VERSION);
ok(Object.values(mig.villages).every(x => x.buildings.smithy === undefined && x.upgrade === undefined), 'migracja usuwa Kuźnię');
ok(mig.factions.player.coins === 0 && mig.factions.player.upgrades.axe === 3, 'poziomy ulepszeń jednostek zostają, monety = 0');
const re = DB.parse(DB.serialize(mig)).state;
E.advance(re, re.now + 3600 * 1000);
ok(true, 'zapis po migracji działa przez godzinę gry');

/* ---------- szybkie przyciski (wymiana i monety) ---------- */
const qs = E.newGame(0, 777, 'normal', 'small');
const qv = E.villagesOf(qs, 'player')[0];
E.useDifficulty(qs);
qv.buildings.hq = 10; qv.buildings.market = 1;
qv.res = { wood: 300, clay: 5000, iron: 4000 };
let q = E.exchangeQuick(qv, 'clay', 'wood', '1000');
ok(q.ok && q.amount === 1000 && q.got === 700, 'szybka wymiana 1000: oddaje 1000, daje 700');
ok(!E.exchangeQuick(qv, 'wood', 'clay', '1000').ok, 'stała ilość większa niż zapas: przycisk nieaktywny');
q = E.exchangeQuick(qv, 'clay', 'wood', 'half');
ok(q.ok && q.amount === 1000 && q.got === 700, '50% zapasu jest przycinane do limitu kupców (' + E.exchangeMax(qv) + ')');
qv.res.wood = E.storageCap(qv) - 100;
q = E.exchangeQuick(qv, 'clay', 'wood', 'max');
ok(q.ok && q.got <= 100 && q.amount > 0, 'maks. mieści się w magazynie celu (daje ' + q.got + ' przy 100 wolnego)');
qv.res.wood = E.storageCap(qv);
ok(!E.exchangeQuick(qv, 'clay', 'wood', 'max').ok, 'pełny magazyn celu: wymiana zablokowana');
qv.res.wood = 0; qv.res.clay = 5000;
q = E.exchangeQuick(qv, 'clay', 'wood', '5000');
ok(q.amount === E.exchangeMax(qv) && q.ok === (q.amount <= 5000), 'stała ilość nie przekracza limitu kupców');
r = E.exchange(qs, qv.id, 'clay', 'wood', E.exchangeQuick(qv, 'clay', 'wood', 'max').amount, 0);
ok(r.ok, 'ilość z szybkiej wymiany przechodzi przez E.exchange');
qv.buildings.market = 0;
ok(!E.exchangeQuick(qv, 'clay', 'wood', '1000').ok && !E.coinQuick(qv, 'clay', '1', 0).ok, 'bez Targowiska szybkie przyciski są nieaktywne');

qv.buildings.market = 3; qv.res = { wood: 20000, clay: 3000, iron: 100 }; qv.mint = null;
const qlim = E.mintLimit(qv);
let cq = E.coinQuick(qv, 'wood', '5', 0);
ok(cq.ok === (5 <= qlim) && cq.count === 5 && cq.cost === 5 * T.coinPrice, 'szybki zakup 5 monet: koszt ' + cq.cost + ' (limit ' + qlim + ')');
cq = E.coinQuick(qv, 'clay', 'max', 0);
ok(cq.count === Math.min(qlim, 2) && cq.ok, 'maks. monet za glinę = min(limit, stać mnie) = ' + cq.count);
ok(!E.coinQuick(qv, 'iron', 'max', 0).ok, 'brak surowca: maks. = 0, przycisk nieaktywny');
r = E.buyCoins(qs, qv.id, 'clay', cq.count, 0);
ok(r.ok && qs.factions.player.coins === cq.count, 'zakup z szybkiego przycisku przechodzi przez E.buyCoins');

const all = E.newGame(0, 888, 'normal', 'small');
const av = E.villagesOf(all, 'player')[0];
E.useDifficulty(all);
av.buildings.market = 2; av.res = { wood: 2000, clay: 9000, iron: 3000 }; av.mint = null;
let ra = E.buyCoinsAll(all, 0);
ok(ra.ok && all.factions.player.coins === ra.coins && ra.villages === 1, 'maks. ze wszystkich wiosek kupuje monety (' + ra.coins + ')');
ok(av.res.clay < 9000 && av.res.wood === 2000 && av.res.iron === 3000, 'płaci najobfitszym surowcem (gliną)');
ok(!E.buyCoinsAll(all, 0).ok, 'po wyczerpaniu limitu: brak zakupu');

/* ---------- nowe węzły: produkcja, łupy, skrytki, Taran ---------- */
const nt = E.newGame(0, 4242, 'normal', 'small');
const nf = nt.factions.player, nv = E.villagesOf(nt, 'player')[0];
E.useDifficulty(nt);
nf.coins = 1e6;
ok(['tools', 'p_wood', 'p_clay', 'p_iron', 'u_ram', 'plunder', 'hide'].every(id => E.techNode(id)), 'nowe węzły istnieją w drzewku');
ok(T.branches.every(b => T.nodes.some(n => n.branch === b.id && !n.req)), 'każda gałąź ma korzeń');
ok(E.techInfo(nt, 'p_wood').code === 'req', 'Leśnictwo wymaga Narzędzi poz. 2');
const p0 = E.productionPerMin(nv);
E.researchTech(nt, 'tools', 0); E.researchTech(nt, 'tools', 0);
const p1 = E.productionPerMin(nv);
ok(E.RES.every(k => Math.abs(p1[k] - p0[k] * 1.04) < 1e-9), 'Narzędzia poz. 2: +4% produkcji każdego surowca');
for (let i = 0; i < 3; i++) E.researchTech(nt, 'p_clay', 0);
const p2 = E.productionPerMin(nv);
ok(Math.abs(p2.clay - p0.clay * 1.04 * 1.09) < 1e-9 && Math.abs(p2.wood - p1.wood) < 1e-9, 'Ceglarstwo poz. 3: +9% tylko gliny');
const aiv = Object.values(nt.villages).find(x => x.owner && x.owner !== 'player');
ok(E.productionPerMin(aiv).wood === C.BUILDINGS.wood.prod[aiv.buildings.wood] * E.diff(nt).aiProd, 'AI nie dostaje bonusu do produkcji');
// łupy i skrytki
const h0 = E.hiddenRes(nt, nv);
['militia', 'militia', 'militia'].forEach(id => E.researchTech(nt, id, 0));
ok(E.techInfo(nt, 'hide').ok, 'Skrytki dostępne po Pospolitym ruszeniu poz. 3');
E.researchTech(nt, 'hide', 0); E.researchTech(nt, 'hide', 0);
ok(E.hiddenRes(nt, nv) > h0 && Math.abs(E.hiddenRes(nt, nv) - Math.floor(E.storageCap(nv) * (E.diff(nt).lootProtect + 0.06))) <= 1, 'Skrytki poz. 2: +6 p.p. ukrytego magazynu');
ok(E.techInfo(nt, 'plunder').code === 'req' && E.techInfo(nt, 'u_ram').code === 'req', 'Grabież i Taran wymagają wcześniejszych badań');
['drill', 'drill', 'drill', 'u_light', 'u_light', 'u_light'].forEach(id => E.researchTech(nt, id, 0));
ok(E.techInfo(nt, 'u_ram').ok && E.techInfo(nt, 'plunder').ok, 'Taran (Musztra 3) i Grabież (Lekka kaw. 3) odblokowane – Taran nie wymaga Topornika');
E.researchTech(nt, 'u_ram', 0);
ok(nf.upgrades.ram === 1, 'badanie Tarana zapisuje poziom w ulepszeniach plemienia');
// udźwig łupu: wygrany atak na wioskę z surowcami
function raid(plunderLvl) {
  const g = E.newGame(0, 555, 'normal', 'small');
  const pl = g.factions.player, home = E.villagesOf(g, 'player')[0];
  pl.tech.plunder = plunderLvl; E.useDifficulty(g);
  const tgt = Object.values(g.villages).find(x => x.owner === null);
  tgt.units = E.emptyUnits(); tgt.res = { wood: 9000, clay: 9000, iron: 9000 }; tgt.buildings.wall = 0;
  home.units = E.emptyUnits(); home.units.light = 100; home.res = { wood: 0, clay: 0, iron: 0 };
  const r = E.sendAttack(g, home.id, tgt.id, Object.assign(E.emptyUnits(), { light: 100 }), g.now);
  if (!r.ok) return null;
  E.advance(g, r.movement.arrive);
  const rep = (g.reports || []).find(x => x.attacker === 'player' && x.kind === 'battle' && x.lootCapacity != null) || (g.reports || []).find(x => x.attacker === 'player' && x.lootCapacity != null);
  return rep ? rep.lootCapacity : null;
}
const cap0r = raid(0), cap5r = raid(10);
ok(cap0r > 0 && cap5r === Math.floor(cap0r * 1.5), 'Grabież poz. 10: udźwig łupu +50% (' + cap0r + ' → ' + cap5r + ')');

/* ---------- niezależność jednostek i nowe węzły ---------- */
const unitNodes = T.nodes.filter(n => n.effect.type === 'unit');
ok(unitNodes.every(n => !n.req || T.nodes.find(p => p.id === n.req.id).effect.type !== 'unit'), 'ulepszenie jednostki nie wymaga ulepszenia innej jednostki');
ok(T.nodes.filter(n => n.req && T.nodes.find(p => p.id === n.req.id).effect.type === 'unit').map(n => n.id + '<-' + n.req.id).sort().join() === 'plunder<-u_light,siege<-u_ram', 'jedyne dzieci węzłów jednostek: Grabież (Lekka kaw.) i Machiny oblężnicze (Taran)');
ok(T.nodes.every(n => T.branches.some(b => b.id === n.branch)), 'każdy węzeł należy do istniejącej gałęzi');
{ // każda jednostka da się ulepszyć niezależnie od pozostałych: tylko korzeń gałęzi + własne minimum
  const g = E.newGame(0, 31337, 'normal', 'small'); E.useDifficulty(g); g.factions.player.coins = 1e6;
  ['u_axe', 'u_light', 'u_ram'].forEach(id => ok(E.techInfo(g, id).code === 'req', id + ': bez Musztry zablokowany'));
  ['u_spear', 'u_archer', 'u_guard'].forEach(id => ok(E.techInfo(g, id).code === 'req', id + ': bez Pospolitego ruszenia zablokowany'));
  E.researchTech(g, 'militia', 0); E.researchTech(g, 'militia', 0);
  ok(['u_spear', 'u_archer', 'u_guard'].every(id => E.techInfo(g, id).ok), 'Pospolite ruszenie 2: wszystkie trzy jednostki obrony badane od razu, w dowolnej kolejności');
  E.researchTech(g, 'u_guard', 0);
  ok(g.factions.player.upgrades.guard === 1 && !g.factions.player.upgrades.spear, 'Tarczownik ulepszony bez Pikiniera');
  for (let i = 0; i < 3; i++) E.researchTech(g, 'drill', 0);
  ok(['u_axe', 'u_light', 'u_ram'].every(id => E.techInfo(g, id).ok), 'Musztra 3: Topornik, Lekka kawaleria i Taran badane niezależnie');
  E.researchTech(g, 'u_ram', 0);
  ok(E.techInfo(g, 'siege').code === 'req', 'Machiny oblężnicze wymagają Tarana poz. 3');
}
{ // Pospolite ruszenie: stała obrona wioski, tylko dla gracza
  const g = E.newGame(0, 2024, 'normal', 'small'); E.useDifficulty(g);
  const gv = E.villagesOf(g, 'player')[0]; gv.units = E.emptyUnits();
  const d0 = E.villageDefense(gv, null, E.upgradesOf(g, 'player'));
  g.factions.player.tech.militia = 5; E.useDifficulty(g);
  ok(Math.abs(E.villageDefense(gv, null, E.upgradesOf(g, 'player')) - d0 - 40 * (1 + C.BUILDINGS.wall.bonus[gv.buildings.wall])) < 1e-6, 'Pospolite ruszenie poz. 5: +40 obrony wioski');
  const av2 = Object.values(g.villages).find(x => x.owner && x.owner !== 'player');
  ok(!E.upgradesOf(g, av2.owner) || !E.upgradesOf(g, av2.owner).__militia, 'AI bez Pospolitego ruszenia');
}
{ // Karawany: większy udźwig kupca
  const g = E.newGame(0, 11, 'normal', 'small'); g.factions.player.tech.caravan = 5; E.useDifficulty(g);
  ok(E.merchantCap() === Math.floor(C.MERCHANT.capacity * 1.75), 'Karawany poz. 5: udźwig kupca ×1,75 (' + E.merchantCap() + ')');
  const cv = E.villagesOf(g, 'player')[0]; cv.buildings.market = 1;
  ok(E.exchangeMax(cv) === E.merchantsTotal(cv) * E.merchantCap(), 'limit wymiany liczy się z udźwigu Karawan');
}
{ // Machiny oblężnicze: tarany liczą się za więcej
  const g = E.newGame(0, 12, 'normal', 'small'); g.factions.player.tech.siege = 5; E.useDifficulty(g);
  ok(E.ramEff(10, 'player') === 15 && E.ramEff(10, 'ai1') === 10, 'Machiny oblężnicze poz. 5: tarany gracza ×1,5, AI bez zmian');
}
{ // Taktyka: pech w ataku złagodzony – ten sam los daje nie mniejszy atak
  const g = E.newGame(0, 13, 'normal', 'small'); g.factions.player.tech.tactics = 4; E.useDifficulty(g);
  ok(T.nodes.find(n => n.id === 'tactics').effect.per * 4 === 0.8 && E.techEffects(g.factions.player).tactics === 0.8, 'Taktyka poz. 4: 80% pecha znika');
}

/* ---------- symulacja bez NaN ---------- */
const sim = E.newGame(0, 31337, 'normal', 'small');
const sv = E.villagesOf(sim, 'player')[0];
sv.buildings.market = 5; sim.factions.player.coins = 5000;
['drill', 'u_axe', 'u_axe', 'u_axe', 'trade', 'store', 'store', 'store', 'mint'].forEach(id => E.researchTech(sim, id, sim.now));
for (let i = 0; i < 24; i++) { sv.res = { wood: 14000, clay: 14000, iron: 14000 }; E.buyCoins(sim, sv.id, 'clay', 3, sim.now); E.advance(sim, sim.now + 3600 * 1000); }
ok(Object.values(sim.villages).every(x => E.RES.every(k => Number.isFinite(x.res[k]) && x.res[k] >= 0)), 'brak NaN i wartości ujemnych po symulacji');

/* ---------- Rolnictwo: miejsce na farmach ---------- */
{
  const g = E.newGame(0, 777, 'normal', 'small'), pv = E.villagesOf(g, 'player')[0], av = E.villagesOf(g, 'ai')[0];
  pv.buildings.farm = 10; if (av) av.buildings.farm = 10;
  E.useDifficulty(g);
  const base = C.BUILDINGS.farm.pop[10];
  ok(E.popCap(pv) === base, 'bez badania limit farmy = tabela (' + base + ')');
  g.factions.player.tech = g.factions.player.tech || {};
  g.factions.player.tech.agri = 4;
  E.useDifficulty(g);
  ok(E.popCap(pv) === Math.floor(base * 1.2), 'Rolnictwo 4 daje +20% miejsca (' + E.popCap(pv) + ')');
  if (av) ok(E.popCap(av) === base, 'AI nie korzysta z badań – limit bez zmian');
}

console.log(fails ? '\nBŁĘDÓW: ' + fails : '\nWszystkie testy Technologii przeszły.');
process.exit(fails ? 1 : 0);
