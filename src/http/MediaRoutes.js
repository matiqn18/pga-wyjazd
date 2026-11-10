'use strict';
const Zip = require('../media/Zip');
const UserError = require('../util/UserError');
const { keyOf } = require('../util/text');

/** Nazwa folderu albo pliku w ZIP-ie: bez znaków zakazanych w Windows. */
const zipSafe = s => s.replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '') || '_';

/**
 * Trasy zdjęć i filmów (tylko ekipa):
 *   GET  /api/media                     – spis: [{ id, name, size, by, byKey, at }]
 *   POST /api/media/start               – { name, file, size } → { id, offset } albo { duplicate }
 *   PUT  /api/media/upload/<id>?offset= – surowy kawałek pliku → { offset } albo { done, item }
 *   POST /api/media/delete              – { name, id }: autor albo admin
 *   GET  /api/media/zip?by=<klucz>      – wszystko (albo jednej osoby) jako ZIP, folder na osobę
 */
class MediaRoutes {
  constructor({ media, trip, store, actions, auth, send, readJson }) {
    Object.assign(this, { media, trip, store, actions, auth, send, readJson });
  }

  /** Zwraca false, gdy adres nie jest trasą zdjęć. */
  async handle(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /api/media') return this.list(res);
    if (route === 'POST /api/media/start') return this.start(req, res);
    if (route === 'POST /api/media/delete') return this.remove(req, res);
    if (route === 'GET /api/media/zip') return this.zip(req, res, url);
    const upload = url.pathname.match(/^\/api\/media\/upload\/([\w-]+)$/);
    if (req.method === 'PUT' && upload) return this.upload(req, res, upload[1], Number(url.searchParams.get('offset')));
    return false;
  }

  /** Osoba z body.name (pierwsze wysłanie dopisuje ją do ekipy, jak każda akcja). */
  actor(name) {
    const { actor, changed } = this.actions.actor(name);
    if (changed) this.store.write(this.trip.data);
    return actor;
  }

  /** Aktualne imię autora (po zmianie imienia przez admina). */
  owner(item) {
    const key = this.actions.people.canonicalKey(item.byKey);
    return { key, name: this.trip.data.people[key]?.name || item.by };
  }

  list(res) {
    const items = this.media.items.map(x => {
      const owner = this.owner(x);
      return { id: x.id, name: x.name, size: x.size, at: x.at, by: owner.name, byKey: owner.key };
    });
    return this.send(res, 200, { items });
  }

  async start(req, res) {
    const body = await this.readJson(req);
    return this.send(res, 200, this.media.start(this.actor(body.name), body));
  }

  async upload(req, res, id, offset) {
    try {
      return this.send(res, 200, await this.media.append(id, offset, req));
    } catch (e) {
      if (e.status) return this.send(res, e.status, { error: e.message, offset: e.offset });
      if (e instanceof UserError) throw e;
      if (req.destroyed || e.code === 'ECONNRESET' || e.message === 'aborted') return; // klient zerwał połączenie
      throw e;
    }
  }

  async remove(req, res) {
    const body = await this.readJson(req);
    const actor = this.actor(body.name);
    const item = this.media.find(String(body.id ?? '')) || UserError.fail('Nie ma takiego pliku.');
    if (this.owner(item).key !== actor.key && !this.auth.isAdmin(req)) UserError.fail('Usunąć może tylko autor albo admin.');
    this.media.remove(item.id);
    return this.list(res);
  }

  async zip(req, res, url) {
    const by = url.searchParams.get('by');
    const chosen = this.media.items.filter(x => !by || this.owner(x).key === keyOf(by));
    if (!chosen.length) return this.send(res, 404, 'Nie ma żadnych plików.');

    const used = new Set();
    const files = chosen.map(x => {
      let name = `${zipSafe(this.owner(x).name)}/${zipSafe(x.name)}`;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${zipSafe(this.owner(x).name)}/${zipSafe(x.name).replace(/(\.[^.]*)?$/, ` (${n})$1`)}`;
      used.add(name.toLowerCase());
      return { path: this.media.fileOf(x.id), name, size: x.size, crc: x.crc, at: x.at };
    });

    const zip = new Zip(files);
    const day = new Date().toISOString().slice(0, 10);
    const label = by ? '-' + zipSafe(this.owner(chosen[0]).name) : '';
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': zip.length,
      'Content-Disposition': `attachment; filename="zdjecia-${day}.zip"; filename*=UTF-8''${encodeURIComponent(`zdjecia${label}-${day}.zip`)}`,
      'Cache-Control': 'no-store',
    });
    try {
      await zip.pipe(res);
    } catch (e) {
      if (!res.destroyed) console.error('ZIP przerwany:', e.message);
      res.destroy();
    }
  }
}

module.exports = MediaRoutes;
