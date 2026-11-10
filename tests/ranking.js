/* Test punktów za zniszczone jednostki i rankingu: node tests/ranking.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, DB = MP.DB;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

/* ---------- start ---------- */
const s = E.newGame(0, 11, 'normal');
ok(Object.values(s.factions).every(f => f.killsAtt === 0 && f.killsDef === 0 && f.killUnits === 0), 'nowa gra: wszystkie frakcje mają 0 pokonanych');
let rk = E.ranking(s, 'kills');
ok(rk.length === Object.keys(s.factions).length && rk.every((r, i) => r.rank === i + 1), 'ranking zawiera każdą frakcję, miejsca 1..N');

/* ---------- wygrany atak: punkty dla atakującego ---------- */
function setup(seed) {
  const st = E.newGame(0, seed, 'normal');
  const att = E.villagesOf(st, 'player')[0];
  const def = Object.values(st.villages).find(x => x.owner === null);
  def.units = Object.assign(E.emptyUnits(), { spear: 10 }); def.buildings.wall = 0; def.res = { wood: 0, clay: 0, iron: 0 };
  return { st, att, def };
}
{
  const { st, att, def } = setup(11);
  att.units = Object.assign(E.emptyUnits(), { axe: 100 });
  const sent = Object.assign({}, att.units);
  E.sendAttack(st, att.id, def.id, sent, 0);
  E.advance(st, E.travelTime(att, def, sent) + 1000);
  const rep = st.reports[0];
  const expect = E.unitPoints({ spear: 10 });          // wszyscy obrońcy polegli
  ok(rep.attackerWon && near(E.killsOf(st, 'player').att, expect), 'wygrany atak: ' + E.killsOf(st, 'player').att.toFixed(2) + ' pkt za 10 pikinierów (= ' + expect.toFixed(2) + ')');
  ok(near(rep.killPts.att, expect), 'raport zawiera punkty za pokonanych (' + rep.killPts.att.toFixed(2) + ')');
  ok(E.killsOf(st, 'player').def === 0, 'atakujący nie dostaje punktów za obronę');
  ok(E.killsOf(st, 'player').units === 10, 'licznik pokonanych jednostek = 10');
  ok(rep.killPts.def === 0 && E.killsOf(st, null).total === 0, 'wolna osada jako obrońca nie zbiera punktów (nie ma frakcji w rankingu)');
}

/* ---------- przegrany atak: punkty dla obrońcy (frakcji) ---------- */
{
  const st = E.newGame(0, 21, 'normal');
  const att = E.villagesOf(st, 'player')[0];
  const aiV = Object.values(st.villages).find(x => x.owner && x.owner !== 'player');
  aiV.units = Object.assign(E.emptyUnits(), { spear: 300 });
  att.units = Object.assign(E.emptyUnits(), { axe: 12 });
  const lossBefore = 12;
  const sent = Object.assign({}, att.units);
  E.sendAttack(st, att.id, aiV.id, sent, 0);
  E.advance(st, E.travelTime(att, aiV, sent) + 1000);
  const rep = st.reports[0];
  const fd = E.killsOf(st, aiV.owner);
  ok(!rep.attackerWon && near(fd.def, E.unitPoints({ axe: lossBefore })), 'przegrany atak: obrońca ' + aiV.owner + ' dostaje ' + fd.def.toFixed(2) + ' pkt za 12 toporników');
  ok(fd.att === 0 && E.killsOf(st, 'player').total > 0 === (rep.killPts.att > 0), 'punkty atakującego tylko za faktycznie zabitych obrońców');
  const top = E.ranking(st, 'kills')[0];
  ok(top.id === aiV.owner, 'ranking „Pokonani”: lider to ' + top.name + ' (obrońca)');
}

/* ---------- nieudany zwiad ---------- */
{
  const st = E.newGame(0, 31, 'normal');
  const att = E.villagesOf(st, 'player')[0];
  const aiV = Object.values(st.villages).find(x => x.owner && x.owner !== 'player');
  aiV.units = Object.assign(E.emptyUnits(), { scout: 20 });
  att.units = Object.assign(E.emptyUnits(), { scout: 3 });
  E.sendSpy(st, att.id, aiV.id, 3, 0);
  E.advance(st, E.travelTime(att, aiV, { scout: 3 }) + 1000);
  ok(near(E.killsOf(st, aiV.owner).def, E.unitPoints({ scout: 3 })), 'nieudany zwiad: obrońca dostaje punkty za 3 zwiadowców');
}

/* ---------- sortowanie rankingu ---------- */
{
  const st = E.newGame(0, 41, 'normal');
  const ids = Object.keys(st.factions);
  st.factions[ids[1]].killsAtt = 500; st.factions[ids[2]].killsDef = 900; st.factions[ids[0]].killsAtt = 100;
  const byK = E.ranking(st, 'kills');
  ok(byK[0].id === ids[2] && byK[1].id === ids[1] && byK[2].id === ids[0], 'sortowanie „Pokonani” (atak + obrona)');
  const byV = E.ranking(st, 'villages'), byB = E.ranking(st, 'buildings');
  ok(byV.every((r, i) => i === 0 || byV[i - 1].villages >= r.villages), 'sortowanie „Wioski” malejąco');
  ok(byB.every((r, i) => i === 0 || byB[i - 1].buildings >= r.buildings), 'sortowanie „Budynki” malejąco');
  ok(!('attack' in byK[0]) && !('army' in byK[0]) && !('units' in byK[0]), 'ranking nie zdradza siły wojska frakcji');
}

/* ---------- migracja starego zapisu ---------- */
{
  const old = JSON.parse(JSON.stringify(E.newGame(0, 51, 'normal')));
  Object.values(old.factions).forEach(f => { delete f.killsAtt; delete f.killsDef; delete f.killUnits; });
  old.version = 5;
  const m = DB.migrate(old);
  ok(m.version === C.SAVE_VERSION && Object.values(m.factions).every(f => f.killsAtt === 0 && f.killsDef === 0 && f.killUnits === 0), 'zapis v5 bez rankingu: liczniki = 0, wersja ' + m.version);
  ok(E.ranking(m, 'kills').every(r => Number.isFinite(r.kills)), 'ranking po migracji bez NaN');
  const cur = JSON.parse(JSON.stringify(E.newGame(0, 52, 'normal')));
  delete Object.values(cur.factions)[0].killsAtt;
  ok(Number.isFinite(E.killsOf(DB.migrate(cur), Object.keys(cur.factions)[0]).total), 'zapis w aktualnej wersji z brakującym licznikiem: brak NaN');
}

/* ---------- symulacja: AI zbiera punkty ---------- */
{
  const st = E.newGame(0, 99, 'hard', 'small');
  E.advance(st, 12 * 3600 * 1000);
  const rows = E.ranking(st, 'kills');
  ok(rows.every(r => Number.isFinite(r.kills) && r.kills >= 0 && r.killsAtt >= 0 && r.killsDef >= 0), 'symulacja 12 h: liczniki skończone i nieujemne');
  ok(rows.filter(r => r.kills > 0).length >= 2, 'po 12 h co najmniej dwie frakcje mają punkty za pokonanych (' + rows.map(r => Math.round(r.kills)).join(', ') + ')');
}

console.log(fails ? '\nNIEPOWODZENIE: ' + fails : '\nWszystkie testy rankingu przeszły.');
process.exit(fails ? 1 : 0);
