/* Test fazy ekonomicznej Autopilota (szybki start): node tests/eco.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js'); require('../pilot.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };
const T0 = 1700000000000, MIN = 60000, HOUR = 3600000;
const mk = (seed, diff) => E.newGame(T0, seed || 4242, diff || 'normal', 'small');
const mine = s => E.villagesOf(s, 'player');
const prodLevels = s => mine(s).reduce((a, v) => a + v.buildings.wood + v.buildings.clay + v.buildings.iron, 0);
const wallLevels = s => mine(s).reduce((a, v) => a + (v.buildings.wall || 0), 0);
const logHas = (s, re) => (s.pilot.log || []).some(l => re.test(l.text));

// 1. Faza startuje od pierwszej wioski, wpis w dzienniku, a ustawienie jest domyślnie włączone
{
  ok(C.PILOT.defaults.eco === true, 'faza ekonomiczna jest domyślnie włączona');
  const s = mk(); MP.Pilot.configure(s, { on: true }, T0); E.advance(s, T0 + 5 * MIN);
  ok(s.pilot.ecoNow === true, 'faza ekonomiczna trwa od pierwszej wioski');
  ok(logHas(s, /Faza ekonomiczna: start/), 'dziennik bota zapisuje start fazy');
}

// 2. Gospodarka przed wojskiem: więcej surowców i mniej muru niż bez fazy, przy tych samych godzinach gry
{
  const a = mk(); MP.Pilot.configure(a, { on: true, eco: true }, T0); E.advance(a, T0 + 4 * HOUR);
  const b = mk(); MP.Pilot.configure(b, { on: true, eco: false }, T0); E.advance(b, T0 + 4 * HOUR);
  ok(prodLevels(a) > prodLevels(b), 'więcej poziomów budynków surowcowych z fazą (' + prodLevels(a) + ' vs ' + prodLevels(b) + ' bez)');
  ok(mine(a).length > mine(b).length, 'więcej wiosek z fazą (' + mine(a).length + ' vs ' + mine(b).length + ' bez) – także przy wyłączonej opcji Osadnicy');
  ok(a.pilot.stats.settled > 0, 'osadnicy zakładają wioski mimo wyłączonej opcji Nowe wioski');
  ok(b.pilot.ecoNow === false && !logHas(b, /Faza ekonomiczna/), 'z wyłączoną opcją bot działa po staremu (bez wpisów o fazie)');
}

// 3. Faza kończy się po osiągnięciu limitu wiosek i nie przekracza go bez opcji Nowe wioski
{
  const s = mk(5); MP.Pilot.configure(s, { on: true }, T0); E.advance(s, T0 + 8 * HOUR);
  ok(mine(s).length <= C.PILOT.eco.villages, 'bez opcji Nowe wioski bot nie zakłada więcej niż ' + C.PILOT.eco.villages + ' wiosek (' + mine(s).length + ')');
  const old = C.PILOT.eco.villages; C.PILOT.eco.villages = 1;
  const t = mk(); MP.Pilot.configure(t, { on: true }, T0); E.advance(t, T0 + 2 * MIN);
  ok(t.pilot.ecoNow === false && !logHas(t, /Faza ekonomiczna: start/), 'przy limicie wiosek faza w ogóle się nie zaczyna');
  C.PILOT.eco.villages = 2;
  const u = mk(); MP.Pilot.configure(u, { on: true }, T0); E.advance(u, T0 + 6 * HOUR);
  ok(mine(u).length >= 2 && u.pilot.ecoNow === false && logHas(u, /Faza ekonomiczna: koniec \(bot ma już wystarczająco wiosek\)/), 'po osiągnięciu limitu wiosek faza się kończy i zapisuje powód');
  C.PILOT.eco.villages = old;
}

// 4. Faza kończy się po limicie czasu od startu gry
{
  const s = mk(); MP.Pilot.configure(s, { on: true }, T0);
  E.advance(s, T0 + (C.PILOT.eco.maxHours + 1) * HOUR);
  ok(s.pilot.ecoNow === false, 'po ' + C.PILOT.eco.maxHours + ' h gry faza jest zakończona');
}

// 5. Po ataku na gracza faza „śpi” (zwykła obrona), potem wraca
{
  const s = mk(7);
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  MP.Pilot.configure(s, { on: true }, T0); E.advance(s, T0 + 10 * MIN);
  ok(s.pilot.ecoNow === true, 'przed atakiem faza trwa');
  const v = mine(s)[0];
  s.pilot.threat[v.id] = s.now;
  E.advance(s, s.now + 2 * MIN);
  ok(s.pilot.ecoNow === false && logHas(s, /atak na Twoją wioskę/), 'po ataku faza jest wstrzymana');
  E.advance(s, s.now + (C.PILOT.eco.calmMin + 3) * MIN);
  ok(s.pilot.ecoNow === true, 'po przerwie faza wraca');
}

// 6. Wioska przygraniczna zachowuje pełny cel obrony (faza obniża go tylko w spokojnych wioskach)
{
  const s = mk(9);
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  MP.Pilot.configure(s, { on: true, build: false }, T0);
  const v = mine(s)[0];
  const foe = Object.values(s.villages).find(o => o.owner && o.owner !== 'player');
  foe.x = v.x + 3; foe.y = v.y;                         // wróg w zasięgu garnizonu
  v.res.wood = v.res.clay = v.res.iron = 700; v.units = E.emptyUnits();
  E.advance(s, T0 + 3 * MIN);
  ok(E.unitsPop(v.units) + v.recruitQueue.reduce((a, e) => a + e.count, 0) > 0, 'wioska przygraniczna szkoli obronę także w fazie ekonomicznej');
}

// 7. Podbój wolnych osad małą armią bez opcji Podbój
{
  const s = mk(41);
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  MP.Pilot.configure(s, { on: true, recruit: 'defense' }, T0);
  const p0 = mine(s)[0];
  p0.units.axe = 120; p0.units.scout = 12; p0.buildings.barracks = 3; p0.buildings.hq = 5; p0.buildings.farm = 6;
  p0.units.spear = 200;
  const before = Object.values(s.villages).filter(o => o.owner === null).length;
  E.advance(s, T0 + 6 * HOUR);
  const after = Object.values(s.villages).filter(o => o.owner === null).length;
  ok(s.pilot.stats.attacked > 0 && s.pilot.stats.spied > 0, 'bot zwiadowuje i atakuje wolne osady bez opcji Podbój (ataki ' + s.pilot.stats.attacked + ', zwiady ' + s.pilot.stats.spied + ')');
  ok(after < before || s.pilot.stats.conquered > 0, 'wolne osady przejęte (' + before + ' → ' + after + ')');
  ok(Object.values(s.villages).filter(o => o.owner && o.owner !== 'player').every(o => o.owner !== 'player'), 'bot nie rusza wiosek frakcji bez opcji Podbój');
  ok(!s.movements.some(m => m.owner === 'player' && m.type === 'attack' && state_isFaction(s, m.to)), 'żaden atak nie idzie na wioskę frakcji');
}
function state_isFaction(s, id) { const o = s.villages[id]; return !!(o && o.owner && o.owner !== 'player'); }

// 8. Ustawienie „eco” zapisuje się w konfiguracji
{
  const s = mk(); MP.Pilot.configure(s, { on: true, eco: false }, T0);
  ok(s.pilot.eco === false, 'konfiguracja zapamiętuje wyłączenie fazy');
  MP.Pilot.configure(s, { eco: true }, T0);
  ok(s.pilot.eco === true, 'konfiguracja zapamiętuje włączenie fazy');
}

if (fails) { console.error(fails + ' błędów'); process.exit(1); }
console.log('Wszystko OK');
