'use strict';
// PGA: centrum wyjazdu – serwer bez zależności (http, fs, crypto).
// Kod aplikacji jest w src/: Config → JsonFileStore → Trip → Actions → HttpServer (+ MediaStore: zdjęcia).
const path = require('path');
const { Config } = require('./src/Config');
const JsonFileStore = require('./src/storage/JsonFileStore');
const Trip = require('./src/domain/Trip');
const Actions = require('./src/domain/Actions');
const HttpServer = require('./src/http/HttpServer');
const MediaStore = require('./src/media/MediaStore');

function start() {
  let config;
  try {
    config = Config.fromEnv(process.env, __dirname);
  } catch (e) {
    console.error(`Błąd w ustawieniach: ${e.message}`);
    process.exit(1);
  }
  const store = new JsonFileStore(config.dataDir);

  let trip, media;
  try {
    trip = Trip.load(store, config);
    store.assertWritable();
    media = new MediaStore(path.join(config.dataDir, 'media'), new JsonFileStore(config.dataDir, { name: 'media' })).load();
  } catch (e) {
    console.error(`Nie mogę czytać lub zapisywać danych w ${config.dataDir}: ${e.message}`);
    if (e.code === 'EACCES') {
      console.error(`Katalog musi należeć do użytkownika procesu (uid ${process.getuid?.()}). Na hoście: sudo chown -R 1000:1000 data`);
    }
    process.exit(1);
  }

  new HttpServer({ config, trip, store, actions: new Actions(trip), media }).listen();
}

start();
