'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const UserError = require('../util/UserError');
const { clean, newId } = require('../util/text');

const MAX_CHUNK = 32 * 1024 * 1024;
const FREE_RESERVE = 1024 ** 3; // tyle miejsca na dysku zostaje zawsze wolne
const STALE_UPLOAD_MS = 24 * 3600e3;

/** CRC32 z zlib (Node 22+), a w starszym Node – tablicowo. */
const crc32 = zlib.crc32 || (() => {
  const table = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  return (buf, crc = 0) => {
    crc = ~crc;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return ~crc >>> 0;
  };
})();

/** Nazwa pliku od użytkownika: bez ścieżki i znaków zakazanych w Windows. */
function safeFileName(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop();
  return clean(base.replace(/[<>:"|?*]/g, '_'), 120).replace(/^\.+/, '') || 'plik';
}

/**
 * Zdjęcia i filmy z wyjazdu: pliki w `dir`, spis w osobnym pliku JSON
 * (nie w stanie wyjazdu, żeby nie spowalniać odpytywania).
 *
 * Wysyłanie w kawałkach: start() → append() aż do końca → plik trafia do spisu.
 * Przerwany kawałek nie psuje niczego: klient pyta o offset i wysyła dalej.
 *
 * Wpis w spisie: { id, name, size, crc, sha, by, byKey, at }
 */
class MediaStore {
  constructor(dir, store) {
    this.dir = dir;
    this.store = store;
    this.uploads = new Map(); // id → wysyłanie w toku (tylko w pamięci)
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.items = (this.store.read() || { items: [] }).items;
    // Niedokończone wysyłki sprzed restartu i tak by się nie dokończyły.
    for (const f of fs.readdirSync(this.dir)) if (f.endsWith('.part')) fs.unlinkSync(path.join(this.dir, f));
    return this;
  }

  fileOf(id) {
    return path.join(this.dir, id);
  }

  save() {
    this.store.write({ items: this.items });
  }

  get totalSize() {
    return this.items.reduce((sum, x) => sum + x.size, 0);
  }

  find(id) {
    return this.items.find(x => x.id === id);
  }

  /**
   * Zaczyna wysyłanie. Ten sam plik (nazwa i rozmiar) już jest →
   * `{ duplicate: true }` bez wysyłania.
   */
  start(actor, { file, size }) {
    const name = safeFileName(file);
    size = Number(size);
    if (!Number.isSafeInteger(size) || size <= 0) UserError.fail('Pusty plik.');
    if (this.items.some(x => x.name === name && x.size === size)) return { duplicate: true };
    this.sweepStale();
    if (size + this.reservedBytes() + FREE_RESERVE > this.freeBytes()) UserError.fail('Brak miejsca na serwerze.');

    const id = newId(crypto);
    const upload = { id, name, size, received: 0, by: actor.name, byKey: actor.key, busy: false, touched: Date.now() };
    fs.writeFileSync(this.partOf(upload), '');
    this.uploads.set(id, upload);
    return { id, offset: 0 };
  }

  /** Dopisuje kawałek z `stream` od `offset`. Zwraca { offset } albo gotowy wpis po ostatnim kawałku. */
  async append(id, offset, stream) {
    const upload = this.uploads.get(id);
    if (!upload) throw Object.assign(new UserError('Wysyłanie wygasło, zacznij od nowa.'), { status: 404 });
    if (upload.busy || offset !== upload.received) {
      throw Object.assign(new UserError('Zły offset.'), { status: 409, offset: upload.received });
    }
    upload.busy = true;
    upload.touched = Date.now();
    const handle = await fsp.open(this.partOf(upload), 'a');
    try {
      let chunkBytes = 0;
      for await (const chunk of stream) {
        chunkBytes += chunk.length;
        if (chunkBytes > MAX_CHUNK || upload.received + chunk.length > upload.size) UserError.fail('Za dużo danych.');
        await handle.write(chunk);
        upload.received += chunk.length;
      }
    } finally {
      await handle.close();
      upload.busy = false;
    }
    if (upload.received < upload.size) return { offset: upload.received };
    return this.finish(upload);
  }

  /** Ostatni kawałek doszedł: CRC (do ZIP-a), skrót (wykrywa duplikaty), wpis do spisu. */
  async finish(upload) {
    this.uploads.delete(upload.id);
    const part = this.partOf(upload);
    let crc = 0;
    const hash = crypto.createHash('sha256');
    for await (const buf of fs.createReadStream(part, { highWaterMark: 1 << 20 })) {
      crc = crc32(buf, crc);
      hash.update(buf);
    }
    const sha = hash.digest('hex');
    if (this.items.some(x => x.sha === sha)) {
      await fsp.unlink(part);
      return { duplicate: true };
    }
    await fsp.rename(part, this.fileOf(upload.id));
    const { id, name, size, by, byKey } = upload;
    const item = { id, name, size, crc, sha, by, byKey, at: Date.now() };
    this.items.push(item);
    this.save();
    return { done: true, item };
  }

  remove(id) {
    const item = this.find(id) || UserError.fail('Nie ma takiego pliku.');
    this.items = this.items.filter(x => x !== item);
    this.save();
    fs.rmSync(this.fileOf(item.id), { force: true });
    return item;
  }

  partOf(upload) {
    return path.join(this.dir, upload.id + '.part');
  }

  /** Miejsce zajęte przez rozpoczęte wysyłki, których jeszcze nie ma na dysku. */
  reservedBytes() {
    return [...this.uploads.values()].reduce((sum, u) => sum + u.size - u.received, 0);
  }

  freeBytes() {
    if (!fs.statfsSync) return Infinity;
    const s = fs.statfsSync(this.dir);
    return s.bavail * s.bsize;
  }

  sweepStale() {
    const now = Date.now();
    for (const upload of this.uploads.values()) {
      if (!upload.busy && now - upload.touched > STALE_UPLOAD_MS) {
        this.uploads.delete(upload.id);
        fs.rmSync(this.partOf(upload), { force: true });
      }
    }
  }
}

module.exports = MediaStore;
