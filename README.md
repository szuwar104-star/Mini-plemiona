# Mini Plemiona

Strategia przeglądarkowa (PWA) w klimacie klasycznych Plemion. Jedna wioska na start, cztery frakcje AI, 24 wolne osady na mapie 15 × 15. Cel: zdobyć 20 wiosek.

Gra działa w całości lokalnie: HTML, CSS i czysty JavaScript, zapis w IndexedDB, bez backendu i bez zewnętrznych API. Przeciwnicy AI to lokalny skrypt (`ai.js`), który działa w tym samym procesorze zdarzeń co reszta gry, także „wstecznie”, gdy aplikacja była zamknięta.

## Uruchomienie

**Windows:** kliknij dwukrotnie `start.bat`. Skrypt uruchomi lokalny serwer (Node.js albo Python – to, co jest zainstalowane) i otworzy grę pod adresem http://localhost:8080.

**macOS / Linux:** w terminalu w folderze gry: `./start.sh`.

**Ręcznie:** w folderze gry uruchom jedno z poleceń i otwórz http://localhost:8080:

```
node serve.js 8080
python -m http.server 8080
```

Serwer jest potrzebny do działania jako PWA (Service Worker, instalacja, tryb offline). Sam plik `index.html` otwarty dwuklikiem też uruchomi grę i zapis, ale bez trybu offline.

**Instalacja na telefonie:** telefon i komputer w tej samej sieci Wi-Fi, otwórz `http://<adres-IP-komputera>:8080`. Pełna instalacja PWA na telefonie wymaga HTTPS, więc w sieci lokalnej zadziała jako zwykła strona; po publikacji na hostingu z HTTPS pojawi się opcja „Dodaj do ekranu głównego”.

## Jak grać

1. **Wioska** – rozbudowuj budynki. Tartak, Cegielnia i Kopalnia produkują surowce, Ratusz powiększa magazyn i pozwala budować wyżej (inne budynki: maks. poziom Ratusza + 2), Farma daje miejsce na wojsko, Koszary odblokowują jednostki.
2. **Wojsko** – rekrutuj jednostki (wpisz liczbę albo „Maks.”). Topornik – Koszary 2, Lekka kawaleria – Koszary 3, Dowódca podboju – Koszary 5. Łucznik (Koszary 2) to jednostka prawie bez żelaza, a koszty pozostałych jednostek mają różne proporcje drewna, gliny i żelaza (punkt 17).
3. **Mapa** – wybierz osadę, kliknij „Atakuj”, wybierz jednostki. Czas marszu zależy od odległości i najwolniejszej jednostki.
4. **Raporty** – wynik bitwy, straty, łupy, poparcie.

5. **Zwiad** – na mapie wybierz obcą wioskę i kliknij „Zwiad”. Zwiad się udaje, gdy wyślesz więcej zwiadowców, niż ma obrońca. Raport pokazuje wojsko, surowce i budynki, a mapa i okno ataku podpowiadają potem siłę obrony. Bez zwiadu siła obrony celu jest nieznana. Zwiadowcy w Twojej wiosce chronią ją przed szpiegami wroga.
6. **Transport surowców** – zbuduj Targowisko (każdy poziom daje kupców, każdy kupiec wiezie do 1000 surowców). Na mapie wybierz swoją wioskę i kliknij „Wyślij tu surowce”. Kupcy jadą, dostarczają towar i wracają. Nadwyżka ponad magazyn celu przepada.
7. **Zasiedlanie** – zrekrutuj Osadnika (Koszary, wymaga Ratusza 4), wybierz na mapie pustą równinę (nie las, nie góry, co najmniej 1,5 pola od innej wioski) i kliknij „Załóż osadę”. Powstaje nowa wioska z podstawowymi budynkami. Założone wioski liczą się do celu 20 wiosek. Frakcje gospodarcza i ekspansywna również zakładają osady.

8. **Wsparcie i przenoszenie wojska** – na mapie wybierz swoją wioskę i kliknij „Wyślij tu wojsko” (albo użyj przycisków na ekranie Wojsko). Domyślnie zaznaczone jest **przeniesienie na stałe** (także w oknie „Zbierz / rozdziel wojsko”), wsparcie wybierasz przełącznikiem. Do wyboru:
   - **Wsparcie** – jednostki bronią celu, ale należą do wioski macierzystej (zajmują jej farmę). Na ekranie Wojsko możesz je odwołać albo odesłać. W bitwie straty dzielą się proporcjonalnie między wszystkie oddziały.
   - **Przeniesienie na stałe** – jednostki przechodzą do wioski docelowej i muszą zmieścić się na jej farmie.
