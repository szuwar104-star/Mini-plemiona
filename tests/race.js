/* Test trybu Wyścig (AI może wygrać): node tests/race.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, H = 3600000;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const give = (s, owner, n) => {
  let have = E.villagesOf(s, owner).length;
  Object.values(s.villages).filter(v => v.owner === null).forEach(v => { if (have < n) { v.owner = owner; have++; } });
};

ok(E.newGame(0, 1, 'normal').race === false, 'nowa gra domyślnie bez wyścigu');
ok(E.newGame(0, 1, 'normal', 'small', true).race === true, 'nowa gra może mieć tryb Wyścig');

/* Spokojny: AI z celem nie wygrywa */
{
  const s = E.newGame(0, 2, 'normal', 'small', false);
  const ai = Object.keys(s.factions).find(i => i !== 'player');
  give(s, ai, E.winVillages(s));
  E.checkWin(s, ai, 0);
  ok(!s.ended, 'tryb Spokojny: AI z pełnym celem nie kończy gry');
}
/* Wyścig: ostrzeżenie i porażka */
{
  const s = E.newGame(0, 2, 'normal', 'small', true);
  const ai = Object.keys(s.factions).find(i => i !== 'player');
  const goal = E.winVillages(s);
  give(s, ai, Math.ceil(goal * C.RACE.warnShare));
  E.checkWin(s, ai, 5);
  ok(!s.ended && s.notices.some(n => /zbliża się do zwycięstwa/.test(n.text)), 'przy 80% celu gracz dostaje ostrzeżenie');
  const nn = s.notices.length; E.checkWin(s, ai, 6);
  ok(s.notices.length === nn, 'ostrzeżenie tylko raz na frakcję');
  give(s, ai, goal);
  E.checkWin(s, ai, 10);
  ok(s.ended && s.ended.type === 'defeat' && s.ended.by === ai, 'AI z celem wiosek wygrywa wyścig (porażka gracza)');
  const e0 = s.ended; give(s, 'player', goal); E.checkWin(s, 'player', 20);
  ok(s.ended === e0, 'po zakończeniu gry nic już jej nie zmienia');
}
/* Gracz wygrywa w obu trybach */
[false, true].forEach(race => {
  const s = E.newGame(0, 3, 'normal', 'small', race);
  give(s, 'player', E.winVillages(s)); E.checkWin(s, 'player', 1);
  ok(s.ended && s.ended.type === 'victory', 'gracz wygrywa po zdobyciu celu (race=' + race + ')');
});
/* Przełączenie w trakcie gry */
{
  const s = E.newGame(0, 4, 'normal', 'small', false);
  const ai = Object.keys(s.factions).find(i => i !== 'player');
  give(s, ai, E.winVillages(s));
  E.advance(s, H);
  ok(!s.ended, 'bez wyścigu AI z celem nie wygrywa w trakcie gry');
  s.race = true; E.checkWin(s, ai, s.now);
  ok(s.ended && s.ended.by === ai, 'włączenie wyścigu w trakcie gry działa od razu');
}
/* Limit wiosek: w wyścigu sufit sięga celu */
{
  const calm = E.newGame(0, 5, 'normal', 'huge', false), race = E.newGame(0, 5, 'normal', 'huge', true);
  const P = C.AI.personalities.expansionist;
  const cc = MP.AI.villageCap(calm, P, 1000 * H), cr = MP.AI.villageCap(race, P, 1000 * H);
  ok(cc === Math.ceil(E.winVillages(calm) * C.AI.growth.ceilingShare), 'Spokojny: sufit limitu = ' + cc);
  ok(cr === E.winVillages(race) && cr > cc, 'Wyścig: sufit limitu = cel zwycięstwa (' + cr + ')');
}
/* Zapis: stare zapisy bez pola race */
{
  const s = E.newGame(0, 6, 'normal'); delete s.race; delete s.raceWarn;
  const m = MP.DB.migrate(JSON.parse(JSON.stringify(s)));
  E.advance(m, H);
  ok(!m.race && !m.ended, 'zapis bez pola race działa jak tryb Spokojny');
}
/* Symulacja bez gracza: czy ktoś dochodzi do celu (tylko raport) */
{
  const s = E.newGame(0, 7, 'hard', 'small', true);
  const t0 = Date.now();
  let h = 0;
  while (!s.ended && h < 96) { h += 4; E.advance(s, h * H); }
  const top = Object.values(s.factions).filter(f => f.ai).map(f => E.villagesOf(s, f.id).length).sort((a, b) => b - a)[0];
  console.log('   symulacja (Trudny, Mała, cel ' + E.winVillages(s) + '): po ' + h + ' h ' + (s.ended ? s.ended.type + (s.ended.by ? ' przez ' + s.ended.by : '') : 'bez rozstrzygnięcia') + ', najlepsza frakcja ma ' + top + ' wiosek, ' + (Date.now() - t0) + ' ms');
}
if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy trybu Wyścig przeszły.');
