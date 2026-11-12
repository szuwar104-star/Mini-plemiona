/* Test presji AI na gracza (poziom Trudny): node tests/pressure.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG, cfg = C.AI.pressure;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const MIN = 60000;

['easy', 'normal'].forEach(d => {
  const s = E.newGame(0, 3, d);
  ok(MP.AI.pressureOf(s, 500 * MIN, 'ai1') === 0, d + ': presja wyłączona');
});

const s = E.newGame(0, 3, 'hard');
const grace = E.diff(s).graceMinutes * MIN;
ok(MP.AI.pressureOf(s, grace + (cfg.startMin - 1) * MIN, 'ai1') === 0, 'Trudny: przed startMin presji brak');
const mid = MP.AI.pressureOf(s, grace + (cfg.startMin + cfg.rampMin / 2) * MIN, 'ai1');
ok(Math.abs(mid - 0.5) < 1e-9, 'Trudny: w połowie narastania presja 0,5 (' + mid + ')');
ok(MP.AI.pressureOf(s, grace + (cfg.startMin + cfg.rampMin * 5) * MIN, 'ai1') === E.diff(s).aiPressure, 'Trudny: presja ma sufit aiPressure');

// atak AI na gracza zeruje presję
const pv = E.villagesOf(s, 'player')[0];
const t0 = grace + (cfg.startMin + cfg.rampMin * 2) * MIN;
s.lastHitBy = { ai1: t0 };
ok(MP.AI.pressureOf(s, t0, 'ai1') === 0, 'po ataku frakcji na gracza jej presja spada do zera');
ok(MP.AI.pressureOf(s, t0, 'ai2') === E.diff(s).aiPressure, 'a presja innej frakcji pozostaje pełna');
ok(MP.AI.pressureOf(s, t0 + (cfg.startMin + cfg.rampMin) * MIN, 'ai1') === E.diff(s).aiPressure, 'i znów narasta do pełnej');

console.log(fails ? fails + ' błędów' : 'Wszystkie testy presji AI przeszły.');
process.exit(fails ? 1 : 0);