9a. **Wymiana surowców i monety (Targowisko)** – w wiosce z Targowiskiem na ekranie *Wioska* jest panel **Targowisko – szybkie akcje**: wybierasz ilość (monety: 1 / 5 / 10 / maks.; wymiana: 1 000 / 5 000 / 50% / maks.) i jednym kliknięciem kupujesz monety za wybrany surowiec albo wymieniasz dowolną parę surowców (maks. i 50% same przycinają się do zapasu, limitu kupców i miejsca w magazynie). Pełne okno z własną ilością nadal jest pod przyciskiem „Wymiana i monety”. Zakładka *Wymiana surowców*: oddajesz jeden surowiec, dostajesz inny po kursie 100 → 70 (poprawia go badanie Kupiectwo); jednorazowo do (kupcy × 1000), natychmiast, w obrębie jednej wioski. Zakładka *Monety*: za 1500 jednego wybranego surowca kupujesz 1 monetę (tylko w jedną stronę). Limit zakupu w wiosce to poziom Targowiska × 3 monety na godzinę (+ badanie Mennica), z zapasem do 6 godzin – dzięki temu nadmiar z wielu wiosek ma znaczenie.
9b. **Technologia** (Menu lub Przegląd) – drzewko badań płatne monetami, wspólne dla całego plemienia. Gałąź *Wojsko*: Musztra (szybsze szkolenie), ulepszenia Pikiniera, Łucznika, Tarczownika, Toporników, Lekkiej kawalerii i Tarana (+5% ataku i obrony na poziom, do poz. 10), Grabież (+5% udźwigu łupu na poziom; wymaga Lekkiej kawalerii 3) i Skrytki (+3 p.p. magazynu ukrytego przed łupieżcami na poziom, do poz. 5; wymagają Tarczownika 3). Gałąź *Gospodarka*: Kupiectwo (kurs wymiany), Magazyny (+10% pojemności na poziom), Rolnictwo (+5% miejsca na farmach we wszystkich wioskach na poziom, do poz. 10; wymaga Magazynów 2), Mennica (większy limit monet), Budownictwo (krótszy czas budowy). Gałąź *Produkcja*: Narzędzia (+2% produkcji wszystkich surowców na poziom, do poz. 5) oraz – od Narzędzi 2 – Leśnictwo, Ceglarstwo i Górnictwo (+3% produkcji drewna, gliny lub żelaza na poziom, do poz. 10). Kolejne węzły odblokowują się po osiągnięciu poziomu węzła nadrzędnego. Drzewko jest rysowane jako gałęzie z łącznikami (złoty łącznik = wymaganie spełnione); kliknięcie węzła pokazuje szczegóły (efekt, wymaganie, co odblokowuje, koszt do maksimum), a „Badaj” na kafelku kupuje poziom od razu. Na ekranie Technologia jest też szybki zakup monet w aktywnej wiosce oraz przycisk „Maks. ze wszystkich wiosek” (kupuje maksimum w każdej wiosce z Targowiskiem, płacąc jej najobfitszym surowcem). Całe drzewko kosztuje około 5700 monet (≈8,5 mln surowców). AI nie korzysta z Technologii. Wszystkie liczby: `TECH` w `config.js`.
9. **Mur obronny i tarany** – mur dodaje stałą obronę i procentowy bonus (do +70% na poziomie 10). Tarany (Koszary 4) w bitwie obniżają mur o 1 poziom na każde 8 sztuk, a po wygranej ocalałe tarany burzą go na stałe (1 poziom na 4 tarany).
10. **Szybkie przełączanie wiosek** – dwuklik (na telefonie podwójne stuknięcie) na swojej wiosce na mapie ustawia ją jako aktywną, a na obcej otwiera okno ataku z aktywnej wioski. Z każdego ekranu przełączysz wioski strzałkami ‹ › obok listy w górnym pasku albo klawiszami `[` i `]`.
11. **Przegląd** – wszystkie wioski w jednej tabeli: surowce z zapełnieniem magazynu, farma, bieżąca budowa i rekrutacja, wojsko i nadciągające ataki.
12. **Zbieranie i rozdzielanie surowców** – w Przeglądzie przycisk „Zbierz / rozdziel surowce” otwiera okno, w którym jednym kliknięciem wysyłasz kupców z wielu wiosek do jednej (albo z jednej po równo do pozostałych). Wybierasz surowce i ile procent magazynu zostaje w wiosce wysyłającej (domyślnie 20%), a wioski możesz odznaczać. Plan uwzględnia wolnych kupców, miejsce w magazynie celu (także surowce już jadące) i czas drogi; wioski bez Targowiska są pomijane z podaną przyczyną.
13. **Zbieranie i rozdzielanie wojska** – drugi przycisk w Przeglądzie („Zbierz / rozdziel wojsko”) działa tak samo, ale dla jednostek: zbierasz wojsko z wielu wiosek do jednej albo rozdzielasz je po równo z jednej do pozostałych. Wybierasz jednostki (domyślnie bez Zwiadowców i Osadników), ile procent zostaje w wiosce wysyłającej oraz rodzaj wysyłki: wsparcie (odwoływalne) albo przeniesienie na stałe (z przycinaniem do wolnego miejsca na farmie celu).
14. **Brak wyskakujących powiadomień** – nie zasłaniają już gry; komunikat o błędzie pojawia się w otwartym oknie, a zdarzenia znajdziesz w Raportach i na ekranie Przegląd.
15. **Rozmiar świata** – przy nowej grze (Menu → Zacznij od nowa) wybierasz mapę: Mała 15×15 i 4 przeciwników (cel 20 wiosek), Średnia 25×25 i 8 (cel 30), Duża 35×35 i 12 (cel 40) albo Ogromna 45×45 i 15 (cel 50). Ustawienia w `WORLDS` w `config.js`; legenda mapy dopasowuje się do liczby frakcji. Na większych mapach nadrabianie nieobecności trwa dłużej (Ogromna: ok. 4 s na 4 h gry).
17. **Koszty jednostek i brak żelaza** – w późnej grze zostawało dużo drewna i gliny, a żelaza brakowało, bo wojsko kosztowało go najwięcej (w typowej armii ok. 38% kosztu). Koszty zostały przebalansowane: suma kosztu każdej jednostki jest taka sama jak wcześniej (siła na surowiec bez zmian), ale każda ma inny dominujący surowiec, a w typowej armii żelazo to ok. 27%:

   | Jednostka | Drewno / Glina / Żelazo | Dominuje |
   |---|---|---|
   | Pikinier | 37 / 38 / 21 | glina |
   | Łucznik (Koszary 2, atak 15, obrona 28) | 60 / 40 / 15 | drewno |
   | Tarczownik (Koszary 3, atak 20, obrona 48) | 45 / 50 / 60 | żelazo |
   | Topornik | 44 / 30 / 39 | drewno |
   | Zwiadowca | 25 / 55 / 21 | glina |
   | Lekka kawaleria | 100 / 90 / 170 | żelazo |
   | Taran | 190 / 320 / 140 | glina |
   | Dowódca podboju | 950 / 1250 / 900 | glina |
   | Osadnik | 850 / 950 / 600 | glina |

   Dzięki temu możesz sterować tym, czego zużywasz najwięcej: Łucznicy i Topornicy są „drewniani”, Pikinierzy, tarany i dowódcy „gliniani”, a tylko kawaleria jest „żelazna”. AI korzysta z tych samych kosztów. Wszystkie liczby w `UNITS` w `config.js`; testy: `node tests/units.js`.
