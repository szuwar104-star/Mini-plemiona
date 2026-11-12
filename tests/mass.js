/* Test zmasowanych uderzeń AI i Autopilota: node tests/mass.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../diplomacy.js'); require('../pilot.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const MIN = 60000, T = 600 * MIN;
function clone(s, base, id, dx, dy, owner) {
  const v = JSON.parse(JSON.stringify(base));
  Object.assign(v, { id, name: id, x: base.x + dx, y: base.y + dy, owner, lastTick: T, buildQueue: [], recruitQueue: [], support: {}, loyalty: 100 });
  s.villages[id] = v; return v;
}
function scene(owner, foeOwner) {
  const s = E.newGame(0, 11, 'hard', 'small');
  s.race = false; s.now = T; s.aiTrade = false;
  s.movements = [];
  // wolna przestrzeń: usuwamy cudze wioski poza dwiema stronami
  const att = foeOwner === 'player' ? Object.keys(s.factions).find(f => s.factions[f].ai) : owner;
  const base = E.villagesOf(s, att)[0];
  for (const id of Object.keys(s.villages)) { const o = s.villages[id].owner; if (o !== null && s.villages[id] !== base) delete s.villages[id]; }
  return { s, base, att };
}

// --- AI: kilka wiosek z armią uderza jedną falą w silnie bronioną wioskę gracza ---
{
  const { s, base, att } = scene('ai', 'player');
  const army = { axe: 3500, light: 300, spear: 600, archer: 200, guard: 100, ram: 20 };
  const vs = [base, clone(s, base, 'a2', 3, 0, att), clone(s, base, 'a3', 0, 5, att), clone(s, base, 'a4', -6, 2, att)];
  vs.forEach(v => { v.buildings.hq = 15; v.buildings.wall = 3; v.buildings.farm = 20; v.buildings.barracks = 15; Object.assign(v.units, army); v.res = { wood: 0, clay: 0, iron: 0 }; });
  const tgt = clone(s, base, 'p1', 8, 3, 'player');
  tgt.buildings.wall = 5; Object.assign(tgt.units, { guard: 1200, spear: 800 });
  s.factions.player.upgrades = {};
  const P = C.AI.personalities[s.factions[att].personality];
  let guard = 0;
  while (!s.movements.some(m => m.type === 'attack' && m.owner === att) && guard++ < 400) { MP.AI.think(s, att, T + guard * 20000); }
  const t1 = T + guard * 20000;
  for (let i = 0; i < 40; i++) MP.AI.think(s, att, t1 + i * 5000);   // opóźnione oddziały dołączają
  const wave = s.movements.filter(m => m.type === 'attack' && m.owner === att && m.to === 'p1');
  const total = wave.reduce((n, m) => n + E.sumUnits(m.units), 0);
  ok(wave.length >= 2, 'AI posyła uderzenie z kilku wiosek naraz (fale: ' + wave.length + ')');
  ok(total >= C.AI.mass.minUnits, 'uderzenie ma co najmniej ' + C.AI.mass.minUnits + ' żołnierzy (jest ' + total + ')');
  const arr = wave.map(m => m.arrive);
  ok(Math.max.apply(null, arr) - Math.min.apply(null, arr) <= 60000, 'wszystkie fale dochodzą w ciągu minuty (rozrzut ' + (Math.max.apply(null, arr) - Math.min.apply(null, arr)) + ' ms)');
  ok(!(s.aiPending || []).length, 'po wysłaniu nie zostają opóźnione oddziały');
}

// --- AI: za mało żołnierzy na uderzenie (poniżej minUnits) – brak zmasowanego uderzenia ---
{
  const { s, base, att } = scene('ai', 'player');
  const vs = [base, clone(s, base, 'a2', 3, 0, att)];
  vs.forEach(v => { v.buildings.farm = 20; Object.assign(v.units, { axe: 300, spear: 200 }); });
  clone(s, base, 'p1', 8, 3, 'player').units.spear = 10;
  for (let i = 0; i < 100; i++) MP.AI.think(s, att, T + i * 20000);
  ok(!(s.aiMass && s.aiMass[att]), 'armia poniżej minUnits nie robi zmasowanego uderzenia');
}

// --- Autopilot: uderzenie z kilku wiosek ofensywnych (massMin) ---
{
  const s = E.newGame(0, 21, 'normal', 'small');
  s.now = T; s.movements = []; s.race = false;
  const base = E.villagesOf(s, 'player')[0];
  const foe = Object.keys(s.factions).find(f => s.factions[f].ai);
  for (const id of Object.keys(s.villages)) { const v = s.villages[id]; if (v.owner !== null && v !== base) delete s.villages[id]; }
  const mine = [base, clone(s, base, 'm2', 2, 1, 'player'), clone(s, base, 'm3', -2, 2, 'player')];
  mine.forEach(v => { v.buildings.hq = 15; v.buildings.farm = 25; v.buildings.barracks = 15; v.buildings.wall = 10; Object.assign(v.units, { axe: 4000, light: 200, ram: 30, scout: 20, noble: 1, guard: 600 }); });
  const enemy = clone(s, base, 'e1', 6, 2, foe);
  enemy.buildings.wall = 6; Object.assign(enemy.units, { spear: 900, archer: 300, guard: 300 });
  s.intel = s.intel || {};
  s.intel.e1 = { time: T, owner: foe, units: Object.assign(E.emptyUnits(), enemy.units), res: { wood: 0, clay: 0, iron: 0 }, buildings: Object.assign({}, enemy.buildings), loyalty: 100 };
  const r = MP.Pilot.configure(s, { on: true, attack: true, massMin: 10000, tickSec: 15 }, T);
  ok(r.ok, 'Autopilot przyjmuje ustawienie massMin');
  ok(s.pilot.massMin === 10000, 'massMin zapisane w ustawieniach Autopilota');
  const sent = [], orig = E.sendAttack;                                       // rejestr wysłanych fal (dojście kończy się w czasie symulacji)
  E.sendAttack = function (st, from, to, units, tt, type) { const r2 = orig.apply(this, arguments); if (r2.ok && type === 'attack' && to === 'e1') sent.push(r2.movement); return r2; };
  E.advance(s, T + 5 * MIN);                                                    // silnik sam woła Autopilota i wysyła opóźnione fale
  E.sendAttack = orig;
  const w = sent.filter(m => m.owner === 'player');
  const total = w.reduce((n, m) => n + E.sumUnits(m.units), 0);
  ok(w.length >= 2, 'Autopilot uderza z kilku wiosek naraz (fale: ' + w.length + ')');
  ok(total >= 10000, 'zmasowane uderzenie Autopilota ma ≥ 10 000 żołnierzy (jest ' + total + ')');
  ok(w.reduce((n, m) => n + (m.units.noble || 0), 0) >= 1, 'uderzenie niesie Dowódcę podboju');
  const arr = w.map(m => m.arrive);
  ok(Math.max.apply(null, arr) - Math.min.apply(null, arr) <= 60000, 'fale dochodzą razem (rozrzut ' + (Math.max.apply(null, arr) - Math.min.apply(null, arr)) + ' ms)');
}

// --- Autopilot: massMin = 0 wyłącza zmasowane uderzenia (stare zachowanie) ---
{
  const s = E.newGame(0, 21, 'normal', 'small');
  const r = MP.Pilot.configure(s, { on: true, attack: true, massMin: 0 }, 0);
  ok(r.ok && s.pilot.massMin === 0, 'massMin 0 = zwykłe fale');
}

if (fails) { console.error('\nNIEPOWODZENIA: ' + fails); process.exit(1); } else console.log('\nWszystkie testy zmasowanych uderzeń przeszły.');
