/* Test najazdów łupieżczych na wolne osady: node tests/raid.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

function setup(seed) {
  const s = E.newGame(0, seed, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; }); // AI nie przeszkadza w teście
  const p = E.villagesOf(s, 'player')[0];
  const n = Object.values(s.villages).filter(v => v.owner === null).sort((a, b) => E.dist(a, p) - E.dist(b, p))[0];
  p.units.axe = 300; p.units.light = 60;
  n.res = { wood: 900, clay: 800, iron: 500 };
  return { s, p, n };
}

// 1. Grabież: wygrana, łup, osada zostaje wolna, załoga wybita
{
  const { s, p, n } = setup(11);
  const garrison = E.sumUnits(n.garrison);
  ok(garrison > 0, 'wolna osada ma stałą załogę (' + garrison + ')');
  const r = E.sendAttack(s, p.id, n.id, { axe: 300, light: 60 }, 0, 'attack', { raid: true });
  ok(r.ok && r.movement.raid === true, 'rozkaz grabieży ma znacznik raid');
  E.advance(s, r.movement.arrive + 1);
  const rep = s.reports.find(x => x.kind === 'attack');
  ok(rep && rep.raid && rep.attackerWon, 'raport: udana grabież');
  ok(n.owner === null, 'osada po grabieży nadal wolna');
  ok(rep.loot.wood + rep.loot.clay + rep.loot.iron > 0, 'jest łup: ' + JSON.stringify(rep.loot));
  ok(E.sumUnits(n.units) === 0, 'załoga wybita');
  // 2. odradzanie: po 2 h ~50% załogi, po 6 h pełna, nigdy ponad bazę
  E.advance(s, r.movement.arrive + 2 * 3600e3); E.tickVillage(s, n, s.now);
  const half = E.sumUnits(n.units);
  ok(half > 0 && half < garrison, 'po 2 h załoga częściowo odrodzona (' + half + '/' + garrison + ')');
  E.advance(s, r.movement.arrive + 8 * 3600e3); E.tickVillage(s, n, s.now);
  ok(E.sumUnits(n.units) === garrison, 'po 8 h pełna załoga, nie więcej (' + E.sumUnits(n.units) + ')');
  // 3. odradzanie niezależne od liczby kroków (jeden skok vs. wiele)
  const a = setup(12), b = setup(12);
  const ra = E.sendAttack(a.s, a.p.id, a.n.id, { axe: 300 }, 0, 'attack', { raid: true });
  E.sendAttack(b.s, b.p.id, b.n.id, { axe: 300 }, 0, 'attack', { raid: true });
  E.advance(a.s, ra.movement.arrive + 3 * 3600e3); E.tickVillage(a.s, a.n, a.s.now);
  for (let t = 60e3; t <= ra.movement.arrive + 3 * 3600e3; t += 60e3) { E.advance(b.s, t); E.tickVillage(b.s, b.n, t); }
  ok(JSON.stringify(a.n.units) === JSON.stringify(b.n.units), 'odradzanie identyczne przy jednym skoku i krokach co minutę');
}
// 4. Zwykły atak nadal przejmuje wolną osadę
{
  const { s, p, n } = setup(13);
  const r = E.sendAttack(s, p.id, n.id, { axe: 300, light: 60 }, 0);
  E.advance(s, r.movement.arrive + 1);
  ok(n.owner === 'player', 'zwykły atak przejmuje wolną osadę');
  ok(!n.garrison, 'przejęta osada nie ma już stałej załogi');
}
// 5. Znacznik raid ignorowany dla wioski frakcji
{
  const { s, p } = setup(14);
  const ai = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
  const r = E.sendAttack(s, p.id, ai.id, { axe: 10 }, 0, 'attack', { raid: true });
  ok(r.ok && !r.movement.raid, 'grabież tylko na wolne osady');
}
// 6. Stary zapis bez garrison: baza = obecna załoga
{
  const { s, n } = setup(15);
  delete n.garrison; const before = E.sumUnits(n.units);
  E.tickVillage(s, n, 60e3);
  ok(n.garrison && E.sumUnits(n.garrison) === before, 'stary zapis: załoga bazowa uzupełniona przy pierwszym liczeniu');
}
// 7. AI po osiągnięciu limitu wiosek grabi wolne osady zamiast je pomijać
{
  const s = E.newGame(0, 3, 'hard', 'small');
  let raids = 0; const o = E.sendAttack;
  E.sendAttack = function (st, f, t2, u, t, type, opts) { const r = o.apply(this, arguments); if (r.ok && r.movement.raid) raids++; return r; };
  E.advance(s, 8 * 3600e3);
  E.sendAttack = o;
  ok(raids > 0, 'AI wysłało ' + raids + ' grabieży w 8 h (poziom Trudny)');
}
console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy grabieży przeszły.');
process.exit(fails ? 1 : 0);
