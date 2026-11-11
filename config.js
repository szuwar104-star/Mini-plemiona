/* =========================================================================
   Mini Plemiona – KONFIGURACJA I BALANS
   Wszystkie parametry rozgrywki są w tym pliku. Zmiana wartości tutaj
   zmienia zachowanie gry – żaden inny plik nie zawiera liczb balansu.
   Czasy podawane są w SEKUNDACH, produkcja w jednostkach NA MINUTĘ.
   ========================================================================= */
(function (root) {
  'use strict';
  const MP = root.MP = root.MP || {};
  const LEVELS = 10;

  // Tabela wartości dla poziomów 1..10 (indeks 0 = poziom 0).
  function series(base, factor, roundTo) {
    const out = [0];
    for (let lvl = 1; lvl <= LEVELS; lvl++) {
      const v = base * Math.pow(factor, lvl - 1);
      out.push(Math.max(roundTo, Math.round(v / roundTo) * roundTo));
    }
    return out;
  }
  function cost(wood, clay, iron, factor) {
    return { wood: series(wood, factor, 5), clay: series(clay, factor, 5), iron: series(iron, factor, 5) };
  }

  MP.CONFIG = {
    SAVE_VERSION: 8,

    // Poziomy trudności – mnożniki dla gracza i AI.
    // playerProd / aiProd: produkcja surowców; graceMinutes: ochrona gracza na starcie;
    // aiAggro: jak często AI atakuje; playerBias: jak chętnie AI wybiera gracza;
    // aiCaution: jakiej przewagi AI potrzebuje do ataku; lootProtect: część magazynu
    // gracza ukryta przed łupieniem; hitCooldownMin: przerwa między atakami AI na tę samą wioskę gracza;
    // aiExpand: mnożnik limitu wiosek AI; playerZone: promień (w polach) wokół wiosek gracza, w którym AI nie zajmuje wolnych osad ani pól.
    DEFAULT_DIFFICULTY: 'normal',
    DIFFICULTY: {
      easy:   { label: 'Łatwy',    desc: 'Spokojny rozwój. AI rzadko atakuje i wolniej rośnie.',
                playerProd: 1.3, aiProd: 0.6, graceMinutes: 40, aiAggro: 0.4, playerBias: 0.4, aiCaution: 1.5, lootProtect: 0.4, hitCooldownMin: 15,
                aiExpand: 0.5, playerZone: 4 },
      normal: { label: 'Normalny', desc: 'Wyważona rozgrywka. AI naciska, ale da się je wyprzedzić.',
                playerProd: 1.15, aiProd: 0.72, graceMinutes: 25, aiAggro: 0.7, playerBias: 0.7, aiCaution: 1.2, lootProtect: 0.25, hitCooldownMin: 8,
                aiExpand: 0.7, playerZone: 3 },
      hard:   { label: 'Trudny',   desc: 'Agresywne i szybkie AI. Dla doświadczonych.',
                playerProd: 1, aiProd: 0.95, graceMinutes: 10, aiAggro: 1, playerBias: 1, aiCaution: 1, lootProtect: 0.1, hitCooldownMin: 0,
                aiExpand: 1, playerZone: 0 }
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
        time: series(5, 1.55, 1),
        storage: [800, 1200, 1600, 2100, 2800, 3600, 4700, 6100, 8000, 10500, 14000],
        buildSpeed: [1, 1, 0.95, 0.9, 0.86, 0.82, 0.78, 0.74, 0.7, 0.67, 0.64]
      },
      wood: {
        name: 'Tartak',
        desc: 'Produkuje drewno.',
        start: 1,
        cost: cost(40, 50, 48, 1.3),
        time: series(4, 1.5, 1),
        prod: [10, 40, 55, 74, 98, 128, 165, 210, 265, 330, 410]
      },
      clay: {
        name: 'Cegielnia',
        desc: 'Produkuje glinę.',
        start: 1,
        cost: cost(55, 40, 48, 1.3),
        time: series(4, 1.5, 1),
        prod: [10, 40, 55, 74, 98, 128, 165, 210, 265, 330, 410]
      },
      iron: {
        name: 'Kopalnia',
        desc: 'Wydobywa żelazo.',
        start: 1,
        cost: cost(60, 65, 50, 1.31),
        time: series(5, 1.5, 1),
        prod: [10, 40, 55, 74, 98, 128, 165, 210, 265, 330, 410]
      },
      farm: {
        name: 'Farma',
        desc: 'Wyżywi większą armię – zwiększa limit jednostek.',
        start: 1,
        cost: cost(45, 40, 34, 1.3),
        time: series(5, 1.5, 1),
        pop: [100, 240, 300, 380, 480, 600, 760, 960, 1200, 1500, 1900]
      },
      barracks: {
        name: 'Koszary',
        desc: 'Rekrutacja wojska. Wyższy poziom odblokowuje jednostki i skraca szkolenie.',
        start: 1,
        cost: cost(85, 85, 85, 1.33),
        time: series(6, 1.55, 1),
        recruitSpeed: [0, 1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.61, 0.56, 0.52, 0.48]
      },
      market: {
        name: 'Targowisko',
        desc: 'Kupcy przewożą surowce między Twoimi wioskami.',
        start: 0,
        cost: cost(65, 60, 60, 1.3),
        time: series(6, 1.5, 1),
        merchants: [0, 1, 2, 3, 4, 6, 8, 10, 13, 16, 20]
      },
      wall: {
        name: 'Mur obronny',
        desc: 'Zwiększa obronę wioski. Tarany wroga mogą go burzyć.',
        start: 0,
        cost: cost(55, 75, 62, 1.32),
        time: series(6, 1.5, 1),
        flat: [0, 20, 40, 60, 85, 110, 140, 170, 200, 240, 280],          // stała obrona muru
        bonus: [0, .05, .10, .16, .22, .29, .36, .44, .52, .61, .70]       // procentowy bonus obrony
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
    // effect: unit – +unitBonus ataku i obrony jednostki na poziom; pozostałe typy działają jako suma per × poziom
    // (storage, build, recruit – mnożnik wokół 1; exchange – dodatek do kursu wymiany; mint – dodatkowe monety/h na wioskę;
    // prod, prodWood, prodClay, prodIron – mnożniki produkcji wokół 1 (prod dotyczy wszystkich surowców); carry – mnożnik udźwigu łupu
    // atakujących jednostek; hide – dodatkowa część magazynu ukryta przed łupieżcami, dodawana do ochrony z poziomu trudności).
    TECH: {
      unitBonus: 0.05,
      coinPrice: 1500,
      mint: { perLevelPerHour: 3, bucketHours: 6 },
      branches: [
        { id: 'war', name: 'Wojsko' },
        { id: 'eco', name: 'Gospodarka' },
        { id: 'prod', name: 'Produkcja' }
      ],
      nodes: [
        { id: 'drill', branch: 'war', name: 'Musztra', desc: 'Szybsze szkolenie wojska.', max: 5, base: 10, factor: 1.3, req: null, effect: { type: 'recruit', per: -0.04 } },
        { id: 'u_spear', branch: 'war', name: 'Pikinier', desc: 'Atak i obrona Pikiniera.', max: 10, base: 10, factor: 1.25, req: { id: 'drill', min: 1 }, effect: { type: 'unit', unit: 'spear' } },
        { id: 'u_archer', branch: 'war', name: 'Łucznik', desc: 'Atak i obrona Łucznika.', max: 10, base: 10, factor: 1.25, req: { id: 'drill', min: 1 }, effect: { type: 'unit', unit: 'archer' } },
        { id: 'u_guard', branch: 'war', name: 'Tarczownik', desc: 'Atak i obrona Tarczownika.', max: 10, base: 10, factor: 1.25, req: { id: 'u_spear', min: 3 }, effect: { type: 'unit', unit: 'guard' } },
        { id: 'u_axe', branch: 'war', name: 'Topornik', desc: 'Atak i obrona Topornika.', max: 10, base: 10, factor: 1.25, req: { id: 'drill', min: 2 }, effect: { type: 'unit', unit: 'axe' } },
        { id: 'u_light', branch: 'war', name: 'Lekka kawaleria', desc: 'Atak i obrona Lekkiej kawalerii.', max: 10, base: 10, factor: 1.25, req: { id: 'u_axe', min: 3 }, effect: { type: 'unit', unit: 'light' } },
        { id: 'u_ram', branch: 'war', name: 'Taran', desc: 'Atak i obrona Tarana.', max: 10, base: 12, factor: 1.25, req: { id: 'u_axe', min: 4 }, effect: { type: 'unit', unit: 'ram' } },
        { id: 'plunder', branch: 'war', name: 'Grabież', desc: 'Większy udźwig łupu atakujących jednostek.', max: 10, base: 14, factor: 1.27, req: { id: 'u_light', min: 3 }, effect: { type: 'carry', per: 0.05 } },
        { id: 'hide', branch: 'war', name: 'Skrytki', desc: 'Większa część magazynu ukryta przed łupieżcami.', max: 5, base: 14, factor: 1.3, req: { id: 'u_guard', min: 3 }, effect: { type: 'hide', per: 0.03 } },
        { id: 'trade', branch: 'eco', name: 'Kupiectwo', desc: 'Lepszy kurs wymiany surowców w Targowisku.', max: 5, base: 10, factor: 1.3, req: null, effect: { type: 'exchange', per: 0.02 } },
        { id: 'store', branch: 'eco', name: 'Magazyny', desc: 'Większa pojemność magazynów we wszystkich wioskach.', max: 10, base: 12, factor: 1.25, req: { id: 'trade', min: 1 }, effect: { type: 'storage', per: 0.10 } },
        { id: 'mint', branch: 'eco', name: 'Mennica', desc: 'Większy limit zakupu monet w każdej wiosce (monet na godzinę).', max: 5, base: 15, factor: 1.3, req: { id: 'trade', min: 2 }, effect: { type: 'mint', per: 2 } },
        { id: 'build', branch: 'eco', name: 'Budownictwo', desc: 'Krótszy czas budowy.', max: 10, base: 15, factor: 1.25, req: { id: 'store', min: 3 }, effect: { type: 'build', per: -0.03 } },
        { id: 'tools', branch: 'prod', name: 'Narzędzia', desc: 'Większa produkcja wszystkich surowców we wszystkich wioskach.', max: 5, base: 12, factor: 1.3, req: null, effect: { type: 'prod', per: 0.02 } },
        { id: 'p_wood', branch: 'prod', name: 'Leśnictwo', desc: 'Większa produkcja drewna.', max: 10, base: 15, factor: 1.27, req: { id: 'tools', min: 2 }, effect: { type: 'prodWood', per: 0.03 } },
        { id: 'p_clay', branch: 'prod', name: 'Ceglarstwo', desc: 'Większa produkcja gliny.', max: 10, base: 15, factor: 1.27, req: { id: 'tools', min: 2 }, effect: { type: 'prodClay', per: 0.03 } },
        { id: 'p_iron', branch: 'prod', name: 'Górnictwo', desc: 'Większa produkcja żelaza.', max: 10, base: 15, factor: 1.27, req: { id: 'tools', min: 2 }, effect: { type: 'prodIron', per: 0.03 } }
      ]
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
        att: 130, def: 30, speed: 7, pop: 4, carry: 80, barracks: 3
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
      startRes: 300
    },

    PLAYER: { name: 'Twoje plemię', color: '#2f62c9' },

    AI: {
      thinkInterval: 20,         // co ile sekund frakcja podejmuje decyzje
      prodFactor: 1.1,           // mnożnik produkcji AI (poziom trudności)
      graceMinutes: 10,          // przez tyle minut AI nie atakuje gracza
      maxOrder: 40,              // maks. liczba jednostek w jednym zleceniu AI
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
          buildWeights: { hq: 1, wood: 1, clay: 1, iron: 1.2, farm: 1.2, barracks: 1.5, market: 0.4, wall: 0.6 },
          unitWeights: { spear: 1, axe: 4, scout: 0.3, light: 3, ram: 0.5, archer: 0.5, guard: 0.4 },
          recruitShare: 0.7, attackChance: 0.6, attackRatio: 1.3, keepHome: 0.2,
          minPower: 250, range: 8, targets: 'any', anyAfterMin: 0,
          neutralBias: 1, playerBias: 1.6, nobles: true, maxVillages: 10, settle: false, spyChance: 0.15
        },
        economic: {
          label: 'gospodarcza',
          buildWeights: { hq: 1.3, wood: 1.5, clay: 1.5, iron: 1.4, farm: 1, barracks: 0.7, market: 0.6, wall: 0.8 },
          unitWeights: { spear: 2, axe: 1, scout: 0.2, light: 1, ram: 0.1, archer: 2, guard: 1.5 },
          recruitShare: 0.35, attackChance: 0.25, attackRatio: 2.0, keepHome: 0.5,
          minPower: 300, range: 6, targets: 'neutral', anyAfterMin: 30,
          neutralBias: 2, playerBias: 0.8, nobles: true, maxVillages: 7, settleMax: 11, settle: true, spyChance: 0.05
        },
        defensive: {
          label: 'obronna',
          buildWeights: { hq: 1.2, wood: 1.2, clay: 1.2, iron: 1, farm: 1.4, barracks: 1, market: 0.4, wall: 1.4 },
          unitWeights: { spear: 5, axe: 1, scout: 0.5, light: 0.5, ram: 0, archer: 4, guard: 5 },
          recruitShare: 0.5, attackChance: 0.2, attackRatio: 2.5, keepHome: 0.8,
          minPower: 300, range: 5, targets: 'neutral', anyAfterMin: 45,
          neutralBias: 2, playerBias: 0.6, nobles: false, maxVillages: 5, settle: false, spyChance: 0
        },
        expansionist: {
          label: 'ekspansywna',
          buildWeights: { hq: 1.2, wood: 1.1, clay: 1.1, iron: 1.1, farm: 1.2, barracks: 1.3, market: 0.4, wall: 0.6 },
          unitWeights: { spear: 1, axe: 3, scout: 0.3, light: 2, ram: 0.3, archer: 0.5, guard: 0.4 },
          recruitShare: 0.55, attackChance: 0.5, attackRatio: 1.5, keepHome: 0.3,
          minPower: 200, range: 9, targets: 'any', anyAfterMin: 0,
          neutralBias: 2.5, playerBias: 1, nobles: true, maxVillages: 12, settleMax: 16, settle: true, spyChance: 0.1
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
