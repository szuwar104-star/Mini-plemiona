/* Test prędkości gry: node tests/speed.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../database.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const T0 = 1700000000000, MIN = 60000, SEC = 1000;
const mk = () => E.newGame(T0, 12345, 'normal');
const world = s => JSON.stringify({ v: s.villages, m: s.movements, r: s.reports.length, f: s.factions });

ok(E.speedOf(mk()) === 1, 'domyślnie ×1');

// ×10 przez 6 min rzeczywistych = 60 min gry, identycznie jak zwykłe 60 min
const ctrl = mk(); E.advance(ctrl, T0 + 60 * MIN);
const s = mk();
ok(E.setSpeed(s, T0, 10) === true, 'ustawienie ×10');
ok(E.setSpeed(s, T0, 10) === false, 'to samo ustawienie nic nie zmienia');
let real = T0;
for (let i = 0; i < 360; i++) { real += SEC; E.rebaseClock(s, real); E.advance(s, E.gameClock(s, real)); }
ok(s.now === ctrl.now, '6 min rzeczywistych ×10 = 60 min gry');
ok(world(s) === world(ctrl), 'świat identyczny jak po zwykłych 60 min');

// najbliższa dozwolona wartość
ok(E.setSpeed(s, real, 9) === false && E.speedOf(s) === 10, '9 zaokrągla się do ×10 (bez zmiany)');
ok(E.setSpeed(s, real, 1) === true && E.speedOf(s) === 1, 'powrót do ×1');
const before = s.now;
real += 10 * SEC; E.rebaseClock(s, real);
ok(E.gameClock(s, real) === before + 10 * SEC, 'po powrocie do ×1 czas płynie normalnie');

// pauza z prędkością: zegar stoi, po wznowieniu liczy dalej ×5
E.setSpeed(s, real, 5);
E.advance(s, E.gameClock(s, real + 10 * SEC)); real += 10 * SEC;
E.pauseGame(s, real);
const frozen = s.now;
ok(E.gameClock(s, real + 3600 * SEC) === frozen, 'w pauzie zegar stoi mimo ×5');
real += 3600 * SEC;
ok(E.resumeGame(s, real) === true, 'wznowienie');
ok(E.gameClock(s, real + 2 * SEC) === frozen + 10 * SEC, 'po wznowieniu ×5 liczy od zamrożonego momentu');
E.setSpeed(s, real, 1);

// zmiana prędkości w pauzie działa po wznowieniu
E.pauseGame(s, real + SEC); const fz = s.now;
ok(E.setSpeed(s, real + 5 * SEC, 20) === true && s.now === fz, 'zmiana prędkości w pauzie nie rusza czasu');
E.resumeGame(s, real + 10 * SEC);
ok(E.gameClock(s, real + 11 * SEC) === fz + 20 * SEC, 'po wznowieniu obowiązuje ×20');

// luka (zamknięta gra) liczy się w tempie ×1
const g = mk(); E.setSpeed(g, T0, 10);
E.rebaseClock(g, T0 + 5 * SEC); E.advance(g, E.gameClock(g, T0 + 5 * SEC));
const gStart = g.now; // 50 s gry
const away = 2 * 3600 * SEC; // 2 h przy zamkniętej grze
E.rebaseClock(g, T0 + 5 * SEC + away);
ok(E.gameClock(g, T0 + 5 * SEC + away) === gStart + away, '2 h przerwy = 2 h gry, nie 20 h');
ok(E.gameClock(g, T0 + 6 * SEC + away) === gStart + away + 10 * SEC, 'po powrocie znów ×10');

// godziny w raportach: odwzorowanie czas gry -> zegarek
const w = mk(); E.setSpeed(w, T0 + 100 * SEC, 10); // przed zmianą ×1
ok(E.wallTime(w, T0 + 50 * SEC) === T0 + 50 * SEC, 'wallTime przed zmianą prędkości = zegar');
ok(E.wallTime(w, w.now + 100 * SEC) === T0 + 110 * SEC, 'wallTime po zmianie: 100 s gry = 10 s zegarka');
const legacy = mk(); legacy.skew = 5000;
ok(E.wallTime(legacy, T0) === T0 + 5000, 'stare zapisy: wallTime = czas + skew');

// zapis i wczytanie
const back = MP.DB.parse(MP.DB.serialize(w)).state;
ok(E.speedOf(back) === 10 && back.clk && back.clk.s === 10, 'prędkość przeżywa zapis do pliku');

if (fails) { console.error(fails + ' błędów'); process.exit(1); }
console.log('Wszystko OK');