18. **Pokonani i ranking** – za zniszczone jednostki wroga dostajesz punkty (koszt jednostki / `SCORE.costDivisor`, tak jak punkty wojska), osobno za atak i za obronę. Liczą się też zwiadowcy zabici przy obronie przed szpiegami. Punkty widać w raporcie bitwy („Punkty za pokonanych”), na ekranie Wojsko, w Mocy konta i w panelu bocznym. W Menu jest ranking wszystkich frakcji z zakładkami Pokonani, Budynki i Wioski oraz Twoim miejscem. Ranking nie zdradza siły wojska frakcji AI. Stare zapisy zaczynają z zerem (bitwy z przeszłości nie są liczone wstecz). Test: `node tests/ranking.js`.
19. **Rebalans ataku i obrony** – przy tych samych nakładach atak był ok. 30% silniejszy od obrony: Pikinier daje 26 obrony na 100 surowców, a Topornik 35 ataku, na miejsce farmy 25–28 obrony przeciw 40 ataku, a żadna jednostka obronna nie odblokowywała się wyżej niż w Koszarach 2. Dodano **Tarczownika** (Koszary 3, obrona 48 na jedno miejsce na farmie, atak 20) – dzięki niemu przy budżecie 6–25 tys. surowców (obrona + mur kontra sam atak Toporników) stosunek ataku do obrony wynosi ok. 1,1–0,9 zamiast 1,3–1,1. Atakujący zachowuje inicjatywę, szybkość i łupy, a tarany nadal kruszą mur. AI buduje Tarczowników zależnie od osobowości (najchętniej obronna). Zapisy wczytują się bez migracji (brakujące jednostki dostają 0). Test: `node tests/units.js`.
16. **Czytelniejsza grafika** – przerysowane ikony wojsk (16×16 px), większe proporce właścicieli i cień pod osadami na mapie; tabela bitwy w raportach mieści się na telefonie.

