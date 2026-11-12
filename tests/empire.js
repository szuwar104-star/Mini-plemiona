/* Test zarządzania wieloma wioskami i ulepszeń AI: node tests/empire.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
function setup(seed, n) {
  const s = E.newGame(0, seed, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const p = E.villagesOf(s, 'player')[0];
  const extra = Object.values(s.villages).filter(v => v.owner === null).sort((a, b) => E.dist(a, p) - E.dist(b, p)).slice(0, n || 3);
  extra.forEach(v => { v.owner = 'player'; v.units = E.emptyUnits(); });
  return { s, p, vs: E.villagesOf(s, 'player') };
}

// --- Buduj we wszystkich wioskach
{
  const { s, vs } = setup(31);
  vs.forEach(v => { v.res = { wood: 5000, clay: 5000, iron: 5000 }; });
  const before = JSON.stringify(vs.map(v => [v.res, v.buildQueue]));
  const plan = E.planBuildAll(s, E.templateItems('eco', 10), 1);
  ok(JSON.stringify(vs.map(v => [v.res, v.buildQueue])) === before, 'plan nie wydaje surowców');
  ok(plan.rows.length === vs.length && plan.total > 0, 'plan: ' + plan.total + ' budów w ' + vs.length + ' wioskach');
  ok(vs.every(v => v.buildQueue.length === 0), 'plan nie zmienia stanu gry');
  ok(plan.rows.every(r => r.items.length <= E.queueMax(s.villages[r.villageId], 'build')), 'plan mieści się w kolejkach');
  const r = E.buildAll(s, E.templateItems('eco', 10), 1);
  ok(r.ok && r.queued === plan.total, 'zakolejkowano ' + r.queued + ' budów');
  ok(vs.every(v => v.buildQueue.every(e => E.templateItems('eco', 10).some(([k]) => k === e.building))), 'tylko budynki z szablonu');
  // kolejność: najpierw budynek najdalej od celu
  const o = setup(37), w = o.p;
  Object.assign(w.buildings, { hq: 9, wood: 8, clay: 2, iron: 5, farm: 8 });
  w.res = { wood: 20000, clay: 20000, iron: 20000 };
  const po = E.planBuildAll(o.s, E.templateItems('eco', 10), 1).rows.find(r => r.villageId === w.id);
  ok(po.items[0].key === 'clay', 'najpierw najdalszy od celu (Cegielnia 2 z 10): ' + po.items.map(i => i.key + i.level).join(', '));
  // jeden budynek do poziomu
  const a = setup(32); a.vs.forEach(v => { v.res = { wood: 9000, clay: 9000, iron: 9000 }; v.buildings.wall = 0; });
  const rw = E.buildAll(a.s, [['wall', 2]], 1);
  ok(rw.ok && a.vs.every(v => v.buildQueue.filter(e => e.building === 'wall').length === 2), 'Mur do poz. 2: dwie budowy w każdej wiosce');
  const again = E.planBuildAll(a.s, [['wall', 2]], 1);
  ok(again.total === 0 && again.rows.every(r => r.skip), 'cel już zakolejkowany – nic więcej');
  // pominięte wioski i brak surowców
  const b = setup(33); b.vs.forEach(v => { v.res = { wood: 0, clay: 0, iron: 0 }; });
  const pb = E.planBuildAll(b.s, E.templateItems('all', 10), 1, { [b.vs[0].id]: true });
  ok(pb.total === 0 && pb.rows[0].skip && pb.rows.find(r => r.villageId === b.vs[0].id).off, 'brak surowców i pominięta wioska');
}

// --- Konwoje
{
  const { s, p, vs } = setup(34);
  vs.forEach(v => { v.buildings.market = 3; });
  const hub = p, src = vs.filter(v => v.id !== hub.id);
  const cap = E.storageCap(src[0]);
  src[0].res = { wood: cap, clay: cap, iron: cap };                    // pełny – odda
  src[1].res = { wood: Math.floor(cap * 0.3), clay: 0, iron: 0 };      // poniżej progu – nie odda
  hub.res = { wood: 0, clay: 0, iron: 0 };
  const r = E.setAuto(s, { on: true, hub: hub.id, high: 80, keep: 40, everyMin: 5, coins: false }, 0);
  ok(r.ok && s.auto.on && s.auto.next === 1000, 'konwoje włączone');
  E.advance(s, 2000);
  const tr = s.movements.filter(m => m.type === 'transport');
  ok(tr.length >= 1 && tr.every(m => m.to === hub.id), 'konwój wyruszył do wioski centralnej');
  ok(tr.every(m => m.from === src[0].id), 'wysłała tylko wioska z pełnym magazynem');
  ok(Math.floor(src[0].res.wood) >= Math.ceil(cap * 0.4) - 1, 'w wiosce zostało ok. 40% magazynu');
  ok(s.auto.last && s.auto.last.sent >= 1 && s.auto.next === 1000 + 5 * 60000, 'kolejny przegląd za 5 min');
  const arrive = Math.max.apply(null, tr.map(m => m.arrive));
  E.advance(s, arrive + 1);
  ok(hub.res.wood > 0, 'surowce dotarły do wioski centralnej');
  // monety
  const c = setup(35); c.vs.forEach(v => { v.buildings.market = 5; });
  c.p.res = { wood: 9000, clay: 100, iron: 100 };
  const coins0 = c.s.factions.player.coins || 0;
  E.setAuto(c.s, { on: true, hub: c.p.id, high: 80, keep: 40, everyMin: 5, coins: true }, 0);
  E.advance(c.s, 3 * 3600e3);
  ok((c.s.factions.player.coins || 0) > coins0, 'wioska centralna kupuje monety (' + (c.s.factions.player.coins || 0) + ')');
  // utrata wioski centralnej wyłącza konwoje
  const d = setup(36); E.setAuto(d.s, { on: true, hub: d.p.id, high: 80, keep: 40, everyMin: 5 }, 0);
  d.p.owner = 'ai1'; E.advance(d.s, 2000);
  ok(!d.s.auto.on, 'utrata wioski centralnej wyłącza konwoje');
  ok(!E.setAuto(d.s, { on: true, hub: d.p.id }, 0).ok, 'nie można ustawić cudzej wioski');
}

// --- Ulepszenia AI
{
  for (const [d, minL] of [['easy', 3], ['normal', 5], ['hard', 7]]) {
    const s = E.newGame(0, 7, d, 'small');
    E.advance(s, 6 * 3600e3);
    const f = Object.values(s.factions).find(x => x.ai && x.alive);
    const lv = Math.max.apply(null, Object.values(f.upgrades || { x: 0 }));
    ok(lv >= minL && lv <= C.AI.tech.max, d + ': AI po 6 h ma ulepszenia do poz. ' + lv);
  }
  const s = E.newGame(0, 8, 'normal', 'small');
  E.advance(s, 20 * 60000);
  ok(Object.values(s.factions).every(f => !f.ai || !f.upgrades || !Object.keys(f.upgrades).length), 'AI bez ulepszeń na starcie gry');
  E.advance(s, 30 * 3600e3);
  ok(Object.values(s.factions).every(f => !f.ai || !f.upgrades || Math.max.apply(null, Object.values(f.upgrades)) <= C.AI.tech.max), 'nie więcej niż maksimum');
}
console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy imperium przeszły.');
process.exit(fails ? 1 : 0);
