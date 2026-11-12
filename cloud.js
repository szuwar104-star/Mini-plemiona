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
  function patch(o) { write(Object.assign(read(), o)); }
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
    write(read().auto === false ? { code: c, base: Number(base) || 0, auto: false } : { code: c, base: Number(base) || 0 });
    resetAuto();
    return c;
  }
  function clear() { write({}); resetAuto(); }

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
    const err = new Error(msg);
    err.status = res.status;
    return err;
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
  // Wysyłania idą jedno po drugim (autozapis i przycisk w menu nigdy nie nakładają się na siebie).
  let queue = Promise.resolve();
  function push(state, opts) {
    const run = () => pushNow(state, opts);
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }
  async function pushNow(state, opts) {
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
    patch({ base: b.savedAt });
    markAutoSynced();
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
  function markSynced(savedAt) { patch({ code: code(), base: Number(savedAt) || 0 }); markAutoSynced(); }

  /* ---------- autozapis co minutę ----------
     Wysyła zapis tylko wtedy, gdy jest kod, autozapis jest włączony i stan się zmienił od ostatniego wysłania.
     Nigdy nie wymusza nadpisania: gdy w chmurze jest nowsza wersja z innego urządzenia (409), autozapis się wstrzymuje
     do czasu ręcznego „Wyślij do chmury” / „Pobierz z chmury”. Po błędzie sieci ponawia z narastającą przerwą (do 10 min). */
  const AUTO_MS = 60000;
  const auto = { busy: false, sent: false, fails: 0, nextAt: 0, lastAt: 0, state: 'idle', msg: '' };
  function resetAuto() { Object.assign(auto, { busy: false, sent: false, fails: 0, nextAt: 0, lastAt: 0, state: 'idle', msg: '' }); }
  // Ręczne wysłanie lub pobranie ustawia nową bazę, więc ewentualny konflikt jest rozwiązany.
  function markAutoSynced() {
    if (auto.state === 'conflict' || auto.state === 'error') { auto.state = 'idle'; auto.msg = ''; }
    auto.fails = 0; auto.nextAt = 0;
  }
  const autoEnabled = () => read().auto !== false;
  function setAutoEnabled(on) {
    patch({ auto: !!on });
    resetAuto();
  }
  async function autoTick(state, changed, now) {
    now = now || Date.now();
    if (!state || !code() || !autoEnabled()) return { skipped: 'off' };
    if (auto.state === 'conflict' || auto.state === 'unsupported') return { skipped: auto.state };
    if (auto.busy || now < auto.nextAt) return { skipped: 'wait' };
    if (!changed && auto.sent) return { skipped: 'unchanged' };
    auto.busy = true;
    try {
      const r = await push(state);
      if (r.conflict) {
        auto.state = 'conflict'; auto.msg = '';
        return { conflict: true, savedAt: r.savedAt };
      }
      Object.assign(auto, { state: 'ok', msg: '', sent: true, fails: 0, nextAt: 0, lastAt: r.savedAt });
      return { ok: true, savedAt: r.savedAt };
    } catch (e) {
      if (e && (e.status === 404 || e.status === 405 || e.status === 503)) {
        auto.state = 'unsupported'; auto.msg = e.message;
        return { error: e, unsupported: true };
      }
      auto.fails++;
      auto.state = 'error'; auto.msg = (e && e.message) || String(e);
      auto.nextAt = now + (auto.fails < 2 ? 0 : Math.min(10, Math.pow(2, auto.fails - 1)) * 60000);
      return { error: e, fails: auto.fails };
    } finally {
      auto.busy = false;
    }
  }

  MP.Cloud = {
    code, setCode, clear, newCode, isCode, normalize, meta, push, pull, markSynced,
    auto: { INTERVAL: AUTO_MS, enabled: autoEnabled, setEnabled: setAutoEnabled, status: () => Object.assign({}, auto), tick: autoTick }
  };
})(typeof window !== 'undefined' ? window : globalThis);
