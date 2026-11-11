/* =========================================================================
   Mini Plemiona – ZAPIS GRY
   IndexedDB jako główny magazyn + lustrzana kopia w localStorage
   (zapisywana synchronicznie, więc przetrwa nawet nagłe zamknięcie karty).
   Przy wczytaniu wybierany jest najnowszy poprawny zapis.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const C = MP.CONFIG;
  const DB_NAME = 'mini-plemiona';
  const STORE = 'saves';
  const LS_KEY = 'mini-plemiona-save';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('Brak IndexedDB')); return; }
      const req = root.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => { dbPromise = null; throw err; });
    return dbPromise;
  }

  async function idbPut(record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async function idbGet(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDelete(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------- wersjonowanie ---------- */
  // Migracje: klucz = wersja źródłowa, funkcja podnosi zapis o jedną wersję.
  const MIGRATIONS = {
    // v1 → v2: Targowisko, Zwiadowca, Osadnik, wiedza ze zwiadu
    1: s => {
      const fillUnits = u => { if (u && typeof u === 'object') ['scout', 'settler'].forEach(k => { if (u[k] == null) u[k] = 0; }); };
      Object.values(s.villages || {}).forEach(v => {
        if (v.buildings && v.buildings.market == null) v.buildings.market = 0;
        fillUnits(v.units);
      });
      (s.movements || []).forEach(m => fillUnits(m.units));
      (s.reports || []).forEach(r => ['attUnits', 'attLoss', 'defUnits', 'defLoss'].forEach(k => fillUnits(r[k])));
      s.intel = s.intel || {};
      s.version = 2;
      return s;
    },
    // v2 → v3: Mur obronny, Taran, wsparcie stacjonujące w wioskach
    2: s => {
      const fillUnits = u => { if (u && typeof u === 'object' && u.ram == null) u.ram = 0; };
      Object.values(s.villages || {}).forEach(v => {
        if (v.buildings && v.buildings.wall == null) v.buildings.wall = 0;
        fillUnits(v.units);
        if (!v.support) v.support = {};
      });
      (s.movements || []).forEach(m => fillUnits(m.units));
      (s.reports || []).forEach(r => ['attUnits', 'attLoss', 'defUnits', 'defLoss'].forEach(k => fillUnits(r[k])));
      Object.values(s.intel || {}).forEach(i => { fillUnits(i.units); if (i.buildings && i.buildings.wall == null) i.buildings.wall = 0; });
      s.version = 3;
      return s;
    },
    // v3 → v4: poziom trudności i przerwa między atakami AI
    3: s => {
      s.difficulty = s.difficulty || 'normal';
      s.lastHit = s.lastHit || {};
      s.version = 4;
      return s;
    },
    // v4 → v5: nowa jednostka (Łucznik) – wszędzie 0
    4: s => {
      const fillUnits = u => { if (u && typeof u === 'object') Object.keys(C.UNITS).forEach(k => { if (u[k] == null) u[k] = 0; }); };
      Object.values(s.villages || {}).forEach(v => {
        fillUnits(v.units);
        Object.values(v.support || {}).forEach(fillUnits);
      });
      (s.movements || []).forEach(m => fillUnits(m.units));
      (s.reports || []).forEach(r => ['attUnits', 'attLoss', 'defUnits', 'defLoss'].forEach(k => fillUnits(r[k])));
      Object.values(s.intel || {}).forEach(i => fillUnits(i.units));
      s.version = 5;
      return s;
    },
    // v5 → v6: punkty za zniszczone jednostki i ranking (liczniki na frakcjach; stare bitwy nie są liczone wstecz)
    5: s => {
      s.version = 6;
      return s;
    },
    // v6 → v7: Kuźnia (budynek smithy) i ulepszenia jednostek na frakcjach
    6: s => {
      Object.values(s.villages || {}).forEach(v => {
        if (v.buildings && v.buildings.smithy == null) v.buildings.smithy = 0;
        if (v.upgrade === undefined) v.upgrade = null;
      });
      Object.values(s.intel || {}).forEach(i => { if (i.buildings && i.buildings.smithy == null) i.buildings.smithy = 0; });
      Object.values(s.factions || {}).forEach(f => { if (!f.upgrades) f.upgrades = {}; });
      s.version = 7;
      return s;
    },
    // v7 → v8: Kuźnia zastąpiona drzewkiem Technologii (monety); poziomy ulepszeń jednostek zostają
    7: s => {
      Object.values(s.villages || {}).forEach(v => {
        if (v.buildings) delete v.buildings.smithy;
        delete v.upgrade;
        v.buildQueue = (v.buildQueue || []).filter(e => e.building !== 'smithy');
      });
      Object.values(s.intel || {}).forEach(i => { if (i.buildings) delete i.buildings.smithy; });
      const pf = s.factions && s.factions.player;
      if (pf) { if (typeof pf.coins !== 'number') pf.coins = 0; if (!pf.tech) pf.tech = {}; if (!pf.upgrades) pf.upgrades = {}; }
      s.version = 8;
      return s;
    }
  };

  function migrate(state) {
    if (!state || typeof state !== 'object') throw new Error('Plik nie zawiera zapisu gry.');
    let v = Number(state.version) || 0;
    if (v > C.SAVE_VERSION) throw new Error('Zapis pochodzi z nowszej wersji gry (v' + v + ').');
    while (v < C.SAVE_VERSION) {
      const fn = MIGRATIONS[v];
      if (!fn) throw new Error('Brak migracji zapisu z wersji ' + v + '.');
      state = fn(state);
      v = state.version;
    }
    normalizeUnits(state);
    normalizeFactions(state);
    validate(state);
    return state;
  }

  // Dopasowuje wszystkie liczniki jednostek do aktualnej listy z config.js – niezależnie od wersji zapisu:
  // brakujące jednostki dostają 0 (bez NaN), usunięte z gry są wyrzucane, kolejki z nieznaną jednostką znikają.
  function normalizeUnits(s) {
    const keys = Object.keys(C.UNITS);
    const fix = u => {
      if (!u || typeof u !== 'object') return;
      Object.keys(u).forEach(k => { if (!C.UNITS[k]) delete u[k]; });
      keys.forEach(k => { const n = Number(u[k]); u[k] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; });
    };
    Object.values(s.villages || {}).forEach(v => {
      fix(v.units);
      Object.values(v.support || {}).forEach(fix);
      if (Array.isArray(v.recruitQueue)) v.recruitQueue = v.recruitQueue.filter(e => e && C.UNITS[e.unit]);
    });
    (s.movements || []).forEach(m => fix(m.units));
    (s.reports || []).forEach(r => ['attUnits', 'attLoss', 'defUnits', 'defLoss'].forEach(k => fix(r[k])));
    Object.values(s.intel || {}).forEach(i => fix(i && i.units));
  }

  // Liczniki pokonanych jednostek muszą być liczbami (zapisy sprzed rankingu ich nie mają).
  function normalizeFactions(s) {
    Object.values(s.factions || {}).forEach(f => {
      ['killsAtt', 'killsDef', 'killUnits'].forEach(k => { const n = Number(f[k]); f[k] = Number.isFinite(n) && n > 0 ? n : 0; });
    });
    if (s.reports) s.reports.forEach(r => { if (r && r.kind && r.killPts && !(Number.isFinite(r.killPts.att) && Number.isFinite(r.killPts.def))) r.killPts = null; });
  }

  function validate(s) {
    const ok = s.map && Array.isArray(s.map.tiles) && s.map.tiles.length === s.map.size * s.map.size &&
      s.villages && typeof s.villages === 'object' && s.factions && s.factions.player &&
      Array.isArray(s.movements) && Array.isArray(s.reports) && typeof s.now === 'number';
    if (!ok) throw new Error('Zapis jest uszkodzony lub niekompletny.');
    if (!Array.isArray(s.notices)) s.notices = [];
    if (!s.intel) s.intel = {};
    for (const id in s.villages) {
      const v = s.villages[id];
      if (!v.buildings || !v.units || !v.res || !Array.isArray(v.buildQueue) || !Array.isArray(v.recruitQueue)) {
        throw new Error('Uszkodzone dane wioski ' + id + '.');
      }
    }
  }

  /* ---------- API ---------- */
  function serialize(state) {
    return JSON.stringify({ app: 'mini-plemiona', version: state.version, savedAt: Date.now(), state });
  }
  function parse(text) {
    const obj = JSON.parse(text);
    if (!obj || obj.app !== 'mini-plemiona' || !obj.state) throw new Error('To nie jest plik zapisu Mini Plemion.');
    return { savedAt: obj.savedAt || 0, state: migrate(obj.state) };
  }

  async function save(state) {
    const text = serialize(state);
    let okLs = false, okIdb = false;
    try { root.localStorage.setItem(LS_KEY, text); okLs = true; } catch (e) { /* brak miejsca lub tryb prywatny */ }
    try { await idbPut({ id: 'current', text }); okIdb = true; } catch (e) { /* IndexedDB niedostępne */ }
    if (!okLs && !okIdb) throw new Error('Nie udało się zapisać gry.');
  }

  // Synchroniczna kopia awaryjna – używana przy zamykaniu strony.
  function saveSync(state) {
    try { root.localStorage.setItem(LS_KEY, serialize(state)); } catch (e) { /* ignoruj */ }
  }

  async function load() {
    const candidates = [];
    try {
      const rec = await idbGet('current');
      if (rec && rec.text) candidates.push(parse(rec.text));
    } catch (e) { console.warn('Odczyt IndexedDB nieudany:', e); }
    try {
      const text = root.localStorage.getItem(LS_KEY);
      if (text) candidates.push(parse(text));
    } catch (e) { console.warn('Odczyt kopii lokalnej nieudany:', e); }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.state.now - a.state.now);
    return candidates[0].state;
  }

  async function clear() {
    try { root.localStorage.removeItem(LS_KEY); } catch (e) { /* ignoruj */ }
    try { await idbDelete('current'); } catch (e) { /* ignoruj */ }
  }

  MP.DB = { save, saveSync, load, clear, serialize, parse, migrate };
})(typeof window !== 'undefined' ? window : globalThis);
