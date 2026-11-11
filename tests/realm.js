/* Test gałęzi technologii „Królestwo”: node tests/realm.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
function setup(seed, tech) {
  const s = E.newGame(0, seed, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  s.factions.player.tech = Object.assign({}, tech || {});
  const p = E.villagesOf(s, 'player')[0];
  E.tickVillage(s, p, 1);                       // przelicza efekty badań
  return { s, p };
}
const nearest = (s, p, pred) => Object.values(s.villages).filter(pred).sort((a, b) => E.dist(a, p) - E.dist(b, p))[0];

// koszty i struktura
const realm = C.TECH.nodes.filter(n => n.branch === 'realm');
ok(realm.length === 5 && realm.every(n => !n.req || realm.some(r => r.id === n.req.id)), 'Królestwo: 5 badań, wymagania w obrębie gałęzi (Fortyfikacje są w gałęzi Obrona)');
const cost = realm.reduce((a, n) => { let c = 0; for (let l = 1; l <= n.max; l++) c += Math.max(1, Math.round(n.base * Math.pow(n.factor, l - 1))); return a + c; }, 0);
ok(cost > 1500 && cost < 6000, 'koszt całej gałęzi: ' + cost + ' monet (późna gra)');
{ const { s } = setup(1); ok(E.techInfo(s, 'roads').code === 'req', 'Trakty wymagają Administracji'); }

// Administracja: dłuższe kolejki
{ const { p } = setup(2, { admin: 2 });
  ok(E.queueMax(p, 'build') === C.BUILD_QUEUE_MAX + 2 && E.queueMax(p, 'recruit') === C.RECRUIT_QUEUE_MAX + 2, 'Administracja 2: kolejki +2');
  const ai = { owner: 'ai1' }; ok(E.queueMax(ai, 'build') === C.BUILD_QUEUE_MAX, 'AI bez zmian'); }

// Trakty: szybszy marsz gracza, AI bez zmian
{ const a = setup(3), b = setup(3, { admin: 1, roads: 10 });
  const tgt = nearest(a.s, a.p, v => v.owner === null);
  const ra = E.sendAttack(a.s, a.p.id, tgt.id, { spear: 5 }, 10);
  const rb = E.sendAttack(b.s, b.p.id, tgt.id, { spear: 5 }, 10);
  const ta = ra.movement.arrive - 10, tb = rb.movement.arrive - 10;
  ok(Math.abs(tb / ta - 0.7) < 0.01, 'Trakty 10: marsz 70% czasu (' + ta + ' → ' + tb + ' ms)');
  ok(E.travelTime(a.p, tgt, { spear: 5 }, 'ai1') === E.travelTime(a.p, tgt, { spear: 5 }), 'Trakty nie przyspieszają AI'); }

// Lazaret: część poległych wraca
{ const { s, p } = setup(4, { admin: 1, medic: 10 });
  const tgt = nearest(s, p, v => v.owner && v.owner !== 'player');
  tgt.units.spear += 2000;                                    // atak na pewno przegrany
  p.units.axe = 100;
  const r = E.sendAttack(s, p.id, tgt.id, { axe: 100 }, 10);
  E.advance(s, r.movement.arrive + 1);
  const rep = s.reports.find(x => x.kind === 'attack');
  ok(rep && !rep.attackerWon && rep.healed === 30 && rep.attLoss.axe === 70, 'Lazaret 10: z 100 poległych 30 wraca');
  const back = s.movements.find(m => m.type === 'return' && m.owner === 'player');
  ok(back && back.units.axe === 30, 'ranni wracają do domu'); }

// Fortyfikacje: mocniejszy mur gracza
{ const a = setup(5), b = setup(5, { admin: 2, fort: 10 });
  a.p.buildings.wall = 10; b.p.buildings.wall = 10;
  const da = E.villageDefense(a.p, null, E.upgradesOf(a.s, 'player')), db = E.villageDefense(b.p, null, E.upgradesOf(b.s, 'player'));
  const W = C.BUILDINGS.wall.bonus[10];
  ok(Math.abs(db / da - (1 + W * 1.3) / (1 + W)) < 1e-9, 'Fortyfikacje 10: bonus muru ×1,3 (' + Math.round(da) + ' → ' + Math.round(db) + ')');
  ok(!E.upgradesOf(a.s, 'ai1') || !E.upgradesOf(a.s, 'ai1').__fort, 'AI bez Fortyfikacji'); }

// Dowództwo i Wiara: spadek poparcia
function loyaltyDrop(tech, attackerIsPlayer) {
  const { s, p } = setup(6, tech);
  if (attackerIsPlayer) {
    const tgt = nearest(s, p, v => v.owner && v.owner !== 'player');
    Object.keys(tgt.units).forEach(k => { tgt.units[k] = 0; });
    p.units.axe = 500; p.units.noble = 1;
    const r = E.sendAttack(s, p.id, tgt.id, { axe: 500, noble: 1 }, 10);
    E.advance(s, r.movement.arrive + 1);
    const rep = s.reports.find(x => x.kind === 'attack'); return rep.loyaltyBefore - rep.loyaltyAfter;
  }
  const ai = nearest(s, p, v => v.owner && v.owner !== 'player');
  Object.keys(p.units).forEach(k => { p.units[k] = 0; });
  ai.units.axe = 500; ai.units.noble = 1;
  const r = E.sendAttack(s, ai.id, p.id, { axe: 500, noble: 1 }, 10);
  E.advance(s, r.movement.arrive + 1);
  const rep = s.reports.find(x => x.kind === 'defense'); return rep.loyaltyBefore - rep.loyaltyAfter;
}
{ const d0 = loyaltyDrop({}, true), d1 = loyaltyDrop({ admin: 1, roads: 3, command: 5 }, true);
  ok(d1 - d0 === 15, 'Dowództwo 5: +15 p.p. spadku poparcia (' + d0 + ' → ' + d1 + ')');
  const f0 = loyaltyDrop({}, false), f1 = loyaltyDrop({ admin: 1, medic: 3, faith: 5 }, false);
  ok(f1 === Math.round(f0 * 0.6), 'Wiara 5: spadek poparcia Twojej wioski −40% (' + f0 + ' → ' + f1 + ')'); }

console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy Królestwa przeszły.');
process.exit(fails ? 1 : 0);
