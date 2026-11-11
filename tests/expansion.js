/* Test limitu wiosek AI rosnącego z czasem: node tests/expansion.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG, H = 3600000;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const G = C.AI.growth;

// limit mierzymy pośrednio: frakcja poniżej limitu szkoli osadników/dowódców, powyżej – tylko grabi.
// Bezpośrednio: ten sam wzór co w ai.js
const cap = (s, P, hours, settle) => {
  const X = E.diff(s).aiExpand;
  const base = Math.ceil((settle ? (P.settleMax || P.maxVillages) : P.maxVillages) * X);
  const bonus = Math.round(Math.floor(hours / G.everyHours) * G.perStep * X);
  return Math.max(base, Math.min(base + bonus, Math.ceil(E.winVillages(s) * G.ceilingShare)));
};
{
  const s = E.newGame(0, 5, 'normal', 'huge');
  const P = C.AI.personalities.economic;
  ok(cap(s, P, 0) === Math.ceil(P.maxVillages * E.diff(s).aiExpand), 'start: limit = bazowy');
  ok(cap(s, P, 12) > cap(s, P, 0), 'po 12 h limit jest wyższy');
  ok(cap(s, P, 1000) === Math.ceil(E.winVillages(s) * G.ceilingShare), 'limit nie przekracza ' + G.ceilingShare * 100 + '% celu zwycięstwa (' + cap(s, P, 1000) + ')');
  const small = E.newGame(0, 5, 'hard', 'small');
  const A = C.AI.personalities.expansionist;
  ok(cap(small, A, 1000) >= Math.ceil(A.maxVillages * E.diff(small).aiExpand), 'limit nigdy nie spada poniżej bazowego');
}

// symulacja: na świecie Średnim po 24 h frakcje mają średnio więcej wiosek niż bazowy limit
{
  const s = E.newGame(0, 1, 'normal', 'medium');
  E.advance(s, 24 * H);
  const per = {};
  Object.values(s.villages).forEach(v => { if (v.owner && v.owner !== 'player') per[v.owner] = (per[v.owner] || 0) + 1; });
  const arr = Object.values(per), avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const baseAvg = Object.keys(per).reduce((a, id) => a + Math.ceil(C.AI.personalities[s.factions[id].personality].maxVillages * E.diff(s).aiExpand), 0) / arr.length;
  console.log('   średnio wiosek na frakcję po 24 h: ' + avg.toFixed(1) + ' (bazowy limit średnio ' + baseAvg.toFixed(1) + ')');
  ok(avg > baseAvg, 'po 24 h AI ma średnio więcej wiosek niż bazowy limit');
  ok(Math.max.apply(null, arr) <= Math.ceil(E.winVillages(s) * G.ceilingShare) + 3, 'żadna frakcja nie przebija sufitu o więcej niż kilka wiosek (zdobycze od innych)');
}
if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy ekspansji AI przeszły.');
