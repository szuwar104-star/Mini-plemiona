/* Test rozmiarów świata: node tests/worlds.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

for (const key of Object.keys(C.WORLDS)) {
  const W = C.WORLDS[key];
  const s = E.newGame(0, 12345, 'normal', key);
  const vs = Object.values(s.villages);
  const ais = Object.values(s.factions).filter(f => f.ai);
  ok(s.map.size === W.size && s.map.tiles.length === W.size * W.size, key + ': mapa ' + W.size + '×' + W.size);
  ok(ais.length === W.ai, key + ': ' + ais.length + ' frakcji AI');
  ok(ais.every(f => vs.some(v => v.owner === f.id)), key + ': każda frakcja ma wioskę');
  ok(vs.filter(v => v.owner === null).length >= W.neutral * 0.8, key + ': wolnych osad ' + vs.filter(v => v.owner === null).length + ' (cel ' + W.neutral + ')');
  ok(new Set(vs.map(v => v.x + ',' + v.y)).size === vs.length, key + ': brak wiosek na tym samym polu');
  ok(E.winVillages(s) === W.win, key + ': cel zwycięstwa ' + W.win);
  const t0 = Date.now();
  E.advance(s, 4 * 3600 * 1000);
  const ms = Date.now() - t0;
  ok(ms < 20000, key + ': 4 h gry policzone w ' + ms + ' ms');
}
const old = E.newGame(0, 7, 'normal');
delete old.winVillages; delete old.world;
ok(E.winVillages(old) === C.WIN_VILLAGES, 'stary zapis bez pola winVillages dostaje domyślny cel');
console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy światów przeszły.');
process.exit(fails ? 1 : 0);
