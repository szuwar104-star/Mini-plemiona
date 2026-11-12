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
  let down = false, curEnv = env;
  global.fetch = async (path, init) => { if (down) throw new TypeError('offline'); return worker.handle(new Request('https://gra.test' + path, init), curEnv); };
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

  // ---------- autozapis co minutę ----------
  const A = C.auto;
  ok(A.INTERVAL === 60000, 'autozapis działa co 60 s');
  Object.keys(store).forEach(k => delete store[k]);
  const T1 = 1800000000000;
  let t = await A.tick(s, true, T1);
  ok(t.skipped === 'off', 'bez kodu autozapis nic nie robi');
  C.setCode(C.newCode(), 0);
  ok(A.enabled(), 'autozapis jest domyślnie włączony');
  t = await A.tick(s, false, T1);
  ok(t.ok && A.status().state === 'ok' && A.status().lastAt === t.savedAt, 'pierwszy tick wysyła zapis nawet bez zmian');
  t = await A.tick(s, false, T1 + 60000);
  ok(t.skipped === 'unchanged', 'bez zmian od ostatniego wysłania – pomija');
  t = await A.tick(s, true, T1 + 120000);
  ok(t.ok, 'po zmianie wysyła kolejny zapis');
  const [q1, q2] = await Promise.all([C.push(s), C.push(s)]);
  ok(q1.ok && q2.ok, 'dwa wysłania naraz idą po kolei i oba przechodzą (bez fałszywego konfliktu)');
  A.setEnabled(false);
  ok(!A.enabled() && (await A.tick(s, true, T1 + 180000)).skipped === 'off', 'wyłączony autozapis nie wysyła');
  const savedCode = C.code();
  C.setCode(savedCode, 0);
  ok(!A.enabled(), 'wybór „wyłączony” przeżywa ponowne ustawienie kodu');
  A.setEnabled(true);
  ok(A.enabled(), 'autozapis można włączyć z powrotem');

  // konflikt: drugie urządzenie wysłało nowszą wersję
  C.markSynced(0);
  t = await A.tick(s, true, T1 + 240000);
  ok(t.conflict === true && A.status().state === 'conflict', 'nowsza wersja z innego urządzenia: autozapis staje na konflikcie');
  const before = mem.get([...mem.keys()].pop()).metadata.savedAt;
  t = await A.tick(s, true, T1 + 300000);
  ok(t.skipped === 'conflict' && mem.get([...mem.keys()].pop()).metadata.savedAt === before, 'w konflikcie autozapis nie nadpisuje chmury');
  r = await C.push(s, { force: true });
  ok(r.ok && A.status().state === 'idle', 'ręczne wymuszenie rozwiązuje konflikt');
  t = await A.tick(s, true, T1 + 360000);
  ok(t.ok, 'po rozwiązaniu konfliktu autozapis rusza dalej');

  // błędy sieci: ponawianie z narastającą przerwą
  down = true;
  t = await A.tick(s, true, T1 + 420000);
  ok(t.error && t.fails === 1 && A.status().state === 'error', 'brak sieci: błąd, bez wyjątku');
  t = await A.tick(s, true, T1 + 480000);
  ok(t.error && t.fails === 2, 'kolejna próba po minucie');
  t = await A.tick(s, true, T1 + 480000 + 60000);
  ok(t.skipped === 'wait', 'po dwóch błędach przerwa 2 min');
  down = false;
  t = await A.tick(s, true, T1 + 480000 + 130000);
  ok(t.ok && A.status().fails === 0, 'po powrocie sieci wysyła i zeruje błędy');

  // serwer bez synchronizacji (brak KV) – bez nękania
  curEnv = {};
  t = await A.tick(s, true, T1 + 900000);
  ok(t.unsupported && A.status().state === 'unsupported', 'brak KV na serwerze: autozapis się wyłącza');
  t = await A.tick(s, true, T1 + 960000);
  ok(t.skipped === 'unsupported', 'i nie ponawia prób');
  curEnv = env;

  if (fails) { console.error(fails + ' błędów'); process.exit(1); }
  console.log('Wszystko OK');
})();
