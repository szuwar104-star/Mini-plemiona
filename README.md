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
2. **Wojsko** – rekrutuj jednostki (wpisz liczbę albo „Maks.”). Topornik – Koszary 2, Lekka kawaleria – Koszary 3, Dowódca podboju – Koszary 5.
3. **Mapa** – wybierz osadę, kliknij „Atakuj”, wybierz jednostki. Czas marszu zależy od odległości i najwolniejszej jednostki.
4. **Raporty** – wynik bitwy, straty, łupy, poparcie.

5. **Zwiad** – na mapie wybierz obcą wioskę i kliknij „Zwiad”. Zwiad się udaje, gdy wyślesz więcej zwiadowców, niż ma obrońca. Raport pokazuje wojsko, surowce i budynki, a mapa i okno ataku podpowiadają potem siłę obrony. Bez zwiadu siła obrony celu jest nieznana. Zwiadowcy w Twojej wiosce chronią ją przed szpiegami wroga.
6. **Transport surowców** – zbuduj Targowisko (każdy poziom daje kupców, każdy kupiec wiezie do 1000 surowców). Na mapie wybierz swoją wioskę i kliknij „Wyślij tu surowce”. Kupcy jadą, dostarczają towar i wracają. Nadwyżka ponad magazyn celu przepada.
7. **Zasiedlanie** – zrekrutuj Osadnika (Koszary, wymaga Ratusza 4), wybierz na mapie pustą równinę (nie las, nie góry, co najmniej 1,5 pola od innej wioski) i kliknij „Załóż osadę”. Powstaje nowa wioska z podstawowymi budynkami. Założone wioski liczą się do celu 20 wiosek. Frakcje gospodarcza i ekspansywna również zakładają osady.

8. **Wsparcie i przenoszenie wojska** – na mapie wybierz swoją wioskę i kliknij „Wyślij tu wojsko” (albo użyj przycisków na ekranie Wojsko). Do wyboru:
   - **Wsparcie** – jednostki bronią celu, ale należą do wioski macierzystej (zajmują jej farmę). Na ekranie Wojsko możesz je odwołać albo odesłać. W bitwie straty dzielą się proporcjonalnie między wszystkie oddziały.
   - **Przeniesienie na stałe** – jednostki przechodzą do wioski docelowej i muszą zmieścić się na jej farmie.
9. **Mur obronny i tarany** – mur dodaje stałą obronę i procentowy bonus (do +70% na poziomie 10). Tarany (Koszary 4) w bitwie obniżają mur o 1 poziom na każde 8 sztuk, a po wygranej ocalałe tarany burzą go na stałe (1 poziom na 4 tarany).
10. **Szybkie przełączanie wiosek** – dwuklik (na telefonie podwójne stuknięcie) na swojej wiosce na mapie ustawia ją jako aktywną, a na obcej otwiera okno ataku z aktywnej wioski. Z każdego ekranu przełączysz wioski strzałkami ‹ › obok listy w górnym pasku albo klawiszami `[` i `]`.
11. **Przegląd** – wszystkie wioski w jednej tabeli: surowce z zapełnieniem magazynu, farma, bieżąca budowa i rekrutacja, wojsko i nadciągające ataki.
12. **Zbieranie i rozdzielanie surowców** – w Przeglądzie przycisk „Zbierz / rozdziel surowce” otwiera okno, w którym jednym kliknięciem wysyłasz kupców z wielu wiosek do jednej (albo z jednej po równo do pozostałych). Wybierasz surowce i ile procent magazynu zostaje w wiosce wysyłającej (domyślnie 20%), a wioski możesz odznaczać. Plan uwzględnia wolnych kupców, miejsce w magazynie celu (także surowce już jadące) i czas drogi; wioski bez Targowiska są pomijane z podaną przyczyną.

Wolną osadę przejmujesz, wygrywając bitwę. Wioskę frakcji AI – wysyłając Dowódcę podboju: każda wygrana z żywym dowódcą obniża poparcie o 25–40%, przy 0% wioska jest Twoja. Przez pierwsze 10 minut AI nie atakuje gracza i nie zabiera osad leżących bliżej Ciebie.

## Pliki

| Plik | Zawartość |
|---|---|
| `index.html` | szkielet aplikacji |
| `style.css` | wygląd (komputer: panele boczne, telefon: dolny pasek) |
| `config.js` | **wszystkie parametry balansu** – koszty, czasy, produkcja, jednostki, AI |
| `engine.js` | stan gry, centralny procesor zdarzeń, ekonomia, walka, podbój |
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
| `tools/make-icons.py` | generator ikon (wymaga Pillow) |
| `tools/balance.js` | symulacja balansu na wszystkich poziomach trudności |
| `tools/resources.js` | bilans surowców: wydatki, marnowanie, blokady |

## Jak działa czas

Gra nie liczy niczego „co sekundę”. Każda wioska ma znacznik ostatniej aktualizacji, a `Engine.advance(stan, teraz)` przetwarza w kolejności chronologicznej wszystkie zaległe zdarzenia: końce budów, przybycia wojsk, tury AI. Przed każdym zdarzeniem produkcja jest naliczana po stawce sprzed zmiany. Zdarzenie po przetworzeniu znika z kolejki, więc nic nie liczy się dwa razy. Test `tests/simulate.js` sprawdza, że 30 minut gry policzone jednym skokiem daje identyczny stan jak 1800 kroków po sekundzie.

Surowce są naliczane w liczbach całkowitych (ułamki jednostek czekają w osobnym liczniku), dlatego wynik jest identyczny co do sztuki bez względu na liczbę kroków.

Nadrabianie nieobecności trwa ok. 1–2 s na dobę gry (tydzień ok. 9 s).

## Moc konta

Menu → „Moc konta” (skrót: panel „Imperium” z boku i kafelek na ekranie Przegląd) pokazuje: punkty budynków (1 pkt za poziom), punkty wojska, siłę ataku i obrony całej armii oraz sumę. Wojsko liczy się razem z oddziałami w marszu i na wsparciu w innych wioskach. Punkty jednostki to jej koszt podzielony przez `SCORE.costDivisor` w `config.js` (Pikinier ≈ 1, Lekka kawaleria ≈ 3,6, Dowódca ≈ 31). Moc frakcji AI nie jest pokazywana – ich armię trzeba rozpoznać zwiadem.

## Zapis

Autozapis co 5 s, po każdej akcji i przy zamykaniu karty (synchroniczna kopia w localStorage). Przy starcie wczytywany jest nowszy z dwóch zapisów. Menu → „Pobierz kopię zapisu” / „Wczytaj zapis z pliku”. Zapis ma numer wersji (`SAVE_VERSION` w `config.js`); przy zmianie struktury dopisz migrację w `database.js` (`MIGRATIONS`).

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



Zapisy z poprzedniej wersji są automatycznie uzupełniane o Targowisko i nowe jednostki (migracje zapisu v1 → v2 → v3 → v4; stare gry dostają poziom Normalny).
