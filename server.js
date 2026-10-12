'use strict';
// PGA: centrum wyjazdu – serwer bez zależności (http, fs, crypto).
// Kod aplikacji jest w src/: Config → JsonFileStore → Trip → Actions → HttpServer.
const { Config } = require('./src/Config');
const JsonFileStore = require('./src/storage/JsonFileStore');
const Trip = require('./src/domain/Trip');
const Actions = require('./src/domain/Actions');
const HttpServer = require('./src/http/HttpServer');

function start() {
  let config;
  try {
    config = Config.fromEnv(process.env, __dirname);
  } catch (e) {
    console.error(`Błąd w ustawieniach: ${e.message}`);
    process.exit(1);
  }
  const store = new JsonFileStore(config.dataDir);

  let trip;
  try {
    trip = Trip.load(store, config);
    store.assertWritable();
  } catch (e) {
    console.error(`Nie mogę czytać lub zapisywać danych w ${config.dataDir}: ${e.message}`);
    if (e.code === 'EACCES') {
      console.error(`Katalog musi należeć do użytkownika procesu (uid ${process.getuid?.()}). Na hoście: sudo chown -R 1000:1000 data`);
    }
    process.exit(1);
  }

  new HttpServer({ config, trip, store, actions: new Actions(trip) }).listen();
}

start();
