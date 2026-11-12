/* Test statystyk (zrabowane surowce, bitwy): node tests/stats.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const s = E.newGame(0, 11, 'normal');
let t = E.statsOf(s, 'player');
ok(t.looted.total === 0 && t.lost.total === 0 && t.won === 0 && t.lostBattles === 0 && t.conquered === 0, 'nowa gra: statystyki zerowe');

const att = E.villagesOf(s, 'player')[0];
const def = Object.values(s.villages).find(x => x.owner === null);
def.units = Object.assign(E.emptyUnits(), { spear: 10 }); def.buildings.wall = 0; def.res = { wood: 5000, clay: 5000, iron: 5000 };
att.units = Object.assign(E.emptyUnits(), { axe: 100, light: 200 });
const sent = Object.assign({}, att.units);
E.sendAttack(s, att.id, def.id, sent, 0);
E.advance(s, E.travelTime(att, def, sent) + 1000);
const rep = s.reports[0];
t = E.statsOf(s, 'player');
const repLoot = rep.loot.wood + rep.loot.clay + rep.loot.iron;
ok(rep.attackerWon && repLoot > 0, 'atak wygrany i zrabował surowce (' + repLoot + ')');
ok(t.looted.total === repLoot, 'statystyka zrabowanych = łup z raportu (' + t.looted.total + ')');
ok(t.looted.wood === rep.loot.wood && t.looted.iron === rep.loot.iron, 'podział na surowce zgodny z raportem');
ok(t.won === 1 && t.lostBattles === 0, 'bitwa wygrana policzona');

if (fails) { console.error(fails + ' błędów'); process.exit(1); }
console.log('Wszystko OK');
