/* Test doganiania lidera przez AI i wygaszania strefy gracza: node tests/catchup.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG, H = 3600000;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const grow = (s, n) => { // oddaje graczowi n wolnych wiosek (jak po podbojach)
  const free = Object.values(s.villages).filter(v => !v.owner).slice(0, n);
  free.forEach(v => { v.owner = 'player'; });
};

{
  const s = E.newGame(0, 3, 'normal', 'huge');
  const P = C.AI.personalities.economic;
  const t = s.created + 2 * H;
  const before = MP.AI.villageCap(s, P, t, true);
  grow(s, 17);
  const t2 = t + 1000; // inny moment = świeże zliczenie (cache jest na moment)
  const after = MP.AI.villageCap(s, P, t2, true);
  ok(after > before, 'limit rośnie, gdy gracz ma dużo wiosek (' + before + ' → ' + after + ')');
  const want = Math.min(Math.ceil(E.winVillages(s) * C.AI.growth.ceilingShare), Math.ceil(E.villagesOf(s, 'player').length * E.diff(s).aiCatchUp));
  ok(after >= want, 'limit ≥ ' + E.diff(s).aiCatchUp + ' × wioski lidera (' + after + ' ≥ ' + want + ')');
  grow(s, 100);
  ok(MP.AI.villageCap(s, P, t2 + 1000, true) <= Math.ceil(E.winVillages(s) * C.AI.growth.ceilingShare), 'doganianie nie przebija sufitu świata');
}
{
  const s = E.newGame(0, 3, 'easy', 'small');
  const z0 = MP.AI.playerZoneNow(s, s.created), zH = MP.AI.playerZoneNow(s, s.created + C.AI.growth.zoneFadeHours * H);
  ok(z0 === E.diff(s).playerZone, 'na starcie strefa = pełna (' + z0 + ')');
  ok(zH === 0, 'po ' + C.AI.growth.zoneFadeHours + ' h strefa znika');
}
if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy doganiania AI przeszły.');
