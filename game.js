/* =========================================================================
   Mini Plemiona – START GRY, PĘTLA I AUTOZAPIS
   Pętla co sekundę tylko przesuwa świat do bieżącego czasu gry (zegarek minus pauzy).
   Cała logika czasu siedzi w Engine.advance, więc gra liczy się
   poprawnie także po kilku godzinach z zamkniętą aplikacją.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP;
  const E = MP.Engine;
  const UI = () => MP.UI;

  const Game = {
    state: null,
    saving: false,
    pendingSave: false,
    lastSave: 0,

    // Blokada uśpienia ekranu, gdy Autopilot pracuje (przeglądarka zwalnia ją sama po ukryciu karty).
    wakeLock: null, wakeTry: 0,
    async keepAwake(force) {
      if (!this.state || !('wakeLock' in navigator)) return;
      const want = !!(this.state.pilot && this.state.pilot.on) && !this.state.paused && document.visibilityState === 'visible';
      if (!want) { if (this.wakeLock) { try { await this.wakeLock.release(); } catch (e) { /* już zwolniona */ } this.wakeLock = null; } return; }
      if (this.wakeLock || (!force && Date.now() - this.wakeTry < 30000)) return;
      this.wakeTry = Date.now();
      try {
        const lock = await navigator.wakeLock.request('screen');
        this.wakeLock = lock;
        lock.addEventListener('release', () => { if (this.wakeLock === lock) this.wakeLock = null; });
      } catch (e) { /* przeglądarka odmówiła – bot działa dalej, ekran może się wygasić */ }
    },

    // Czas gry: rzeczywisty minus czas spędzony w pauzie (w pauzie stoi w miejscu).
    clock() { return this.state ? E.gameClock(this.state, Date.now()) : Date.now(); },
    // Czas z gry -> czas na zegarku (do wyświetlania godzin w raportach).
    wall(ts) { return ts + (this.state && this.state.skew || 0); },
    paused() { return !!(this.state && this.state.paused); },

    pause() {
      if (!this.state || !E.pauseGame(this.state, Date.now())) return false;
      this.dirty = true; UI().invalidate(); UI().render(); this.save();
      return true;
    },
    resume() {
      if (!this.state || !E.resumeGame(this.state, Date.now())) return false;
      this.dirty = true; UI().invalidate(); UI().render(); this.save();
      return true;
    },

    async init() {
      UI().init();
      let state = null;
      try { state = await MP.DB.load(); } catch (e) { console.error(e); }
      if (state) {
        await new Promise(r => setTimeout(r, 30)); // pozwól wyświetlić ekran ładowania
        this.state = state;
        const away = state.paused ? 0 : this.clock() - state.now;
        const unreadBefore = state.reports.filter(r => !r.read && r.kind !== 'news').length;
        this.tick(true);
        const fresh = state.reports.filter(r => !r.read && r.kind !== 'news').length - unreadBefore;
        UI().drainNotices(true);
        if (state.paused) {
          UI().toast('info', 'Gra jest wstrzymana – czas nie płynie. Wznów ją przyciskiem u góry.');
        } else if (away > 60000) {
          UI().toast('info', 'Witaj z powrotem! Minęło ' + Math.round(away / 60000) + ' min.' + (fresh > 0 ? ' Nowe raporty: ' + fresh + '.' : ''));
        }
      } else {
        this.state = E.newGame(Date.now(), (Math.random() * 4294967295) >>> 0);
        UI().toast('info', 'Nowa gra. Rozbuduj wioskę i zdobądź ' + E.winVillages(this.state) + ' osad.');
      }
      await this.save();
      document.body.classList.remove('loading');
      UI().render();

      setInterval(() => this.tick(false), 1000);
      setInterval(() => this.save(), 5000);
      setInterval(() => this.cloudAuto(), MP.Cloud.auto.INTERVAL);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { this.tick(true); MP.DB.saveSync(this.state); this.save(); }
        else { this.tick(false); this.keepAwake(true); }
      });
      window.addEventListener('pagehide', () => { MP.DB.saveSync(this.state); });
      this.registerSW();
    },

    // Przesuwa świat do teraz. silent = bez renderu (np. przy zamykaniu).
    tick(silent) {
      if (!this.state) return;
      if (this.state.paused) return;
      const n = E.advance(this.state, this.clock());
      if (n > 0) { this.dirty = true; UI().invalidate(); }
      this.keepAwake(false);
      if (!silent) {
        UI().drainNotices(false);
        UI().render();
      }
    },

    // Każda akcja gracza: najpierw aktualizacja świata, potem zmiana, potem zapis.
    // opts.allowPaused: czynność bez wpływu na czas gry (np. oznaczanie raportów) działa też w pauzie.
    action(fn, opts) {
      if (this.state.paused && !(opts && opts.allowPaused)) {
        UI().toast('bad', 'Gra jest wstrzymana. Wznów ją, żeby wydawać rozkazy.');
        return { ok: false, reason: 'Gra jest wstrzymana' };
      }
      if (!this.state.paused) E.advance(this.state, this.clock());
      const result = fn(this.state);
      this.dirty = true;
      UI().invalidate();
      UI().render();
      this.save();
      return result;
    },

    async save() {
      if (!this.state) return;
      if (this.saving) { this.pendingSave = true; return; }
      this.saving = true;
      try {
        await MP.DB.save(this.state);
        this.lastSave = Date.now();
      } catch (e) {
        console.error(e);
        UI().toast('bad', 'Nie udało się zapisać gry: ' + e.message);
      } finally {
        this.saving = false;
        if (this.pendingSave) { this.pendingSave = false; this.save(); }
      }
    },

    // Autozapis do chmury (raz na minutę, tylko gdy jest kod synchronizacji i stan się zmienił).
    async cloudAuto() {
      const C2 = MP.Cloud;
      if (!C2 || !this.state) return;
      const sy = UI().sync;
      if (sy && sy.busy) return; // trwa ręczne wysyłanie lub pobieranie
      const was = !!this.dirty;
      this.dirty = false;
      let r;
      try { r = await C2.auto.tick(this.state, was); } catch (e) { r = { error: e }; }
      if (was && !r.ok) this.dirty = true; // nie zgub zmiany, gdy wysłanie się nie udało
      if (r.conflict) {
        UI().toast('bad', 'Autozapis do chmury wstrzymany: w chmurze jest nowszy zapis z innego urządzenia. W Menu → Synchronizacja wybierz „Pobierz z chmury” albo „Wyślij do chmury”.');
      } else if (r.error && r.fails === 3) {
        UI().toast('bad', 'Autozapis do chmury nie działa: ' + r.error.message + ' Gra zapisuje się lokalnie i ponawia próby.');
      }
    },

    async newGame(difficulty, world, race) {
      this.state = E.newGame(Date.now(), (Math.random() * 4294967295) >>> 0, difficulty, world, race);
      const ui = UI().state;
      ui.vid = null; ui.sel = null; ui.recruit = {}; ui.atk = {}; ui.filter = 'all';
      MP.Map.reset();
      await this.save();
      UI().show('village');
      UI().toast('info', 'Nowa gra rozpoczęta.');
    },

    async importText(text) {
      const parsed = MP.DB.parse(text);
      this.state = parsed.state;
      if (!this.state.paused) E.advance(this.state, this.clock());
      this.state.notices = [];
      const ui = UI().state;
      ui.vid = null; ui.sel = null; ui.recruit = {}; ui.atk = {};
      MP.Map.reset();
      await this.save();
      UI().show('village');
    },

    registerSW() {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        const hadController = !!navigator.serviceWorker.controller;
        let reloaded = false;
        // Nowa wersja gry przejęła stronę – zapisz stan i przeładuj raz, żeby od razu ją pokazać.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!hadController || reloaded) return;
          reloaded = true;
          MP.DB.saveSync(this.state);
          location.reload();
        });
        navigator.serviceWorker.register('./sw.js').then(r => r.update()).catch(err => console.warn('Service Worker:', err));
      }
    }
  };

  MP.Game = Game;
  document.addEventListener('DOMContentLoaded', () => {
    Game.init().catch(err => {
      console.error(err);
      document.body.classList.remove('loading');
      document.body.insertAdjacentHTML('afterbegin', '<p class="fatal">Nie udało się uruchomić gry: ' + String(err.message) + '</p>');
    });
  });
})(window);
