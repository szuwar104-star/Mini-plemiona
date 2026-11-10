/* =========================================================================
   Mini Plemiona – START GRY, PĘTLA I AUTOZAPIS
   Pętla co sekundę tylko przesuwa świat do bieżącego czasu (Date.now()).
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

    async init() {
      UI().init();
      let state = null;
      try { state = await MP.DB.load(); } catch (e) { console.error(e); }
      if (state) {
        await new Promise(r => setTimeout(r, 30)); // pozwól wyświetlić ekran ładowania
        this.state = state;
        const away = Date.now() - state.now;
        const unreadBefore = state.reports.filter(r => !r.read).length;
        this.tick(true);
        const fresh = state.reports.filter(r => !r.read).length - unreadBefore;
        UI().drainNotices(true);
        if (away > 60000) {
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
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { this.tick(true); MP.DB.saveSync(this.state); this.save(); }
        else this.tick(false);
      });
      window.addEventListener('pagehide', () => { MP.DB.saveSync(this.state); });
      this.registerSW();
    },

    // Przesuwa świat do teraz. silent = bez renderu (np. przy zamykaniu).
    tick(silent) {
      if (!this.state) return;
      const n = E.advance(this.state, Date.now());
      if (n > 0) { this.dirty = true; UI().invalidate(); }
      if (!silent) {
        UI().drainNotices(false);
        UI().render();
      }
    },

    // Każda akcja gracza: najpierw aktualizacja świata, potem zmiana, potem zapis.
    action(fn) {
      E.advance(this.state, Date.now());
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

    async newGame(difficulty, world) {
      this.state = E.newGame(Date.now(), (Math.random() * 4294967295) >>> 0, difficulty, world);
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
      E.advance(this.state, Date.now());
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
