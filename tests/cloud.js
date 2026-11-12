/* Test synchronizacji zapisu (worker.mjs + cloud.js) na atrapie KV: node tests/cloud.js */
'use strict';
require('../config.js'); require('../engine.js'); require('../database.js'); require('../cloud.js');
const E = MP.Engine;
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.error('BŁĄD: ' + msg); } else console.log('ok: ' + msg); };

(async () => {
  const worker = await import('../worker.mjs');
  // atrapa KV
  const mem = new Map();
  const env = { SAVES: {
    async getWithMetadata(k) { const r = mem.get(k); return r ? { value: r.value, metadata: r.metadata } : { value: null, metadata: null }; },
    async put(k, value, o) { mem.set(k, { value, metadata: o && o.metadata }); }
  } };
  // atrapa localStorage i fetch (trafia prosto do workera)
  const store = {};
  global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  let down = false;
  global.fetch = async (path, init) => { if (down) throw new TypeError('offline'); return worker.handle(new Request('https://gra.test' + path, init), env); };
  const C = MP.Cloud;

  const T0 = 1700000000000;
  const s = E.newGame(T0, 4242, 'normal');
  const code = C.newCode();
  ok(/^([A-Z2-9]{5}-){4}[A-Z2-9]{5}$/.test(code), 'kod ma 5 grup po 5 znaków');
  ok(C.newCode() !== code, 'kody są losowe');
  ok(!C.isCode('abc') && C.isCode(code.toLowerCase()), 'walidacja kodu (małe litery są normalizowane)');

  // urządzenie A
  C.setCode(code, 0);
  ok((await C.meta()) === null, 'pusta chmura: meta = null');
  let r = await C.push(s);
  ok(r.ok && r.savedAt > 0, 'pierwsze wysłanie przechodzi');
  ok([...mem.keys()].every(k => /^save:[0-9a-f]{64}$/.test(k)) && ![...mem.keys()].some(k => k.includes(code)), 'klucz w KV to hash, nie kod');
  r = await C.push(s);
  ok(r.ok, 'kolejne wysłanie z tego samego urządzenia przechodzi');

  // urządzenie B (pusty localStorage, ten sam kod)
  Object.keys(store).forEach(k => delete store[k]);
  C.setCode(code, 0);
  const m = await C.meta();
  ok(m && m.savedAt > 0, 'urządzenie B widzi zapis (meta)');
  const pulled = await C.pull();
  const back = MP.DB.parse(pulled.text).state;
  ok(back.villages && JSON.stringify(back.villages) === JSON.stringify(s.villages), 'pobrany zapis zgadza się z wysłanym');
  ok(pulled.savedAt === m.savedAt, 'nagłówek X-Saved-At = meta');
  C.markSynced(pulled.savedAt);

  // pauza przeżywa chmurę
  E.pauseGame(s, T0 + 60000);
  r = await C.push(s);
  ok(r.ok, 'B po pobraniu wysyła nową wersję bez konfliktu');
  const p2 = MP.DB.parse((await C.pull()).text).state;
  ok(p2.paused === true && p2.pausedReal === T0 + 60000, 'pauza przeżywa wysłanie do chmury i pobranie');

  // konflikt: urządzenie A ma starą bazę
  Object.keys(store).forEach(k => delete store[k]);
  C.setCode(code, 1); // stara wersja
  r = await C.push(s);
  ok(r.conflict === true && r.savedAt > 0, 'stara baza daje konflikt (409)');
  r = await C.push(s, { force: true });
  ok(r.ok, 'wymuszenie nadpisuje mimo konfliktu');
  r = await C.push(s);
  ok(r.ok, 'po wymuszeniu baza jest aktualna');

  // błędy
  let err = null;
  C.setCode(C.newCode(), 0);
  try { await C.pull(); } catch (e) { err = e; }
  ok(err && /nie ma jeszcze zapisu/.test(err.message), 'pobranie z pustego kodu: czytelny błąd');
  err = null; down = true;
  try { await C.pull(); } catch (e) { err = e; }
  ok(err && /Brak połączenia/.test(err.message), 'brak sieci: czytelny błąd');
  down = false;
  let res = await worker.handle(new Request('https://gra.test/api/save/krotki', { method: 'GET' }), env);
  ok(res.status === 404, 'zbyt krótki kod odrzucony');
  res = await worker.handle(new Request('https://gra.test/api/save/' + code, { method: 'PUT', body: '{"x":1}' }), env);
  ok(res.status === 400, 'PUT ze śmieciowym zapisem odrzucony');
  res = await worker.handle(new Request('https://gra.test/api/save/' + code, { method: 'GET' }), {});
  ok(res.status === 503, 'brak KV: 503');
  res = await worker.handle(new Request('https://gra.test/api/save/' + code, { method: 'DELETE' }), env);
  ok(res.status === 405, 'inne metody: 405');

  if (fails) { console.error(fails + ' błędów'); process.exit(1); }
  console.log('Wszystko OK');
})();
