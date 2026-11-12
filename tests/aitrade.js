/* Test handlu AI (opcja gry aiTrade): node tests/aitrade.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../ai.js'); require('../database.js');
const E = MP.Engine, C = MP.CONFIG, AI = MP.AI;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

const T0 = 1700000000000, MIN = 60000;
const mk = () => E.newGame(T0, 4242, 'normal');
const fid = s => Object.keys(s.factions).find(f => s.factions[f].ai);
const setup = (s, res) => {
  const v = E.villagesOf(s, fid(s))[0];
  v.buildings.market = 5; v.buildings.hq = 10; v.buildings.barracks = 5;
  Object.assign(v.res, res);
  return v;
};
const P = s => C.AI.personalities[s.factions[fid(s)].personality];

ok(mk().aiTrade === true, 'nowa gra ma handel AI włączony');

// brakuje drewna na budynek, są nadwyżki gliny i żelaza -> wymiana pokrywa niedobór
{
  const s = mk(), v = setup(s, { wood: 100, clay: 6000, iron: 6000 });
  const cost = { wood: 1500, clay: 200, iron: 200 };
  const before = v.res.clay + v.res.iron;
  ok(AI.manageTrade(s, v, P(s), T0, cost) === true, 'wymiana się odbywa');
  ok(Math.floor(v.res.wood) >= cost.wood, 'po wymianie drewna wystarcza na koszt');
  ok(v.res.clay + v.res.iron < before, 'nadwyżkowe surowce zostały oddane');
  ok(v.aiTradeAt === T0, 'wymiana zapisała czas (przerwa)');
  // kurs: za 1000 oddanego dostaje się 70% (C.MARKET.exchangeRate)
  const given = before - (v.res.clay + v.res.iron);
  ok(Math.abs((v.res.wood - 100) - Math.floor(given * C.MARKET.exchangeRate)) <= 2, 'kurs wymiany = bazowy (' + C.MARKET.exchangeRate + ')');
}

// przerwa między wymianami
{
  const s = mk(), v = setup(s, { wood: 100, clay: 6000, iron: 6000 });
  AI.manageTrade(s, v, P(s), T0, { wood: 1500, clay: 200, iron: 200 });
  v.res.wood = 100;
  ok(AI.manageTrade(s, v, P(s), T0 + MIN, { wood: 1500, clay: 200, iron: 200 }) === false, 'w trakcie przerwy brak kolejnej wymiany');
  ok(AI.manageTrade(s, v, P(s), T0 + (C.AI.trade.cooldownMin + 1) * MIN, { wood: 1500, clay: 200, iron: 200 }) === true, 'po przerwie wymiana znów działa');
}

// za mało nadwyżek: nic nie wymienia (nie mieli surowców bez efektu)
{
  const s = mk(), v = setup(s, { wood: 100, clay: 400, iron: 400 });
  const snap = JSON.stringify(v.res);
  ok(AI.manageTrade(s, v, P(s), T0, { wood: 1500, clay: 300, iron: 300 }) === false && JSON.stringify(v.res) === snap, 'bez wystarczających nadwyżek nic się nie dzieje');
}

// bez Targowiska nie ma handlu
{
  const s = mk(), v = setup(s, { wood: 100, clay: 6000, iron: 6000 });
  v.buildings.market = 0;
  ok(AI.manageTrade(s, v, P(s), T0, { wood: 1500, clay: 200, iron: 200 }) === false, 'bez Targowiska brak wymiany');
}

// opcja wyłączona
{
  const s = mk(), v = setup(s, { wood: 100, clay: 6000, iron: 6000 });
  s.aiTrade = false;
  ok(AI.manageTrade(s, v, P(s), T0, { wood: 1500, clay: 200, iron: 200 }) === false, 'wyłączona opcja = brak wymiany');
}

// gracz nie jest dotknięty, a po pełnej symulacji nic się nie psuje
{
  const s = mk(); E.advance(s, T0 + 6 * 60 * MIN);
  const bad = Object.values(s.villages).filter(v => ['wood', 'clay', 'iron'].some(r => !(v.res[r] >= 0) || v.res[r] > E.storageCap(v) + 1));
  ok(bad.length === 0, 'po 6 h gry surowce w zakresie 0…magazyn');
  const s2 = mk(); s2.aiTrade = false; E.advance(s2, T0 + 6 * 60 * MIN);
  ok(Object.values(s.villages).some(v => v.aiTradeAt) , 'przy włączonej opcji AI faktycznie handluje w trakcie gry');
  ok(!Object.values(s2.villages).some(v => v.aiTradeAt), 'przy wyłączonej opcji AI nie handluje');
}

// zapis: opcja przeżywa serializację, stary zapis bez pola dostaje domyślnie włączone
{
  const s = mk(); s.aiTrade = false;
  ok(MP.DB.parse(MP.DB.serialize(s)).state.aiTrade === false, 'wyłączona opcja przeżywa zapis');
  const old = JSON.parse(MP.DB.serialize(s)); delete old.state.aiTrade;
  ok(MP.DB.parse(JSON.stringify(old)).state.aiTrade === true, 'stary zapis bez pola: handel włączony');
}

if (fails) { console.error(fails + ' błędów'); process.exit(1); }
console.log('Wszystko OK');
