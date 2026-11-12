/* Test Epoki II (drugie drzewko Technologii): bramka po ukończeniu Epoki I, efekty i niezależność badań jednostek: node tests/epoch2.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, T = C.TECH;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const st = E.newGame(0, 777, 'normal', 'small');
const f = st.factions.player;
E.useDifficulty(st);
const e1 = T.nodes.filter(n => !n.epoch), e2 = T.nodes.filter(n => n.epoch === 2);

/* struktura */
ok(e2.length > 0 && e1.length > 0, 'są węzły obu epok (' + e1.length + ' + ' + e2.length + ')');
const ids = T.nodes.map(n => n.id);
ok(new Set(ids).size === ids.length, 'identyfikatory węzłów unikalne');
ok(e2.every(n => T.branches.some(b => b.id === n.branch && b.epoch === 2)), 'węzły Epoki II leżą w gałęziach Epoki II');
ok(e1.every(n => T.branches.some(b => b.id === n.branch && !b.epoch)), 'węzły Epoki I leżą w gałęziach Epoki I');
ok(e2.every(n => !n.req || ids.indexOf(n.req.id) >= 0 && ids.indexOf(n.req.id) < ids.indexOf(n.id)), 'rodzice Epoki II wcześniej w liście');
ok(e2.every(n => !n.req || T.nodes.find(p => p.id === n.req.id).epoch === 2), 'Epoka II zależy tylko od Epoki II (poza bramką)');
ok(e2.filter(n => n.effect.type === 'unit2').every(n => C.UNITS[n.effect.unit]), 'węzły unit2 wskazują istniejące jednostki');
ok(e2.filter(n => n.effect.type === 'unit2').every(n => { const p = n.req && T.nodes.find(x => x.id === n.req.id); return p && p.effect.type !== 'unit2'; }),
  'badanie jednostki II nie zależy od badania innej jednostki (tylko od korzenia gałęzi)');
ok(e2.every(n => n.base > 0 && n.factor >= 1 && n.max > 0), 'koszty Epoki II poprawne');

/* bramka */
f.coins = 1e9;
ok(E.techInfo(st, 'e2_drill').code === 'epoch', 'Epoka II zablokowana, dopóki Epoka I nieukończona');
ok(!E.researchTech(st, 'e2_drill', 0).ok && !(f.tech && f.tech.e2_drill), 'badanie Epoki II bez bramki jest odrzucone');
ok(!E.epochDone(f, 2), 'epochDone(2) = false na starcie');
// ukończ Epokę I bez ostatniego węzła
const done = n => { if (n.effect.type === 'unit') { f.upgrades = f.upgrades || {}; f.upgrades[n.effect.unit] = n.max; } else { f.tech = f.tech || {}; f.tech[n.id] = n.max; } };
e1.slice(0, -1).forEach(done);
ok(E.techInfo(st, 'e2_drill').code === 'epoch', 'o jedno badanie od końca Epoki I: nadal zablokowane');
done(e1[e1.length - 1]);
E.useDifficulty(st);
ok(E.epochDone(f, 2), 'Epoka I ukończona → epochDone(2)');
ok(E.techInfo(st, 'e2_drill').ok, 'po ukończeniu Epoki I można badać Epokę II');
ok(E.techInfo(st, 'u2_axe').code === 'req', 'Topornik II nadal wymaga korzenia gałęzi');

/* efekty */
const before = E.techEffects(f);
let r = E.researchTech(st, 'e2_drill', 0);
ok(r.ok && f.tech.e2_drill === 1, 'Musztra mistrzowska poz. 1 kupiona');
ok(E.techEffects(f).recruit < before.recruit, 'Musztra mistrzowska skraca szkolenie (sumuje się z Musztrą)');
const v = E.villagesOf(st, 'player')[0];
const ups0 = E.upgradesOf(st, 'player'), m0 = E.upgradeMult(ups0, 'axe');
ok(Math.abs(m0 - (1 + T.unitBonus * T.nodes.find(n => n.id === 'u_axe').max)) < 1e-9, 'Epoka I: topornik ma pełny bonus Epoki I (' + m0.toFixed(2) + ')');
E.researchTech(st, 'e2_drill', 0);
r = E.researchTech(st, 'u2_axe', 0);
ok(r.ok && f.tech.u2_axe === 1, 'Topornik II poz. 1 kupiony');
const ups1 = E.upgradesOf(st, 'player');
ok(Math.abs(E.upgradeMult(ups1, 'axe') - (m0 + T.unit2Bonus)) < 1e-9, 'Topornik II dodaje +' + T.unit2Bonus * 100 + '% do ataku i obrony (sumuje się)');
ok(E.upgradeMult(ups1, 'light') === E.upgradeMult(ups0, 'light'), 'Topornik II nie zmienia innych jednostek');
const u = E.emptyUnits(); u.axe = 100;
ok(E.attackPower(u, ups1) > E.attackPower(u, ups0), 'siła ataku rośnie po Topornik II');
ok(E.defensePower(u, ups1) > E.defensePower(u, ups0), 'obrona jednostki rośnie po Topornik II');

/* inne efekty są liczbami */
const fx = E.techEffects(f);
ok(Object.keys(fx).every(k => Number.isFinite(fx[k])), 'wszystkie efekty techEffects są liczbami (brak NaN)');
e2.forEach(n => { if (n.effect.type !== 'unit2') done(n); else f.tech[n.id] = n.max; });
const fxMax = E.techEffects(f);
ok(Object.keys(fxMax).every(k => Number.isFinite(fxMax[k])), 'przy pełnej Epoce II efekty są liczbami');
ok(fxMax.recruit >= 0.3 && fxMax.build >= 0.3 && fxMax.march >= 0.5 && fxMax.wonderTime >= 0.3 && fxMax.wonderCost >= 0.5, 'ograniczenia dolne efektów działają');
ok(fxMax.exchange < 1, 'kurs wymiany po obu epokach wciąż poniżej 100% (' + fxMax.exchange.toFixed(2) + ')');
const upsMax = E.upgradesOf(st, 'player');
ok(upsMax.__fort > 0 && upsMax.__militia > 0, 'Twierdze i Powszechny pobór sumują się z Epoką I (fort ' + upsMax.__fort.toFixed(2) + ')');

/* AI nie ma badań, a jego bonus jednostek nie zmienia się */
const aiId = Object.keys(st.factions).find(i => i !== 'player');
st.factions[aiId].upgrades = { axe: 4 };
ok(Math.abs(E.upgradeMult(E.upgradesOf(st, aiId), 'axe') - (1 + 4 * T.unitBonus)) < 1e-9, 'AI: bonus jednostek bez zmian');

/* zapis/odczyt */
const back = MP.DB.parse(MP.DB.serialize(st)).state;
ok(back.factions.player.tech.u2_axe === T.nodes.find(n => n.id === 'u2_axe').max, 'poziomy Epoki II przeżywają zapis i odczyt');
ok(E.techLevel(back.factions.player, T.nodes.find(n => n.id === 'u2_axe')) === T.nodes.find(n => n.id === 'u2_axe').max, 'techLevel po odczycie');

if (fails) { console.error(fails + ' błędów'); process.exit(1); } else console.log('Epoka II: OK');
