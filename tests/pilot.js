/* Test Autopilota: node tests/pilot.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../diplomacy.js'); require('../ai.js'); require('../pilot.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const T0 = 1700000000000, MIN = 60000, HOUR = 3600000;
const mk = seed => E.newGame(T0, seed || 4242, 'normal');
const buildingPts = s => E.villagesOf(s, 'player').reduce((a, v) => a + E.points(v), 0);
const armyPop = s => E.villagesOf(s, 'player').reduce((a, v) => a + E.unitsPop(v.units) + v.recruitQueue.reduce((q, e) => q + (e.count - e.done), 0), 0);

// 1. Autopilot rozwija wioskę: 6 godzin gry, bez ingerencji gracza
const idle = mk(); E.advance(idle, T0 + 6 * HOUR);
const bot = mk(); MP.Pilot.configure(bot, { on: true }, T0); E.advance(bot, T0 + 6 * HOUR);
ok(buildingPts(bot) > buildingPts(idle) + 20, 'bot rozbudował wioskę (' + buildingPts(bot) + ' pkt vs ' + buildingPts(idle) + ' bez bota)');
ok(armyPop(bot) > armyPop(idle), 'bot zbudował wojsko (' + armyPop(bot) + ' vs ' + armyPop(idle) + ')');
ok(bot.pilot.stats.built > 5 && bot.pilot.stats.recruited > 0, 'statystyki bota rosną (' + JSON.stringify(bot.pilot.stats) + ')');
ok(E.villagesOf(bot, 'player').every(v => v.buildQueue.length >= 1 || Object.keys(v.buildings).every(k => v.buildings[k] >= C.MAX_LEVEL) || v.res.wood < 200), 'kolejka budowy nie stoi bez powodu');
ok(E.villagesOf(bot, 'player').every(v => v.units.noble === 0 && v.units.settler === 0), 'bot nie szkoli dowódców ani osadników');
ok(E.villagesOf(bot, 'player').every(v => v.units.axe === 0 && v.units.light === 0 && v.units.ram === 0), 'tryb obronny: bez jednostek ataku');

// 2. Skok czasu = małe kroki (nadrabianie po zamknięciu gry)
const a = mk(); MP.Pilot.configure(a, { on: true }, T0); E.advance(a, T0 + 3 * HOUR);
const b = mk(); MP.Pilot.configure(b, { on: true }, T0); for (let t = T0 + MIN; t <= T0 + 3 * HOUR; t += MIN) E.advance(b, t);
const snap = s => JSON.stringify({ v: s.villages, p: s.pilot.stats, m: s.movements.length });
ok(snap(a) === snap(b), 'skok o 3 godziny daje ten sam stan co kroki po minucie');

// 3. Obrona: atak na wioskę A -> posiłki z B i C, które zdążą; po ataku wracają
function twoVillages() {
  const s = mk(7);
  const base = E.villagesOf(s, 'player')[0];
  base.buildings.barracks = 3; base.buildings.farm = 8; base.buildings.storage = 8; base.buildings.hq = 8;
  const mkv = (dx, dy, name) => {
    const v = JSON.parse(JSON.stringify(base));
    Object.assign(v, { id: 'vt' + name, name, x: base.x + dx, y: base.y + dy, lastTick: s.now, buildQueue: [], recruitQueue: [], support: {} });
    v.units = E.emptyUnits(); v.units.spear = 100; v.units.guard = 40;
    s.villages[v.id] = v; return v;
  };
  base.units = E.emptyUnits(); base.units.spear = 20;
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });   // AI nie przeszkadza w teście
  return { s, A: base, B: mkv(1, 0, 'B'), C: mkv(0, 2, 'C'), far: mkv(9, 9, 'Far') };
}
{
  const { s, A, B, C: Cc, far } = twoVillages();
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, defLevel: 400 }, s.now);
  // wróg z odległej wioski AI atakuje A
  const ai = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
  ai.x = A.x + 6; ai.y = A.y; ai.units = E.emptyUnits(); ai.units.axe = 300;
  const t0 = s.now;
  const r = E.sendAttack(s, ai.id, A.id, { axe: 60 }, t0);
  ok(r.ok, 'wróg wysłał atak (' + (r.reason || '') + ')');
  const arrive = r.movement.arrive;
  ok(s.pilot.next <= t0 + 1000, 'atak przyspiesza turę bota');
  E.advance(s, t0 + 2000);
  const sup = s.movements.filter(m => m.type === 'support' && m.owner === 'player' && m.to === A.id);
  ok(sup.length >= 2, 'posiłki wysłane z co najmniej dwóch wiosek (' + sup.length + ')');
  ok(sup.every(m => m.arrive < arrive), 'posiłki zdążą przed atakiem');
  ok(sup.every(m => E.sumUnits(m.units) === m.units.spear + m.units.guard), 'wysyłane są tylko jednostki obronne');
  ok(!sup.some(m => m.from === far.id) || sup.every(m => m.arrive < arrive), 'zbyt odległa wioska nie wysyła spóźnionych posiłków');
  ok(B.units.spear < 100 && B.units.spear >= 100 - Math.floor(100 * C.PILOT.supportShare), 'wioska pomocnicza zostawia część obrony w domu');
  const before = JSON.stringify(s.movements.filter(m => m.type === 'support').length);
  E.advance(s, t0 + 4000);
  ok(JSON.stringify(s.movements.filter(m => m.type === 'support').length) === before, 'ten sam atak nie wywołuje drugiej tury posiłków');
  E.advance(s, arrive + 1000);
  ok(s.reports.some(rp => rp.kind === 'defense' && rp.to === A.id), 'bitwa się odbyła');
  E.advance(s, arrive + (C.PILOT.recallMin + 3) * MIN);
  const left = Object.keys(A.support || {}).length;
  const back = s.movements.filter(m => m.type === 'return' && m.owner === 'player' && m.to === A.id);
  ok(left === 0 && (back.length > 0 || E.villagesOf(s, 'player').every(v => v.units.spear > 0)), 'po zagrożeniu posiłki wracają do domu');
  E.advance(s, arrive + 30 * MIN);
  ok(B.units.spear > 100 - Math.floor(100 * C.PILOT.supportShare) + 10, 'jednostki wróciły do wioski macierzystej (' + B.units.spear + ')');
}

// 3b. Atakowana wioska wywozi surowce kupcami do bezpiecznej wioski
{
  const { s, A, B } = twoVillages();
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, defLevel: 400 }, s.now);
  A.buildings.market = 5; B.buildings.market = 5;
  A.res = { wood: 3000, clay: 3000, iron: 3000 }; B.res = { wood: 0, clay: 0, iron: 0 };
  const ai = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
  ai.x = A.x + 6; ai.y = A.y; ai.units = E.emptyUnits(); ai.units.axe = 300;
  E.sendAttack(s, ai.id, A.id, { axe: 60 }, s.now);
  E.advance(s, s.now + 2000);
  const tr = s.movements.filter(m => m.type === 'transport' && m.from === A.id);
  ok(tr.length >= 1 && tr.every(m => m.to !== A.id), 'atakowana wioska wywozi surowce kupcami (' + tr.length + ' transportów)');
  ok(A.res.wood < 3000, 'surowce opuściły atakowaną wioskę (' + Math.round(A.res.wood) + ')');
}

// 4. Wyłączona obrona nie wysyła posiłków
{
  const { s, A } = twoVillages();
  MP.Pilot.configure(s, { on: true, defend: false, build: false, recruit: 'off', tech: false }, s.now);
  const ai = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
  ai.x = A.x + 6; ai.y = A.y; ai.units = E.emptyUnits(); ai.units.axe = 300;
  E.sendAttack(s, ai.id, A.id, { axe: 100 }, s.now);
  E.advance(s, s.now + 3000);
  ok(!s.movements.some(m => m.type === 'support' && m.owner === 'player'), 'obrona wyłączona = brak posiłków');
}

// 5. Technologia: nadwyżki -> monety -> badanie
{
  const s = mk(11);
  const v = E.villagesOf(s, 'player')[0];
  v.buildings.market = 5; v.buildings.storage = 10; v.buildings.hq = 10;
  const cap = E.storageCap(v);
  v.res = { wood: cap, clay: cap, iron: cap };
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'off' }, s.now);
  E.advance(s, s.now + 2 * MIN);
  const f = s.factions.player;
  ok((s.pilot.stats.coins || 0) > 0, 'bot kupił monety z nadwyżek (' + (s.pilot.stats.coins || 0) + ')');
  ok(s.pilot.stats.research >= 1 && E.techLevel(f, E.techNode('militia')) >= 1, 'bot wykupił badanie Pospolite ruszenie');
  const w = E.villagesOf(s, 'player')[0];
  ok(w.res.wood >= cap * C.PILOT.coinTo - C.TECH.coinPrice, 'zakup monet nie wyczyścił magazynu poniżej progu');
  const f2 = JSON.parse(JSON.stringify(f)); f2.coins = 100000; s.factions.player = f2;
  s.pilot.next = s.now + 1000; E.advance(s, s.now + 2 * MIN);
  const queue = ['militia', 'tools', 'trade', 'store'].map(id => E.techLevel(s.factions.player, E.techNode(id)));
  ok(queue.every(l => l >= 1), 'priorytety badań realizowane (' + queue.join(',') + ')');
  ok(E.techLevel(s.factions.player, E.techNode('u_axe')) === 0, 'tryb obronny nie bada jednostek ataku');
}

// 6. Tryb zbalansowany buduje też jednostki ataku
{
  const s = mk(5);
  const v = E.villagesOf(s, 'player')[0];
  v.buildings.barracks = 5; v.buildings.farm = 10; v.buildings.storage = 10; v.buildings.hq = 10;
  const cap = E.storageCap(v); v.res = { wood: cap, clay: cap, iron: cap };
  v.units.spear = 1000; // obrona ponad cel
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'balanced', tech: false, defLevel: 5 }, s.now);
  E.advance(s, s.now + 3 * MIN);
  const q = v.recruitQueue.map(e => e.unit);
  ok(q.length > 0 && q.some(u => !C.UNITS[u].role) || v.units.light + v.units.axe > 0, 'tryb zbalansowany szkoli jednostki ataku po osiągnięciu celu obrony (' + q.join(',') + ')');
}

// 7. Zapis i odczyt
{
  const s = mk(3); MP.Pilot.configure(s, { on: true, recruit: 'balanced', defLevel: 60 }, T0); E.advance(s, T0 + HOUR);
  const back = MP.DB.parse(MP.DB.serialize(s)).state;
  ok(back.pilot && back.pilot.on && back.pilot.recruit === 'balanced' && back.pilot.defLevel === 60, 'ustawienia bota przeżywają zapis');
  E.advance(back, T0 + 2 * HOUR);
  ok(back.pilot.stats.built >= s.pilot.stats.built, 'bot działa dalej po wczytaniu zapisu');
  MP.Pilot.configure(back, { on: false }, back.now);
  const n = back.pilot.stats.built; E.advance(back, back.now + HOUR);
  ok(back.pilot.stats.built === n && back.pilot.next === null, 'wyłączony bot nic nie robi');
  ok(MP.Pilot.configure(back, { recruit: 'bzdura', defLevel: -4 }, back.now).ok && back.pilot.recruit === 'balanced' && back.pilot.defLevel === 60, 'błędne ustawienia są ignorowane');
}

// 8. Bot działa dla wielu wiosek i nie psuje stanu (długi przebieg)
{
  const s = mk(21); MP.Pilot.configure(s, { on: true }, T0);
  const t = Date.now(); E.advance(s, T0 + 48 * HOUR);
  const ms = Date.now() - t;
  const own = E.villagesOf(s, 'player');
  ok(own.length >= 1, 'po 48 h gry gracz ma wioski (' + own.length + ')');
  ok(own.every(v => E.RES.every(r => v.res[r] >= 0 && v.res[r] <= E.storageCap(v) + 1)), 'surowce w granicach magazynu');
  ok(own.every(v => E.popUsed(s, v) <= E.popCap(v) + 1), 'wojsko mieści się na farmach');
  ok(ms < 20000, '48 h nadrobione w ' + ms + ' ms');
  console.log('   po 48 h: wioski ' + own.length + ', pkt budynków ' + buildingPts(s) + ', wojsko ' + armyPop(s) + ', statystyki ' + JSON.stringify(s.pilot.stats));
}

// 9. Konwoje do stolicy
{
  const { s, A, B } = twoVillages();
  Object.values(s.villages).forEach(v => { if (v.owner === 'player') { v.buildings.market = 5; v.buildings.storage = 10; v.buildings.hq = 10; } });
  const cap = E.storageCap(B);
  B.res = { wood: cap, clay: cap, iron: cap }; A.res = { wood: 100, clay: 100, iron: 100 };
  const r = MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, convoy: true, hub: A.id }, s.now);
  ok(r.ok && s.auto.on && s.auto.hub === A.id, 'konwoje włączone przez bota, stolica = A');
  E.advance(s, s.now + 40 * MIN);
  ok(A.res.wood > 1000 || s.movements.some(m => m.type === 'transport' && m.to === A.id), 'nadwyżki z B trafiają do stolicy (' + Math.round(A.res.wood) + ' drewna)');
  ok(B.res.wood < cap, 'B oddała nadwyżkę');
  ok(MP.Pilot.configure(s, { convoy: true, hub: 'nieistnieje' }, s.now).ok === false, 'obca stolica odrzucona');
  MP.Pilot.configure(s, { convoy: false }, s.now);
  ok(!s.auto.on, 'wyłączenie konwojów w bocie wyłącza Konwoje');
}

// 9b. Zasilanie: wioska z pustą kolejką budowy dostaje brakujące surowce od bogatszej
{
  const { s, A, B } = twoVillages();
  [A, B].forEach(v => { Object.keys(C.PILOT.buildWeights).forEach(k => { v.buildings[k] = 10; }); v.buildings.storage = 12; });   // drogie następne budynki
  const cap = E.storageCap(B);
  B.res = { wood: cap, clay: cap, iron: cap }; A.res = { wood: 0, clay: 0, iron: 0 };
  B.buildQueue.push({ building: 'wood', start: s.now, end: s.now + HOUR, level: B.buildings.wood + 1 });   // B ma zajętą kolejkę
  MP.Pilot.configure(s, { on: true, recruit: 'off', tech: false, convoy: false }, s.now);
  const t0 = s.now; s.pilot.next = t0 + 1000;
  E.advance(s, t0 + 3 * MIN);
  ok((s.pilot.stats.supplied || 0) > 0, 'bot zasilił wioskę z pustą kolejką (' + (s.pilot.stats.supplied || 0) + ' surowców)');
  ok(A.buildQueue.length > 0 || s.movements.some(m => m.type === 'transport' && m.to === A.id), 'A dostała surowce / ruszyła budowa');
  ok(B.res.wood < cap && B.res.wood >= cap * C.PILOT.supplyKeep - 1, 'dawca zachował rezerwę magazynu');
  // dopełnianie: wysyła dużo więcej niż koszt budynku (~1000 każdego surowca) – do 80% magazynu, w granicach udźwigu kupców i rezerwy dawcy
  ok(s.pilot.stats.supplied > 10000, 'zasilanie dopełnia magazyn, a nie tylko koszt budynku (' + s.pilot.stats.supplied + ' surowców)');
  const sent = s.pilot.stats.supplied;
  E.advance(s, t0 + 4 * MIN);
  ok(s.pilot.stats.supplied - sent < sent, 'surowce w drodze nie są wysyłane drugi raz');
  // wyłączone = brak zasilania
  const t = twoVillages(); [t.A, t.B].forEach(v => { Object.keys(C.PILOT.buildWeights).forEach(k => { v.buildings[k] = 10; }); v.buildings.storage = 12; });
  t.B.res = { wood: cap, clay: cap, iron: cap }; t.A.res = { wood: 0, clay: 0, iron: 0 };
  t.B.buildQueue.push({ building: 'wood', start: t.s.now, end: t.s.now + HOUR, level: t.B.buildings.wood + 1 });
  MP.Pilot.configure(t.s, { on: true, recruit: 'off', tech: false, supply: false }, t.s.now);
  t.s.pilot.next = t.s.now + 1000; E.advance(t.s, t.s.now + 3 * MIN);
  ok(!(t.s.pilot.stats.supplied > 0), 'z wyłączoną opcją bot nie zasila wiosek');
}

// 10. Osadnicy: bot zakłada nowe wioski w pobliżu
{
  const s = mk(9);
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const v = E.villagesOf(s, 'player')[0];
  v.buildings.hq = 8; v.buildings.barracks = 3; v.buildings.farm = 12; v.buildings.storage = 12;
  const cap = E.storageCap(v); v.res = { wood: cap, clay: cap, iron: cap }; v.units.spear = 2000;
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, settle: true, settleMax: 3 }, s.now);
  E.advance(s, s.now + 3 * MIN);
  ok(v.recruitQueue.some(e => e.unit === 'settler') || v.units.settler > 0 || s.movements.some(m => m.type === 'settle'), 'bot zlecił szkolenie osadnika');
  E.advance(s, s.now + 25 * MIN);
  let own = E.villagesOf(s, 'player');
  ok(own.length >= 2, 'założono nową wioskę (' + own.length + ')');
  const nv = own.find(o => o.id !== v.id);
  ok(!nv || E.dist(nv, v) <= 8, 'nowa wioska blisko macierzystej (' + (nv ? E.dist(nv, v).toFixed(1) : '-') + ' pól)');
  ok(s.pilot.stats.settled >= 1, 'statystyka osadników rośnie');
  // limit wiosek
  const w = E.villagesOf(s, 'player'); w.forEach(x => { const c = E.storageCap(x); x.res = { wood: c, clay: c, iron: c }; x.buildings.hq = 8; x.buildings.barracks = 3; x.buildings.farm = 12; x.buildings.storage = 12; x.units.spear = 2000; });
  E.advance(s, s.now + 3 * HOUR);
  ok(E.villagesOf(s, 'player').length <= 3, 'limit settleMax=3 respektowany (' + E.villagesOf(s, 'player').length + ')');
  // wyłączone = brak osadników
  const s2 = mk(9); Object.values(s2.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const v2 = E.villagesOf(s2, 'player')[0]; v2.buildings.hq = 8; v2.buildings.barracks = 3; v2.buildings.farm = 12; v2.buildings.storage = 12;
  const c2 = E.storageCap(v2); v2.res = { wood: c2, clay: c2, iron: c2 }; v2.units.spear = 2000;
  MP.Pilot.configure(s2, { on: true, build: false, recruit: 'off', tech: false }, s2.now); E.advance(s2, s2.now + HOUR);
  ok(E.villagesOf(s2, 'player').length === 1 && v2.units.settler === 0, 'bez opcji osadnicy nie powstają');
}

// 11. Osadnicy: wioska w środku terytorium (bez wolnych pól w zasięgu) nie blokuje ekspansji – osadnik idzie na pole przy innej wiosce
{
  const s = mk(9);
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  s.winVillages = 60;
  Object.keys(s.villages).forEach(id => { if (!s.villages[id].owner) delete s.villages[id]; });   // pusta okolica
  const v0 = E.villagesOf(s, 'player')[0];
  const mkfull = v => { v.buildings.hq = 8; v.buildings.barracks = 3; v.buildings.farm = 12; v.buildings.storage = 12; v.units.spear = 2000; };
  mkfull(v0);
  const v1 = JSON.parse(JSON.stringify(v0));
  Object.assign(v1, { id: 'edge', name: 'Edge', x: 2, y: 2, buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now });
  v1.units = E.emptyUnits(); v1.units.spear = 2000; s.villages.edge = v1;
  const cap = E.storageCap(v0); v0.res = { wood: cap, clay: cap, iron: cap }; v1.res = { wood: cap / 2, clay: cap / 2, iron: cap / 2 };
  // wolne pola (równina) są tylko daleko od v0 (dalej niż 8 pól), za to blisko v1; reszta to las
  const N = s.map.size;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) s.map.tiles[y * N + x].terrain = E.dist(v0, { x, y }) <= 8.5 ? 'forest' : 'plain';
  {
    ok(MP.Pilot.findSpot(s, v0) === null && MP.Pilot.findSpot(s, v1) !== null, 'v0 nie ma wolnego pola w zasięgu, v1 ma');
    MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, settle: true, settleMax: 3 }, s.now);
    E.advance(s, s.now + 40 * MIN);
    ok(E.villagesOf(s, 'player').length >= 3, 'ekspansja nie zatrzymuje się na wiosce bez wolnych pól (' + E.villagesOf(s, 'player').length + ' wiosek)');
  }
}

// 12. Bez limitu bot zakłada osady także po przekroczeniu celu gry
{
  const s = mk(9); Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  s.winVillages = 2;
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, settle: true }, s.now);
  for (let i = 0; i < 8; i++) {
    E.villagesOf(s, 'player').forEach(x => { const c = E.storageCap(x); x.res = { wood: c, clay: c, iron: c }; x.buildings.hq = 8; x.buildings.barracks = 3; x.buildings.farm = 12; x.buildings.storage = 12; x.units.spear = 2000; });
    E.advance(s, s.now + HOUR);
  }
  ok(E.villagesOf(s, 'player').length > 2, 'bez limitu bot zakłada osady ponad cel gry (' + E.villagesOf(s, 'player').length + ' > 2)');
}

// 13. Garnizony: zaplecze przenosi nadwyżkę obrony do wioski przygranicznej (wróg w zasięgu ataku)
{
  const setup = () => {
    const { s, A, B, C: Cc } = twoVillages();
    const ai = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
    Object.keys(s.villages).forEach(id => { const o = s.villages[id]; if (o.owner && o.owner !== 'player' && id !== ai.id) delete s.villages[id]; });
    Object.assign(ai, { x: 4, y: 2 }); Object.assign(A, { x: 2, y: 2 }); Object.assign(B, { x: 12, y: 12 }); Object.assign(Cc, { x: 13, y: 11 });
    return { s, A, B, C: Cc };
  };
  const cfg = extra => Object.assign({ on: true, build: false, recruit: 'off', tech: false, defend: false, defLevel: 40 }, extra);
  const { s, A, B, C: Cc } = setup();
  const sum = v => v.units.spear + v.units.guard;
  const before = sum(A) + sum(B) + sum(Cc);
  MP.Pilot.configure(s, cfg({}), s.now);
  E.advance(s, s.now + 90000);
  const mv = s.movements.filter(m => m.type === 'support' && m.owner === 'player' && m.to === A.id);
  ok(mv.length >= 1 && mv.every(m => m.stay === true), 'zaplecze wysyła garnizon do wioski przygranicznej na stałe (' + mv.length + ' oddziałów)');
  ok(s.pilot.stats.garrisoned > 0, 'statystyka garnizonów rośnie (' + s.pilot.stats.garrisoned + ')');
  E.advance(s, s.now + 30 * MIN);
  ok(sum(A) > 20 + 50, 'wioska przygraniczna ma więcej obrony (' + sum(A) + ')');
  const keepB = E.points(B) * 40 * C.PILOT.garrisonKeep;
  ok(E.villageDefense(B, null, E.upgradesOf(s, 'player')) >= keepB * 0.9 || sum(B) >= 100 * (1 - C.PILOT.garrisonShare) * 0.9, 'zaplecze zostawia sobie własną obronę');
  ok(sum(A) + sum(B) + sum(Cc) <= before, 'garnizon przenosi wojsko, nie tworzy go');
  ok(E.villagesOf(s, 'player').every(v => E.popUsed(s, v) <= E.popCap(v) + 1), 'garnizon mieści się na farmie');

  const o = setup();
  MP.Pilot.configure(o.s, cfg({ garrison: false }), o.s.now);
  E.advance(o.s, o.s.now + 20 * MIN);
  ok(!o.s.movements.some(m => m.type === 'support') && o.A.units.spear === 20, 'wyłączone garnizony = brak przesunięć');

  const f = setup();
  Object.values(f.s.villages).forEach(v => { if (v.owner && v.owner !== 'player') { v.x = 14; v.y = 0; } });
  f.A.x = 2; f.A.y = 14; f.B.x = 8; f.B.y = 14; f.C.x = 5; f.C.y = 14;
  MP.Pilot.configure(f.s, cfg({}), f.s.now);
  E.advance(f.s, f.s.now + 20 * MIN);
  ok(!f.s.movements.some(m => m.type === 'support') && f.A.units.spear === 20, 'bez wrogów w zasięgu nie ma garnizonów');
}

// 13b. Grabież wiosek przeciwnika: zwiad -> grabież bez Dowódcy; nie zabiera obrońców, nie przejmuje wioski
{
  const mkFarm = (axe, foeSpear, opts) => {
    const s = E.newGame(T0, 31, 'normal', 'small');
    Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
    const A = E.villagesOf(s, 'player')[0];
    const foe = Object.values(s.villages).filter(v => v.owner && v.owner !== 'player').sort((a, b) => E.dist(a, b) - E.dist(a, A))[0];
    Object.keys(s.villages).forEach(id => { const o = s.villages[id]; if (o.owner && o.owner !== 'player' && id !== foe.id) o.owner = null; });
    foe.x = A.x + 5; foe.y = A.y; foe.units = E.emptyUnits(); foe.units.spear = foeSpear; foe.buildings.wall = 0;
    foe.res = { wood: 2000, clay: 2000, iron: 2000 };
    A.buildings.barracks = 5; A.buildings.farm = 20; A.buildings.storage = 20;
    A.units = Object.assign(E.emptyUnits(), { axe, scout: 6, spear: 300, guard: 100 });
    MP.Pilot.configure(s, Object.assign({ on: true, build: false, recruit: 'off', tech: false, defend: false, garrison: false, farm: true }, opts || {}), s.now);
    return { s, A, foe };
  };
  const { s, A, foe } = mkFarm(3000, 10);
  E.advance(s, s.now + 12 * MIN);
  const rep = s.reports.filter(r => r.kind === 'attack' && r.to === foe.id);
  const mv = s.movements.filter(m => m.type === 'attack' && m.owner === 'player' && m.to === foe.id);
  ok(s.pilot.stats.spied >= 1, 'grabież: najpierw zwiad celu');
  ok(rep.length + mv.length >= 1, 'grabież: bot wysyła falę na wioskę przeciwnika');
  ok(mv.every(m => m.units.noble === 0 && m.units.spear === 0 && m.units.guard === 0), 'fala bez Dowódcy i bez obrońców');
  ok(rep.every(r => !r.conquered) && foe.owner !== 'player', 'wioska nie jest przejmowana (grabież)');
  ok(A.units.spear === 300 && A.units.guard === 100, 'obrońcy zostają w domu');
  ok(s.pilot.stats.farmed >= 1 && s.pilot.farmInfo, 'statystyki i podgląd grabieży (' + (s.pilot.farmInfo && s.pilot.farmInfo.text) + ')');
  const weak = mkFarm(30, 4000);
  E.advance(weak.s, weak.s.now + 30 * MIN);
  ok(!weak.s.reports.some(r => r.kind === 'attack' && r.to === weak.foe.id) && !weak.s.movements.some(m => m.type === 'attack' && m.to === weak.foe.id), 'za silny cel: bot go nie grabi');
  const off = mkFarm(3000, 10, { farm: false });
  E.advance(off.s, off.s.now + 30 * MIN);
  ok(!off.s.movements.some(m => m.type === 'attack') && !off.s.reports.some(r => r.kind === 'attack'), 'bez opcji nie grabi');
}

// 14. Podbój: zwiad -> fale z Dowódcą -> przejęcie wioski frakcji
{
  const setup = (units, opts) => {
    const s = E.newGame(T0, 31, 'normal', 'small');
    Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
    const A = E.villagesOf(s, 'player')[0];
    const foe = Object.values(s.villages).filter(v => v.owner && v.owner !== 'player').sort((a, b) => E.dist(a, A) - E.dist(b, A))[0];
    Object.keys(s.villages).forEach(id => { if (id !== A.id && id !== foe.id) delete s.villages[id]; });   // tylko cel i my (wolne osady też są celami)
    foe.x = A.x + 5; foe.y = A.y; foe.units = E.emptyUnits(); foe.units.spear = 10; foe.buildings.wall = 0;
    A.buildings.barracks = 5; A.buildings.farm = 20; A.buildings.storage = 20;
    A.units = Object.assign(E.emptyUnits(), units);
    MP.Pilot.configure(s, Object.assign({ on: true, build: false, recruit: 'off', tech: false, defend: false, garrison: false, attack: true }, opts || {}), s.now);
    return { s, A, foe };
  };
  const army = { axe: 500, ram: 12, noble: 2, scout: 5, spear: 300, guard: 100 };   // baza armii musi mieć własnych obrońców (samo wojsko ofensywne się nie liczy)
  const { s, A, foe } = setup(army);
  E.advance(s, s.now + 2 * MIN);
  ok(s.pilot.stats.spied >= 1, 'bot najpierw zwiadowuje cel (' + (s.pilot.stats.spied || 0) + ' zwiadów)');
  ok(s.movements.some(m => m.type === 'spy' || (m.type === 'return' && m.units.scout > 0)) || s.intel[foe.id], 'zwiadowcy wyruszyli');
  E.advance(s, s.now + 8 * MIN);
  const atk = s.movements.filter(m => m.type === 'attack' && m.owner === 'player');
  const rep0 = s.reports.filter(r => r.kind === 'attack' && r.to === foe.id);
  ok(atk.length + rep0.length >= 1, 'po zwiadzie bot wysyła falę ataku');
  const firstWave = rep0.length ? rep0[rep0.length - 1].attUnits : (atk[0] && atk[0].units);   // pierwsza fala (późniejsze mogą być bez Taranów – giną w bitwach)
  ok(firstWave && firstWave.noble === 1 && firstWave.axe > 0 && firstWave.ram > 0, 'pierwsza fala niesie Dowódcę, armię i Tarany');
  ok(atk.every(m => m.units.spear === 0 && m.units.guard === 0), 'fala nie zabiera obrońców');
  E.advance(s, s.now + 3 * HOUR);
  ok(foe.owner === 'player', 'wioska frakcji przejęta po kolejnych falach (właściciel: ' + foe.owner + ', poparcie ' + Math.floor(foe.loyalty) + ')');
  ok(s.pilot.stats.conquered >= 1 && s.pilot.stats.attacked >= 2, 'statystyki: fale ' + s.pilot.stats.attacked + ', przejęte ' + s.pilot.stats.conquered);
  ok(E.villagesOf(s, 'player').length >= 2, 'przejęta wioska trafia pod opiekę bota');

  // za słaba armia: bot nie atakuje
  const w = setup({ axe: 20, noble: 1, scout: 5, spear: 300, guard: 100 });
  E.advance(w.s, w.s.now + 2 * HOUR);
  ok(!w.s.reports.some(r => r.kind === 'attack') && !w.s.movements.some(m => m.type === 'attack'), 'za słaba armia – bot czeka');
  ok(w.s.pilot.warWhy && w.s.pilot.warWhy.text && w.s.pilot.log.some(l => /^Brak ataku:/.test(l.text)), 'bot podaje powód braku ataku: ' + (w.s.pilot.warWhy && w.s.pilot.warWhy.text));
  // bez Dowódcy: tylko zwiad, bez ataku
  const nn = setup({ axe: 500, ram: 12, scout: 5, spear: 300, guard: 100 });
  E.advance(nn.s, nn.s.now + 2 * HOUR);
  ok(!nn.s.reports.some(r => r.kind === 'attack'), 'bez Dowódcy bot nie atakuje');
  ok(nn.s.pilot.warWhy && /Dowódc/.test(nn.s.pilot.warWhy.text), 'powód: brak Dowódcy (' + (nn.s.pilot.warWhy && nn.s.pilot.warWhy.text) + ')');
  // opcja wyłączona
  const off = setup(army, { attack: false });
  E.advance(off.s, off.s.now + 2 * HOUR);
  ok(!off.s.reports.some(r => r.kind === 'attack') && !off.s.movements.some(m => m.type === 'attack'), 'bez opcji bot nie atakuje');
  // silna obrona celu: bot nie atakuje
  const st = setup(army); st.foe.units.guard = 400; st.foe.units.spear = 400;
  E.advance(st.s, st.s.now + 2 * HOUR);
  ok(!st.s.reports.some(r => r.kind === 'attack'), 'mocno bronionego celu bot nie atakuje (zwiad pokazał obronę)');
  ok(st.s.pilot.warWhy && st.s.pilot.warWhy.key === 'weak', 'powód: za słaba fala (' + (st.s.pilot.warWhy && st.s.pilot.warWhy.text) + ')');
  // pakt o nieagresji chroni cel
  const pk = setup(army);
  pk.s.diplomacy = pk.s.diplomacy || {};
  const bl = MP.Diplomacy.blocked; MP.Diplomacy.blocked = () => true;
  E.advance(pk.s, pk.s.now + 2 * HOUR);
  MP.Diplomacy.blocked = bl;
  ok(!pk.s.reports.some(r => r.kind === 'attack') && pk.foe.owner !== 'player', 'cel z paktem nie jest atakowany');
  ok(pk.s.pilot.warWhy && pk.s.pilot.warWhy.key === 'foes', 'powód: pakt o nieagresji (' + (pk.s.pilot.warWhy && pk.s.pilot.warWhy.text) + ')');
}
// 14b. Podbój wolnej osady zwykłą armią (bez Dowódcy) i ciąg uderzeń z kilku wiosek na wioskę frakcji
{
  const base = (n) => {
    const s = E.newGame(T0, 31, 'normal', 'small');
    Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
    const A = E.villagesOf(s, 'player')[0];
    A.buildings.barracks = 5; A.buildings.farm = 20; A.buildings.storage = 20;
    return { s, A };
  };
  // wolna osada: bez Dowódcy, same Topornicy + zwiad
  {
    const { s, A } = base();
    const neut = Object.values(s.villages).filter(v => v.owner === null).sort((a, b) => E.dist(a, A) - E.dist(b, A))[0];
    Object.keys(s.villages).forEach(id => { if (id !== A.id && id !== neut.id) delete s.villages[id]; });
    neut.x = A.x + 4; neut.y = A.y; neut.units = E.emptyUnits(); neut.units.spear = 5; neut.buildings.wall = 0; neut.garrison = E.emptyUnits(); neut.garrison.spear = 5;
    A.units = Object.assign(E.emptyUnits(), { axe: 600, scout: 6, spear: 200, guard: 100 });
    MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, defend: false, garrison: false, attack: true }, s.now);
    E.advance(s, s.now + 4 * HOUR);
    ok(neut.owner === 'player', 'wolna osada zdobyta zwykłą armią bez Dowódcy (poparcie ' + Math.floor(neut.loyalty) + ', właściciel ' + neut.owner + ')');
    ok(A.units.spear === 200 && A.units.guard === 100, 'obrońcy zostali w domu');
  }
  // ciąg: wioska frakcji z pełnym poparciem, 3 wioski z Dowódcami -> podbój dużo szybciej niż pojedynczymi falami
  {
    const { s, A } = base();
    const foe = Object.values(s.villages).filter(v => v.owner && v.owner !== 'player').sort((a, b) => E.dist(a, A) - E.dist(b, A))[0];
    Object.keys(s.villages).forEach(id => { if (id !== A.id && id !== foe.id) delete s.villages[id]; });
    foe.x = A.x + 6; foe.y = A.y; foe.units = E.emptyUnits(); foe.units.spear = 10; foe.buildings.wall = 0; foe.loyalty = 100;
    const mkv = (dx, name) => { const v = JSON.parse(JSON.stringify(A)); Object.assign(v, { id: 'vq' + name, name, x: A.x + dx, y: A.y + 1, buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now }); s.villages[v.id] = v; return v; };
    const B = mkv(1, 'B'), Cc = mkv(2, 'C');
    [A, B, Cc].forEach(v => { v.units = Object.assign(E.emptyUnits(), { axe: 500, ram: 6, noble: 1, scout: 5, spear: 100, guard: 50 }); });
    MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, defend: false, garrison: false, attack: true }, s.now);
    E.advance(s, s.now + 12 * MIN);
    const planned = (s.pilot.pending || []).length + s.movements.filter(m => m.type === 'attack' && m.owner === 'player' && m.units.noble > 0).length + s.reports.filter(r => r.kind === 'attack' && r.attUnits.noble > 0).length;
    ok(planned >= 2, 'uderzenie to kilka fal z Dowódcami z różnych wiosek (' + planned + ')');
    E.advance(s, s.now + 40 * MIN);
    ok(foe.owner === 'player', 'wioska frakcji przejęta jednym uderzeniem w ciągu 50 min (poparcie ' + Math.floor(foe.loyalty) + ', właściciel ' + foe.owner + ')');
  }
}

// 15. Zbiórka armii: zaplecze przenosi atak i Dowódcę do najsilniejszej wioski
{
  const s = E.newGame(T0, 31, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const A = E.villagesOf(s, 'player')[0];
  A.buildings.farm = 20;
  Object.keys(s.villages).forEach(id => { if (s.villages[id].owner !== 'player') delete s.villages[id]; });   // bez celów – tylko zbiórka
  const B = JSON.parse(JSON.stringify(A));
  Object.assign(B, { id: 'vgB', name: 'B', x: A.x + 2, y: A.y + 1, buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now });
  s.villages.vgB = B;
  A.units = Object.assign(E.emptyUnits(), { axe: 300, scout: 3, spear: 300, guard: 100 });
  B.units = Object.assign(E.emptyUnits(), { axe: 100, noble: 1, spear: 50, scout: 3 });
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'off', tech: false, defend: false, garrison: false, attack: true }, s.now);
  E.advance(s, s.now + 20 * MIN);
  ok(A.units.axe === 400 && A.units.noble === 1, 'armia i Dowódca zebrane w najsilniejszej wiosce (' + A.units.axe + ' Toporników, ' + A.units.noble + ' Dowódca)');
  ok(B.units.axe === 0 && B.units.spear === 50, 'obrońcy zostają w domu');
}

// 16. Podział wiosek na ofensywne i defensywne
{
  const s = E.newGame(T0, 31, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const A = E.villagesOf(s, 'player')[0];
  A.buildings.farm = 20; A.buildings.barracks = 5; A.buildings.storage = 15; A.buildings.hq = 15;
  Object.keys(s.villages).forEach(id => { if (s.villages[id].owner !== 'player') delete s.villages[id]; });   // bez wrogów – sprawdzamy role i szkolenie
  const vs = [A];
  for (let i = 1; i < 8; i++) {
    const v = JSON.parse(JSON.stringify(A));
    Object.assign(v, { id: 'vs' + i, name: 'S' + i, x: A.x + (i % 4), y: A.y + 1 + Math.floor(i / 4), buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now });
    s.villages[v.id] = v; vs.push(v);
  }
  vs.forEach(v => { v.units = Object.assign(E.emptyUnits(), { scout: 3 }); v.res = { wood: 9000, clay: 9000, iron: 9000 }; });
  vs[5].units.axe = 400;   // wioska z armią ataku trafia do ofensywnych
  MP.Pilot.configure(s, { on: true, build: false, tech: false, recruit: 'balanced', split: true, splitRatio: 3, garrison: false }, s.now);
  E.advance(s, s.now + 3 * HOUR);
  const roles = s.pilot.roles || {};
  const off = vs.filter(v => roles[v.id] === 'off'), def = vs.filter(v => roles[v.id] === 'def');
  ok(off.length === 2 && def.length === 6, 'osiem wiosek dzieli się 2 ofensywne : 6 defensywnych (' + off.length + ' : ' + def.length + ')');
  ok(roles[vs[5].id] === 'off', 'wioska z armią ataku jest ofensywna');
  const defK = Object.keys(C.UNITS).filter(k => C.UNITS[k].role === 'def');
  const attK = Object.keys(C.UNITS).filter(k => !C.UNITS[k].role && !C.UNITS[k].conquer && !C.UNITS[k].settler && !C.UNITS[k].scout);
  const cnt = (v, ks) => ks.reduce((a, k) => a + (v.units[k] || 0) + v.recruitQueue.reduce((q, e) => q + (e.unit === k ? e.count - e.done : 0), 0), 0);
  ok(off.every(v => cnt(v, defK) === 0) && off.every(v => cnt(v, attK) > 0), 'wioski ofensywne szkolą tylko jednostki ataku');
  ok(def.every(v => cnt(v, attK) === 0) && def.every(v => cnt(v, defK) > 0), 'wioski defensywne szkolą tylko obronę');
  // nowa wioska dopełnia podział, role istniejących się nie zmieniają
  const before = JSON.stringify(roles);
  MP.Pilot.configure(s, { splitRatio: 1 }, s.now);
  E.advance(s, s.now + 2 * MIN);
  const after = s.pilot.roles;
  ok(Object.keys(before ? JSON.parse(before) : {}).every(id => JSON.parse(before)[id] !== 'off' || after[id] === 'off'), 'wioski ofensywne zachowują rolę po zmianie proporcji');
  ok(vs.filter(v => after[v.id] === 'off').length === 4, 'proporcja 1 : 1 daje 4 wioski ofensywne');
  MP.Pilot.configure(s, { split: false }, s.now);
  E.advance(s, s.now + 2 * MIN);
  ok(s.pilot.roles === null, 'wyłączenie podziału czyści role');
}

// 16b. Podział działa niezależnie od trybu „Tylko obrona”: ofensywne szkolą atak, defensywne obronę
{
  const s = E.newGame(T0, 30, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const A = E.villagesOf(s, 'player')[0];
  A.buildings.farm = 20; A.buildings.barracks = 5;
  const vs = [A];
  for (let i = 1; i < 4; i++) {
    const v = JSON.parse(JSON.stringify(A));
    Object.assign(v, { id: 'vd' + i, name: 'D' + i, x: A.x + i, y: A.y + 1, buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now });
    s.villages[v.id] = v; vs.push(v);
  }
  vs.forEach(v => { v.units = Object.assign(E.emptyUnits(), { scout: 3 }); v.res = { wood: 9000, clay: 9000, iron: 9000 }; });
  MP.Pilot.configure(s, { on: true, build: false, tech: false, recruit: 'defense', split: true, splitRatio: 3, garrison: false }, s.now);
  E.advance(s, s.now + 3 * HOUR);
  const roles = s.pilot.roles || {};
  ok(vs.filter(v => roles[v.id] === 'off').length === 1, 'przy „Tylko obrona” podział nadal działa (1 ofensywna z 4)');
  MP.Pilot.configure(s, { recruit: 'off' }, s.now);
  E.advance(s, s.now + 2 * MIN);
  ok(s.pilot.roles === null, 'przy „Nie szkol wojska” bez ataku podział się wyłącza');
}

// 17. Podział: obrona idzie tylko z wiosek defensywnych, armia ataku z defensywnych wędruje do ofensywnej
{
  const s = E.newGame(T0, 31, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const A = E.villagesOf(s, 'player')[0];
  A.buildings.farm = 20; A.buildings.barracks = 5;
  const foe0 = Object.values(s.villages).find(v => v.owner && v.owner !== 'player');
  Object.keys(s.villages).forEach(id => { if (s.villages[id].owner !== 'player' && s.villages[id] !== foe0) delete s.villages[id]; });
  const mk2 = (id, dx, dy) => {
    const v = JSON.parse(JSON.stringify(A));
    Object.assign(v, { id, name: id, x: A.x + dx, y: A.y + dy, buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now });
    s.villages[id] = v; return v;
  };
  const O = A, D1 = mk2('vD1', 1, 0), D2 = mk2('vD2', 0, 1), D3 = mk2('vD3', 2, 1);
  [O, D1, D2, D3].forEach(v => { v.units = Object.assign(E.emptyUnits(), { scout: 3 }); });
  O.units.axe = 500;
  D1.units.spear = 200; D1.units.axe = 120;
  D2.units.spear = 200; D2.units.noble = 1;
  D3.units.spear = 200;
  foe0.x = A.x + 7; foe0.y = A.y; foe0.units = Object.assign(E.emptyUnits(), { axe: 300 });
  MP.Pilot.configure(s, { on: true, build: false, tech: false, recruit: 'balanced', split: true, splitRatio: 3, garrison: false, defLevel: 400 }, s.now);
  E.advance(s, s.now + 1000);
  ok(s.pilot.roles && s.pilot.roles[O.id] === 'off', 'wioska z armią ataku jest ofensywna');
  E.advance(s, s.now + 20 * MIN);
  ok(O.units.axe >= 620 && O.units.noble === 1, 'armia ataku i Dowódca z defensywnych przeniesione do ofensywnej (' + O.units.axe + ' Toporników)');
  ok(D1.units.axe === 0 && D2.units.noble === 0 && D1.units.spear >= 200, 'defensywne oddały armię ataku, a obrońców zachowały');
  // wróg atakuje ofensywną wioskę: posiłki idą tylko z defensywnych
  const t0 = s.now;
  const r = E.sendAttack(s, foe0.id, O.id, { axe: 60 }, t0);
  ok(r.ok, 'wróg wysłał atak na wioskę ofensywną (' + (r.reason || '') + ')');
  E.advance(s, t0 + 3000);
  const sup = s.movements.filter(m => m.type === 'support' && m.owner === 'player' && m.to === O.id);
  ok(sup.length >= 1 && sup.every(m => s.pilot.roles[m.from] === 'def'), 'posiłki dla wioski ofensywnej wysyłają wyłącznie wioski defensywne (' + sup.length + ')');
}

// 17. Jednostki ofensywne nie liczą się jako „własna obrona”: wioska z samymi toporami i LK dalej szkoli obrońców
{
  const s = E.newGame(T0, 31, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const A = E.villagesOf(s, 'player')[0];
  Object.keys(s.villages).forEach(id => { if (s.villages[id].owner !== 'player') delete s.villages[id]; });
  A.buildings.barracks = 5; A.buildings.farm = C.MAX_LEVEL; A.buildings.storage = C.MAX_LEVEL;
  const cap = E.storageCap(A); A.res = { wood: cap, clay: cap, iron: cap };
  A.units = Object.assign(E.emptyUnits(), { axe: 1083, light: 277, scout: 3 });
  ok(E.villageDefense(A, null, null) > E.villageDefenseDef(A, null, null), 'obrona z samych jednostek ofensywnych jest wyższa niż obrona z jednostek def');
  MP.Pilot.configure(s, { on: true, build: false, recruit: 'defense', tech: false, defend: true, garrison: true, attack: true }, s.now);
  E.advance(s, s.now + 3 * MIN);
  const defKeys = Object.keys(C.UNITS).filter(k => C.UNITS[k].role === 'def');
  const defHave = defKeys.reduce((n, k) => n + (A.units[k] || 0) + A.recruitQueue.reduce((q, e) => q + (e.unit === k ? e.count : 0), 0), 0);
  const offNew = ['axe', 'light'].reduce((n, k) => n + (A.units[k] - (k === 'axe' ? 1083 : 277)), 0) + A.recruitQueue.reduce((q, e) => q + (C.UNITS[e.unit].role || C.UNITS[e.unit].scout ? 0 : e.count), 0);
  ok(defHave > 0 && offNew === 0, 'wioska z samą ofensywą szkoli obrońców, nie kolejną ofensywę (' + defHave + ' obrońców, +' + offNew + ' ofensywy)');
}

// 18. Wioska defensywna szkoli obrońców aż do zapełnienia farmy w 90%, także gdy cel obrony jest spełniony, a magazyn niepełny
{
  const s = E.newGame(T0, 31, 'normal', 'small');
  Object.values(s.factions).forEach(f => { if (f.ai) f.nextThink = 1e15; });
  const A = E.villagesOf(s, 'player')[0];
  A.buildings.farm = 20; A.buildings.barracks = 5; A.buildings.storage = 20; A.buildings.hq = 15;
  Object.keys(s.villages).forEach(id => { if (s.villages[id].owner !== 'player') delete s.villages[id]; });
  const vs = [A];
  for (let i = 1; i < 4; i++) {
    const v = JSON.parse(JSON.stringify(A));
    Object.assign(v, { id: 'vf' + i, name: 'F' + i, x: A.x + i, y: A.y + 1, buildQueue: [], recruitQueue: [], support: {}, lastTick: s.now });
    s.villages[v.id] = v; vs.push(v);
  }
  vs.forEach(v => { v.units = Object.assign(E.emptyUnits(), { scout: 3 }); v.res = { wood: 30000, clay: 30000, iron: 30000 }; });
  vs[0].units.axe = 400;
  MP.Pilot.configure(s, { on: true, build: false, tech: false, recruit: 'balanced', split: true, splitRatio: 3, garrison: false, defLevel: 1 }, s.now);
  E.advance(s, s.now + 6 * HOUR);
  const roles = s.pilot.roles || {};
  const defV = vs.filter(v => roles[v.id] === 'def');
  ok(defV.length === 3, 'trzy wioski defensywne (' + defV.length + ')');
  ok(defV.every(v => E.villageDefenseDef(v, null, null) > E.points(v) * 1), 'cel obrony (defLevel 1) jest spełniony, więc samo to nie wymusza szkolenia');
  ok(defV.every(v => E.popUsed(s, v) / E.popCap(v) >= C.PILOT.split.defPopFill - 0.02 || v.res.wood < 200 || v.res.clay < 200 || v.res.iron < 200), 'wioski defensywne zapełniają farmę do 90% (' + defV.map(v => (E.popUsed(s, v) / E.popCap(v)).toFixed(2)).join(', ') + ')');
}

// 9. Częstotliwość pracy (suwak) i nadrabianie po zamknięciu gry: 2 h i 8 h = ten sam stan co ciągła gra
{
  const runs = (sec, span) => { const s = mk(11); MP.Pilot.configure(s, { on: true, tickSec: sec }, T0); let n = 0; const p = MP.Pilot.run; MP.Pilot.run = (st, t) => { n++; return p(st, t); }; E.advance(s, T0 + span); MP.Pilot.run = p; return n; };
  const r30 = runs(30, HOUR), r120 = runs(120, HOUR);
  ok(r30 > r120 * 3 && r30 >= 110, 'suwak: 30 s daje ~4x więcej tur niż 120 s (' + r30 + ' vs ' + r120 + ' na godzinę)');
  const s0 = mk(11); MP.Pilot.configure(s0, { on: true, tickSec: 3 }, T0); ok(s0.pilot.tickSec === 60, 'zła wartość suwaka (3 s) jest ignorowana, zostaje 60 s');
  const s1 = mk(11); MP.Pilot.configure(s1, { on: true, tickSec: 90 }, T0); MP.Pilot.configure(s1, { build: false }, T0); ok(s1.pilot.tickSec === 90, 'zmiana innych ustawień nie resetuje suwaka');
  const old = mk(11); MP.Pilot.configure(old, { on: true }, T0); delete old.pilot.tickSec; E.advance(old, T0 + 10 * MIN); ok(old.pilot.stats.built >= 1, 'stary zapis bez tickSec działa (domyślnie 60 s)');
  for (const [sec, span, label] of [[60, 2 * HOUR, '2 h'], [60, 8 * HOUR, '8 h'], [30, 8 * HOUR, '8 h przy 30 s'], [120, 8 * HOUR, '8 h przy 120 s']]) {
    const a = mk(5); MP.Pilot.configure(a, { on: true, tickSec: sec, recruit: 'balanced', settle: true, supply: true, convoy: false }, T0);
    const b = mk(5); MP.Pilot.configure(b, { on: true, tickSec: sec, recruit: 'balanced', settle: true, supply: true, convoy: false }, T0);
    const t0 = Date.now(); E.advance(a, T0 + span); const ms = Date.now() - t0;
    for (let t = T0 + MIN; t <= T0 + span; t += MIN) E.advance(b, t);
    ok(JSON.stringify({ v: a.villages, st: a.pilot.stats }) === JSON.stringify({ v: b.villages, st: b.pilot.stats }), 'skok o ' + label + ' = ciągła gra (nadrobienie trwa ' + ms + ' ms, wiosek: ' + E.villagesOf(a, 'player').length + ')');
    ok(a.pilot.on && a.pilot.stats.built > 20, 'po ' + label + ' bot nadal włączony i zbudował ' + a.pilot.stats.built + ' budynków');
  }
}

if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy Autopilota przeszły.');
