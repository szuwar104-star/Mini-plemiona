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
    SAVE_VERSION: 4,

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
    WIN_VILLAGES: 20,
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
      units: { spear: 12, axe: 0, scout: 0, light: 0, ram: 0, noble: 0, settler: 0 }
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

    // Nowa wioska założona przez Osadnika
    SETTLE: {
      buildings: { hq: 1, wood: 1, clay: 1, iron: 1, farm: 1, barracks: 0, market: 0, wall: 0 },
      resources: { wood: 300, clay: 300, iron: 200 },
      minDistance: 1.5                           // minimalna odległość od innej wioski
    },

    // speed = sekundy na jedno pole mapy; carry = udźwig łupu; pop = miejsce na farmie
    UNITS: {
      spear: {
        name: 'Pikinier', desc: 'Tani i wytrzymały w obronie.',
        cost: { wood: 33, clay: 30, iron: 33 }, time: 6,
        att: 10, def: 25, speed: 14, pop: 1, carry: 25, barracks: 1
      },
      axe: {
        name: 'Topornik', desc: 'Silny w ataku, słaby w obronie.',
        cost: { wood: 38, clay: 25, iron: 50 }, time: 8,
        att: 40, def: 10, speed: 14, pop: 1, carry: 10, barracks: 2
      },
      scout: {
        name: 'Zwiadowca', desc: 'Przegląda wojsko, surowce i budynki wroga. Chroni przed szpiegami.',
        cost: { wood: 33, clay: 40, iron: 28 }, time: 5,
        att: 0, def: 2, speed: 5, pop: 2, carry: 0, barracks: 1, scout: true
      },
      light: {
        name: 'Lekka kawaleria', desc: 'Szybka i groźna, dużo zabiera łupów.',
        cost: { wood: 100, clay: 100, iron: 160 }, time: 16,
        att: 130, def: 30, speed: 7, pop: 4, carry: 80, barracks: 3
      },
      ram: {
        name: 'Taran', desc: 'Kruszy mur obronny wroga. Wolny i słaby w walce.',
        cost: { wood: 220, clay: 230, iron: 200 }, time: 25,
        att: 2, def: 20, speed: 30, pop: 5, carry: 0, barracks: 4
      },
      noble: {
        name: 'Dowódca podboju', desc: 'Obniża poparcie wioski frakcji. Przy 0 wioska przechodzi na Ciebie.',
        cost: { wood: 950, clay: 1100, iron: 1050 }, time: 60,
        att: 30, def: 100, speed: 22, pop: 20, carry: 0, barracks: 5, conquer: true
      },
      settler: {
        name: 'Osadnik', desc: 'Zakłada nową wioskę na pustej równinie.',
        cost: { wood: 800, clay: 850, iron: 750 }, time: 45,
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
      startUnits: { spear: 20, axe: 10, scout: 0, light: 0, ram: 0, noble: 0, settler: 0 },
      secondBuildings: { hq: 1, wood: 1, clay: 1, iron: 1, farm: 1, barracks: 1 },
      secondUnits: { spear: 8, axe: 0, scout: 0, light: 0, ram: 0, noble: 0, settler: 0 },
      factions: [
        { id: 'ai1', name: 'Czerwony Klan', color: '#c23a2b', personality: 'aggressive' },
        { id: 'ai2', name: 'Kupcy z Doliny', color: '#3f8f3a', personality: 'economic' },
        { id: 'ai3', name: 'Strażnicy Grani', color: '#7a4bb0', personality: 'defensive' },
        { id: 'ai4', name: 'Wilcza Horda', color: '#d9861c', personality: 'expansionist' }
      ],
      personalities: {
        aggressive: {
          label: 'agresywna',
          buildWeights: { hq: 1, wood: 1, clay: 1, iron: 1.2, farm: 1.2, barracks: 1.5, market: 0.4, wall: 0.6 },
          unitWeights: { spear: 1, axe: 4, scout: 0.3, light: 3, ram: 0.5 },
          recruitShare: 0.7, attackChance: 0.6, attackRatio: 1.3, keepHome: 0.2,
          minPower: 250, range: 8, targets: 'any', anyAfterMin: 0,
          neutralBias: 1, playerBias: 1.6, nobles: true, maxVillages: 10, settle: false, spyChance: 0.15
        },
        economic: {
          label: 'gospodarcza',
          buildWeights: { hq: 1.3, wood: 1.5, clay: 1.5, iron: 1.4, farm: 1, barracks: 0.7, market: 0.6, wall: 0.8 },
          unitWeights: { spear: 2, axe: 1, scout: 0.2, light: 1, ram: 0.1 },
          recruitShare: 0.35, attackChance: 0.25, attackRatio: 2.0, keepHome: 0.5,
          minPower: 300, range: 6, targets: 'neutral', anyAfterMin: 30,
          neutralBias: 2, playerBias: 0.8, nobles: true, maxVillages: 7, settleMax: 11, settle: true, spyChance: 0.05
        },
        defensive: {
          label: 'obronna',
          buildWeights: { hq: 1.2, wood: 1.2, clay: 1.2, iron: 1, farm: 1.4, barracks: 1, market: 0.4, wall: 1.4 },
          unitWeights: { spear: 5, axe: 1, scout: 0.5, light: 0.5, ram: 0 },
          recruitShare: 0.5, attackChance: 0.2, attackRatio: 2.5, keepHome: 0.8,
          minPower: 300, range: 5, targets: 'neutral', anyAfterMin: 45,
          neutralBias: 2, playerBias: 0.6, nobles: false, maxVillages: 5, settle: false, spyChance: 0
        },
        expansionist: {
          label: 'ekspansywna',
          buildWeights: { hq: 1.2, wood: 1.1, clay: 1.1, iron: 1.1, farm: 1.2, barracks: 1.3, market: 0.4, wall: 0.6 },
          unitWeights: { spear: 1, axe: 3, scout: 0.3, light: 2, ram: 0.3 },
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
