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

if (fails) { console.error('\nBłędy: ' + fails); process.exit(1); }
console.log('\nWszystkie testy Autopilota przeszły.');
