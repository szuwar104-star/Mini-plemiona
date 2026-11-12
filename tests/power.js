/* Test liczenia mocy konta: node tests/power.js */
'use strict';
require('../config.js'); require('../engine.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const s = E.newGame(0, 7, 'normal');
const v = E.villagesOf(s, 'player')[0];
let p = E.accountPower(s, 'player');
ok(p.buildings === E.points(v), 'punkty budynków = suma poziomów (' + p.buildings + ')');
ok(p.units === 12 && p.attack === 120 && p.defense === 300, 'start: 12 pikinierów -> atak 120, obrona 300');
ok(p.army === Math.round(12 * (33 + 30 + 33) / C.SCORE.costDivisor), 'punkty wojska pikinierów (' + p.army + ')');
ok(p.total === p.buildings + p.army, 'razem = budynki + wojsko');

// wojsko w marszu liczy się do mocy
const before = p.total;
s.movements.push({ id: 'mt1', type: 'attack', owner: 'player', from: v.id, to: 'x', units: Object.assign(E.emptyUnits(), { light: 10 }), arrive: 1e9 });
p = E.accountPower(s, 'player');
ok(p.units === 22 && p.attack === 120 + 10 * C.UNITS.light.att, 'oddział w marszu liczy się (atak ' + p.attack + ')');
ok(p.total > before, 'moc rośnie po dodaniu wojska w marszu');
s.movements.pop();

// wsparcie stacjonujące w drugiej wiosce liczy się raz
const w = JSON.parse(JSON.stringify(v)); w.id = 'vw'; w.support = { [v.id]: Object.assign(E.emptyUnits(), { axe: 5 }) }; w.units = E.emptyUnits();
s.villages.vw = w;
p = E.accountPower(s, 'player');
ok(p.units === 12 + 5, 'wsparcie liczone raz: ' + p.units + ' jedn.');

// obcy właściciele nie wpływają na wynik gracza
const ai = E.accountPower(s, 'ai1');
ok(ai.villages >= 1 && ai.total > 0, 'AI ma własną moc (' + ai.total + ')');
console.log(fails ? fails + ' błędów' : 'wszystko OK');
process.exit(fails ? 1 : 0);