Wolną osadę przejmujesz, wygrywając bitwę. Wioskę frakcji AI – wysyłając Dowódcę podboju: każda wygrana z żywym dowódcą obniża poparcie o 25–40%, przy 0% wioska jest Twoja. Przez pierwsze 10 minut AI nie atakuje gracza i nie zabiera osad leżących bliżej Ciebie.

## Pliki

| Plik | Zawartość |
|---|---|
| `index.html` | szkielet aplikacji |
| `style.css` | wygląd (komputer: panele boczne, telefon: dolny pasek) |
| `config.js` | **wszystkie parametry balansu** – koszty, czasy, produkcja, jednostki, AI |
| `engine.js` | stan gry, centralny procesor zdarzeń, ekonomia, walka, podbój |
| `diplomacy.js` | dyplomacja: nastawienie, pakty o nieagresji, dary, zdrada, lider |
| `ai.js` | skrypt czterech frakcji AI (agresywna, gospodarcza, obronna, ekspansywna) |
| `database.js` | zapis IndexedDB + kopia w localStorage, wersjonowanie, eksport/import JSON |
| `sprites.js` | małe ikony pikselowe (surowce, jednostki, budynki) |
| `art.js` | grafika proceduralna mapy: teren, drogi, lasy, góry, terytoria, osady |
| `map.js` | mapa 15 × 15: warstwy, trasy wojsk, minimapa, przesuwanie, przybliżanie, szczypanie |
| `ui.js` | ekrany, okna, powiadomienia |
| `game.js` | start, pętla, autozapis, rejestracja Service Workera |
| `manifest.json`, `sw.js`, `assets/` | PWA: manifest, tryb offline, ikony (generowane przez `tools/make-icons.py`) |
| `serve.js`, `start.bat`, `start.sh` | lokalny serwer bez zależności |
| `tests/simulate.js` | test logiki: `node tests/simulate.js` |
| `tests/power.js` | test liczenia mocy konta: `node tests/power.js` |
| `tests/gather.js` | test zbierania i rozdzielania surowców: `node tests/gather.js` |
| `tests/worlds.js` | test rozmiarów świata (mapa, liczba frakcji, wydajność): `node tests/worlds.js` |
| `tests/troops.js` | test zbierania i rozdzielania wojska: `node tests/troops.js` |
| `tools/make-icons.py` | generator ikon (wymaga Pillow) |
| `tools/balance.js` | symulacja balansu na wszystkich poziomach trudności |
| `tools/resources.js` | bilans surowców: wydatki, marnowanie, blokady |

## Jak działa czas

Gra nie liczy niczego „co sekundę”. Każda wioska ma znacznik ostatniej aktualizacji, a `Engine.advance(stan, teraz)` przetwarza w kolejności chronologicznej wszystkie zaległe zdarzenia: końce budów, przybycia wojsk, tury AI. Przed każdym zdarzeniem produkcja jest naliczana po stawce sprzed zmiany. Zdarzenie po przetworzeniu znika z kolejki, więc nic nie liczy się dwa razy. Test `tests/simulate.js` sprawdza, że 30 minut gry policzone jednym skokiem daje identyczny stan jak 1800 kroków po sekundzie.

