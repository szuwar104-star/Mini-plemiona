/* Test podboju: zdobywcy zostają w przejętej wiosce, kolejne fale zawracają. node tests/conquest.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

function setup(seed) {
  const s = E.newGame(0, seed, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const p = E.villagesOf(s, 'player')[0];
  p.units.axe = 400; p.units.light = 80; p.units.noble = 2;
  return { s, p };
}

// 1. Wolna osada: wojsko zostaje, surowce zostają, brak powrotu
{
  const { s, p } = setup(21);
  const n = Object.values(s.villages).filter(v => v.owner === null).sort((a, b) => E.dist(a, p) - E.dist(b, p))[0];
  n.res = { wood: 500, clay: 500, iron: 500 };
  const r1 = E.sendAttack(s, p.id, n.id, { axe: 200, light: 40 }, 0);
  const r2 = E.sendAttack(s, p.id, n.id, { axe: 100 }, 30e3); // druga fala, później
  E.advance(s, r1.movement.arrive + 1);
  const rep = s.reports.find(x => x.kind === 'attack');
  ok(n.owner === 'player' && rep.conquered, 'osada przejęta');
  ok(rep.stayed > 0 && E.sumUnits(n.units) === rep.stayed, 'ocalali (' + rep.stayed + ') zostali w przejętej wiosce');
  ok(!s.movements.some(m => m.type === 'return' && m.to === n.id && !m.bounced), 'zdobywcy nie wracają do domu');
  ok(n.res.wood >= 500 && rep.loot.wood === 0, 'surowce zostały w przejętej wiosce');
  // 2. druga fala dociera do już własnej wioski i zawraca
  E.advance(s, r2.movement.arrive + 1);
  const back = s.movements.find(m => m.bounced);
  ok(back && back.from === p.id && back.units.axe === 100, 'druga fala zawraca do wioski macierzystej');
  ok(E.sumUnits(n.units) === rep.stayed, 'druga fala nie wzmocniła przejętej wioski');
  const before = p.units.axe;
  E.advance(s, back.arrive + 1);
  ok(p.units.axe === before + 100, 'zawrócone wojsko wróciło do domu');
}
// 3. Wioska frakcji zdobyta Dowódcą: wojsko zostaje (bez zużytego dowódcy)
{
  const { s, p } = setup(22);
  const ai = Object.values(s.villages).filter(v => v.owner && v.owner !== 'player').sort((a, b) => E.dist(a, p) - E.dist(b, p))[0];
  ai.loyalty = 10;
  const r = E.sendAttack(s, p.id, ai.id, { axe: 400, light: 80, noble: 2 }, 0);
  E.advance(s, r.movement.arrive + 1);
  const rep = s.reports.find(x => x.kind === 'attack');
  ok(ai.owner === 'player', 'wioska frakcji przejęta');
  ok(ai.units.noble === 1, 'drugi dowódca został w wiosce (pierwszy zużyty na podbój)');
  ok(rep.stayed === E.sumUnits(ai.units) && !s.movements.some(m => m.type === 'return' && m.owner === 'player'), 'cała ocalała armia została w przejętej wiosce');
}
// 4. Bez podboju (wygrana, poparcie > 0) wojsko normalnie wraca z łupem
{
  const { s, p } = setup(23);
  const ai = Object.values(s.villages).filter(v => v.owner && v.owner !== 'player').sort((a, b) => E.dist(a, p) - E.dist(b, p))[0];
  const r = E.sendAttack(s, p.id, ai.id, { axe: 400, light: 80 }, 0);
  E.advance(s, r.movement.arrive + 1);
  ok(ai.owner !== 'player' && s.movements.some(m => m.type === 'return' && m.owner === 'player' && !m.bounced), 'zwykła wygrana – wojsko wraca');
}
console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy podboju przeszły.');
process.exit(fails ? 1 : 0);
