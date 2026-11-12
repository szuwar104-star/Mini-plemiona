/* =========================================================================
   Mini Plemiona – SYNCHRONIZACJA MIĘDZY URZĄDZENIAMI
   Zapis jest wysyłany do workera Cloudflare (worker.mjs) pod losowym kodem synchronizacji – bez konta.
   Kod i numer ostatnio zsynchronizowanej wersji (base) leżą tylko w localStorage tego urządzenia.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const KEY = 'mini-plemiona-sync';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bez 0/O/1/I
  const CODE_RE = /^[A-Z0-9-]{20,64}$/;

  function read() {
    try { return JSON.parse(root.localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function write(o) {
    try { root.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignoruj */ }
  }
  const normalize = c => String(c || '').toUpperCase().replace(/\s+/g, '');
  const isCode = c => CODE_RE.test(normalize(c)) && normalize(c).replace(/-/g, '').length >= 20;

  function newCode() {
    const bytes = new Uint8Array(25);
    root.crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, b => ALPHABET[b % 32]);
    return [0, 5, 10, 15, 20].map(i => chars.slice(i, i + 5).join('')).join('-');
  }

  function code() { return read().code || ''; }
  function setCode(c, base) {
    c = normalize(c);
    if (!isCode(c)) throw new Error('Kod synchronizacji ma mieć 5 grup po 5 znaków (XXXXX-XXXXX-XXXXX-XXXXX-XXXXX).');
    write({ code: c, base: Number(base) || 0 });
    return c;
  }
  function clear() { write({}); }

  async function call(method, query, opts) {
    const c = code();
    if (!c) throw new Error('Najpierw utwórz lub wpisz kod synchronizacji.');
    let res;
    try {
      res = await root.fetch('/api/save/' + c + (query || ''), Object.assign({ method, cache: 'no-store' }, opts || {}));
    } catch (e) {
      throw new Error('Brak połączenia z serwerem.');
    }
    return res;
  }
  async function fail(res) {
    let msg = 'Błąd serwera (' + res.status + ').';
    if (res.status === 404 || res.status === 405) msg = 'Ten serwer nie obsługuje synchronizacji (otwórz grę z adresu na Cloudflare).';
    else if (res.status === 503) msg = 'Synchronizacja nie jest jeszcze skonfigurowana na serwerze (brak magazynu KV).';
    else if (res.status === 413) msg = 'Zapis jest za duży do wysłania.';
    return new Error(msg);
  }

  // Zwraca { savedAt } albo null, gdy w chmurze nic jeszcze nie ma.
  async function meta() {
    const res = await call('GET', '?meta=1');
    if (res.status === 404) {
      let body = null;
      try { body = await res.json(); } catch (e) { /* to nie nasz worker */ }
      if (body && body.error === 'empty') return null;
      throw await fail(res);
    }
    if (!res.ok) throw await fail(res);
    return res.json();
  }

  // Wysyła zapis. Zwraca { ok: true, savedAt } albo { conflict: true, savedAt } (w chmurze jest inna wersja).
  async function push(state, opts) {
    const force = !!(opts && opts.force);
    const text = MP.DB.serialize(state);
    const headers = { 'Content-Type': 'application/json', 'X-Base': String(read().base || 0) };
    if (force) headers['X-Force'] = '1';
    const res = await call('PUT', '', { headers, body: text });
    if (res.status === 409) {
      const b = await res.json();
      return { conflict: true, savedAt: b.savedAt };
    }
    if (!res.ok) throw await fail(res);
    const b = await res.json();
    write({ code: code(), base: b.savedAt });
    return { ok: true, savedAt: b.savedAt };
  }

  // Pobiera tekst zapisu z chmury (do MP.Game.importText).
  async function pull() {
    const res = await call('GET', '');
    if (res.status === 404) {
      let body = null;
      try { body = await res.clone().json(); } catch (e) { /* ignoruj */ }
      if (body && body.error === 'empty') throw new Error('W chmurze nie ma jeszcze zapisu pod tym kodem.');
      throw await fail(res);
    }
    if (!res.ok) throw await fail(res);
    const savedAt = Number(res.headers.get('X-Saved-At')) || 0;
    const text = await res.text();
    return { text, savedAt };
  }
  function markSynced(savedAt) { write({ code: code(), base: Number(savedAt) || 0 }); }

  MP.Cloud = { code, setCode, clear, newCode, isCode, normalize, meta, push, pull, markSynced };
})(typeof window !== 'undefined' ? window : globalThis);
