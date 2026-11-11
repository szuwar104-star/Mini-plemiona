/* Raport zachowania AI bez gracza: node tools/ai-report.js [easy|normal|hard] [godziny] [ziarno]
   Kolumny: wioski, suma poziomów budynków, całe wojsko (z marszami), zapełnienie magazynu i farmy, liczba ataków, osadników, budów i zrekrutowanych jednostek. */
require('../config.js'); require('../engine.js'); require('../ai.js');
const E = MP.Engine, C = MP.CONFIG;
const diff = process.argv[2] || 'normal', hours = +(process.argv[3] || 6), seed = +(process.argv[4] || 1);
const s = E.newGame(0, seed, diff, 'small');
// licz zdarzenia
let atk = {}, settle = {}, recruited = {}, built = {};
const oSendAttack = E.sendAttack, oSettler = E.sendSettler, oQR = E.queueRecruit, oQB = E.queueBuild;
E.sendAttack = function (st, from, to, u, t) { const o = st.villages[from].owner; atk[o] = (atk[o] || 0) + 1; return oSendAttack.apply(this, arguments); };
E.sendSettler = function (st, from) { const o = st.villages[from].owner; settle[o] = (settle[o] || 0) + 1; return oSettler.apply(this, arguments); };
E.queueRecruit = function (st, v, u, n) { recruited[v.owner] = (recruited[v.owner] || 0) + n; return oQR.apply(this, arguments); };
E.queueBuild = function (st, v) { built[v.owner] = (built[v.owner] || 0) + 1; return oQB.apply(this, arguments); };
const rows = [];
for (let h = 1; h <= hours; h++) {
  E.advance(s, h * 3600e3);
  if (h === hours || h % 2 === 0) {
    for (const f of Object.values(s.factions).filter(f => f.ai)) {
      const vs = E.villagesOf(s, f.id);
      const bl = vs.reduce((a, v) => a + Object.values(v.buildings).reduce((x, y) => x + y, 0), 0);
      const army = E.sumUnits(E.armyOf(s, f.id));
      const res = vs.reduce((a, v) => a + v.res.wood + v.res.clay + v.res.iron, 0);
      const cap = vs.reduce((a, v) => a + 3 * E.storageCap(v), 0);
      const pop = vs.reduce((a, v) => a + E.popUsed(s, v) / E.popCap(v), 0) / (vs.length || 1);
      rows.push([h + 'h', f.personality.slice(0, 5), vs.length, bl, army, Math.round(res / cap * 100) + '%', Math.round(pop * 100) + '%', atk[f.id] || 0, settle[f.id] || 0, built[f.id] || 0, recruited[f.id] || 0].join('\t'));
    }
  }
}
console.log('czas\tosob.\twiosk\tpoz.bud\twojsko\tmagazyn\tfarma\tataki\tosadn.\tbudowy\trekrut.');
console.log(rows.join('\n'));
const pv=E.villagesOf(s,'player')[0]; console.log('ataki AI na gracza:', s.reports.filter(r=>r.kind==='defense').length, 'gracz obrona:', pv?E.villageDefense(pv):0);
console.log('gracz wiosek:', E.villagesOf(s, 'player').length, 'wolnych:', Object.values(s.villages).filter(v => !v.owner).length);