Surowce są naliczane w liczbach całkowitych (ułamki jednostek czekają w osobnym liczniku), dlatego wynik jest identyczny co do sztuki bez względu na liczbę kroków.

Nadrabianie nieobecności trwa ok. 1–2 s na dobę gry (tydzień ok. 9 s).

## Moc konta

Menu → „Moc konta” (z licznikiem pokonanych wrogów; skrót: panel „Imperium” z boku i kafelek na ekranie Przegląd) pokazuje: punkty budynków (1 pkt za poziom), punkty wojska, siłę ataku i obrony całej armii oraz sumę. Wojsko liczy się razem z oddziałami w marszu i na wsparciu w innych wioskach. Punkty jednostki to jej koszt podzielony przez `SCORE.costDivisor` w `config.js` (Pikinier ≈ 1, Lekka kawaleria ≈ 3,6, Dowódca ≈ 31). Moc frakcji AI nie jest pokazywana – ich armię trzeba rozpoznać zwiadem.

## Zapis

Autozapis co 5 s, po każdej akcji i przy zamykaniu karty (synchroniczna kopia w localStorage). Przy starcie wczytywany jest nowszy z dwóch zapisów. Menu → „Pobierz kopię zapisu” / „Wczytaj zapis z pliku”. **Pauza**: Menu → „Wstrzymaj grę” albo „Zapisz do pliku i wstrzymaj”. W pauzie czas gry stoi (AI się nie rozwija, nic nie nadrabia się po powrocie), a rozkazy są zablokowane; po wznowieniu (pasek u góry) gra liczy dalej od tego samego momentu. Pauza i łączny czas pauz (`skew`) są w zapisie, więc działają też po wczytaniu pliku na innym urządzeniu. Czas gry = zegar − `skew` (`Engine.gameClock`). Test: `node tests/pause.js`. Zapis ma numer wersji (`SAVE_VERSION` w `config.js`); przy zmianie struktury dopisz migrację w `database.js` (`MIGRATIONS`).

## Balans i poziomy trudności

Poziom wybierasz przy nowej grze (Menu → Zacznij od nowa) i możesz go zmienić w trakcie gry w Menu – zmiana działa od razu.

| | Łatwy | Normalny | Trudny |
|---|---|---|---|
| Produkcja gracza | ×1,3 | ×1,15 | ×1 |
| Produkcja AI | ×0,6 | ×0,72 | ×0,95 |
| Ochrona na starcie | 40 min | 25 min | 10 min |
| Część magazynu ukryta przed łupieżcami | 40% | 25% | 10% |
| Przerwa między atakami AI na tę samą wioskę | 15 min | 8 min | brak |
| Strefa wokół Twoich wiosek, w której AI nie zajmuje osad | 4 pola | 3 pola | brak |

Koszty budynków rosną o ok. 30% na poziom (produkcja rośnie podobnie), więc kolejne poziomy nie zwracają się coraz wolniej. Tartak, Cegielnia i Kopalnia produkują tyle samo, a koszty budynków i jednostek są rozłożone mniej więcej po równo na trzy surowce.

`node tools/balance.js` uruchamia 5 gier na każdym poziomie z prostym botem gracza i podaje: punkty gracza, liczbę ataków AI, zrabowane surowce i siłę najsilniejszej frakcji. `node tools/resources.js` (oraz `node tools/resources.js budowa`) pokazuje, jaki udział w wydatkach ma każdy surowiec, który się marnuje na pełnym magazynie i który blokuje rozwój – dla stylu z armią i dla samej rozbudowy. Warto puścić oba narzędzia po każdej zmianie kosztów.

## Zmiana balansu

Edytuj `config.js` i odśwież stronę. Po zmianie plików gry podnieś wersję `CACHE` w `sw.js`, żeby przeglądarka pobrała nowe pliki zamiast kopii offline.



Zapisy z poprzedniej wersji są automatycznie uzupełniane o Targowisko i nowe jednostki (migracje zapisu v1 → … → v9; stare gry dostają poziom Normalny).

## Zachowanie AI (wersja 2)

