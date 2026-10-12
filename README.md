# PGA: centrum wyjazdu

Strona dla ekipy jadącej na PGA. Jedno wspólne hasło, bez kont:

- **Pomysły** – każdy dodaje (nazwa, link, rodzaj) i ocenia: bardzo chcę / chętnie / mogę
- **Kto co chce** – ranking pomysłów, kto jeszcze nie ocenił, historia zmian
- **Wspólny plan** – plansza dni × pory dnia, kafelki przeciąga każdy
- **Mój plan** – co mnie interesuje we wspólnym planie, „Nie mogę”, „Gdzie kto jest” (lokalizacja na 2 h)

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
- `TITLE` – nagłówek strony
- `DAYS` – dni i pory dnia, np. `Piątek:rano,popołudnie,wieczór;Sobota:rano,popołudnie,wieczór`

## Dane

Jeden plik `/data/pga.json` na wolumenie `pga-data` (lokalnie `data/pga.json`, poza repo).
Przy starcie serwer robi kopię do `data/backup/` (5 ostatnich).
Pobranie: link na dole strony albo `/api/export` (po zalogowaniu).

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
    Actions.js               akcje API: POST /api/<nazwa> → serwis
  http/
    HttpServer.js            trasy, odpowiedzi JSON
    Auth.js TokenSigner.js RateLimiter.js   hasło ekipy, tryb admina, limit prób
    StaticFiles.js           pliki z public/ z wersjami w adresach (?v=…)
public/
  app.js                     punkt wejścia strony
  js/App.js                  stan, odpytywanie serwera, zakładki, okna
  js/core/                   Api, Identity, Prefs, Toast, format, dom
  js/model/TripModel.js      pytania o stan: oceny, plan, bilans, przelewy
  js/ui/                     wspólne kawałki HTML, opisy historii
  js/views/                  zakładki (klasa View) + DragController, WherePanel
  js/dialogs/                okna (klasa Dialog)
```

Nowa akcja: metoda w odpowiednim serwisie w `src/domain/`, wpis w `Actions.js`, opis zdarzenia w `public/js/ui/eventText.js`.
