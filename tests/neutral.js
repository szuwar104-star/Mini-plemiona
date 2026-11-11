/* Test wolnych osad: podbój w kilku atakach i samodzielny rozwój. node tests/neutral.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG, N = C.NEUTRAL;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
function setup(seed) {
  const s = E.newGame(0, seed, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const p = E.villagesOf(s, 'player')[0];
  const n = Object.values(s.villages).filter(v => v.owner === null).sort((a, b) => E.dist(a, p) - E.dist(b, p))[0];
  p.units.axe = 2000; p.units.light = 200; p.units.noble = 1;
  return { s, p, n };
}
function hit(s, p, n, units, t) {
  const r = E.sendAttack(s, p.id, n.id, units, t);
  E.advance(s, r.movement.arrive + 1);
  return s.reports.find(x => x.kind === 'attack');
}

// 1. Podbój w kilku atakach
{
  const { s, p, n } = setup(41);
  const r1 = hit(s, p, n, { axe: 300 }, 0);
  ok(r1.attackerWon && !r1.conquered && n.owner === null, 'pierwsza wygrana nie przejmuje osady');
  const d1 = r1.loyaltyBefore - r1.loyaltyAfter;
  ok(d1 >= N.dropMin && d1 <= N.dropMax, 'poparcie spadło o ' + d1 + ' (' + N.dropMin + '–' + N.dropMax + ')');
  let k = 1;
  while (n.owner === null && k < 6) { hit(s, p, n, { axe: 300 }, s.now); k++; }
  ok(n.owner === 'player' && k >= 2 && k <= 3, 'osada przejęta po ' + k + ' wygranych');
}
// 2. Z Dowódcą szybciej (bez zużycia dowódcy)
{
  const { s, p, n } = setup(42);
  const r = hit(s, p, n, { axe: 300, noble: 1 }, 0);
  const d = r.loyaltyBefore - (r.loyaltyAfter || 0);
  ok(d >= N.dropMin + C.LOYALTY.dropMin, 'z Dowódcą spadek ' + d + ' p.p.');
}
// 3. Grabież nie rusza poparcia
{
  const { s, p, n } = setup(43);
  const r = E.sendAttack(s, p.id, n.id, { axe: 300 }, 0, 'attack', { raid: true });
  E.advance(s, r.movement.arrive + 1);
  ok(n.loyalty === C.LOYALTY.max, 'grabież nie obniża poparcia');
}
// 4. Poparcie wolnej osady się odnawia
{
  const { s, p, n } = setup(44);
  hit(s, p, n, { axe: 300 }, 0);
  const low = n.loyalty;
  E.advance(s, s.now + 30 * 60000); E.tickVillage(s, n, s.now);
  ok(n.loyalty > low && n.loyalty - low <= 8, 'poparcie odnawia się wolno (' + Math.floor(low) + ' → ' + Math.floor(n.loyalty) + ' po 30 min)');
}
// 5. Rozwój wolnych osad
{
  const s = E.newGame(0, 45, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const n = Object.values(s.villages).find(v => v.owner === null);
  const pts0 = E.points(n), g0 = E.sumUnits(n.garrison), prod0 = E.productionPerMin(n).wood;
  E.advance(s, 10 * 3600e3); E.tickVillage(s, n, s.now);
  ok(E.points(n) === pts0 + 10, 'po 10 h osada ma +10 poziomów (' + pts0 + ' → ' + E.points(n) + ')');
  ok(E.sumUnits(n.garrison) > g0, 'stała załoga urosła (' + g0 + ' → ' + E.sumUnits(n.garrison) + ')');
  ok(E.productionPerMin(n).wood >= prod0, 'produkcja nie spadła');
  ok(Object.keys(N.growMax).every(k => n.buildings[k] <= N.growMax[k]) && n.buildings.barracks === 0 && n.buildings.market === 0, 'limity rozwoju respektowane');
  E.advance(s, 200 * 3600e3); E.tickVillage(s, n, s.now);
  ok(Object.keys(N.growMax).every(k => n.buildings[k] === N.growMax[k]), 'po bardzo długim czasie wszystko na limicie');
  // wynik niezależny od liczby kroków
  const a = E.newGame(0, 46, 'normal', 'small'), b = E.newGame(0, 46, 'normal', 'small');
  [a, b].forEach(x => Object.values(x.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; }));
  const na = Object.values(a.villages).find(v => v.owner === null), nb = b.villages[na.id];
  E.tickVillage(a, na, 5 * 3600e3 + 777);
  for (let t = 7e5; t < 5 * 3600e3; t += 7e5) E.tickVillage(b, nb, t);
  E.tickVillage(b, nb, 5 * 3600e3 + 777);
  ok(JSON.stringify([na.res, na.buildings, na.units]) === JSON.stringify([nb.res, nb.buildings, nb.units]), 'rozwój i produkcja identyczne przy jednym skoku i wielu krokach');
  // przejęta osada przestaje się rozwijać sama
  n.owner = null; n.loyalty = 1;
}
{
  const { s, p, n } = setup(47);
  n.loyalty = 5; hit(s, p, n, { axe: 300 }, 0);
  ok(n.owner === 'player' && !n.growNext && !n.garrison, 'po przejęciu koniec samodzielnego rozwoju');
}
console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy wolnych osad przeszły.');
process.exit(fails ? 1 : 0);