Każda frakcja co turę (`C.AI.thinkInterval`):

1. **Rozbudowa bez przestojów** – kolejka budowy jest zawsze zajęta. Pierwszeństwo mają pilne potrzeby: Farma przy zajętości powyżej 85%, Ratusz (magazyn), gdy surowce zbliżają się do limitu albo budynek nie mieści się w magazynie. Na następny budynek odkładana jest rezerwa – wojsko rekrutowane jest tylko z nadwyżki.
2. **Wojsko z głową** – najpierw obrona domu do progu `punkty wioski × homeDef` (osobowość), potem armia według wag. Przy pełnym magazynie albo nadciągającym ataku AI wydaje wszystko.
3. **Posiłki** – wioska z nadciągającym atakiem dostaje obrońców z sąsiednich wiosek, jeśli zdążą dojść.
4. **Zbiórka wojsk** – frakcje ofensywne co jakiś czas ściągają jednostki ataku z zaplecza do wioski frontowej, żeby móc uderzyć na silniej bronione cele.
5. **Ataki** – armia zbiera się do sensownej wielkości (`minPower + punkty × powerPerPoint`) zamiast wysyłać garstki co turę; agresywna i ekspansywna frakcja prowadzą do dwóch wypraw naraz. Cel wybierany według odległości, przewagi, łupu i obniżonego poparcia (dobijanie podboju). AI nie wysyła wojska, gdy samo jest atakowane.
6. **Rozrost** – osadnicy częściej (także frakcja obronna), dowódcy podboju tylko przy bezpiecznej obronie domu.

Poziomy trudności działają jak wcześniej (produkcja, agresja, ostrożność, strefa wokół gracza). Parametry: `C.AI.tactics` i `C.AI.personalities` w `config.js`. Raport bez gracza: `node tools/ai-report.js normal 8 1`.

Porównanie (świat Mały, Normalny, 8 h bez gracza, średnia z 6 gier na frakcję): suma poziomów budynków 323 → 548, zrekrutowane jednostki 5 404 → 8 798, liczba wypraw 840 → 179 (zamiast garstek – pełne armie).

## Najazdy łupieżcze (grabież wolnych osad)

Na wolnej osadzie masz dwa rozkazy: **Atakuj** (wygrana przejmuje osadę, jak dotąd) i **Grabież**. Grabież to zwykła bitwa, ale po wygranej osada zostaje wolna, a ocalali zabierają surowce do swojego udźwigu. Załoga wolnej osady odradza się po najeździe – 25% stałej załogi na godzinę (`NEUTRAL.regenPerHour` w `config.js`), nigdy ponad stan wyjściowy – a surowce przybywają z jej produkcji, więc do osady opłaca się wracać.

- Tryb wybierasz przyciskiem w panelu osady na mapie albo przełącznikiem **Podbój / Grabież** w oknie ataku (gra pamięta ostatni wybór).
- W raporcie grabieży jest przycisk **Powtórz grabież** – otwiera okno ataku z tym samym wojskiem i tą samą wioską wysyłającą.
- Ruch na liście ma etykietę „W drodze · grabież”, a raport – złotą pieczęć „Udana grabież”.
- AI po osiągnięciu limitu wiosek nie pomija już wolnych osad, tylko je grabi (chęć zależy od osobowości: `raids`). Wolne osady w strefie wokół Twoich wiosek AI nadal omija.
- Stare zapisy: osady bez zapisanej stałej załogi przyjmują obecną załogę jako bazę przy pierwszym przeliczeniu. Rozkazy wysłane przed aktualizacją działają jak zwykły atak.

Test: `node tests/raid.js`.

## Podbój: wojsko zostaje, kolejne fale zawracają

- **Zdobywcy zostają.** Gdy atak przejmuje wioskę (wolną osadę albo wioskę frakcji Dowódcą), ocalałe jednostki zostają w niej jako jej załoga, zamiast wracać do domu. Surowce, które normalnie byłyby łupem, też zostają w przejętej wiosce. W raporcie: „Twoje wojsko (N jedn.) zostało w przejętej wiosce”.
- **Kolejne fale zawracają.** Jeśli atak dociera do wioski, która w międzyczasie stała się Twoja (np. zdobyła ją wcześniejsza fala), bitwy nie ma – wojsko zawraca do wioski, z której wyruszyło („Zawraca do X – Y jest już Twoja”). Wcześniej takie wojsko wzmacniało zdobytą wioskę.
- Zasady dotyczą też AI. Grabież (tryb bez przejęcia) działa bez zmian – wojsko wraca z łupem.
- Ocalali mogą przekroczyć miejsce na farmie przejętej wioski – wtedy rekrutacja jest tam wstrzymana do rozbudowy Farmy albo odesłania części wojska.

