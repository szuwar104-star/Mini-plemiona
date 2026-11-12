/* =========================================================================
   Mini Plemiona – KONFIGURACJA I BALANS
   Wszystkie parametry rozgrywki są w tym pliku. Zmiana wartości tutaj
   zmienia zachowanie gry – żaden inny plik nie zawiera liczb balansu.
   Czasy podawane są w SEKUNDACH, produkcja w jednostkach NA MINUTĘ.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP = root.MP || {};
  const LEVELS = 20;       // maksymalny poziom budynków
  const BASE_LEVELS = 10;  // do tego poziomu krzywe są „klasyczne”; powyżej rosną łagodniej (czas), a zyski maleją (produkcja)

  // Tabela wartości dla poziomów 1..LEVELS (indeks 0 = poziom 0).
  // Powyżej poziomu 10 wykładnik wzrostu jest łagodzony (softness: 1 = bez zmian, 0 = płasko), żeby czasy budowy
  // nie rosły w nieskończoność; koszty surowców zostawiamy ostre – wysokie poziomy mają pochłaniać nadwyżki.
  function series(base, factor, roundTo, softness) {
    const out = [0];
    const soft = softness == null ? 1 : softness;
    let v = base;
    for (let lvl = 1; lvl <= LEVELS; lvl++) {
      if (lvl > 1) v *= lvl > BASE_LEVELS ? 1 + (factor - 1) * soft : factor;
      out.push(Math.max(roundTo, Math.round(v / roundTo) * roundTo));
    }
    return out;
  }
  const HIGH_TIME = 0.55;   // łagodzenie wzrostu czasu budowy powyżej poziomu 10
  function cost(wood, clay, iron, factor) {
    return { wood: series(wood, factor, 5), clay: series(clay, factor, 5), iron: series(iron, factor, 5) };
  }

  MP.CONFIG = {
    SAVE_VERSION: 9,

    // Poziomy trudności – mnożniki dla gracza i AI.
    // playerProd / aiProd: produkcja surowców; graceMinutes: ochrona gracza na starcie;
    // aiAggro: jak często AI atakuje; playerBias: jak chętnie AI wybiera gracza;
    // aiCaution: jakiej przewagi AI potrzebuje do ataku; lootProtect: część magazynu
    // gracza ukryta przed łupieniem; hitCooldownMin: przerwa między atakami AI na tę samą wioskę gracza;
    // aiTech: tempo automatycznych ulepszeń jednostek AI (1 = poziom co AI.tech.minutesPerLevel minut gry);
    // aiExpand: mnożnik limitu wiosek AI; aiCatchUp: do jakiej części wiosek lidera (gracza) AI może dorosnąć mimo limitu czasowego; playerZone: promień (w polach) wokół wiosek gracza, w którym AI nie zajmuje wolnych osad ani pól.
    // Tryb Wyścig (state.race, wybierany przy nowej grze i w Menu): frakcja AI, która pierwsza zdobędzie cel wiosek świata, wygrywa.
    // warnShare: od jakiej części celu gracz dostaje ostrzeżenie o frakcji zbliżającej się do zwycięstwa.
    RACE: { warnShare: 0.8 },
    DEFAULT_DIFFICULTY: 'normal',
    DIFFICULTY: {
      easy:   { label: 'Łatwy',    desc: 'Spokojny rozwój. AI rzadko atakuje i wolniej rośnie.',
                playerProd: 1.3, aiProd: 0.6, graceMinutes: 40, aiAggro: 0.4, playerBias: 0.4, aiCaution: 1.5, lootProtect: 0.4, hitCooldownMin: 15,
                aiExpand: 0.5, aiCatchUp: 0.5, playerZone: 4, aiTech: 0.5 },
      normal: { label: 'Normalny', desc: 'Wyważona rozgrywka. AI naciska, ale da się je wyprzedzić.',
                playerProd: 1.15, aiProd: 0.72, graceMinutes: 25, aiAggro: 0.7, playerBias: 0.7, aiCaution: 1.2, lootProtect: 0.25, hitCooldownMin: 8,
                aiExpand: 0.7, aiCatchUp: 0.7, playerZone: 3, aiTech: 0.8 },
      hard:   { label: 'Trudny',   desc: 'Agresywne i szybkie AI. Dla doświadczonych.',
                playerProd: 1, aiProd: 0.95, graceMinutes: 10, aiAggro: 1, playerBias: 1, aiCaution: 1, lootProtect: 0.1, hitCooldownMin: 0,
                aiExpand: 1, aiCatchUp: 0.9, playerZone: 0, aiTech: 1 }
    },
    WIN_VILLAGES: 20,           // domyślny cel (stare zapisy); nowe gry biorą cel ze świata (WORLDS)

    // Rozmiary świata wybierane przy nowej grze: bok mapy, liczba frakcji AI, wolnych osad i cel zwycięstwa.
    DEFAULT_WORLD: 'small',
    WORLDS: {
      small:  { label: 'Mała',     size: 15, ai: 4,  neutral: 24,  win: 20, desc: 'Szybka gra: 15×15 pól, 4 przeciwników.' },
      medium: { label: 'Średnia',  size: 25, ai: 8,  neutral: 70,  win: 30, desc: 'Większy świat: 25×25 pól, 8 przeciwników, cel 30 wiosek.' },
      large:  { label: 'Duża',     size: 35, ai: 12, neutral: 140, win: 40, desc: 'Duży świat: 35×35 pól, 12 przeciwników, cel 40 wiosek.' },
      huge:   { label: 'Ogromna',  size: 45, ai: 15, neutral: 230, win: 50, desc: 'Ogromny świat: 45×45 pól, 15 przeciwników, cel 50 wiosek. Wymaga mocniejszego telefonu.' }
    },
    MAX_LEVEL: LEVELS,

    MAP: {
      size: 15,
      forest: 0.17,              // udział lasów
      mountain: 0.10,            // udział gór
      neutralCount: 24,          // liczba neutralnych osad
      neutralNearPlayer: 4,      // ile słabych osad w promieniu 2–4 pól od gracza
      aiMinDistFromPlayer: 6,    // minimalna odległość stolic AI od gracza
      aiMinDistBetween: 5        // minimalna odległość między stolicami AI
    },

    START: {
      resources: { wood: 800, clay: 800, iron: 700 },
      buildings: { hq: 1, wood: 1, clay: 1, iron: 1, farm: 1, barracks: 1, market: 0, wall: 0 },
      units: { spear: 12 }
    },

    BUILD_QUEUE_MAX: 3,
    RECRUIT_QUEUE_MAX: 5,
    HQ_LEVEL_GAP: 2,             // pozostałe budynki: maks. poziom = Ratusz + 2

    RESOURCES: {
      wood: { name: 'Drewno' },
      clay: { name: 'Glina' },
      iron: { name: 'Żelazo' }
    },

    BUILDINGS: {
      hq: {
        name: 'Ratusz',
        desc: 'Odblokowuje wyższe poziomy budynków, powiększa magazyn i skraca czas budowy.',
        start: 1,
        cost: cost(70, 70, 66, 1.33),
        time: series(5, 1.55, 1, HIGH_TIME),
        storage: [800, 1200, 1600, 2100, 2800, 3600, 4700, 6100, 8000, 10500, 14000,
                  16400, 19200, 22500, 26300, 30800, 36000, 42000, 49000, 57000, 66000],
        buildSpeed: [1, 1, 0.95, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.67, 0.64,
                    0.62, 0.60, 0.58, 0.56, 0.54, 0.52, 0.50, 0.48, 0.46, 0.45]
      },
      wood: {
        name: 'Tartak',
        desc: 'Produkuje drewno.',
        start: 1,
        cost: cost(40, 50, 48, 1.3),
        time: series(4, 1.5, 1, HIGH_TIME),
        prod: [10, 40, 55, 74, 98, 128, 165, 210, 265, 330, 410,
               470, 540, 620, 710, 810, 920, 1040, 1170, 1310, 1460]
      },
      clay: {
        name: 'Cegielnia',
        desc: 'Produkuje glinę.',
        start: 1,
        cost: cost(55, 40, 48, 1.3),
        time: series(4, 1.5, 1, HIGH_TIME),
        prod: [10, 40, 55, 74, 98, 128, 165, 210, 265, 330, 410,
               470, 540, 620, 710, 810, 920, 1040, 1170, 1310, 1460]
      },
      iron: {
        name: 'Kopalnia',
        desc: 'Wydobywa żelazo.',
        start: 1,
        cost: cost(60, 65, 50, 1.31),
        time: series(5, 1.5, 1, HIGH_TIME),
        prod: [10, 40, 55, 74, 98, 128, 165, 210, 265, 330, 410,
               470, 540, 620, 710, 810, 920, 1040, 1170, 1310, 1460]
      },
      farm: {
        name: 'Farma',
        desc: 'Wyżywi większą armię – zwiększa limit jednostek.',
        start: 1,
        cost: cost(45, 40, 34, 1.3),
        time: series(5, 1.5, 1, HIGH_TIME),
        pop: [100, 240, 300, 380, 480, 600, 760, 960, 1200, 1500, 1900,
             2200, 2550, 3000, 3500, 4100, 4800, 5600, 6500, 7600, 9000]
      },
      barracks: {
        name: 'Koszary',
        desc: 'Rekrutacja wojska. Wyższy poziom odblokowuje jednostki i skraca szkolenie.',
        start: 1,
        cost: cost(85, 85, 85, 1.33),
        time: series(6, 1.55, 1, HIGH_TIME),
        recruitSpeed: [0, 1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.61, 0.56, 0.52, 0.48,
                       0.46, 0.44, 0.42, 0.41, 0.40, 0.39, 0.38, 0.37, 0.36, 0.35]
      },
      market: {
        name: 'Targowisko',
        desc: 'Kupcy przewożą surowce między Twoimi wioskami.',
        start: 0,
        cost: cost(65, 60, 60, 1.3),
        time: series(6, 1.5, 1, HIGH_TIME),
        merchants: [0, 1, 2, 3, 4, 6, 8, 10, 13, 16, 20,
                    24, 28, 32, 37, 42, 48, 54, 61, 68, 75]
      },
      wall: {
        name: 'Mur obronny',
        desc: 'Zwiększa obronę wioski. Tarany wroga mogą go burzyć.',
        start: 0,
        cost: cost(55, 75, 62, 1.32),
        time: series(6, 1.5, 1, HIGH_TIME),
        flat: [0, 20, 40, 60, 85, 110, 140, 170, 200, 240, 280,
               320, 360, 400, 440, 480, 520, 560, 600, 640, 680],          // stała obrona muru
        bonus: [0, .05, .10, .16, .22, .29, .36, .44, .52, .61, .70,
                .76, .815, .865, .91, .95, .985, 1.015, 1.04, 1.06, 1.08]       // procentowy bonus obrony
      }
    },

    // Taran: w bitwie każde `fightPerLevel` taranów obniża mur o 1 poziom;
    // po wygranej każde `destroyPerLevel` ocalałych taranów burzy 1 poziom na stałe.
    RAM: { fightPerLevel: 8, destroyPerLevel: 4 },

    MERCHANT: { capacity: 1000, speed: 10 },   // udźwig jednego kupca; sekundy na pole

    // Wymiana surowców w Targowisku (natychmiast, w obrębie jednej wioski).
    // rate – ile surowca dostajesz za 1 oddany (0,7 = 30% prowizji); jednorazowo do (kupcy × udźwig) surowca.
    MARKET: { exchangeRate: 0.7 },

    // Technologia: drzewko badań plemienia, płatne MONETAMI (nie surowcami).
    // Monety kupuje się w wiosce z Targowiskiem za JEDEN wybrany surowiec: coinPrice sztuk surowca = 1 moneta (tylko w jedną stronę).
    // Limit zakupu na wioskę: (poziom Targowiska × perLevelPerHour + bonus z badania Mennica) monet na godzinę;
    // niewykorzystany limit odkłada się do bucketHours godzin.
    // Węzeł: max poziomów, koszt poziomu L = base × factor^(L-1) monet, req = węzeł nadrzędny i jego minimalny poziom.
    // ZASADA UKŁADU: ulepszenie jednostki nigdy nie zależy od ulepszenia innej jednostki – każda ma własne wymaganie od ogólnego węzła
    // swojej gałęzi (Pospolite ruszenie / Musztra). Węzeł jednostki może mieć dzieci tylko wtedy, gdy rozwija TĘ SAMĄ jednostkę
    // (Lekka kawaleria → Grabież, Taran → Machiny oblężnicze).
    // effect: unit – +unitBonus ataku i obrony jednostki na poziom; pozostałe typy działają jako suma per × poziom
    // (storage, build, recruit – mnożnik wokół 1; exchange – dodatek do kursu wymiany; mint – dodatkowe monety/h na wioskę;
    // prod, prodWood, prodClay, prodIron – mnożniki produkcji wokół 1 (prod dotyczy wszystkich surowców); carry – mnożnik udźwigu łupu
    // atakujących jednostek; hide – dodatkowa część magazynu ukryta przed łupieżcami, dodawana do ochrony z poziomu trudności;
    // militia – stała obrona każdej Twojej wioski (dodawana do COMBAT.baseDefense); siege – mnożnik skuteczności taranów (walka i burzenie);
    // caravan – mnożnik udźwigu kupca; tactics – część ujemnego szczęścia Twojego ataku, która znika (0,2 = −20% „pecha”)).
    TECH: {
      unitBonus: 0.05,
      coinPrice: 1500,
      mint: { perLevelPerHour: 3, bucketHours: 6 },
      branches: [
        { id: 'war', name: 'Wojsko – atak' },
        { id: 'def', name: 'Wojsko – obrona' },
        { id: 'eco', name: 'Gospodarka' },
        { id: 'prod', name: 'Produkcja' },
        { id: 'realm', name: 'Królestwo' }      // późna gra: drogie badania dla rozbudowanego plemienia
      ],
      nodes: [
        // --- Wojsko – atak: korzeń Musztra; jednostki ataku niezależne od siebie ---
        { id: 'drill', branch: 'war', name: 'Musztra', desc: 'Szybsze szkolenie wojska (wszystkich jednostek).', max: 5, base: 10, factor: 1.3, req: null, effect: { type: 'recruit', per: -0.04 } },
        { id: 'u_axe', branch: 'war', name: 'Topornik', desc: 'Atak i obrona Topornika.', max: 10, base: 10, factor: 1.25, req: { id: 'drill', min: 1 }, effect: { type: 'unit', unit: 'axe' } },
        { id: 'u_light', branch: 'war', name: 'Lekka kawaleria', desc: 'Atak i obrona Lekkiej kawalerii.', max: 10, base: 10, factor: 1.25, req: { id: 'drill', min: 2 }, effect: { type: 'unit', unit: 'light' } },
        { id: 'plunder', branch: 'war', name: 'Grabież', desc: 'Większy udźwig łupu atakujących jednostek.', max: 10, base: 14, factor: 1.27, req: { id: 'u_light', min: 3 }, effect: { type: 'carry', per: 0.05 } },
        { id: 'u_ram', branch: 'war', name: 'Taran', desc: 'Atak i obrona Tarana.', max: 10, base: 12, factor: 1.25, req: { id: 'drill', min: 3 }, effect: { type: 'unit', unit: 'ram' } },
        { id: 'siege', branch: 'war', name: 'Machiny oblężnicze', desc: 'Tarany skuteczniej kruszą mur: w trakcie bitwy i po wygranej.', max: 5, base: 20, factor: 1.3, req: { id: 'u_ram', min: 3 }, effect: { type: 'siege', per: 0.10 } },
        { id: 'tactics', branch: 'war', name: 'Taktyka', desc: 'Mniej pecha w Twoich atakach – najgorsze szczęście bitwy jest łagodniejsze.', max: 4, base: 14, factor: 1.3, req: { id: 'drill', min: 4 }, effect: { type: 'tactics', per: 0.2 } },
        // --- Wojsko – obrona: korzeń Pospolite ruszenie; jednostki obrony niezależne od siebie ---
        { id: 'militia', branch: 'def', name: 'Pospolite ruszenie', desc: 'Stała obrona każdej Twojej wioski, także bez żołnierzy.', max: 5, base: 8, factor: 1.3, req: null, effect: { type: 'militia', per: 8 } },
        { id: 'u_spear', branch: 'def', name: 'Pikinier', desc: 'Atak i obrona Pikiniera.', max: 10, base: 10, factor: 1.25, req: { id: 'militia', min: 1 }, effect: { type: 'unit', unit: 'spear' } },
        { id: 'u_archer', branch: 'def', name: 'Łucznik', desc: 'Atak i obrona Łucznika.', max: 10, base: 10, factor: 1.25, req: { id: 'militia', min: 1 }, effect: { type: 'unit', unit: 'archer' } },
        { id: 'u_guard', branch: 'def', name: 'Tarczownik', desc: 'Atak i obrona Tarczownika.', max: 10, base: 10, factor: 1.25, req: { id: 'militia', min: 2 }, effect: { type: 'unit', unit: 'guard' } },
        { id: 'hide', branch: 'def', name: 'Skrytki', desc: 'Większa część magazynu ukryta przed łupieżcami.', max: 5, base: 14, factor: 1.3, req: { id: 'militia', min: 3 }, effect: { type: 'hide', per: 0.03 } },
        { id: 'fort', branch: 'def', name: 'Fortyfikacje', desc: 'Mocniejszy bonus muru w Twoich wioskach.', max: 10, base: 25, factor: 1.27, req: { id: 'militia', min: 5 }, effect: { type: 'fort', per: 0.03 } },
        // --- Gospodarka ---
        { id: 'trade', branch: 'eco', name: 'Kupiectwo', desc: 'Lepszy kurs wymiany surowców w Targowisku.', max: 5, base: 10, factor: 1.3, req: null, effect: { type: 'exchange', per: 0.02 } },
        { id: 'store', branch: 'eco', name: 'Magazyny', desc: 'Większa pojemność magazynów we wszystkich wioskach.', max: 10, base: 12, factor: 1.25, req: { id: 'trade', min: 1 }, effect: { type: 'storage', per: 0.10 } },
        { id: 'agri', branch: 'eco', name: 'Rolnictwo', desc: 'Więcej miejsca na farmach we wszystkich wioskach.', max: 10, base: 14, factor: 1.25, req: { id: 'store', min: 2 }, effect: { type: 'pop', per: 0.05 } },
        { id: 'build', branch: 'eco', name: 'Budownictwo', desc: 'Krótszy czas budowy.', max: 10, base: 15, factor: 1.25, req: { id: 'store', min: 3 }, effect: { type: 'build', per: -0.03 } },
        { id: 'mint', branch: 'eco', name: 'Mennica', desc: 'Większy limit zakupu monet w każdej wiosce (monet na godzinę).', max: 5, base: 15, factor: 1.3, req: { id: 'trade', min: 2 }, effect: { type: 'mint', per: 2 } },
        { id: 'caravan', branch: 'eco', name: 'Karawany', desc: 'Kupcy wożą więcej: wymiana, transporty i konwoje między wioskami.', max: 5, base: 12, factor: 1.3, req: { id: 'trade', min: 2 }, effect: { type: 'caravan', per: 0.15 } },
        // --- Produkcja ---
        { id: 'tools', branch: 'prod', name: 'Narzędzia', desc: 'Większa produkcja wszystkich surowców we wszystkich wioskach.', max: 5, base: 12, factor: 1.3, req: null, effect: { type: 'prod', per: 0.02 } },
        { id: 'p_wood', branch: 'prod', name: 'Leśnictwo', desc: 'Większa produkcja drewna.', max: 10, base: 15, factor: 1.27, req: { id: 'tools', min: 2 }, effect: { type: 'prodWood', per: 0.03 } },
        { id: 'p_clay', branch: 'prod', name: 'Ceglarstwo', desc: 'Większa produkcja gliny.', max: 10, base: 15, factor: 1.27, req: { id: 'tools', min: 2 }, effect: { type: 'prodClay', per: 0.03 } },
        { id: 'p_iron', branch: 'prod', name: 'Górnictwo', desc: 'Większa produkcja żelaza.', max: 10, base: 15, factor: 1.27, req: { id: 'tools', min: 2 }, effect: { type: 'prodIron', per: 0.03 } },
        // --- Królestwo (późna gra) ---
        { id: 'admin', branch: 'realm', name: 'Administracja', desc: 'Dłuższe kolejki budowy i rekrutacji we wszystkich wioskach.', max: 2, base: 120, factor: 2, req: null, effect: { type: 'queue', per: 1 } },
        { id: 'roads', branch: 'realm', name: 'Trakty', desc: 'Szybszy marsz Twoich wojsk i osadników (ataki, wsparcie, powroty).', max: 10, base: 25, factor: 1.27, req: { id: 'admin', min: 1 }, effect: { type: 'march', per: -0.03 } },
        { id: 'medic', branch: 'realm', name: 'Lazaret', desc: 'Część poległych w Twoich atakach wraca ranna do domu zamiast ginąć.', max: 10, base: 25, factor: 1.27, req: { id: 'admin', min: 1 }, effect: { type: 'heal', per: 0.03 } },
        { id: 'command', branch: 'realm', name: 'Dowództwo', desc: 'Twoi Dowódcy podboju mocniej obniżają poparcie.', max: 5, base: 40, factor: 1.35, req: { id: 'roads', min: 3 }, effect: { type: 'command', per: 3 } },
        { id: 'faith', branch: 'realm', name: 'Wiara', desc: 'Wrodzy Dowódcy słabiej obniżają poparcie Twoich wiosek.', max: 5, base: 40, factor: 1.35, req: { id: 'medic', min: 3 }, effect: { type: 'faith', per: 0.08 } }
      ]
    },

    // Szablony „Buduj we wszystkich wioskach”: [budynek, docelowy poziom]. Zawsze celują w maksymalny poziom (LEVELS).
    // Wioska buduje najpierw to, co jest najdalej od celu; poziom częściowy wybierzesz trybem „Jeden budynek”.
    BUILD_TEMPLATES: {
      eco:   { label: 'Gospodarka', desc: 'Tartak, Cegielnia, Kopalnia, Ratusz i Farma do maksymalnego poziomu.',
               items: [['wood', LEVELS], ['clay', LEVELS], ['iron', LEVELS], ['hq', LEVELS], ['farm', LEVELS]] },
      res:   { label: 'Surowce', desc: 'Tylko Tartak, Cegielnia i Kopalnia do maksymalnego poziomu, po równo. Bez Ratusza: wioska zatrzyma się na poziomie Ratusza + 2.',
               items: [['wood', LEVELS], ['clay', LEVELS], ['iron', LEVELS]] },
      army:  { label: 'Wojsko', desc: 'Koszary, Farma, Mur i Ratusz do maksymalnego poziomu.',
               items: [['barracks', LEVELS], ['farm', LEVELS], ['wall', LEVELS], ['hq', LEVELS]] },
      trade: { label: 'Handel', desc: 'Targowisko (kupcy i monety) i Ratusz do maksymalnego poziomu.',
               items: [['market', LEVELS], ['hq', LEVELS]] },
      all:   { label: 'Pełna rozbudowa', desc: 'Wszystkie budynki do maksymalnego poziomu, po równo. Drogie i długie – pochłania nadwyżki surowców.',
               items: [['hq', LEVELS], ['wood', LEVELS], ['clay', LEVELS], ['iron', LEVELS], ['farm', LEVELS], ['barracks', LEVELS], ['market', LEVELS], ['wall', LEVELS]] }
    },
    // Autopilot (pilot.js): bot rozwijający Twoje wioski. Czasy w sekundach/minutach CZASU GRY.
    PILOT: {
      defaults: { on: false, build: true, recruit: 'defense', tech: true, defend: true, defLevel: 40, convoy: false, hub: null, settle: false, settleMax: 0 },
      tickSec: 60,               // co ile sekund bot sprawdza wioski
      alertDelaySec: 1,          // po wykryciu nowego ataku bot działa po tylu sekundach
      buildDepth: 2,             // ile budów trzyma w kolejce każda wioska
      recruitDepth: 2,           // ile zleceń rekrutacji trzyma w kolejce
      batchMin: 20,              // maks. czas jednego zlecenia (minuty) – bot reaguje na zmiany
      farmUrgent: 0.85,          // zajętość farmy, od której Farma ma pierwszeństwo
      storeUrgent: 0.85,         // zapełnienie magazynu, od którego Ratusz ma pierwszeństwo
      storeSpend: 0.9,           // od tego zapełnienia wydaje na wojsko wszystko (nic się nie marnuje)
      recruitShare: 0.8,         // jaką część nadwyżki (ponad rezerwę na budynek) wydaje na wojsko
      scouts: 3,                 // tylu zwiadowców trzyma w każdej wiosce
      supportShare: 0.6,         // maks. część obrońców wysyłana z wioski jako posiłki
      supportMin: 5,             // mniejszych oddziałów nie wysyła
      supportGoal: 3,            // cel obrony atakowanej wioski = punkty × defLevel × ta wartość
      recallMin: 10,             // po tylu minutach od ostatniego ataku posiłki wracają do domu
      coinFrom: 0.85, coinTo: 0.6, // zakup monet: gdy magazyn > coinFrom, schodzi do coinTo
      logMax: 30,
      settleRanges: [5, 8],      // w jakim promieniu od wioski macierzystej bot szuka miejsca na osadę (najpierw bliżej)
      settleDefMin: 0.5,         // osadników szkoli tylko wioska z obroną co najmniej tej części celu
      settleFoeDist: 2.5,        // nie zakłada osad bliżej niż tyle pól od wioski innej frakcji (wolne osady bez właściciela nie liczą się)
      buildWeights: { hq: 1, wood: 1.1, clay: 1.1, iron: 1.1, farm: 1, barracks: 0.8, market: 0.5, wall: 0.7 },
      techPriority: [['militia', 2], ['tools', 2], ['trade', 1], ['store', 3], ['u_spear', 3], ['u_archer', 3], ['u_guard', 3],
        ['p_wood', 3], ['p_clay', 3], ['p_iron', 3], ['agri', 3], ['build', 3], ['drill', 2], ['militia', 5], ['hide', 3], ['fort', 3],
        ['u_spear', 6], ['u_archer', 6], ['u_guard', 6], ['tools', 5], ['store', 6], ['agri', 6], ['build', 6],
        ['p_wood', 6], ['p_clay', 6], ['p_iron', 6], ['fort', 6], ['hide', 5], ['mint', 3], ['caravan', 2], ['admin', 2]]
    },

    // Konwoje (automatyczne odsyłanie nadwyżek do wioski centralnej)
    AUTO: { everyMin: [5, 15, 30], defaults: { high: 80, keep: 40, everyMin: 15, coins: true } },

    // Dyplomacja (diplomacy.js): nastawienie frakcji AI, pakty o nieagresji, dary, zdrada.
    // Czasy w minutach, tempo zmian nastawienia w punktach NA GODZINĘ. Nastawienie: -100 (wróg) … +100 (przyjaciel).
    DIPLO: {
      pactMin: 360,              // czas trwania paktu o nieagresji
      breakNoticeMin: 20,        // wypowiedzenie: tyle minut pakt jeszcze chroni po zerwaniu
      renewWindowMin: 45,        // AI proponuje przedłużenie, gdy do końca paktu zostaje tyle minut
      warnMin: 30,               // ostrzeżenie o wygasaniu paktu gracza
      maxPacts: 2, playerMaxPacts: 3,
      offerTtlMin: 180,          // oferta AI dla gracza wygasa po tylu minutach
      rejectCoolMin: 30,         // po odrzuceniu propozycji kolejna dopiero po tylu minutach
      breakPenalty: 40,          // o tyle spada nastawienie ofiary zerwanego paktu do zrywającego
      repPerBreak: 1,            // zerwanie paktu: punkt nieufności u wszystkich (maleje w czasie)
      repDecayHours: 8,          // tyle godzin znika 1 punkt nieufności
      hitWin: 12, hitLoss: 5, hitConquer: 30, allyOutrage: 6, // spadek nastawienia po ataku (wygrany / przegrany / z podbojem)
      signBonus: 8,              // wzrost nastawienia po podpisaniu paktu
      giftPerRes: 600,           // tyle surowców daje +1 do nastawienia
      giftMax: 20, giftCoolMin: 20, // maks. wzrost z jednego daru i przerwa między darami dla tej samej frakcji
      leaderShare: 0.6           // frakcja z tą częścią celu zwycięstwa jest „liderem”: nikt nie zawiera z nią paktu, wszyscy chętniej ją atakują
    },

    // Nowa wioska założona przez Osadnika
    SETTLE: {
      buildings: { hq: 1, wood: 1, clay: 1, iron: 1, farm: 1, barracks: 0, market: 0, wall: 0 },
      resources: { wood: 300, clay: 300, iron: 200 },
      minDistance: 1.5                           // minimalna odległość od innej wioski
    },

    // speed = sekundy na jedno pole mapy; carry = udźwig łupu; pop = miejsce na farmie
    // role: 'def' – AI część takich jednostek zostawia w domu; wallPower: ile "taranów" liczy jednostka przy burzeniu muru.
    // Koszty: każda jednostka ma inny dominujący surowiec (Łucznik, Topornik – drewno; Pikinier, Zwiadowca, Taran, Dowódca – glina;
    // Lekka kawaleria – żelazo), a w typowej armii żelazo to ok. 1/4 kosztu – dzięki temu żelaza nie brakuje w późnej grze.
    UNITS: {
      spear: {
        name: 'Pikinier', desc: 'Tani i wytrzymały w obronie.',
        cost: { wood: 37, clay: 38, iron: 21 }, time: 6,
        att: 10, def: 25, speed: 14, pop: 1, carry: 25, barracks: 1, role: 'def'
      },
      archer: {
        name: 'Łucznik', desc: 'Łuk i strzały z drewna – obrona prawie bez żelaza.',
        cost: { wood: 60, clay: 40, iron: 15 }, time: 7,
        att: 15, def: 28, speed: 14, pop: 1, carry: 15, barracks: 2, role: 'def'
      },
      guard: {
        name: 'Tarczownik', desc: 'Ciężka piechota z tarczą – najlepsza obrona na jedno miejsce na farmie. Odblokowuje się w Koszarach 3.',
        cost: { wood: 45, clay: 50, iron: 60 }, time: 10,
        att: 20, def: 48, speed: 16, pop: 1, carry: 15, barracks: 3, role: 'def'
      },
      axe: {
        name: 'Topornik', desc: 'Silny w ataku, słaby w obronie.',
        cost: { wood: 44, clay: 30, iron: 39 }, time: 8,
        att: 40, def: 10, speed: 14, pop: 1, carry: 10, barracks: 2
      },
      scout: {
        name: 'Zwiadowca', desc: 'Przegląda wojsko, surowce i budynki wroga. Chroni przed szpiegami.',
        cost: { wood: 25, clay: 55, iron: 21 }, time: 5,
        att: 0, def: 2, speed: 5, pop: 2, carry: 0, barracks: 1, scout: true
      },
      light: {
        name: 'Lekka kawaleria', desc: 'Szybka i groźna, dużo zabiera łupów.',
        cost: { wood: 100, clay: 90, iron: 170 }, time: 16,
        att: 120, def: 28, speed: 7, pop: 3, carry: 80, barracks: 3
      },
      ram: {
        name: 'Taran', desc: 'Kruszy mur obronny wroga. Wolny i słaby w walce.',
        cost: { wood: 190, clay: 320, iron: 140 }, time: 25,
        att: 2, def: 20, speed: 30, pop: 5, carry: 0, barracks: 4, wallPower: 1
      },
      noble: {
        name: 'Dowódca podboju', desc: 'Obniża poparcie wioski frakcji. Przy 0 wioska przechodzi na Ciebie.',
        cost: { wood: 950, clay: 1250, iron: 900 }, time: 60,
        att: 30, def: 100, speed: 22, pop: 20, carry: 0, barracks: 5, conquer: true
      },
      settler: {
        name: 'Osadnik', desc: 'Zakłada nową wioskę na pustej równinie.',
        cost: { wood: 850, clay: 950, iron: 600 }, time: 45,
        att: 0, def: 5, speed: 20, pop: 10, carry: 0, barracks: 1, hq: 4, settler: true
      }
    },

    // Moc konta: punkty za budynki (1 pkt za poziom) + punkty za wojsko.
    // Punkty jednostki = suma jej kosztu / costDivisor (np. Pikinier ~1, Lekka kaw. ~3,6, Dowódca ~31).
    SCORE: { costDivisor: 100 },

    SPY: { lossExponent: 1.5 },

    COMBAT: {
      baseDefense: 20,           // pospolite ruszenie – każda wioska ma minimalną obronę
      lossExponent: 1.5,         // straty zwycięzcy = (siła przegranego / siła zwycięzcy)^wykładnik
      luck: 0.10                 // szczęście ±10% siły ataku
    },

    LOYALTY: {
      max: 100,
      regenPerMin: 1,
      dropMin: 25,
      dropMax: 40,
      afterConquest: 25
    },

    NEUTRAL: {
      name: 'Wolna osada',
      color: '#8d8573',
      prodFactor: 0.5,
      spearBase: 4,
      spearPerDist: 1.5,
      axePerDist: 0.6,
      lightFromDist: 7,
      startRes: 300,
      regenPerHour: 0.25,          // po najeździe wolna osada odtwarza 25% swojej stałej załogi na godzinę
      // Podbój: każda wygrana w trybie Podbój obniża poparcie o dropMin–dropMax (z Dowódcą + jego zwykły spadek);
      // przy 0% osada przechodzi na zwycięzcę. Poparcie odnawia się jak w każdej wiosce (LOYALTY.regenPerMin).
      dropMin: 35, dropMax: 50,
      loyaltyRegenPerMin: 0.25,    // poparcie wolnej osady wraca wolniej niż w wioskach frakcji (15 p.p. na godzinę)
      // Rozwój: co growEveryMin minut +1 poziom budynku (najpierw najniższy względem limitu z growMax),
      // a stała załoga rośnie o garrisonPerLevel (np. 0.12 = +12% na każdy zdobyty poziom).
      growEveryMin: 60,
      growMax: { wood: 10, clay: 10, iron: 10, hq: 8, farm: 8, wall: 6 },
      garrisonPerLevel: 0.12
    },

    PLAYER: { name: 'Twoje plemię', color: '#2f62c9' },

    AI: {
      thinkInterval: 20,         // co ile sekund frakcja podejmuje decyzje
      prodFactor: 1.1,           // mnożnik produkcji AI (poziom trudności)
      graceMinutes: 10,          // przez tyle minut AI nie atakuje gracza
      maxOrder: 120,             // maks. liczba jednostek w jednym zleceniu AI
      // Ulepszenia jednostek AI (odpowiednik badań gracza): rosną same z czasem gry, tempo × DIFFICULTY.aiTech.
      // Każdy poziom = +TECH.unitBonus ataku i obrony, jak u gracza. Frakcja najpierw ulepsza jednostki, których używa najchętniej.
      tech: { minutesPerLevel: 45, startAfterMin: 30, max: 10 },
      // Miejsce na farmach AI rośnie z czasem gry: +perHour na godzinę (ułamek bazy), do +max. Wyłączone, gdy poziom trudności ma aiTech 0.
      popGrowth: { perHour: 0.015, max: 1.5 },
      // Limit wiosek AI rośnie z czasem: +perStep co everyHours (× mnożnik aiExpand trudności), do ceilingShare celu zwycięstwa świata.
      // ceilingShareRace: sufit w trybie Wyścig (AI może dojść do celu zwycięstwa).
      // zoneFadeHours: po tylu godzinach gry strefa ochronna wokół wiosek gracza (DIFFICULTY.playerZone) znika.
      growth: { everyHours: 3, perStep: 1, ceilingShare: 0.5, ceilingShareRace: 1, zoneFadeHours: 24 },
      // Taktyka wspólna dla wszystkich frakcji (ai.js)
      tactics: {
        buildQueue: 3,           // ile budów AI trzyma w kolejce
        recruitQueue: 5,         // ile zleceń rekrutacji AI trzyma w kolejce
        farmUrgent: 0.85,        // zajętość farmy, od której Farma ma pierwszeństwo
        storeUrgent: 0.8,        // zapełnienie magazynu, od którego Ratusz (magazyn) ma pierwszeństwo
        storeSpend: 0.55,        // od tego zapełnienia AI wydaje na wojsko wszystko (nic się nie marnuje)
        settleChance: 0.8,       // szansa na turę, że wolna wioska zacznie szkolić osadnika
        settleRange: 5,          // maks. odległość nowej osady od wioski macierzystej
        supportRange: 6,         // z jak daleka AI wysyła posiłki do atakowanej wioski
        supportShare: 0.5,       // maks. część obrońców wysyłana jako posiłki
        lootScale: 3000,         // ile surowców w celu podwaja jego atrakcyjność
        gatherRange: 7,          // z jak daleka frakcja ściąga jednostki ataku do wioski frontowej
        powerPerPoint: 80,       // min. siła wyprawy = (minPower osobowości + punkty wioski × ta wartość) × mnożnik czasu gry
        waveGrowthPerHour: 0.05, // o tyle rośnie mnożnik min. siły wyprawy z każdą godziną gry (armie rosną razem z gospodarką)
        waveGrowthMax: 6,        // sufit mnożnika (po ok. 100 godzinach gry)
        // raids (osobowość): chęć grabienia wolnych osad po osiągnięciu limitu wiosek; 0 = nie grabi
        scoutCap: 6, siegeCap: 20
      },
      startBuildings: { hq: 3, wood: 3, clay: 3, iron: 2, farm: 2, barracks: 2 },
      startUnits: { spear: 20, axe: 10 },
      secondBuildings: { hq: 1, wood: 1, clay: 1, iron: 1, farm: 1, barracks: 1 },
      secondUnits: { spear: 8 },
      factions: [
        { id: 'ai1', name: 'Czerwony Klan', color: '#c23a2b', personality: 'aggressive' },
        { id: 'ai2', name: 'Kupcy z Doliny', color: '#3f8f3a', personality: 'economic' },
        { id: 'ai3', name: 'Strażnicy Grani', color: '#7a4bb0', personality: 'defensive' },
        { id: 'ai4', name: 'Wilcza Horda', color: '#d9861c', personality: 'expansionist' },
        // Dalsi przeciwnicy – używane tylko na większych mapach (patrz WORLDS)
        { id: 'ai5', name: 'Bractwo Rzeki', color: '#19a39a', personality: 'economic' },
        { id: 'ai6', name: 'Lisy z Bagien', color: '#e0679f', personality: 'aggressive' },
        { id: 'ai7', name: 'Zakon Białej Skały', color: '#d8dbe0', personality: 'defensive' },
        { id: 'ai8', name: 'Łowcy Wichru', color: '#9a9a2a', personality: 'expansionist' },
        { id: 'ai9', name: 'Kowale Gór', color: '#8b5a2b', personality: 'defensive' },
        { id: 'ai10', name: 'Ród Złotego Dębu', color: '#e4c02c', personality: 'economic' },
        { id: 'ai11', name: 'Dzicy z Puszczy', color: '#86c232', personality: 'aggressive' },
        { id: 'ai12', name: 'Synowie Burzy', color: '#7d2434', personality: 'aggressive' },
        { id: 'ai13', name: 'Straż Północy', color: '#4fb0e0', personality: 'defensive' },
        { id: 'ai14', name: 'Kupcy Szlaku', color: '#a82f8f', personality: 'economic' },
        { id: 'ai15', name: 'Hufiec Czarnego Kruka', color: '#4a4f5c', personality: 'expansionist' }
      ],
      personalities: {
        aggressive: {
          label: 'agresywna',
          // dyplomacja: baseline/cap = zakres nastawienia; warm/heal = tempo na godzinę; minAttitude = próg zgody na pakt;
          // repLimit = ile zerwanych paktów u proponującego go zniechęca; offerChance = szansa na minutę na własną propozycję;
          // betray = szansa na minutę na zdradę słabszego partnera; revenge = skala zemsty; leaderBias = zapał do atakowania lidera
          diplo: { baseline: -10, cap: 25, warm: 1.5, heal: 3, minAttitude: 5, repLimit: 3, offerChance: 0.004, betray: 0.006, revenge: 30, leaderBias: 0.5 },
          buildWeights: { hq: 1, wood: 1, clay: 1, iron: 1.2, farm: 1.2, barracks: 1.5, market: 0.4, wall: 0.6 },
          unitWeights: { spear: 1, axe: 4, scout: 0.3, light: 3, ram: 0.5, archer: 0.5, guard: 0.4 },
          recruitShare: 0.9, attackChance: 0.6, attackRatio: 1.3, keepHome: 0.2,
          minPower: 250, range: 8, targets: 'any', anyAfterMin: 0,
          neutralBias: 1, playerBias: 1.6, nobles: true, maxVillages: 12, settle: false, spyChance: 0.15,
          homeDef: 28, waves: 2, gatherChance: 0.15, raids: 1.2
        },
        economic: {
          label: 'gospodarcza',
          // dyplomacja: baseline/cap = zakres nastawienia; warm/heal = tempo na godzinę; minAttitude = próg zgody na pakt;
          // repLimit = ile zerwanych paktów u proponującego go zniechęca; offerChance = szansa na minutę na własną propozycję;
          // betray = szansa na minutę na zdradę słabszego partnera; revenge = skala zemsty; leaderBias = zapał do atakowania lidera
          diplo: { baseline: 10, cap: 60, warm: 3, heal: 5, minAttitude: -5, repLimit: 2, offerChance: 0.02, betray: 0, revenge: 60, leaderBias: 1 },
          buildWeights: { hq: 1.3, wood: 1.5, clay: 1.5, iron: 1.4, farm: 1, barracks: 0.7, market: 0.6, wall: 0.8 },
          unitWeights: { spear: 2, axe: 1, scout: 0.2, light: 1, ram: 0.1, archer: 2, guard: 1.5 },
          recruitShare: 0.65, attackChance: 0.25, attackRatio: 2.0, keepHome: 0.5,
          minPower: 300, range: 6, targets: 'neutral', anyAfterMin: 30,
          neutralBias: 2, playerBias: 0.8, nobles: true, maxVillages: 8, settleMax: 12, settle: true, spyChance: 0.05,
          homeDef: 30, waves: 1, gatherChance: 0.1, raids: 1
        },
        defensive: {
          label: 'obronna',
          // dyplomacja: baseline/cap = zakres nastawienia; warm/heal = tempo na godzinę; minAttitude = próg zgody na pakt;
          // repLimit = ile zerwanych paktów u proponującego go zniechęca; offerChance = szansa na minutę na własną propozycję;
          // betray = szansa na minutę na zdradę słabszego partnera; revenge = skala zemsty; leaderBias = zapał do atakowania lidera
          diplo: { baseline: 5, cap: 60, warm: 2.5, heal: 4, minAttitude: 0, repLimit: 2, offerChance: 0.015, betray: 0, revenge: 50, leaderBias: 0.8 },
          buildWeights: { hq: 1.2, wood: 1.2, clay: 1.2, iron: 1, farm: 1.4, barracks: 1, market: 0.4, wall: 1.4 },
          unitWeights: { spear: 5, axe: 1, scout: 0.5, light: 0.5, ram: 0, archer: 4, guard: 5 },
          recruitShare: 0.75, attackChance: 0.2, attackRatio: 2.5, keepHome: 0.8,
          minPower: 300, range: 5, targets: 'neutral', anyAfterMin: 45,
          neutralBias: 2, playerBias: 0.6, nobles: false, maxVillages: 6, settleMax: 7, settle: true, spyChance: 0.05,
          homeDef: 45, waves: 1, gatherChance: 0, raids: 0.5
        },
        expansionist: {
          label: 'ekspansywna',
          // dyplomacja: baseline/cap = zakres nastawienia; warm/heal = tempo na godzinę; minAttitude = próg zgody na pakt;
          // repLimit = ile zerwanych paktów u proponującego go zniechęca; offerChance = szansa na minutę na własną propozycję;
          // betray = szansa na minutę na zdradę słabszego partnera; revenge = skala zemsty; leaderBias = zapał do atakowania lidera
          diplo: { baseline: -5, cap: 40, warm: 2, heal: 3, minAttitude: 10, repLimit: 3, offerChance: 0.006, betray: 0.004, revenge: 35, leaderBias: 0.7 },
          buildWeights: { hq: 1.2, wood: 1.1, clay: 1.1, iron: 1.1, farm: 1.2, barracks: 1.3, market: 0.4, wall: 0.6 },
          unitWeights: { spear: 1, axe: 3, scout: 0.3, light: 2, ram: 0.3, archer: 0.5, guard: 0.4 },
          recruitShare: 0.85, attackChance: 0.5, attackRatio: 1.5, keepHome: 0.3,
          minPower: 200, range: 9, targets: 'any', anyAfterMin: 0,
          neutralBias: 2.5, playerBias: 1, nobles: true, maxVillages: 13, settleMax: 17, settle: true, spyChance: 0.1,
          homeDef: 25, waves: 2, gatherChance: 0.12, raids: 0.8
        }
      }
    },

    NAMES: {
      prefix: ['Dęb', 'Wilk', 'Kamien', 'Brzez', 'Ols', 'Lip', 'Sosn', 'Głog', 'Mokr', 'Jawor',
        'Świerk', 'Grab', 'Czarn', 'Biał', 'Złot', 'Bor', 'Kruk', 'Jodł', 'Wrzos', 'Modrz',
        'Łęcz', 'Strzel', 'Sok', 'Żuraw', 'Rud', 'Bystr', 'Cis', 'Las', 'Mszan', 'Gaj'],
      suffix: ['owo', 'ice', 'ów', 'ka', 'in', 'owa Wola', 'owiec', 'owa Góra', 'no', 'nik', 'ary', 'isko']
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
