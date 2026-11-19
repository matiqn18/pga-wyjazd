# PGA: centrum wyjazdu

Strona dla ekipy jadącej na PGA. Jedno wspólne hasło, bez kont:

- **Pomysły** – każdy dodaje (nazwa, link, rodzaj) i ocenia: bardzo chcę / chętnie / mogę
- **Kto co chce** – ranking pomysłów, kto jeszcze nie ocenił, historia zmian
- **Wspólny plan** – plansza dni × pory dnia, kafelki przeciąga każdy
- **Mój plan** – co mnie interesuje we wspólnym planie, „Nie mogę”, „Gdzie kto jest” (lokalizacja na 2 h)
- **Zdjęcia** – każdy wrzuca zdjęcia i filmy z telefonu, potem pobranie wszystkiego (albo jednej osoby) jako ZIP
- **Mikołajki** – zapisy z telefonem i paczkomatem (wyszukiwarka InPost), losowanie, każdy widzi tylko swój los

Czysty Node, bez zależności i bez kroku budowania.

## Uruchomienie

Na serwerze z Caddy w Dockerze (sieć `web`):

```bash
git clone <repo> pga && cd pga
cp .env.example .env && nano .env        # hasło, tytuł, dni
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
```

W Caddy: `reverse_proxy pga:3050`. Kontener nazywa się `pga`, słucha na porcie 3050 tylko w sieci `web`, bez portów na zewnątrz.
Udostępnianie lokalizacji działa tylko przez HTTPS (Caddy załatwia to sam).

Aktualizacja: `git pull && docker compose up -d --build`.

Lokalnie (Node 18+, bez `npm install`):

```bash
PASSWORD=test node server.js           # bash
$env:PASSWORD="test"; node server.js   # PowerShell
```

## Ustawienia

- `PASSWORD` – wspólne hasło ekipy; bez niego strona jest otwarta
- `ADMIN_PASSWORD` – hasło admina („Tryb admina” na dole strony): edycja i usuwanie wszystkich pomysłów i wydatków, zmiana imion, usuwanie osób; puste = wyłączone
- `GUEST_PASSWORD` – hasło gości do podstrony `/gdzie` (samo „Gdzie kto jest”); goście to osobna grupa: widzą tylko siebie, w głównej aplikacji i w eksporcie się nie pojawiają; puste = wyłączone
- `TITLE` – nagłówek strony
- `DAYS` – dni i pory dnia, np. `Piątek:rano,popołudnie,wieczór;Sobota:rano,popołudnie,wieczór`

## Dane

Jeden plik `/data/pga.json` na wolumenie `pga-data` (lokalnie `data/pga.json`, poza repo).
Przy starcie serwer robi kopię do `data/backup/` (5 ostatnich).
Pobranie: link na dole strony albo `/api/export` (po zalogowaniu).

Mikołajki: dane do paczek są w `pga.json` (bez nich w eksporcie JSON), ale par „kto kogo” nie ma nigdzie.
Przy zapisie przeglądarka tworzy klucz (ECDH P-256) i zostawia go u siebie; serwer losuje jeden cykl i dane wylosowanej osoby
szyfruje kluczem publicznym losującego. Otworzyć los można tylko kluczem z przeglądarki albo z linku zapasowego,
więc wyniku nie zobaczy ani admin, ani ktoś z dostępem do pliku. Zgubiony klucz = cofnij losowanie, usuń osobę, zapis od nowa, losuj jeszcze raz.
Losuje admin (bez `ADMIN_PASSWORD` każdy). Działa tylko przez HTTPS (albo na localhost).

Zdjęcia i filmy: pliki w `data/media/`, spis w `data/media.json`. Nie trafiają do eksportu JSON ani do `backup/`.
Wysyłanie idzie kawałkami po 8 MB (działa też za Cloudflare, przerwane połączenie wznawia się samo), duplikaty są pomijane.
ZIP składa się w locie, bez kompresji i bez zapisu na dysk; powyżej 4 GB jako ZIP64. Serwer odmawia przyjęcia pliku, gdy na dysku zostałoby mniej niż 1 GB.

## Struktura kodu

Bez zależności i bez kroku budowania: serwer to czysty Node (CommonJS), strona to moduły ES.

```
server.js                    start: Config → JsonFileStore → Trip → Actions → HttpServer
src/
  Config.js                  ustawienia z env, Schedule (dni i pory)
  storage/JsonFileStore.js   plik JSON: zapis atomowy, kopie zapasowe
  domain/
    Trip.js                  stan wyjazdu, transakcje (błąd = brak zmian), widok publiczny
    migrations.js            kolejne wersje modelu danych
    History.js               historia zdarzeń
    Service.js               baza serwisów: dane, historia, uprawnienia (autor / admin)
    People.js Ideas.js Board.js Locations.js Expenses.js   logika poszczególnych części
    Guests.js                goście z /gdzie (osobna lista osób)
    Santa.js                 Mikołajki: zapisy, losowanie, szyfrowanie losów
    Actions.js               akcje API: POST /api/<nazwa> → serwis
  media/
    MediaStore.js            zdjęcia i filmy: wysyłanie kawałkami, CRC i skrót, spis plików
    Zip.js                   ZIP bez kompresji składany w locie (ZIP64)
  http/
    HttpServer.js            trasy, odpowiedzi JSON
    Auth.js TokenSigner.js RateLimiter.js   hasło ekipy, tryb admina, limit prób
    StaticFiles.js           pliki z public/ z wersjami w adresach (?v=…)
    MediaRoutes.js           trasy /api/media…: spis, wysyłanie, usuwanie, ZIP
    LockerSearch.js          wyszukiwanie paczkomatów (publiczne API InPost)
public/
  app.js                     punkt wejścia strony
  gdzie.html, gdzie.js       podstrona gości /gdzie
  js/App.js                  stan, odpytywanie serwera, zakładki, okna
  js/GuestApp.js             podstrona gości: WherePanel + logowanie i wybór imienia
  js/core/                   Api, Identity, Prefs, Toast, format, dom, Uploader (wysyłanie plików), SantaKey (klucz Mikołajek)
  js/model/TripModel.js      pytania o stan: oceny, plan, bilans, przelewy
  js/ui/                     wspólne kawałki HTML, opisy historii
  js/views/                  zakładki (klasa View) + DragController, WherePanel
  js/dialogs/                okna (klasa Dialog)
```

Nowa akcja: metoda w odpowiednim serwisie w `src/domain/`, wpis w `Actions.js`, opis zdarzenia w `public/js/ui/eventText.js`.