Test: `node tests/conquest.js`.

## Technologia: gałąź Królestwo (późna gra)

Czwarta gałąź drzewka, ok. 3 900 monet za komplet (reszta drzewka ok. 5 700). Efekty działają tylko dla gracza.

| Badanie | Poziomy | Wymaga | Efekt |
|---|---|---|---|
| Administracja | 2 | – | +1 miejsce w kolejce budowy i rekrutacji na poziom (z 3/5 do 5/7) |
| Trakty | 10 | Administracja 1 | marsz Twoich wojsk i osadników −3% czasu na poziom (ataki, wsparcie, powroty) |
| Lazaret | 10 | Administracja 1 | 3% poległych w Twoich atakach na poziom wraca rannych do domu (maks. 30%) |
| Fortyfikacje | 10 | Administracja 2 | bonus muru +3% na poziom (mur 10: +70% → +91% obrony) |
| Dowództwo | 5 | Trakty 3 | Twój Dowódca obniża poparcie o dodatkowe 3 p.p. na poziom |
| Wiara | 5 | Lazaret 3 | wrodzy Dowódcy obniżają poparcie Twoich wiosek o 8% mniej na poziom |

Raport ataku pokazuje liczbę rannych uratowanych przez Lazaret. Test: `node tests/realm.js`.

## Dyplomacja i zachowanie AI (wersja 3)

Moduł `diplomacy.js` (parametry w `DIPLO` i `diplo` każdej osobowości w `config.js`). Menu → Dyplomacja, skrót w Przeglądzie i w panelu obcej wioski na mapie.

- **Nastawienie** (-100 … +100, osobno w każdą stronę) każdej frakcji AI do gracza i do pozostałych frakcji. Startuje od wartości bazowej osobowości (gospodarcza i obronna ufają od razu, agresywna i ekspansywna nie). Rośnie z czasem, gdy nikogo nie atakujesz (w pakcie dwa razy szybciej, do limitu osobowości), a po ataku spada: -12 po wygranej, -5 po przegranej, -30 po podboju (sojusznicy ofiary dodatkowo -6). Potem wraca do bazowego.
- **Pakt o nieagresji** trwa 6 h, żadna ze stron nie może atakować drugiej (zwiad wolno). Gracz ma do 3 paktów, frakcja AI do 2. Wojsko w marszu, gdy pakt zostaje podpisany, zawraca bez bitwy. Zgoda AI zależy od nastawienia (próg osobowości), reputacji proponującego, zapełnienia paktów i od tego, czy proponujący nie jest „liderem”. Okno Dyplomacja pokazuje, czemu frakcja odmawia i ile brakuje.
- **Wypowiedzenie**: pakt chroni jeszcze 20 min. Zrywający traci reputację (każdy punkt zniechęca frakcje do paktu z nim, maleje 1 pkt na 8 h), a ofiara -40 nastawienia.
- **Dary**: 3 000 / 6 000 / 12 000 surowców z aktywnej wioski podnoszą nastawienie o 5 / 10 / 20 (surowce znikają). Kolejny dar dla tej samej frakcji dopiero po 20 min. To kolejny sposób na zagospodarowanie nadwyżek.
- **Oferty AI**: przychylne frakcje same proponują pakt sąsiadom (także graczowi, oferta wisi 3 h) i przedłużenie, gdy pakt zbliża się do końca. Frakcje zawierają też pakty między sobą (widać je w oknie Dyplomacja przy nazwie frakcji).
- **Zdrada**: agresywna i ekspansywna frakcja może po godzinie wypowiedzieć pakt wyraźnie słabszemu partnerowi (z wypowiedzeniem, więc gracz ma czas na reakcję).
- **Lider**: frakcja z 60% celu zwycięstwa (domyślnie 12 z 20 wiosek) nie dostaje paktów, partnerzy AI wypowiadają jej pakty bez utraty reputacji, a wszystkie frakcje chętniej ją atakują. Dotyczy też gracza, więc końcówka gry jest trudniejsza.
- **AI atakuje mądrzej**: wybór celu uwzględnia pakt (zero ataków), zemstę (im niższe nastawienie, tym chętniej, skala `revenge`), sympatię (mniej chętnie) i lidera (`leaderBias`). AI nie szpieguje partnerów paktu.

