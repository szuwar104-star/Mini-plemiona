/* Test pauzy gry: node tests/pause.js */
'use strict';
require('../config.js'); require('../engine.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const T0 = 1700000000000, MIN = 60000, DAY = 86400000;
const mk = () => E.newGame(T0, 12345, 'normal');
const world = s => JSON.stringify({ v: s.villages, m: s.movements, r: s.reports.length, f: s.factions });

// kontrola: gra płynie bez przerwy 90 minut
const ctrl = mk(); E.advance(ctrl, T0 + 90 * MIN);

// pauza po 30 min, doba przerwy, wznowienie, jeszcze 60 min
const s = mk();
E.advance(s, E.gameClock(s, T0 + 30 * MIN));
ok(E.pauseGame(s, T0 + 30 * MIN) === true && s.paused, 'pauza włączona');
ok(E.pauseGame(s, T0 + 31 * MIN) === false, 'druga pauza nic nie robi');
const frozen = world(s);
ok(E.gameClock(s, T0 + 30 * MIN + DAY) === s.now, 'w pauzie zegar stoi');
E.advance(s, E.gameClock(s, T0 + 30 * MIN + DAY));
ok(world(s) === frozen, 'po dobie pauzy świat bez zmian (AI nie rozwinęło się)');
ok(E.resumeGame(s, T0 + 30 * MIN + DAY) === true && !s.paused, 'wznowienie');
ok(s.skew === DAY, 'skew = czas pauzy');
ok(E.gameClock(s, T0 + 30 * MIN + DAY) === T0 + 30 * MIN, 'po wznowieniu zegar zaczyna od zamrożonego momentu');
E.advance(s, E.gameClock(s, T0 + 90 * MIN + DAY));
ok(s.now === ctrl.now, 'ten sam czas gry co w kontroli');
ok(world(s) === world(ctrl), 'świat identyczny jak bez pauzy (pauza nie zmienia przebiegu)');

// bez pauzy doba przerwy normalnie nadrabia
const away = mk(); E.advance(away, T0 + DAY);
ok(world(away) !== world(mk()), 'kontrola: bez pauzy doba nadrabiana');

// zapis i wczytanie w pauzie
require('../database.js');
const copy = MP.DB ? MP.DB.parse(MP.DB.serialize(s)).state : null;
if (copy) {
  E.pauseGame(s, T0 + 100 * MIN);
  const back = MP.DB.parse(MP.DB.serialize(s)).state;
  ok(back.paused === true && back.pausedReal === T0 + 100 * MIN && back.skew === DAY, 'pauza i skew przeżywają zapis do pliku');
}
if (fails) { console.error(fails + ' błędów'); process.exit(1); }
console.log('Wszystko OK');