Test: `node tests/diplomacy.js` (pakty, blokada, zawracanie wojska, dary, oferty, zdrada, lider, migracja v8 → v9, symulacja 24 h na mapie Dużej). Zapis ma teraz numer wersji 9 (migracja dodaje pustą dyplomację).

## Ulepszenia jednostek AI

Frakcje AI nie kupują badań, ale ich jednostki same zyskują ulepszenia (jak gracz w gałęzi Wojsko: +5% ataku i obrony na poziom). Pierwszy poziom po 30 minutach gry, kolejne co 45 minut × tempo poziomu trudności (`aiTech`: Łatwy 0,5, Normalny 0,8, Trudny 1). Maksimum: poziom 10 (+50%) – na Normalnym po ok. 10 h, na Trudnym po ok. 8 h, na Łatwym po ok. 15 h. Ulubione jednostki frakcji dostają pełny poziom, pozostałe o 2 niższy. Panel „Frakcje” pokazuje najwyższe ulepszenie każdej frakcji (np. „+30%”). Parametry: `AI.tech` i `DIFFICULTY.*.aiTech` w `config.js`. Stare zapisy: AI od razu dostaje poziom odpowiadający czasowi gry.

## Zarządzanie wieloma wioskami

- **Buduj we wszystkich wioskach** (Przegląd): szablon (Gospodarka, Wojsko, Handel, Pełna rozbudowa – `BUILD_TEMPLATES` w `config.js`) albo jeden budynek do wybranego poziomu. Każda wioska kolejkuje tyle, ile zmieści się w kolejce i na ile ją stać, najpierw budynek najdalej od celu. Podgląd pokazuje, co trafi do kolejki w każdej wiosce, i pozwala wioski odznaczyć.
- **Konwoje** (Przegląd): wybierasz wioskę centralną, próg (domyślnie: wioska z magazynem ponad 80% wysyła nadwyżkę, zostawiając 40%) i częstotliwość (5/15/30 min). Kupcy jadą sami, także podczas nieobecności (gra nadrabia czas), ale nie w pauzie. Opcjonalnie wioska centralna od razu kupuje monety (maks. limitu, najobfitszym surowcem). Wysyłające wioski potrzebują Targowiska. Utrata wioski centralnej wyłącza konwoje. Ustawienia są w zapisie gry.

Test: `node tests/empire.js`.

## Wolne osady: podbój w kilku atakach i samodzielny rozwój

- **Podbój wymaga 2–3 wygranych.** Każda wygrana w trybie Podbój obniża poparcie wolnej osady o 35–50% (`NEUTRAL.dropMin/dropMax`); z Dowódcą podboju dochodzi jego zwykły spadek (25–40%), a dowódca się nie zużywa. Przy 0% osada przechodzi na zwycięzcę. Wygrana bez przejęcia działa jak zwykły atak – ocalali wracają z łupem. Grabież nie rusza poparcia.
- **Poparcie wraca powoli:** 15 p.p. na godzinę (`NEUTRAL.loyaltyRegenPerMin`), więc kolejne ataki trzeba wysłać w ciągu kilku godzin.
- **Wolne osady same się rozwijają:** co godzinę gry +1 poziom budynku (najpierw najniższy względem limitu: surowce do 10, Ratusz i Farma do 8, Mur do 6 – `NEUTRAL.growMax`), a ich stała załoga rośnie o 12% na każdy zdobyty poziom (`garrisonPerLevel`). Rośnie też ich produkcja, więc późne grabieże dają więcej, ale są trudniejsze. Panel osady na mapie pokazuje poparcie i „Rozwój: +N poz.”.
- AI podlega tym samym zasadom i chętniej dobija osady z obniżonym poparciem.
- Stare zapisy: osady zaczynają rozwój od pierwszego przeliczenia po aktualizacji.

Test: `node tests/neutral.js`.
